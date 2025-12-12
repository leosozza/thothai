import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// W-API base URL
const WAPI_BASE_URL = "https://api.w-api.app";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Get auth token from request
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create client with user's JWT
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { instanceId, workspaceId, action } = await req.json();
    console.log("W-API Connect request:", { instanceId, workspaceId, action });

    // Get W-API integration config
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    const { data: integration, error: intError } = await supabaseAdmin
      .from("integrations")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("type", "wapi")
      .eq("is_active", true)
      .single();

    if (intError || !integration) {
      console.error("Integration error:", intError);
      return new Response(JSON.stringify({ 
        error: "W-API não configurada. Vá em Integrações para adicionar sua API Key." 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const config = integration.config as { api_key?: string; instance_id?: string };
    const wapiApiKey = config?.api_key;
    const wapiInstanceId = config?.instance_id;
    
    if (!wapiApiKey) {
      return new Response(JSON.stringify({ 
        error: "API Key da W-API não encontrada na configuração." 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!wapiInstanceId) {
      return new Response(JSON.stringify({ 
        error: "Instance ID da W-API não encontrado na configuração." 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Using W-API instance:", wapiInstanceId);

    // Verify instance belongs to user
    const { data: instance, error: instanceError } = await supabaseAdmin
      .from("instances")
      .select("*")
      .eq("id", instanceId)
      .eq("user_id", user.id)
      .single();

    if (instanceError || !instance) {
      return new Response(JSON.stringify({ error: "Instância não encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Save W-API instance key to our instance
    await supabaseAdmin
      .from("instances")
      .update({ 
        instance_key: wapiInstanceId,
        workspace_id: workspaceId,
        status: "connecting",
        updated_at: new Date().toISOString()
      })
      .eq("id", instanceId);

    // Configure webhook URL
    const webhookUrl = `${supabaseUrl}/functions/v1/wapi-webhook?instance_id=${instanceId}`;
    console.log("Configuring webhook URL:", webhookUrl);

    // Update webhooks - using correct W-API endpoints
    const webhookEndpoints = [
      "update-webhook-received",
      "update-webhook-connected", 
      "update-webhook-disconnected",
      "update-webhook-status",
    ];

    for (const endpoint of webhookEndpoints) {
      try {
        const webhookResponse = await fetch(
          `${WAPI_BASE_URL}/v1/webhook/${endpoint}?instanceId=${wapiInstanceId}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${wapiApiKey}`,
            },
            body: JSON.stringify({ webhookUrl }),
          }
        );
        
        if (webhookResponse.ok) {
          console.log(`Webhook ${endpoint} configured successfully`);
        } else {
          const webhookError = await webhookResponse.text();
          console.warn(`Failed to configure ${endpoint}:`, webhookError.substring(0, 100));
        }
      } catch (e) {
        console.warn(`Error configuring ${endpoint}:`, e);
      }
    }

    // Check instance status first
    console.log("Checking instance status...");
    
    const statusResponse = await fetch(
      `${WAPI_BASE_URL}/v1/instance/status?instanceId=${wapiInstanceId}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${wapiApiKey}`,
        },
      }
    );

    console.log("Status response:", statusResponse.status);

    if (statusResponse.ok) {
      const statusData = await statusResponse.json();
      console.log("Instance status data:", JSON.stringify(statusData));

      // Check if connected
      const isConnected = statusData.connected === true || 
                          statusData.status === "CONNECTED" ||
                          statusData.state === "CONNECTED" ||
                          statusData.state === "open";

      if (isConnected) {
        await supabaseAdmin
          .from("instances")
          .update({ 
            status: "connected",
            phone_number: statusData.phone || statusData.phoneNumber || statusData.me?.id || instance.phone_number,
            qr_code: null,
            updated_at: new Date().toISOString()
          })
          .eq("id", instanceId);

        return new Response(JSON.stringify({ 
          success: true, 
          status: "connected",
          phone: statusData.phone || statusData.phoneNumber || statusData.me?.id
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      const statusError = await statusResponse.text();
      console.log("Status error:", statusError.substring(0, 200));
    }

    // Request QR Code - try multiple endpoints
    const qrEndpoints = [
      "/v1/qr-code/text",
      "/v1/qr-code/base64", 
      "/v1/instance/qr-code/text",
      "/v1/instance/qr-code/base64",
      "/v1/instance/qr-code",
    ];

    for (const qrEndpoint of qrEndpoints) {
      console.log(`Trying QR endpoint: ${qrEndpoint}`);
      
      try {
        const qrResponse = await fetch(
          `${WAPI_BASE_URL}${qrEndpoint}?instanceId=${wapiInstanceId}`,
          {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${wapiApiKey}`,
            },
          }
        );

        console.log(`QR ${qrEndpoint} status:`, qrResponse.status);

        if (qrResponse.ok) {
          const qrData = await qrResponse.json();
          console.log(`QR ${qrEndpoint} data keys:`, Object.keys(qrData));
          console.log(`QR ${qrEndpoint} full data:`, JSON.stringify(qrData));
          
          // Check if already connected (W-API returns connected:true when no QR needed)
          if (qrData.connected === true) {
            console.log("Instance already connected via QR endpoint response");
            await supabaseAdmin
              .from("instances")
              .update({ 
                status: "connected",
                qr_code: null,
                updated_at: new Date().toISOString()
              })
              .eq("id", instanceId);

            return new Response(JSON.stringify({ 
              success: true, 
              status: "connected",
              message: "Instância já conectada!"
            }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          
          // Try different possible QR code field names
          const qrCode = qrData.qrcode || qrData.qr || qrData.base64 || 
                         qrData.qrCode || qrData.qr_code || qrData.data?.qrcode ||
                         qrData.data?.base64 || qrData.image || qrData.code ||
                         qrData.result || qrData.text;

          if (qrCode) {
            await supabaseAdmin
              .from("instances")
              .update({ 
                qr_code: qrCode,
                status: "qr_pending",
                updated_at: new Date().toISOString()
              })
              .eq("id", instanceId);

            return new Response(JSON.stringify({ 
              success: true, 
              qr_code: qrCode,
              status: "qr_pending"
            }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }
      } catch (e) {
        console.warn(`Error with ${qrEndpoint}:`, e);
      }
    }

    // Return connecting status if no QR yet
    return new Response(JSON.stringify({ 
      success: true, 
      status: "connecting",
      message: "Aguardando QR Code. A instância W-API pode já estar conectada ou aguardando no painel."
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("W-API Connect error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

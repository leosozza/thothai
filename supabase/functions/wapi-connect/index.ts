import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// W-API base URL - Usando a URL correta da documentação
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

    // Update webhooks usando os endpoints corretos da W-API
    const webhookEndpoints = [
      { endpoint: "update-webhook-messages", name: "messages" },
      { endpoint: "update-webhook-connected", name: "connected" },
      { endpoint: "update-webhook-disconnected", name: "disconnected" },
      { endpoint: "update-webhook-qr-code", name: "qr-code" },
      { endpoint: "update-webhook-message-status", name: "message-status" },
    ];

    for (const wh of webhookEndpoints) {
      try {
        const webhookResponse = await fetch(
          `${WAPI_BASE_URL}/v1/webhook/${wh.endpoint}?instanceId=${wapiInstanceId}`,
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
          console.log(`Webhook ${wh.name} configured successfully`);
        } else {
          const webhookError = await webhookResponse.text();
          console.warn(`Failed to configure webhook ${wh.name}:`, webhookError);
        }
      } catch (e) {
        console.warn(`Error configuring webhook ${wh.name}:`, e);
      }
    }

    // Get instance status first
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

    if (statusResponse.ok) {
      const statusData = await statusResponse.json();
      console.log("Instance status:", statusData);

      // Check if already connected
      if (statusData.status === "CONNECTED" || statusData.connected === true) {
        await supabaseAdmin
          .from("instances")
          .update({ 
            status: "connected",
            phone_number: statusData.phone || statusData.phoneNumber || instance.phone_number,
            qr_code: null,
            updated_at: new Date().toISOString()
          })
          .eq("id", instanceId);

        return new Response(JSON.stringify({ 
          success: true, 
          status: "connected",
          phone: statusData.phone || statusData.phoneNumber
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Request QR Code
    console.log("Requesting QR Code...");
    
    const qrResponse = await fetch(
      `${WAPI_BASE_URL}/v1/instance/qrcode?instanceId=${wapiInstanceId}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${wapiApiKey}`,
        },
      }
    );

    console.log("QR response status:", qrResponse.status);

    if (qrResponse.ok) {
      const qrData = await qrResponse.json();
      console.log("QR data keys:", Object.keys(qrData));
      
      // Try different possible QR code field names
      const qrCode = qrData.qrcode || qrData.qr || qrData.base64 || 
                     qrData.qrCode || qrData.qr_code || qrData.data?.qrcode ||
                     qrData.data?.base64 || qrData.image;

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

      // If no QR code but we got a response, return the full data for debugging
      console.log("Full QR response data:", JSON.stringify(qrData));
      
      return new Response(JSON.stringify({ 
        success: true, 
        status: "connecting",
        message: "Aguardando QR Code...",
        debug: qrData
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Try alternative QR endpoint
    console.log("Trying alternative QR endpoint...");
    
    const qrAltResponse = await fetch(
      `${WAPI_BASE_URL}/v1/instance/qr-code/base64?instanceId=${wapiInstanceId}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${wapiApiKey}`,
        },
      }
    );

    if (qrAltResponse.ok) {
      const qrAltData = await qrAltResponse.json();
      console.log("Alt QR data:", qrAltData);
      
      const qrCode = qrAltData.qrcode || qrAltData.base64 || qrAltData.qr || 
                     qrAltData.data?.base64 || qrAltData.image;

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

    const errorText = await qrResponse.text();
    console.error("QR fetch error:", errorText);

    return new Response(JSON.stringify({ 
      success: false, 
      status: "connecting",
      message: "Aguardando QR Code da W-API. Tente novamente em alguns segundos.",
      error: errorText
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

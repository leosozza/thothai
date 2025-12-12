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

    // Update webhook on W-API
    try {
      const webhookResponse = await fetch(
        `${WAPI_BASE_URL}/v1/config/update-webhook-global?instanceId=${wapiInstanceId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${wapiApiKey}`,
          },
          body: JSON.stringify({ 
            webhookUrl: webhookUrl,
            webhookEvents: ["messages", "qr", "authenticated", "disconnected", "message_ack"]
          }),
        }
      );
      
      if (webhookResponse.ok) {
        console.log("Webhook configured successfully");
      } else {
        const webhookError = await webhookResponse.text();
        console.warn("Failed to configure webhook:", webhookError);
      }
    } catch (e) {
      console.warn("Error configuring webhook:", e);
    }

    // Request connection / QR Code
    console.log("Requesting connection...");
    
    const connectResponse = await fetch(
      `${WAPI_BASE_URL}/v1/instance/connect?instanceId=${wapiInstanceId}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${wapiApiKey}`,
        },
      }
    );

    console.log("Connect response status:", connectResponse.status);
    
    if (!connectResponse.ok) {
      const errorText = await connectResponse.text();
      console.error("W-API connect error:", errorText);
      
      // Try to get QR code directly with different endpoint
      const qrResponse = await fetch(
        `${WAPI_BASE_URL}/v1/instance/qr-code/image?instanceId=${wapiInstanceId}`,
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
        console.log("QR data:", qrData);
        
        const qrCode = qrData.qrcode || qrData.qr || qrData.base64 || qrData.data?.qrcode;

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

      return new Response(JSON.stringify({ 
        error: "Erro ao conectar na W-API. Verifique se a instância existe e está ativa.",
        details: errorText
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const connectData = await connectResponse.json();
    console.log("Connect response data:", connectData);

    // Check if already connected
    if (connectData.status === "connected" || connectData.connected === true) {
      await supabaseAdmin
        .from("instances")
        .update({ 
          status: "connected",
          phone_number: connectData.phone || connectData.phoneNumber || instance.phone_number,
          qr_code: null,
          updated_at: new Date().toISOString()
        })
        .eq("id", instanceId);

      return new Response(JSON.stringify({ 
        success: true, 
        status: "connected",
        phone: connectData.phone || connectData.phoneNumber
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get QR Code from response
    const qrCode = connectData.qrcode || connectData.qr || connectData.base64 || 
                   connectData.data?.qrcode || connectData.data?.base64;
    
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

    // No QR yet, try to get it
    console.log("No QR in connect response, fetching QR code...");
    
    const qrFetchResponse = await fetch(
      `${WAPI_BASE_URL}/v1/instance/qr-code/image?instanceId=${wapiInstanceId}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${wapiApiKey}`,
        },
      }
    );

    if (qrFetchResponse.ok) {
      const qrFetchData = await qrFetchResponse.json();
      console.log("QR fetch data:", qrFetchData);
      
      const fetchedQr = qrFetchData.qrcode || qrFetchData.qr || qrFetchData.base64 || 
                        qrFetchData.data?.qrcode || qrFetchData.data?.base64;
      
      if (fetchedQr) {
        await supabaseAdmin
          .from("instances")
          .update({ 
            qr_code: fetchedQr,
            status: "qr_pending",
            updated_at: new Date().toISOString()
          })
          .eq("id", instanceId);

        return new Response(JSON.stringify({ 
          success: true, 
          qr_code: fetchedQr,
          status: "qr_pending"
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Return current status
    return new Response(JSON.stringify({ 
      success: true, 
      status: "connecting",
      message: "Aguardando QR Code da W-API...",
      connectData
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

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WAPI_BASE_URL = "https://api.w-api.app/v1";

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
      return new Response(JSON.stringify({ 
        error: "W-API não configurada. Vá em Integrações para adicionar sua API Key." 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const config = integration.config as { api_key?: string; instance_id?: string };
    const wapiApiKey = config?.api_key;
    
    if (!wapiApiKey) {
      return new Response(JSON.stringify({ 
        error: "API Key da W-API não encontrada na configuração." 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    const webhookUrl = `${supabaseUrl}/functions/v1/wapi-webhook?instance_id=${instanceId}`;
    let wapiInstanceId = instance.instance_key;

    // If no W-API instance exists, create one
    if (!wapiInstanceId) {
      console.log("Creating new W-API instance...");
      
      const createResponse = await fetch(`${WAPI_BASE_URL}/instance/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${wapiApiKey}`,
        },
        body: JSON.stringify({
          webhookUrl: webhookUrl,
          webhookEvents: ["messages", "qr", "authenticated", "disconnected", "message_ack"],
        }),
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.error("W-API create instance error:", errorText);
        return new Response(JSON.stringify({ error: "Erro ao criar instância na W-API" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const createData = await createResponse.json();
      wapiInstanceId = createData.id || createData.instance_id || createData.instanceId;
      
      console.log("W-API instance created:", wapiInstanceId);

      // Save instance_key
      await supabaseAdmin
        .from("instances")
        .update({ 
          instance_key: wapiInstanceId,
          status: "connecting",
          updated_at: new Date().toISOString()
        })
        .eq("id", instanceId);
    }

    // Configure webhooks
    console.log("Configuring webhooks for instance:", wapiInstanceId);
    
    const webhookEndpoints = [
      "update-webhook-messages",
      "update-webhook-connection", 
      "update-webhook-ack",
    ];

    for (const endpoint of webhookEndpoints) {
      try {
        await fetch(`${WAPI_BASE_URL}/webhook/${endpoint}?instanceId=${wapiInstanceId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${wapiApiKey}`,
          },
          body: JSON.stringify({ webhookUrl }),
        });
      } catch (e) {
        console.warn(`Failed to configure ${endpoint}:`, e);
      }
    }

    // Request QR Code / Connect
    console.log("Requesting QR Code...");
    
    const connectResponse = await fetch(
      `${WAPI_BASE_URL}/instance/connect?instanceId=${wapiInstanceId}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${wapiApiKey}`,
        },
      }
    );

    if (!connectResponse.ok) {
      const errorText = await connectResponse.text();
      console.error("W-API connect error:", errorText);
      
      // Try to get QR code directly
      const qrResponse = await fetch(
        `${WAPI_BASE_URL}/instance/qrcode?instanceId=${wapiInstanceId}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${wapiApiKey}`,
          },
        }
      );

      if (qrResponse.ok) {
        const qrData = await qrResponse.json();
        const qrCode = qrData.qrcode || qrData.qr || qrData.data?.qrcode;

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

      return new Response(JSON.stringify({ error: "Erro ao conectar na W-API" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const connectData = await connectResponse.json();
    console.log("Connect response:", connectData);

    // Check if already connected
    if (connectData.status === "connected" || connectData.connected) {
      await supabaseAdmin
        .from("instances")
        .update({ 
          status: "connected",
          phone_number: connectData.phone || instance.phone_number,
          qr_code: null,
          updated_at: new Date().toISOString()
        })
        .eq("id", instanceId);

      return new Response(JSON.stringify({ 
        success: true, 
        status: "connected",
        phone: connectData.phone
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get QR Code
    const qrCode = connectData.qrcode || connectData.qr || connectData.data?.qrcode;
    
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

    // No QR yet, return current status
    return new Response(JSON.stringify({ 
      success: true, 
      status: "connecting",
      message: "Aguardando QR Code da W-API..."
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

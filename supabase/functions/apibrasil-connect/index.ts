import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APIBRASIL_BASE_URL = "https://gateway.apibrasil.io/api/v2";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json();
    console.log("APIBrasil Connect request:", JSON.stringify(body));

    const {
      instanceId,
      workspaceId,
      action = "connect",
      secretKey,
      deviceToken,
      publicToken,
      bearerToken,
    } = body;

    if (!instanceId) {
      return new Response(JSON.stringify({ error: "instanceId é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get or validate credentials
    let credentials = { secretKey, deviceToken, publicToken, bearerToken };

    if (!secretKey || !deviceToken || !publicToken || !bearerToken) {
      // Fetch from database
      const { data: instance } = await supabase
        .from("instances")
        .select("*")
        .eq("id", instanceId)
        .single();

      if (!instance) {
        return new Response(JSON.stringify({ error: "Instância não encontrada" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      credentials = {
        secretKey: instance.apibrasil_secret_key,
        deviceToken: instance.apibrasil_device_token,
        publicToken: instance.apibrasil_public_token,
        bearerToken: instance.apibrasil_bearer_token,
      };

      if (!credentials.secretKey || !credentials.deviceToken || !credentials.publicToken || !credentials.bearerToken) {
        return new Response(JSON.stringify({ error: "Credenciais APIBrasil não configuradas" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const headers = {
      "Content-Type": "application/json",
      "SecretKey": credentials.secretKey,
      "DeviceToken": credentials.deviceToken,
      "PublicToken": credentials.publicToken,
      "Authorization": `Bearer ${credentials.bearerToken}`,
    };

    // Handle different actions
    switch (action) {
      case "validate": {
        // Validate credentials by checking device status
        try {
          const response = await fetch(`${APIBRASIL_BASE_URL}/whatsapp/status`, {
            method: "GET",
            headers,
          });

          const responseText = await response.text();
          console.log("APIBrasil validation response:", response.status, responseText);

          if (!response.ok) {
            return new Response(JSON.stringify({ 
              error: "Credenciais inválidas ou dispositivo não encontrado",
              details: responseText
            }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          return new Response(JSON.stringify({ 
            success: true, 
            message: "Credenciais válidas" 
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (error) {
          console.error("APIBrasil validation error:", error);
          return new Response(JSON.stringify({ 
            error: "Erro ao validar credenciais",
            details: String(error)
          }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      case "setup": {
        // Save credentials and configure webhook
        const webhookUrl = `${supabaseUrl}/functions/v1/apibrasil-webhook?instanceId=${instanceId}`;

        // Save credentials to database
        const { error: updateError } = await supabase
          .from("instances")
          .update({
            apibrasil_secret_key: credentials.secretKey,
            apibrasil_device_token: credentials.deviceToken,
            apibrasil_public_token: credentials.publicToken,
            apibrasil_bearer_token: credentials.bearerToken,
            provider_type: "apibrasil",
            connection_type: "waba",
            status: "connecting",
          })
          .eq("id", instanceId);

        if (updateError) {
          console.error("Error saving credentials:", updateError);
          return new Response(JSON.stringify({ error: "Erro ao salvar credenciais" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Configure webhook
        try {
          const webhookResponse = await fetch(`${APIBRASIL_BASE_URL}/whatsapp/setWebhook`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              webhookUrl: webhookUrl,
              webhookEnabled: true,
            }),
          });

          const webhookResult = await webhookResponse.text();
          console.log("Webhook setup response:", webhookResponse.status, webhookResult);

          if (!webhookResponse.ok) {
            console.warn("Webhook setup may have failed:", webhookResult);
          }
        } catch (webhookError) {
          console.error("Webhook setup error:", webhookError);
        }

        return new Response(JSON.stringify({ 
          success: true, 
          message: "Credenciais salvas. Iniciando conexão..." 
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "connect": {
        // Get QR Code or check connection status
        try {
          // First check current status
          const statusResponse = await fetch(`${APIBRASIL_BASE_URL}/whatsapp/status`, {
            method: "GET",
            headers,
          });

          const statusText = await statusResponse.text();
          console.log("Status response:", statusResponse.status, statusText);

          let statusData;
          try {
            statusData = JSON.parse(statusText);
          } catch {
            statusData = { raw: statusText };
          }

          // Check if already connected
          if (statusData?.connected === true || statusData?.status === "CONNECTED" || statusData?.state === "open") {
            // Update instance as connected
            const phoneNumber = statusData?.phone || statusData?.number || statusData?.wid?.replace("@s.whatsapp.net", "");
            
            await supabase
              .from("instances")
              .update({
                status: "connected",
                phone_number: phoneNumber || null,
                qr_code: null,
              })
              .eq("id", instanceId);

            return new Response(JSON.stringify({ 
              success: true, 
              status: "connected",
              phone_number: phoneNumber
            }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Not connected, get QR Code
          const qrResponse = await fetch(`${APIBRASIL_BASE_URL}/whatsapp/start`, {
            method: "POST",
            headers,
            body: JSON.stringify({}),
          });

          const qrText = await qrResponse.text();
          console.log("QR Code response:", qrResponse.status, qrText.substring(0, 200));

          let qrData;
          try {
            qrData = JSON.parse(qrText);
          } catch {
            qrData = { raw: qrText };
          }

          const qrCode = qrData?.qrcode || qrData?.qr || qrData?.base64 || qrData?.data?.qrcode;

          if (qrCode) {
            // Update instance with QR Code
            await supabase
              .from("instances")
              .update({
                status: "qr_pending",
                qr_code: qrCode,
              })
              .eq("id", instanceId);

            return new Response(JSON.stringify({ 
              success: true, 
              status: "qr_pending",
              qr_code: qrCode
            }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          return new Response(JSON.stringify({ 
            success: true, 
            status: "connecting",
            message: "Aguardando QR Code..."
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });

        } catch (error) {
          console.error("Connect error:", error);
          return new Response(JSON.stringify({ 
            error: "Erro ao conectar",
            details: String(error)
          }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      case "disconnect": {
        try {
          const response = await fetch(`${APIBRASIL_BASE_URL}/whatsapp/logout`, {
            method: "POST",
            headers,
          });

          const responseText = await response.text();
          console.log("Logout response:", response.status, responseText);

          // Update instance status
          await supabase
            .from("instances")
            .update({
              status: "disconnected",
              phone_number: null,
              qr_code: null,
            })
            .eq("id", instanceId);

          return new Response(JSON.stringify({ 
            success: true, 
            message: "Desconectado com sucesso" 
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (error) {
          console.error("Disconnect error:", error);
          return new Response(JSON.stringify({ 
            error: "Erro ao desconectar",
            details: String(error)
          }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      default:
        return new Response(JSON.stringify({ error: `Ação desconhecida: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

  } catch (error) {
    console.error("APIBrasil Connect error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

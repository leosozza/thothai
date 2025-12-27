import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Base URL da APIBrasil Evolution
const APIBRASIL_BASE_URL = "https://gateway.apibrasil.io/api/v2/evolution";

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
      deviceToken,
      bearerToken,
    } = body;

    if (!instanceId) {
      return new Response(JSON.stringify({ error: "instanceId é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get or validate credentials (apenas 2 campos agora)
    let credentials = { deviceToken, bearerToken };

    if (!deviceToken || !bearerToken) {
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
        deviceToken: instance.apibrasil_device_token,
        bearerToken: instance.apibrasil_bearer_token,
      };

      if (!credentials.deviceToken || !credentials.bearerToken) {
        return new Response(JSON.stringify({ error: "Credenciais APIBrasil não configuradas (DeviceToken e BearerToken são obrigatórios)" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Headers corretos conforme documentação - apenas 2 headers de auth
    const headers = {
      "Content-Type": "application/json",
      "DeviceToken": credentials.deviceToken,
      "Authorization": `Bearer ${credentials.bearerToken}`,
    };

    // Handle different actions
    switch (action) {
      case "validate": {
        // Validate credentials by checking connection state
        try {
          const response = await fetch(`${APIBRASIL_BASE_URL}/instance/connectionState`, {
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
        // Save credentials (webhook deve ser configurado no painel APIBrasil)
        const webhookUrl = `${supabaseUrl}/functions/v1/apibrasil-webhook?instanceId=${instanceId}`;

        // Save credentials to database (apenas os 2 campos necessários)
        const { error: updateError } = await supabase
          .from("instances")
          .update({
            apibrasil_device_token: credentials.deviceToken,
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

        // Tentar configurar webhook via API (endpoint pode variar)
        try {
          const webhookResponse = await fetch(`${APIBRASIL_BASE_URL}/webhook/set`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              url: webhookUrl,
              webhook_by_events: false,
              webhook_base64: false,
              events: [
                "QRCODE_UPDATED",
                "CONNECTION_UPDATE",
                "MESSAGES_UPSERT",
                "MESSAGES_UPDATE",
                "SEND_MESSAGE"
              ]
            }),
          });

          const webhookResult = await webhookResponse.text();
          console.log("Webhook setup response:", webhookResponse.status, webhookResult);

          if (!webhookResponse.ok) {
            console.warn("Webhook setup via API falhou. Configure manualmente no painel APIBrasil:", webhookUrl);
          }
        } catch (webhookError) {
          console.warn("Webhook setup error (configure manualmente):", webhookError);
        }

        return new Response(JSON.stringify({ 
          success: true, 
          message: "Credenciais salvas. Iniciando conexão...",
          webhook_url: webhookUrl,
          webhook_note: "Configure este webhook no painel APIBrasil se não foi configurado automaticamente"
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "connect": {
        // Get QR Code or check connection status
        try {
          // First check current status usando endpoint correto
          const statusResponse = await fetch(`${APIBRASIL_BASE_URL}/instance/connectionState`, {
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

          // Check if already connected (formato Evolution API)
          const instanceState = statusData?.instance?.state || statusData?.state;
          if (instanceState === "open" || statusData?.connected === true) {
            // Update instance as connected
            const phoneNumber = statusData?.instance?.owner?.split("@")[0] || 
                               statusData?.phone || 
                               statusData?.number;
            
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

          // Not connected, get QR Code usando endpoint correto
          const qrResponse = await fetch(`${APIBRASIL_BASE_URL}/instance/connect`, {
            method: "GET",
            headers,
          });

          const qrText = await qrResponse.text();
          console.log("QR Code response:", qrResponse.status, qrText.substring(0, 500));

          let qrData;
          try {
            qrData = JSON.parse(qrText);
          } catch {
            qrData = { raw: qrText };
          }

          // Extrair QR Code (formatos possíveis)
          const qrCode = qrData?.base64 || 
                        qrData?.qrcode?.base64 || 
                        qrData?.qr || 
                        qrData?.code;

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

          // Se não tem QR mas também não está conectado, pode estar conectando
          if (instanceState === "connecting") {
            return new Response(JSON.stringify({ 
              success: true, 
              status: "connecting",
              message: "Aguardando conexão..."
            }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          return new Response(JSON.stringify({ 
            success: true, 
            status: "connecting",
            message: "Aguardando QR Code...",
            debug: qrData
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
          // Endpoint correto é DELETE /instance/logout
          const response = await fetch(`${APIBRASIL_BASE_URL}/instance/logout`, {
            method: "DELETE",
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

      case "restart": {
        try {
          // Reiniciar instância
          const response = await fetch(`${APIBRASIL_BASE_URL}/instance/restart`, {
            method: "PUT",
            headers,
          });

          const responseText = await response.text();
          console.log("Restart response:", response.status, responseText);

          return new Response(JSON.stringify({ 
            success: true, 
            message: "Instância reiniciada" 
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (error) {
          console.error("Restart error:", error);
          return new Response(JSON.stringify({ 
            error: "Erro ao reiniciar",
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

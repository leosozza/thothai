import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const { instanceId, workspaceId, action, evolutionInstanceName: requestEvolutionName } = await req.json();
    console.log("Evolution Connect request:", { instanceId, workspaceId, action, requestEvolutionName });

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Get Evolution API integration config from workspace
    const { data: integration, error: intError } = await supabaseAdmin
      .from("integrations")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("type", "evolution")
      .eq("is_active", true)
      .single();

    if (intError || !integration) {
      console.error("Integration error:", intError);
      return new Response(JSON.stringify({ 
        error: "Evolution API não configurada. Vá em Configurações → Instâncias para configurar." 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const config = integration.config as { 
      server_url?: string; 
      api_key?: string;
    };
    
    const evolutionServerUrl = config?.server_url?.replace(/\/$/, ""); // Remove trailing slash
    const evolutionApiKey = config?.api_key;
    
    if (!evolutionServerUrl || !evolutionApiKey) {
      return new Response(JSON.stringify({ 
        error: "Configuração da Evolution API incompleta. Verifique URL do servidor e API Key." 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Using Evolution server:", evolutionServerUrl);

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

    // Generate instance name for Evolution (use existing or create new)
    const evolutionInstanceName = instance.evolution_instance_name || 
      `thoth_${instanceId.replace(/-/g, "").substring(0, 16)}`;

    console.log("Evolution instance name:", evolutionInstanceName);

    // Update instance with Evolution info
    await supabaseAdmin
      .from("instances")
      .update({ 
        provider_type: "evolution",
        evolution_instance_name: evolutionInstanceName,
        workspace_id: workspaceId,
        status: "connecting",
        updated_at: new Date().toISOString()
      })
      .eq("id", instanceId);

    // Configure webhook URL
    const webhookUrl = `${supabaseUrl}/functions/v1/evolution-webhook?instance_id=${instanceId}`;
    console.log("Webhook URL:", webhookUrl);

    // Action: logout - Disconnect WhatsApp session
    if (action === "logout") {
      console.log("Logging out Evolution instance...");
      
      try {
        const logoutResponse = await fetch(
          `${evolutionServerUrl}/instance/logout/${evolutionInstanceName}`,
          {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
              "apikey": evolutionApiKey,
            },
          }
        );

        if (logoutResponse.ok) {
          await supabaseAdmin
            .from("instances")
            .update({ 
              status: "disconnected",
              qr_code: null,
              phone_number: null,
              updated_at: new Date().toISOString()
            })
            .eq("id", instanceId);

          return new Response(JSON.stringify({ 
            success: true, 
            message: "WhatsApp desconectado com sucesso"
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } else {
          const errorText = await logoutResponse.text();
          console.error("Logout failed:", errorText);
          return new Response(JSON.stringify({ 
            error: `Erro ao desconectar: ${errorText}` 
          }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (logoutError) {
        console.error("Logout error:", logoutError);
        return new Response(JSON.stringify({ 
          error: `Erro ao desconectar: ${logoutError}` 
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Action: delete - Delete instance from Evolution server
    if (action === "delete") {
      console.log("Deleting Evolution instance...");
      
      try {
        const deleteResponse = await fetch(
          `${evolutionServerUrl}/instance/delete/${evolutionInstanceName}`,
          {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
              "apikey": evolutionApiKey,
            },
          }
        );

        if (deleteResponse.ok || deleteResponse.status === 404) {
          // Update local instance status
          await supabaseAdmin
            .from("instances")
            .update({ 
              status: "disconnected",
              qr_code: null,
              evolution_instance_name: null,
              updated_at: new Date().toISOString()
            })
            .eq("id", instanceId);

          return new Response(JSON.stringify({ 
            success: true, 
            message: "Instância Evolution removida com sucesso"
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } else {
          const errorText = await deleteResponse.text();
          console.error("Delete failed:", errorText);
          return new Response(JSON.stringify({ 
            error: `Erro ao remover: ${errorText}` 
          }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (deleteError) {
        console.error("Delete error:", deleteError);
        return new Response(JSON.stringify({ 
          error: `Erro ao remover: ${deleteError}` 
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Action: create - Create new instance on Evolution
    if (action === "create" || !instance.evolution_instance_name) {
      console.log("Creating new Evolution instance...");
      
      try {
        // Check if instance already exists
        const checkResponse = await fetch(
          `${evolutionServerUrl}/instance/fetchInstances`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              "apikey": evolutionApiKey,
            },
          }
        );

        let instanceExists = false;
        if (checkResponse.ok) {
          const instances = await checkResponse.json();
          instanceExists = Array.isArray(instances) && 
            instances.some((i: any) => i.name === evolutionInstanceName || i.instance?.instanceName === evolutionInstanceName);
        }

        if (!instanceExists) {
          // Create new instance
          const createResponse = await fetch(
            `${evolutionServerUrl}/instance/create`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "apikey": evolutionApiKey,
              },
              body: JSON.stringify({
                instanceName: evolutionInstanceName,
                qrcode: true,
                integration: "WHATSAPP-BAILEYS",
                webhook: {
                  url: webhookUrl,
                  byEvents: false,
                  base64: false,
                  headers: {},
                  events: [
                    "MESSAGES_UPSERT",
                    "MESSAGES_UPDATE",
                    "CONNECTION_UPDATE",
                    "QRCODE_UPDATED",
                    "SEND_MESSAGE"
                  ]
                }
              }),
            }
          );

          if (!createResponse.ok) {
            const errorText = await createResponse.text();
            console.error("Failed to create Evolution instance:", errorText);
            
            // Try without webhook config (some versions don't support it in create)
            const createResponse2 = await fetch(
              `${evolutionServerUrl}/instance/create`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "apikey": evolutionApiKey,
                },
                body: JSON.stringify({
                  instanceName: evolutionInstanceName,
                  qrcode: true,
                  integration: "WHATSAPP-BAILEYS"
                }),
              }
            );

            if (!createResponse2.ok) {
              const errorText2 = await createResponse2.text();
              console.error("Failed to create Evolution instance (retry):", errorText2);
              return new Response(JSON.stringify({ 
                error: `Erro ao criar instância: ${errorText2}` 
              }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
          }

          console.log("Evolution instance created successfully");
        }

        // Configure webhook separately (for older versions)
        try {
          await fetch(
            `${evolutionServerUrl}/webhook/set/${evolutionInstanceName}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "apikey": evolutionApiKey,
              },
              body: JSON.stringify({
                url: webhookUrl,
                enabled: true,
                events: [
                  "MESSAGES_UPSERT",
                  "MESSAGES_UPDATE", 
                  "CONNECTION_UPDATE",
                  "QRCODE_UPDATED",
                  "SEND_MESSAGE"
                ]
              }),
            }
          );
          console.log("Webhook configured");
        } catch (e) {
          console.warn("Failed to configure webhook separately:", e);
        }

      } catch (createError) {
        console.error("Error creating Evolution instance:", createError);
        return new Response(JSON.stringify({ 
          error: `Erro ao criar instância: ${createError}` 
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Check connection state
    console.log("Checking connection state...");
    
    const stateResponse = await fetch(
      `${evolutionServerUrl}/instance/connectionState/${evolutionInstanceName}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "apikey": evolutionApiKey,
        },
      }
    );

    if (stateResponse.ok) {
      const stateData = await stateResponse.json();
      console.log("Connection state:", JSON.stringify(stateData));

      const state = stateData.state || stateData.instance?.state || stateData.status;
      
      if (state === "open" || state === "connected") {
        // Already connected
        const phoneNumber = stateData.instance?.owner || stateData.number || stateData.phone;
        
        await supabaseAdmin
          .from("instances")
          .update({ 
            status: "connected",
            phone_number: phoneNumber?.replace(/\D/g, "") || instance.phone_number,
            qr_code: null,
            updated_at: new Date().toISOString()
          })
          .eq("id", instanceId);

        return new Response(JSON.stringify({ 
          success: true, 
          status: "connected",
          phone: phoneNumber
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Get QR Code
    console.log("Getting QR Code...");
    
    // Try connect endpoint (generates QR)
    const connectResponse = await fetch(
      `${evolutionServerUrl}/instance/connect/${evolutionInstanceName}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "apikey": evolutionApiKey,
        },
      }
    );

    if (connectResponse.ok) {
      const connectData = await connectResponse.json();
      console.log("Connect response:", JSON.stringify(connectData));

      // Check if already connected
      if (connectData.instance?.state === "open") {
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
          status: "connected"
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Extract QR code
      let qrCode = connectData.qrcode?.base64 || 
                   connectData.base64 || 
                   connectData.qrcode?.pairingCode ||
                   connectData.code ||
                   connectData.qr;

      // If qrCode is an object, try to extract the actual value
      if (typeof qrCode === "object" && qrCode !== null) {
        qrCode = qrCode.base64 || qrCode.code || qrCode.qr || JSON.stringify(qrCode);
      }

      if (qrCode) {
        // Ensure proper base64 format for display
        if (qrCode && !qrCode.startsWith("data:image")) {
          // It might be raw base64, add data URI prefix
          if (qrCode.length > 100) {
            qrCode = `data:image/png;base64,${qrCode}`;
          }
        }

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

    // Return connecting status if no QR yet
    return new Response(JSON.stringify({ 
      success: true, 
      status: "connecting",
      message: "Aguardando QR Code. Verifique se a Evolution API está rodando corretamente."
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Evolution Connect error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

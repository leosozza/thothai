import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper function to refresh Bitrix24 OAuth token
async function refreshBitrixToken(integration: any, supabase: any): Promise<string | null> {
  const config = integration.config;
  
  if (!config?.refresh_token || !config?.client_id || !config?.client_secret) {
    console.log("No OAuth credentials for refresh");
    return config?.access_token || null;
  }

  const now = Date.now();
  const expiresAt = config.token_expires_at ? new Date(config.token_expires_at).getTime() : 0;
  
  // Check if token needs refresh (10 minutes buffer)
  if (expiresAt - now > 10 * 60 * 1000) {
    console.log("Token still valid, no refresh needed");
    return config.access_token;
  }

  console.log("Token expiring soon, refreshing...");

  try {
    const tokenUrl = `https://oauth.bitrix.info/oauth/token/?grant_type=refresh_token&client_id=${config.client_id}&client_secret=${config.client_secret}&refresh_token=${config.refresh_token}`;
    
    const response = await fetch(tokenUrl);
    const data = await response.json();

    if (data.error) {
      console.error("Token refresh error:", data.error);
      await supabase
        .from("integrations")
        .update({
          config: { ...config, token_refresh_failed: true },
          updated_at: new Date().toISOString()
        })
        .eq("id", integration.id);
      return null;
    }

    // Update integration with new tokens
    const newConfig = {
      ...config,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_expires_at: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
      token_refresh_failed: false,
    };

    await supabase
      .from("integrations")
      .update({
        config: newConfig,
        updated_at: new Date().toISOString()
      })
      .eq("id", integration.id);

    console.log("Token refreshed successfully");
    return data.access_token;
  } catch (error) {
    console.error("Error refreshing token:", error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { integration_id, workspace_id, action } = await req.json();
    console.log("Bitrix24 test - action:", action);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get integration
    let integration;
    if (integration_id) {
      const { data } = await supabase
        .from("integrations")
        .select("*")
        .eq("id", integration_id)
        .single();
      integration = data;
    } else if (workspace_id) {
      const { data } = await supabase
        .from("integrations")
        .select("*")
        .eq("workspace_id", workspace_id)
        .eq("type", "bitrix24")
        .eq("is_active", true)
        .maybeSingle();
      integration = data;
    }

    if (!integration) {
      return new Response(
        JSON.stringify({ success: false, error: "Integração Bitrix24 não encontrada" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const config = integration.config as Record<string, unknown>;

    // Handle different actions
    switch (action) {
      case "refresh_token": {
        if (!config?.refresh_token) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: "Sem refresh_token disponível. Configure OAuth manualmente." 
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const newToken = await refreshBitrixToken(integration, supabase);
        
        if (newToken) {
          return new Response(
            JSON.stringify({ 
              success: true, 
              message: "Token renovado com sucesso!",
              expires_at: new Date(Date.now() + 3600 * 1000).toISOString()
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } else {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: "Falha ao renovar token. Reconecte o Bitrix24 usando OAuth Manual." 
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      case "test_connection": {
        // Determine API endpoint
        let apiUrl: string;
        let authParam: Record<string, string> = {};

        if (config?.access_token) {
          // OAuth-based connection
          const validToken = await refreshBitrixToken(integration, supabase);
          if (!validToken) {
            return new Response(
              JSON.stringify({ 
                success: false, 
                error: "Token OAuth expirado. Use 'Renovar Token' ou reconecte via OAuth Manual." 
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          
          apiUrl = (config.client_endpoint as string) || `https://${config.domain}/rest/`;
          authParam = { auth: validToken };
        } else if (config?.webhook_url) {
          // Webhook-based connection
          apiUrl = config.webhook_url as string;
        } else {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: "Nenhuma credencial configurada (OAuth ou Webhook)" 
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Test with app.info to get user details
        const testResponse = await fetch(`${apiUrl}app.info`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(authParam),
        });

        const testResult = await testResponse.json();
        console.log("app.info result:", JSON.stringify(testResult));

        if (testResult.error) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: testResult.error_description || testResult.error,
              details: testResult
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Also test imconnector.list to verify connector access
        const connectorResponse = await fetch(`${apiUrl}imconnector.list`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(authParam),
        });

        const connectorResult = await connectorResponse.json();
        console.log("imconnector.list result:", JSON.stringify(connectorResult));

        // Check bot status if bot_id exists
        let botStatus = null;
        if (config?.bot_id) {
          const botResponse = await fetch(`${apiUrl}imbot.bot.list`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(authParam),
          });
          const botResult = await botResponse.json();
          console.log("imbot.bot.list result:", JSON.stringify(botResult));
          
          if (botResult.result) {
            const myBot = botResult.result.find((b: any) => b.ID === String(config.bot_id));
            botStatus = myBot ? { registered: true, active: myBot.ACTIVE === "Y", name: myBot.NAME } : { registered: false };
          }
        }

        return new Response(
          JSON.stringify({ 
            success: true, 
            message: "Conexão com Bitrix24 funcionando!",
            app_info: testResult.result,
            connectors: connectorResult.result || [],
            connector_id: config.connector_id,
            bot_status: botStatus,
            token_expires_at: config.token_expires_at
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "check_connector": {
        // Diagnostic action to check connector status in Bitrix24
        const validToken = await refreshBitrixToken(integration, supabase);
        if (!validToken) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: "Token OAuth não disponível" 
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const apiUrl = (config.client_endpoint as string) || `https://${config.domain}/rest/`;
        const connectorId = String(config.connector_id || "thoth_whatsapp");

        // Check imconnector.list
        const listResponse = await fetch(`${apiUrl}imconnector.list`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ auth: validToken })
        });
        const listResult = await listResponse.json();
        console.log("imconnector.list:", JSON.stringify(listResult));

        const connectors = listResult.result as Record<string, any> || {};
        const connectorExists = Object.keys(connectors).includes(connectorId);
        const connectorDetails = connectorExists ? connectors[connectorId] : null;

        // Check activation status via imconnector.status for LINE 1
        const lineId = config.line_id || config.activated_line_id || 1;
        let activationStatus = null;
        if (connectorExists) {
          const statusResponse = await fetch(`${apiUrl}imconnector.status`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              auth: validToken,
              CONNECTOR: connectorId,
              LINE: lineId
            })
          });
          const statusResult = await statusResponse.json();
          console.log("imconnector.status (LINE " + lineId + "):", JSON.stringify(statusResult));
          activationStatus = statusResult.result;
        }

        // Also check imopenlines.config.list.get to see open lines
        const openLinesResponse = await fetch(`${apiUrl}imopenlines.config.list.get`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ auth: validToken })
        });
        const openLinesResult = await openLinesResponse.json();
        console.log("imopenlines.config.list.get:", JSON.stringify(openLinesResult));

        const isActive = activationStatus?.STATUS === true || activationStatus?.ACTIVE === true;

        return new Response(
          JSON.stringify({ 
            success: true,
            connector_id: connectorId,
            registered: connectorExists,
            connector_details: connectorDetails,
            activation_status: activationStatus,
            line_id_checked: lineId,
            open_lines: openLinesResult.result || [],
            all_connectors: Object.keys(listResult.result || {}),
            diagnosis: connectorExists 
              ? (isActive ? "Conector registrado e ATIVO na linha " + lineId : "Conector registrado mas NÃO ATIVO na linha " + lineId + " - verifique Open Lines no Bitrix24")
              : "Conector NÃO registrado - registre novamente"
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "activate_connector": {
        // Manual activation of connector for a specific line
        const validToken = await refreshBitrixToken(integration, supabase);
        if (!validToken) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: "Token OAuth não disponível" 
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { line_id } = await req.json().then(b => ({ line_id: b.line_id })).catch(() => ({ line_id: 1 }));
        const apiUrl = (config.client_endpoint as string) || `https://${config.domain}/rest/`;
        const connectorId = (config.connector_id as string) || "thoth_whatsapp";
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const webhookUrl = `${supabaseUrl}/functions/v1/bitrix24-webhook`;

        // Activate
        const activateResponse = await fetch(`${apiUrl}imconnector.activate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth: validToken,
            CONNECTOR: connectorId,
            LINE: line_id || 1,
            ACTIVE: 1
          })
        });
        const activateResult = await activateResponse.json();
        console.log("imconnector.activate:", JSON.stringify(activateResult));

        // Set data
        const dataSetResponse = await fetch(`${apiUrl}imconnector.connector.data.set`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth: validToken,
            CONNECTOR: connectorId,
            LINE: line_id || 1,
            DATA: {
              id: `${connectorId}_line_${line_id || 1}`,
              url: webhookUrl,
              url_im: webhookUrl,
              name: "Thoth WhatsApp"
            }
          })
        });
        const dataSetResult = await dataSetResponse.json();
        console.log("imconnector.connector.data.set:", JSON.stringify(dataSetResult));

        // Update integration config
        await supabase
          .from("integrations")
          .update({
            config: {
              ...config,
              activated: !activateResult.error,
              activated_line_id: line_id || 1,
              last_activation_at: new Date().toISOString()
            },
            updated_at: new Date().toISOString()
          })
          .eq("id", integration.id);

        return new Response(
          JSON.stringify({ 
            success: !activateResult.error,
            message: activateResult.error 
              ? `Erro ao ativar: ${activateResult.error_description || activateResult.error}`
              : "Conector ativado com sucesso!",
            activate_result: activateResult,
            data_set_result: dataSetResult
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "simulate_placement": {
        // Simulate a PLACEMENT call from Bitrix24 to test webhook response
        console.log("=== SIMULATING PLACEMENT CALL ===");
        
        const webhookUrl = `${supabaseUrl}/functions/v1/bitrix24-webhook`;
        const lineId = 1; // Default to line 1
        
        // Build payload similar to what Bitrix24 sends
        const placementPayload = {
          PLACEMENT: "SETTING_CONNECTOR",
          PLACEMENT_OPTIONS: JSON.stringify({
            CONNECTOR: config.connector_id || "thoth_whatsapp",
            LINE: lineId,
            ACTIVE_STATUS: 1
          }),
          AUTH_ID: config.access_token,
          DOMAIN: config.domain,
          member_id: config.member_id,
          auth: {
            access_token: config.access_token,
            domain: config.domain,
            member_id: config.member_id
          }
        };

        console.log("Simulating with payload:", JSON.stringify(placementPayload, null, 2));

        // Call the webhook
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json"
          },
          body: JSON.stringify(placementPayload)
        });

        const responseText = await response.text();
        console.log("Webhook response:", response.status, responseText);

        const isSuccess = responseText.toLowerCase().includes("successfully");

        return new Response(
          JSON.stringify({ 
            success: isSuccess,
            message: isSuccess 
              ? "PLACEMENT simulado com sucesso! Webhook retornou 'successfully'"
              : `Webhook retornou: ${responseText}`,
            webhook_response: responseText,
            http_status: response.status,
            payload_sent: placementPayload
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "register_bot": {
        // Ensure valid token
        if (config?.access_token) {
          const validToken = await refreshBitrixToken(integration, supabase);
          if (!validToken) {
            return new Response(
              JSON.stringify({ 
                success: false, 
                error: "Token OAuth expirado. Renove antes de registrar o bot." 
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }

        // Forward to bot-register function
        const botResponse = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/bitrix24-bot-register`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`
          },
          body: JSON.stringify({
            action: "register",
            integration_id: integration.id,
            workspace_id: integration.workspace_id,
            bot_name: "Thoth AI",
            bot_description: "Assistente Virtual com IA"
          })
        });

        const botResult = await botResponse.json();
        return new Response(
          JSON.stringify(botResult),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: `Ação desconhecida: ${action}` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (error) {
    console.error("Bitrix24 test error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

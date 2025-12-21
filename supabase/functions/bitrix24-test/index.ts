import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper function to refresh Bitrix24 OAuth token
async function refreshBitrixToken(integration: any, supabase: any): Promise<string | null> {
  const config = integration.config;
  
  // MARKETPLACE: Check for refresh_token only (credentials come from env vars)
  if (!config?.refresh_token) {
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
    // MARKETPLACE: Use credentials from environment variables, NOT from database
    const clientId = Deno.env.get("BITRIX24_CLIENT_ID") || "";
    const clientSecret = Deno.env.get("BITRIX24_CLIENT_SECRET") || "";
    const tokenUrl = `https://oauth.bitrix.info/oauth/token/?grant_type=refresh_token&client_id=${clientId}&client_secret=${clientSecret}&refresh_token=${config.refresh_token}`;
    
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
              error: "Sem refresh_token disponível. Reinstale o app via Marketplace." 
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
              error: "Falha ao renovar token. Reinstale o app via Marketplace." 
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      case "test_connection": {
        if (!config?.access_token) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: "Nenhum token OAuth configurado. Instale o app via Marketplace." 
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const validToken = await refreshBitrixToken(integration, supabase);
        if (!validToken) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: "Token OAuth expirado. Reinstale o app via Marketplace." 
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        
        const apiUrl = (config.client_endpoint as string) || `https://${config.domain}/rest/`;

        // Test with app.info
        const testResponse = await fetch(`${apiUrl}app.info`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ auth: validToken }),
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

        // Test imconnector.list
        const connectorResponse = await fetch(`${apiUrl}imconnector.list`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ auth: validToken }),
        });

        const connectorResult = await connectorResponse.json();
        console.log("imconnector.list result:", JSON.stringify(connectorResult));

        // Check bot status if bot_id exists
        let botStatus = null;
        if (config?.bot_id) {
          const botResponse = await fetch(`${apiUrl}imbot.bot.list`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ auth: validToken }),
          });
          const botResult = await botResponse.json();
          
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
        const lineId = config.line_id || config.activated_line_id || 1;

        // Check imconnector.list
        const listResponse = await fetch(`${apiUrl}imconnector.list`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ auth: validToken })
        });
        const listResult = await listResponse.json();

        const connectors = listResult.result as Record<string, any> || {};
        const connectorExists = Object.keys(connectors).includes(connectorId);
        const connectorDetails = connectorExists ? connectors[connectorId] : null;

        // Check activation status
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
          activationStatus = statusResult.result;
        }

        // Check imopenlines config
        const openLinesResponse = await fetch(`${apiUrl}imopenlines.config.list.get`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ auth: validToken })
        });
        const openLinesResult = await openLinesResponse.json();

        let ourLineConfig = null;
        let connectorActive = false;
        if (openLinesResult.result && Array.isArray(openLinesResult.result)) {
          ourLineConfig = openLinesResult.result.find((line: any) => 
            String(line.ID) === String(lineId)
          );
          
          if (ourLineConfig) {
            connectorActive = ourLineConfig.ACTIVE === "Y" || 
                             ourLineConfig.connector_active === true || 
                             ourLineConfig.connector_active === "true" ||
                             ourLineConfig.connector_active === 1;
          }
        }

        const isActive = activationStatus?.STATUS === true || activationStatus?.ACTIVE === true || connectorActive;

        return new Response(
          JSON.stringify({ 
            success: true,
            connector_id: connectorId,
            registered: connectorExists,
            connector_details: connectorDetails,
            activation_status: activationStatus,
            line_id_checked: lineId,
            line_config: ourLineConfig,
            connector_active: connectorActive,
            open_lines: openLinesResult.result || [],
            all_connectors: Object.keys(listResult.result || {}),
            status_summary: {
              registered: connectorExists,
              active_via_status: activationStatus?.STATUS === true || activationStatus?.ACTIVE === true,
              active_via_config: connectorActive,
              overall_active: isActive
            },
            diagnosis: connectorExists 
              ? (isActive 
                  ? `✓ Conector registrado e ATIVO na linha ${lineId}` 
                  : `⚠ Conector registrado mas NÃO ATIVO na linha ${lineId}`)
              : "✗ Conector NÃO registrado - registre novamente"
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "activate_connector": {
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
        const eventsUrl = `${supabaseUrl}/functions/v1/bitrix24-events`;

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
              url: eventsUrl,
              url_im: eventsUrl,
              name: "Thoth WhatsApp"
            }
          })
        });
        const dataSetResult = await dataSetResponse.json();

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

      case "register_bot": {
        // Forward to bot-register function
        const botResponse = await supabase.functions.invoke("bitrix24-bot-register", {
          body: { integration_id: integration.id }
        });

        return new Response(
          JSON.stringify(botResponse.data),
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
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

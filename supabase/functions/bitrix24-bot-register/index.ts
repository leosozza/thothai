import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper to refresh Bitrix24 OAuth token
async function refreshBitrixToken(integration: any, supabase: any): Promise<string | null> {
  const config = integration.config;
  
  if (config.token_expires_at) {
    const expiresAt = new Date(config.token_expires_at);
    const now = new Date();
    const bufferMs = 5 * 60 * 1000;
    
    if (expiresAt.getTime() - now.getTime() > bufferMs) {
      return config.access_token;
    }
  } else if (config.access_token) {
    return config.access_token;
  }

  if (!config.refresh_token) {
    return config.access_token || null;
  }

  const refreshUrl = `https://oauth.bitrix.info/oauth/token/?grant_type=refresh_token&client_id=${config.client_id || ""}&client_secret=${config.client_secret || ""}&refresh_token=${config.refresh_token}`;
  
  try {
    const response = await fetch(refreshUrl);
    const data = await response.json();

    if (data.access_token) {
      const newExpiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
      
      await supabase
        .from("integrations")
        .update({
          config: {
            ...config,
            access_token: data.access_token,
            refresh_token: data.refresh_token || config.refresh_token,
            token_expires_at: newExpiresAt,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", integration.id);

      return data.access_token;
    }
  } catch (error) {
    console.error("Error refreshing token:", error);
  }

  return config.access_token || null;
}

serve(async (req) => {
  console.log("=== BITRIX24-BOT-REGISTER ===");
  console.log("Method:", req.method);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const payload = await req.json();
    const { action, integration_id, workspace_id, bot_name, bot_description } = payload;

    console.log("Action:", action);
    console.log("Integration ID:", integration_id);

    // Get integration
    const { data: integration, error: integrationError } = await supabase
      .from("integrations")
      .select("*")
      .eq("id", integration_id)
      .single();

    if (integrationError || !integration) {
      console.error("Integration not found:", integrationError);
      return new Response(
        JSON.stringify({ error: "Integração não encontrada" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accessToken = await refreshBitrixToken(integration, supabase);
    if (!accessToken) {
      return new Response(
        JSON.stringify({ error: "Token de acesso não disponível" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const config = integration.config;
    // IMPORTANT: Use config.domain for REST API calls, NOT client_endpoint (which is oauth.bitrix.info)
    const clientEndpoint = config.domain ? `https://${config.domain}/rest/` : config.client_endpoint;
    const eventsUrl = `${supabaseUrl}/functions/v1/bitrix24-events`;

    switch (action) {
      case "register": {
        console.log("=== REGISTERING BOT ===");
        
        // Check if bot already registered
        if (config.bot_id) {
          return new Response(
            JSON.stringify({ 
              success: true, 
              bot_id: config.bot_id,
              message: "Bot já está registrado" 
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const botPayload = {
          auth: accessToken,
          CODE: "thoth_ai_bot",
          TYPE: "B", // B = chatbot (immediate responses)
          OPENLINE: "Y", // Support Open Lines
          EVENT_MESSAGE_ADD: eventsUrl,
          EVENT_WELCOME_MESSAGE: eventsUrl,
          EVENT_BOT_DELETE: eventsUrl,
          PROPERTIES: {
            NAME: bot_name || "Thoth AI",
            LAST_NAME: "",
            WORK_POSITION: bot_description || "Assistente Virtual com IA",
            COLOR: "PURPLE",
            PERSONAL_WWW: "https://thoth.ai",
            PERSONAL_PHOTO: "", // Can add avatar URL later
          }
        };

        console.log("Bot registration payload:", JSON.stringify(botPayload, null, 2));

        const registerResponse = await fetch(`${clientEndpoint}imbot.register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(botPayload)
        });

        const registerResult = await registerResponse.json();
        console.log("imbot.register result:", JSON.stringify(registerResult, null, 2));

        if (registerResult.error) {
          console.error("Bot registration error:", registerResult.error, registerResult.error_description);
          return new Response(
            JSON.stringify({ 
              error: registerResult.error_description || registerResult.error,
              details: registerResult 
            }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const botId = registerResult.result;
        if (!botId) {
          return new Response(
            JSON.stringify({ error: "Bot ID não retornado" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Save bot_id to integration config
        await supabase
          .from("integrations")
          .update({
            config: {
              ...config,
              bot_id: botId,
              bot_code: "thoth_ai_bot",
              bot_name: bot_name || "Thoth AI",
              bot_registered_at: new Date().toISOString()
            },
            updated_at: new Date().toISOString()
          })
          .eq("id", integration.id);

        console.log("Bot registered successfully with ID:", botId);

        return new Response(
          JSON.stringify({ 
            success: true, 
            bot_id: botId,
            message: "Bot registrado com sucesso!" 
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "update": {
        console.log("=== UPDATING BOT ===");
        
        const botId = config.bot_id;
        if (!botId) {
          return new Response(
            JSON.stringify({ error: "Bot não está registrado" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const updatePayload = {
          auth: accessToken,
          BOT_ID: botId,
          FIELDS: {
            EVENT_MESSAGE_ADD: eventsUrl,
            EVENT_WELCOME_MESSAGE: eventsUrl,
            PROPERTIES: {
              NAME: bot_name || config.bot_name || "Thoth AI",
              WORK_POSITION: bot_description || "Assistente Virtual com IA",
            }
          }
        };

        const updateResponse = await fetch(`${clientEndpoint}imbot.update`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updatePayload)
        });

        const updateResult = await updateResponse.json();
        console.log("imbot.update result:", JSON.stringify(updateResult, null, 2));

        if (updateResult.error) {
          return new Response(
            JSON.stringify({ error: updateResult.error_description || updateResult.error }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Update config
        if (bot_name) {
          await supabase
            .from("integrations")
            .update({
              config: {
                ...config,
                bot_name: bot_name
              },
              updated_at: new Date().toISOString()
            })
            .eq("id", integration.id);
        }

        return new Response(
          JSON.stringify({ success: true, message: "Bot atualizado com sucesso!" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "unregister": {
        console.log("=== UNREGISTERING BOT ===");
        
        const botId = config.bot_id;
        if (!botId) {
          return new Response(
            JSON.stringify({ error: "Bot não está registrado" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const unregisterResponse = await fetch(`${clientEndpoint}imbot.unregister`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth: accessToken,
            BOT_ID: botId
          })
        });

        const unregisterResult = await unregisterResponse.json();
        console.log("imbot.unregister result:", JSON.stringify(unregisterResult, null, 2));

        if (unregisterResult.error) {
          // If bot not found, consider it already removed
          if (unregisterResult.error === "BOT_NOT_FOUND" || unregisterResult.error === "BOT_ID_ERROR") {
            console.log("Bot already removed from Bitrix24");
          } else {
            return new Response(
              JSON.stringify({ error: unregisterResult.error_description || unregisterResult.error }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }

        // Remove bot_id from config
        const { bot_id, bot_code, bot_name: oldBotName, bot_registered_at, ...restConfig } = config;
        await supabase
          .from("integrations")
          .update({
            config: restConfig,
            updated_at: new Date().toISOString()
          })
          .eq("id", integration.id);

        console.log("Bot unregistered successfully");

        return new Response(
          JSON.stringify({ success: true, message: "Bot removido com sucesso!" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "status": {
        console.log("=== BOT STATUS ===");
        
        const botId = config.bot_id;
        if (!botId) {
          return new Response(
            JSON.stringify({ 
              registered: false, 
              bot_id: null 
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Try to get bot info from Bitrix24
        const infoResponse = await fetch(`${clientEndpoint}imbot.bot.list`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ auth: accessToken })
        });

        const infoResult = await infoResponse.json();
        console.log("imbot.bot.list result:", JSON.stringify(infoResult, null, 2));

        const botExists = Array.isArray(infoResult.result) && 
          infoResult.result.some((bot: any) => bot.ID === botId || bot.id === botId);

        return new Response(
          JSON.stringify({ 
            registered: botExists,
            bot_id: botId,
            bot_name: config.bot_name || "Thoth AI",
            bot_enabled: config.bot_enabled || false,
            bot_persona_id: config.bot_persona_id || null
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: "Ação não reconhecida" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (error: unknown) {
    console.error("Error in bitrix24-bot-register:", error);
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

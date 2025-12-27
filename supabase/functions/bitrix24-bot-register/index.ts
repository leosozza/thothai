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

  // MARKETPLACE: Use credentials from environment variables, NOT from database
  const clientId = Deno.env.get("BITRIX24_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("BITRIX24_CLIENT_SECRET") || "";
  const refreshUrl = `https://oauth.bitrix.info/oauth/token/?grant_type=refresh_token&client_id=${clientId}&client_secret=${clientSecret}&refresh_token=${config.refresh_token}`;
  
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

// Generate a unique bot code from persona name
function generateBotCode(personaName: string, personaId: string): string {
  // Take first 8 chars of personaId to make it unique
  const shortId = personaId.replace(/-/g, "").substring(0, 8);
  // Sanitize name: lowercase, remove special chars, limit length
  const sanitizedName = personaName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^a-z0-9]/g, "_") // Replace non-alphanumeric with underscore
    .replace(/_+/g, "_") // Remove multiple underscores
    .substring(0, 20);
  
  return `thoth_${sanitizedName}_${shortId}`;
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
    const { action, integration_id, workspace_id, persona_id, bot_name, bot_description } = payload;

    console.log("Action:", action);
    console.log("Integration ID:", integration_id);
    console.log("Persona ID:", persona_id);

    // Get integration - support both integration_id and workspace_id lookup
    let integration = null;
    
    if (integration_id) {
      const { data, error } = await supabase
        .from("integrations")
        .select("*")
        .eq("id", integration_id)
        .single();
      
      if (!error) integration = data;
    } else if (workspace_id) {
      const { data, error } = await supabase
        .from("integrations")
        .select("*")
        .eq("workspace_id", workspace_id)
        .eq("type", "bitrix24")
        .eq("is_active", true)
        .maybeSingle();
      
      if (!error) integration = data;
    }

    if (!integration) {
      console.error("Integration not found");
      return new Response(
        JSON.stringify({ error: "Integração Bitrix24 não encontrada" }),
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
      case "register_persona": {
        console.log("=== REGISTERING PERSONA AS BOT ===");
        
        if (!persona_id) {
          return new Response(
            JSON.stringify({ error: "persona_id é obrigatório" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Get persona
        const { data: persona, error: personaError } = await supabase
          .from("personas")
          .select("*")
          .eq("id", persona_id)
          .single();

        if (personaError || !persona) {
          console.error("Persona not found:", personaError);
          return new Response(
            JSON.stringify({ error: "Persona não encontrada" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const force = payload.force === true;
        
        // Check if persona already has a bot - but verify it actually exists in Bitrix24
        if (persona.bitrix_bot_id && !force) {
          // Verify the bot exists in Bitrix24 by calling imbot.bot.list
          console.log("Persona has bitrix_bot_id, verifying if bot exists in Bitrix24...");
          
          try {
            const listResponse = await fetch(`${clientEndpoint}imbot.bot.list`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ auth: accessToken })
            });
            
            const listResult = await listResponse.json();
            console.log("imbot.bot.list result:", JSON.stringify(listResult, null, 2));
            
            if (listResult.result) {
              const botExists = listResult.result.some((bot: any) => 
                bot.ID === persona.bitrix_bot_id || 
                String(bot.ID) === String(persona.bitrix_bot_id)
              );
              
              if (botExists) {
                console.log("Bot exists in Bitrix24, returning success");
                return new Response(
                  JSON.stringify({ 
                    success: true, 
                    bot_id: persona.bitrix_bot_id,
                    message: "Persona já está publicada como bot" 
                  }),
                  { headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
              } else {
                console.log("Bot NOT found in Bitrix24, will re-register");
                // Bot doesn't exist in Bitrix24, clear the stale ID
                await supabase
                  .from("personas")
                  .update({
                    bitrix_bot_id: null,
                    bitrix_bot_enabled: false,
                    updated_at: new Date().toISOString()
                  })
                  .eq("id", persona_id);
              }
            }
          } catch (verifyError) {
            console.error("Error verifying bot existence:", verifyError);
            // Continue with registration if verification fails
          }
        } else if (force && persona.bitrix_bot_id) {
          // Force republish: unregister first
          console.log("Force republish: unregistering existing bot first...");
          try {
            await fetch(`${clientEndpoint}imbot.unregister`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                auth: accessToken,
                BOT_ID: persona.bitrix_bot_id
              })
            });
            console.log("Old bot unregistered for force republish");
          } catch (unregErr) {
            console.log("Unregister error (continuing anyway):", unregErr);
          }
        }

        const botCode = generateBotCode(persona.name, persona.id);
        const botName = `ThothAI - ${persona.name}`;
        const botDescription = persona.description || `Assistente IA - ${persona.name}`;

        const botPayload = {
          auth: accessToken,
          CODE: botCode,
          TYPE: "O", // O = Open Lines chatbot (appears in Contact Center dropdown)
          OPENLINE: "Y", // Support Open Lines
          EVENT_MESSAGE_ADD: eventsUrl,
          EVENT_WELCOME_MESSAGE: eventsUrl,
          EVENT_BOT_DELETE: eventsUrl,
          PROPERTIES: {
            NAME: botName,
            LAST_NAME: "",
            WORK_POSITION: botDescription,
            COLOR: "PURPLE",
            PERSONAL_WWW: "https://thoth.ai",
            PERSONAL_PHOTO: persona.avatar_url || "",
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

        // Save bot_id to persona
        await supabase
          .from("personas")
          .update({
            bitrix_bot_id: botId,
            bitrix_bot_enabled: true,
            updated_at: new Date().toISOString()
          })
          .eq("id", persona_id);

        console.log(`Bot "${botName}" registered successfully with ID:`, botId);

        return new Response(
          JSON.stringify({ 
            success: true, 
            bot_id: botId,
            bot_code: botCode,
            bot_name: botName,
            message: `Bot "${botName}" publicado com sucesso!` 
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "unregister_persona": {
        console.log("=== UNREGISTERING PERSONA BOT ===");
        
        if (!persona_id) {
          return new Response(
            JSON.stringify({ error: "persona_id é obrigatório" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Get persona
        const { data: persona, error: personaError } = await supabase
          .from("personas")
          .select("*")
          .eq("id", persona_id)
          .single();

        if (personaError || !persona) {
          return new Response(
            JSON.stringify({ error: "Persona não encontrada" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const botId = persona.bitrix_bot_id;
        if (!botId) {
          // Already not registered, just clean up the flag
          await supabase
            .from("personas")
            .update({
              bitrix_bot_id: null,
              bitrix_bot_enabled: false,
              updated_at: new Date().toISOString()
            })
            .eq("id", persona_id);

          return new Response(
            JSON.stringify({ success: true, message: "Persona já não estava publicada" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

        // Remove bot_id from persona
        await supabase
          .from("personas")
          .update({
            bitrix_bot_id: null,
            bitrix_bot_enabled: false,
            updated_at: new Date().toISOString()
          })
          .eq("id", persona_id);

        console.log(`Bot for persona "${persona.name}" unregistered successfully`);

        return new Response(
          JSON.stringify({ success: true, message: `Bot "${persona.name}" removido com sucesso!` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Legacy actions for backwards compatibility
      case "register": {
        console.log("=== REGISTERING BOT (LEGACY) ===");
        
        // Check if bot already registered in config
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
          TYPE: "B",
          OPENLINE: "Y",
          EVENT_MESSAGE_ADD: eventsUrl,
          EVENT_WELCOME_MESSAGE: eventsUrl,
          EVENT_BOT_DELETE: eventsUrl,
          PROPERTIES: {
            NAME: bot_name || "Thoth AI",
            LAST_NAME: "",
            WORK_POSITION: bot_description || "Assistente Virtual com IA",
            COLOR: "PURPLE",
            PERSONAL_WWW: "https://thoth.ai",
            PERSONAL_PHOTO: "",
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
        console.log("=== UNREGISTERING BOT (LEGACY) ===");
        
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

      case "list_bots": {
        console.log("=== LISTING ALL BOTS ===");
        
        const infoResponse = await fetch(`${clientEndpoint}imbot.bot.list`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ auth: accessToken })
        });

        const infoResult = await infoResponse.json();
        console.log("imbot.bot.list result:", JSON.stringify(infoResult, null, 2));

        return new Response(
          JSON.stringify({ 
            success: true,
            bots: infoResult.result || []
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

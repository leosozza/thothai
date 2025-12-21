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
    const { 
      conversation_id, 
      contact_id, 
      content, 
      workspace_id,
      integration_id,
      instance_id,
      bitrix24_user_id,
      bitrix24_chat_id,
      bitrix24_bot_id,
      bitrix24_dialog_id,
      line_id,
      message_type = "connector" // "connector" or "bot"
    } = await req.json();
    
    console.log("=== AI PROCESS BITRIX24 ===");
    console.log("Input:", { conversation_id, contact_id, content, workspace_id, line_id, message_type });

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Fetch persona for this workspace
    let systemPrompt = "Você é um assistente prestativo e profissional. Responda de forma clara e objetiva.";
    let personaName = "Assistente";
    let temperature = 0.7;

    // First check if integration has a specific persona configured
    // For bot messages, use bot_persona_id; for connector, use persona_id
    if (integration_id) {
      const { data: integration } = await supabase
        .from("integrations")
        .select("config")
        .eq("id", integration_id)
        .single();

      const personaIdToUse = message_type === "bot" 
        ? integration?.config?.bot_persona_id 
        : integration?.config?.persona_id;

      if (personaIdToUse) {
        const { data: persona } = await supabase
          .from("personas")
          .select("*")
          .eq("id", personaIdToUse)
          .single();

        if (persona) {
          systemPrompt = persona.system_prompt || systemPrompt;
          personaName = persona.name || personaName;
          temperature = persona.temperature || temperature;
          console.log("Using integration persona:", personaName, "for message_type:", message_type);
        }
      }
    }

    // Fallback to workspace default persona
    if (personaName === "Assistente" && workspace_id) {
      const { data: persona } = await supabase
        .from("personas")
        .select("*")
        .eq("workspace_id", workspace_id)
        .eq("is_default", true)
        .single();

      if (persona) {
        systemPrompt = persona.system_prompt || systemPrompt;
        personaName = persona.name || personaName;
        temperature = persona.temperature || temperature;
        console.log("Using workspace default persona:", personaName);
      }
    }

    // 2. Fetch conversation history (last 10 messages for context)
    const { data: history } = await supabase
      .from("messages")
      .select("content, direction, is_from_bot")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: false })
      .limit(10);

    const messages = [
      { role: "system", content: systemPrompt },
    ];

    // Add conversation history in chronological order
    if (history && history.length > 0) {
      const reversedHistory = [...history].reverse();
      for (const msg of reversedHistory) {
        if (msg.content) {
          messages.push({
            role: msg.direction === "incoming" ? "user" : "assistant",
            content: msg.content,
          });
        }
      }
    }

    // Add current message if not already in history
    if (content && !history?.some(h => h.content === content)) {
      messages.push({ role: "user", content });
    }

    console.log("Sending to AI with", messages.length, "messages");

    // 3. Call Lovable AI Gateway
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        temperature,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI Gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI Gateway error: ${response.status}`);
    }

    const aiResponse = await response.json();
    const aiContent = aiResponse.choices?.[0]?.message?.content;

    if (!aiContent) {
      throw new Error("No content in AI response");
    }

    console.log("AI Response:", aiContent.substring(0, 100) + "...");

    // 4. Save AI response message to database
    const { error: msgError } = await supabase
      .from("messages")
      .insert({
        conversation_id,
        contact_id,
        instance_id,
        content: aiContent,
        direction: "outgoing",
        is_from_bot: true,
        message_type: "text",
        status: "pending",
        metadata: { source: "ai_bitrix24", persona: personaName }
      });

    if (msgError) {
      console.error("Error saving message:", msgError);
    }

    // 5. Send response to Bitrix24
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("id", integration_id)
      .single();

    if (!integration) {
      throw new Error("Integration not found");
    }

    const config = integration.config;
    const connectorId = config?.connector_id || "thoth_whatsapp";
    
    // Get fresh access token with proactive refresh
    let accessToken = config.access_token;
    
    // Check if token needs refresh (10 minute buffer)
    if (config.token_expires_at) {
      const expiresAt = new Date(config.token_expires_at);
      const now = new Date();
      const bufferMs = 10 * 60 * 1000; // 10 minutes
      
      if (expiresAt.getTime() - now.getTime() <= bufferMs && config.refresh_token) {
        console.log("Token expiring soon, refreshing proactively...");
        // MARKETPLACE: Use credentials from environment variables, NOT from database
        const bitrixClientId = Deno.env.get("BITRIX24_CLIENT_ID") || "";
        const bitrixClientSecret = Deno.env.get("BITRIX24_CLIENT_SECRET") || "";
        const refreshUrl = `https://oauth.bitrix.info/oauth/token/?grant_type=refresh_token&client_id=${bitrixClientId}&client_secret=${bitrixClientSecret}&refresh_token=${config.refresh_token}`;
        
        try {
          const tokenResponse = await fetch(refreshUrl);
          const tokenData = await tokenResponse.json();
          
          if (tokenData.error) {
            console.error("Token refresh failed:", tokenData.error, tokenData.error_description);
            // Mark refresh failure but continue with existing token
            await supabase
              .from("integrations")
              .update({
                config: {
                  ...config,
                  token_refresh_failed: true,
                  token_refresh_error: tokenData.error_description || tokenData.error,
                  token_refresh_failed_at: new Date().toISOString(),
                },
              })
              .eq("id", integration_id);
          } else if (tokenData.access_token) {
            accessToken = tokenData.access_token;
            const newExpiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString();
            // Update token in database
            await supabase
              .from("integrations")
              .update({
                config: {
                  ...config,
                  access_token: tokenData.access_token,
                  refresh_token: tokenData.refresh_token || config.refresh_token,
                  token_expires_at: newExpiresAt,
                  token_refresh_failed: false,
                  token_refresh_error: null,
                  last_token_refresh_at: new Date().toISOString(),
                },
              })
              .eq("id", integration_id);
            console.log("Token refreshed successfully, new expiry:", newExpiresAt);
          }
        } catch (e) {
          console.error("Token refresh error:", e);
        }
      }
    }
    
    // Check if token is available
    if (!accessToken) {
      console.error("No access token available to send message to Bitrix24");
      throw new Error("Token de acesso não disponível. Reconecte o Bitrix24.");
    }

    const clientEndpoint = config.client_endpoint || `https://${config.domain}/rest/`;
    
    let sendResult: any;

    // Send message based on message_type
    if (message_type === "bot") {
      // Send via imbot.message.add
      const botId = bitrix24_bot_id || config.bot_id;
      const dialogId = bitrix24_dialog_id;

      if (!botId) {
        throw new Error("Bot ID not configured");
      }

      const botMessagePayload = {
        auth: accessToken,
        BOT_ID: botId,
        DIALOG_ID: dialogId,
        MESSAGE: aiContent,
        // Optional: Add keyboard or attachments
        // KEYBOARD: [],
        // ATTACH: []
      };

      console.log("Sending to Bitrix24 via imbot.message.add:", JSON.stringify(botMessagePayload, null, 2));

      const sendUrl = `${clientEndpoint}imbot.message.add`;
      const sendResponse = await fetch(sendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(botMessagePayload)
      });

      sendResult = await sendResponse.json();
      console.log("Bitrix24 imbot.message.add result:", JSON.stringify(sendResult, null, 2));

    } else {
      // Send via imconnector.send.messages (default for connector)
      const messagePayload = {
        auth: accessToken,
        CONNECTOR: connectorId,
        LINE: line_id,
        MESSAGES: [{
          user: { id: bitrix24_user_id },
          chat: { id: bitrix24_chat_id },
          message: {
            id: `ai_${Date.now()}`,
            date: Math.floor(Date.now() / 1000),
            text: aiContent
          }
        }]
      };

      console.log("Sending to Bitrix24 via imconnector.send.messages:", JSON.stringify(messagePayload, null, 2));

      const sendUrl = `${clientEndpoint}imconnector.send.messages`;
      const sendResponse = await fetch(sendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(messagePayload)
      });

      sendResult = await sendResponse.json();
      console.log("Bitrix24 imconnector.send.messages result:", JSON.stringify(sendResult, null, 2));
    }

    // Update message status
    if (sendResult.result) {
      await supabase
        .from("messages")
        .update({ status: "sent" })
        .eq("conversation_id", conversation_id)
        .eq("content", aiContent)
        .eq("is_from_bot", true);
    }

    // Update conversation
    await supabase
      .from("conversations")
      .update({ 
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("id", conversation_id);

    console.log("AI message sent successfully to Bitrix24 via", message_type);

    return new Response(JSON.stringify({ 
      success: true, 
      response: aiContent,
      persona: personaName,
      message_type,
      bitrix_result: sendResult
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Error in ai-process-bitrix24:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

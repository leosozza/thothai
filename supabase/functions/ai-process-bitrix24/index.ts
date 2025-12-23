import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Generate a simple hash of a message for duplicate detection
 */
function hashMessage(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

/**
 * Search knowledge base for relevant chunks
 */
async function searchKnowledge(
  supabase: any, 
  workspaceId: string, 
  query: string, 
  limit: number = 5
): Promise<string[]> {
  try {
    const { data: documents } = await supabase
      .from("knowledge_documents")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("status", "completed");

    if (!documents || documents.length === 0) {
      return [];
    }

    const documentIds = documents.map((d: any) => d.id);

    const { data: chunks } = await supabase
      .from("knowledge_chunks")
      .select("content")
      .in("document_id", documentIds)
      .limit(limit * 3);

    if (!chunks || chunks.length === 0) {
      return [];
    }

    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    
    const scoredChunks = chunks.map((chunk: any) => {
      const content = chunk.content.toLowerCase();
      let score = 0;
      for (const word of queryWords) {
        if (content.includes(word)) {
          score += 1;
        }
      }
      return { content: chunk.content, score };
    });

    scoredChunks.sort((a: any, b: any) => b.score - a.score);
    
    return scoredChunks
      .filter((c: any) => c.score > 0)
      .slice(0, limit)
      .map((c: any) => c.content);
  } catch (error) {
    console.error("Error searching knowledge:", error);
    return [];
  }
}

/**
 * Try to acquire a processing lock on the conversation
 */
async function tryAcquireLock(
  supabase: any, 
  conversationId: string, 
  lockTimeoutMs: number = 30000
): Promise<boolean> {
  const now = new Date();
  const lockExpiry = new Date(now.getTime() - lockTimeoutMs);

  const { data, error } = await supabase
    .from("conversations")
    .update({ processing_lock_at: now.toISOString() })
    .eq("id", conversationId)
    .or(`processing_lock_at.is.null,processing_lock_at.lt.${lockExpiry.toISOString()}`)
    .select("id");

  if (error) {
    console.error("Error acquiring lock:", error);
    return false;
  }

  return data && data.length > 0;
}

/**
 * Release the processing lock
 */
async function releaseLock(supabase: any, conversationId: string): Promise<void> {
  await supabase
    .from("conversations")
    .update({ processing_lock_at: null })
    .eq("id", conversationId);
}

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
      persona_id,
      message_type = "connector"
    } = await req.json();
    
    console.log("=== AI PROCESS BITRIX24 ===");
    console.log("Input:", { conversation_id, contact_id, content: content?.substring(0, 50), workspace_id, line_id, message_type, persona_id });

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // === ANTI-LOOP MECHANISM 1: Processing Lock ===
    const lockAcquired = await tryAcquireLock(supabase, conversation_id);
    if (!lockAcquired) {
      console.log("ANTI-LOOP: Could not acquire lock, another process is handling this conversation");
      return new Response(JSON.stringify({ 
        skipped: true, 
        reason: "Processing lock active" 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      // Check conversation mode
      const { data: conversation } = await supabase
        .from("conversations")
        .select("attendance_mode, bot_state, last_bot_message_hash")
        .eq("id", conversation_id)
        .single();

      if (conversation?.attendance_mode === "human") {
        console.log("SKIP: Conversation is in human mode");
        return new Response(JSON.stringify({ 
          skipped: true, 
          reason: "Conversation in human mode" 
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // === ANTI-LOOP MECHANISM 2: Check recent messages ===
      const { data: recentOutgoing } = await supabase
        .from("messages")
        .select("created_at, content")
        .eq("conversation_id", conversation_id)
        .eq("direction", "outgoing")
        .eq("is_from_bot", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentOutgoing) {
        const timeSince = Date.now() - new Date(recentOutgoing.created_at).getTime();
        if (timeSince < 3000) {
          console.log("ANTI-LOOP: Bot responded recently:", timeSince, "ms ago");
          return new Response(JSON.stringify({ 
            skipped: true, 
            reason: "Bot message sent recently",
            time_since_ms: timeSince 
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // 1. Fetch persona for this workspace
      let systemPrompt = "Você é um assistente prestativo e profissional. Responda de forma clara e objetiva.";
      let personaName = "Assistente";
      let temperature = 0.7;
      let actualWorkspaceId = workspace_id;

      if (persona_id) {
        const { data: persona } = await supabase
          .from("personas")
          .select("*")
          .eq("id", persona_id)
          .single();

        if (persona) {
          systemPrompt = persona.system_prompt || systemPrompt;
          personaName = persona.name || personaName;
          temperature = persona.temperature || temperature;
          actualWorkspaceId = persona.workspace_id || workspace_id;
          console.log("Using persona from persona_id:", personaName);
        }
      } else if (integration_id) {
        const { data: integration } = await supabase
          .from("integrations")
          .select("config, workspace_id")
          .eq("id", integration_id)
          .single();

        if (integration) {
          actualWorkspaceId = integration.workspace_id || workspace_id;
          
          const personaIdToUse = message_type === "bot" 
            ? integration.config?.bot_persona_id 
            : integration.config?.persona_id;

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
              console.log("Using integration persona:", personaName);
            }
          }
        }
      }

      // Fallback to workspace default persona
      if (personaName === "Assistente" && actualWorkspaceId) {
        const { data: persona } = await supabase
          .from("personas")
          .select("*")
          .eq("workspace_id", actualWorkspaceId)
          .eq("is_default", true)
          .single();

        if (persona) {
          systemPrompt = persona.system_prompt || systemPrompt;
          personaName = persona.name || personaName;
          temperature = persona.temperature || temperature;
          console.log("Using workspace default persona:", personaName);
        }
      }

      // 2. Search knowledge base for relevant context
      let knowledgeContext = "";
      if (actualWorkspaceId && content) {
        const relevantChunks = await searchKnowledge(supabase, actualWorkspaceId, content);
        
        if (relevantChunks.length > 0) {
          knowledgeContext = `\n\n## Base de Conhecimento\nUse as seguintes informações para responder quando relevante:\n\n${relevantChunks.join("\n\n---\n\n")}`;
          console.log(`Found ${relevantChunks.length} relevant knowledge chunks`);
        }
      }

      // 3. Fetch conversation history (last 15 messages for better context)
      const { data: history } = await supabase
        .from("messages")
        .select("content, direction, is_from_bot")
        .eq("conversation_id", conversation_id)
        .order("created_at", { ascending: false })
        .limit(15);

      // Get last bot message for anti-repetition
      const lastBotMessage = recentOutgoing?.content || "";

      // Build anti-repetition instruction
      const antiRepetitionPrompt = lastBotMessage 
        ? `\n\nIMPORTANTE: Sua última resposta foi: "${lastBotMessage.substring(0, 200)}..."\nNÃO repita esta mensagem. Analise o histórico completo e avance a conversa.`
        : "";

      // Build full system prompt
      const fullSystemPrompt = systemPrompt + knowledgeContext + antiRepetitionPrompt;

      const messages = [
        { role: "system", content: fullSystemPrompt },
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

      // 4. Call Lovable AI Gateway
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

      // === ANTI-LOOP MECHANISM 3: Check for duplicate response ===
      const responseHash = hashMessage(aiContent);
      const lastBotHash = lastBotMessage ? hashMessage(lastBotMessage) : "";
      
      if (responseHash === lastBotHash || aiContent.trim() === lastBotMessage.trim()) {
        console.log("ANTI-LOOP: Duplicate response detected, skipping");
        await supabase
          .from("conversations")
          .update({ 
            bot_state: { 
              ...conversation?.bot_state,
              duplicate_detected_at: new Date().toISOString()
            }
          })
          .eq("id", conversation_id);
        
        return new Response(JSON.stringify({ 
          skipped: true, 
          reason: "Duplicate response detected" 
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 5. Save AI response message to database
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

      // 6. Send response to Bitrix24
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
        const bufferMs = 10 * 60 * 1000;
        
        if (expiresAt.getTime() - now.getTime() <= bufferMs && config.refresh_token) {
          console.log("Token expiring soon, refreshing...");
          const bitrixClientId = Deno.env.get("BITRIX24_CLIENT_ID") || "";
          const bitrixClientSecret = Deno.env.get("BITRIX24_CLIENT_SECRET") || "";
          const refreshUrl = `https://oauth.bitrix.info/oauth/token/?grant_type=refresh_token&client_id=${bitrixClientId}&client_secret=${bitrixClientSecret}&refresh_token=${config.refresh_token}`;
          
          try {
            const tokenResponse = await fetch(refreshUrl);
            const tokenData = await tokenResponse.json();
            
            if (tokenData.access_token) {
              accessToken = tokenData.access_token;
              const newExpiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString();
              await supabase
                .from("integrations")
                .update({
                  config: {
                    ...config,
                    access_token: tokenData.access_token,
                    refresh_token: tokenData.refresh_token || config.refresh_token,
                    token_expires_at: newExpiresAt,
                    last_token_refresh_at: new Date().toISOString(),
                  },
                })
                .eq("id", integration_id);
              console.log("Token refreshed successfully");
            }
          } catch (e) {
            console.error("Token refresh error:", e);
          }
        }
      }
      
      if (!accessToken) {
        console.error("No access token available");
        throw new Error("Token de acesso não disponível. Reconecte o Bitrix24.");
      }

      const clientEndpoint = config.client_endpoint || `https://${config.domain}/rest/`;
      
      let sendResult: any;

      // Send message based on message_type
      if (message_type === "bot") {
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
        };

        console.log("Sending via imbot.message.add");

        const sendUrl = `${clientEndpoint}imbot.message.add`;
        const sendResponse = await fetch(sendUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(botMessagePayload)
        });

        sendResult = await sendResponse.json();
        console.log("Bitrix24 result:", JSON.stringify(sendResult, null, 2));

      } else {
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

        console.log("Sending via imconnector.send.messages");

        const sendUrl = `${clientEndpoint}imconnector.send.messages`;
        const sendResponse = await fetch(sendUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(messagePayload)
        });

        sendResult = await sendResponse.json();
        console.log("Bitrix24 result:", JSON.stringify(sendResult, null, 2));
      }

      // Update message status and conversation state
      if (sendResult.result) {
        await supabase
          .from("messages")
          .update({ status: "sent" })
          .eq("conversation_id", conversation_id)
          .eq("content", aiContent)
          .eq("is_from_bot", true);
      }

      await supabase
        .from("conversations")
        .update({ 
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_bot_message_hash: responseHash,
          bot_state: {
            ...conversation?.bot_state,
            last_processed_at: new Date().toISOString()
          }
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

    } finally {
      // Always release the lock
      await releaseLock(supabase, conversation_id);
    }

  } catch (error: unknown) {
    console.error("Error in ai-process-bitrix24:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

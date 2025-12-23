import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FUNCTION_VERSION = "2025-12-23-v3";

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
 * Fallback time-based lock using last_message_at
 */
async function fallbackTimeLock(supabase: any, conversationId: string): Promise<boolean> {
  try {
    const { data: conv } = await supabase
      .from("conversations")
      .select("last_message_at, updated_at")
      .eq("id", conversationId)
      .single();

    if (!conv) return true;

    const lastUpdate = new Date(conv.updated_at || conv.last_message_at);
    const now = new Date();
    const diffMs = now.getTime() - lastUpdate.getTime();

    // If last update was less than 2 seconds ago, another process might be handling
    if (diffMs < 2000) {
      console.log(`Fallback lock: Too recent (${diffMs}ms ago), skipping`);
      return false;
    }

    // Update updated_at to act as a lock
    await supabase
      .from("conversations")
      .update({ updated_at: now.toISOString() })
      .eq("id", conversationId);

    return true;
  } catch (error) {
    console.error("Fallback lock error:", error);
    return true; // Continue on error
  }
}

/**
 * Try to acquire a processing lock on the conversation with fallback
 */
async function tryAcquireLock(
  supabase: any, 
  conversationId: string, 
  lockTimeoutMs: number = 30000
): Promise<boolean> {
  try {
    const now = new Date();
    const lockExpiry = new Date(now.getTime() - lockTimeoutMs);

    const { data, error } = await supabase
      .from("conversations")
      .update({ processing_lock_at: now.toISOString() })
      .eq("id", conversationId)
      .or(`processing_lock_at.is.null,processing_lock_at.lt.${lockExpiry.toISOString()}`)
      .select("id");

    if (error) {
      // If column doesn't exist (42703), use fallback
      if (error.code === "42703") {
        console.warn(`Lock column missing (code: ${error.code}), using fallback time-based lock`);
        return await fallbackTimeLock(supabase, conversationId);
      }
      console.error("Error acquiring lock:", error);
      return await fallbackTimeLock(supabase, conversationId);
    }

    return data && data.length > 0;
  } catch (error) {
    console.error("Lock exception, using fallback:", error);
    return await fallbackTimeLock(supabase, conversationId);
  }
}

/**
 * Release the processing lock (with fallback handling)
 */
async function releaseLock(supabase: any, conversationId: string): Promise<void> {
  try {
    await supabase
      .from("conversations")
      .update({ processing_lock_at: null })
      .eq("id", conversationId);
  } catch (error) {
    // Ignore errors - column might not exist
    console.warn("Could not release lock:", error);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message_id, conversation_id, instance_id, contact_id, content, workspace_id, original_message_type = "text", image_url = null } = await req.json();
    
    console.log(`=== AI PROCESS MESSAGE (${FUNCTION_VERSION}) ===`);
    console.log("Input:", { message_id, conversation_id, instance_id, content: content?.substring(0, 50), original_message_type, image_url: !!image_url });

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
      // === ANTI-LOOP MECHANISM 2: Check recent outgoing messages ===
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
          console.log("ANTI-LOOP: Skipping - bot message sent recently:", timeSince, "ms ago");
          return new Response(JSON.stringify({ 
            skipped: true, 
            reason: "Bot message sent recently",
            time_since_ms: timeSince 
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // Check conversation attendance_mode
      const { data: conversation } = await supabase
        .from("conversations")
        .select("attendance_mode, bot_state, assigned_to")
        .eq("id", conversation_id)
        .single();

      if (conversation?.attendance_mode === "human") {
        console.log("SKIP: Conversation is in human mode, bot should not respond");
        return new Response(JSON.stringify({ 
          skipped: true, 
          reason: "Conversation in human mode" 
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // === ANTI-LOOP MECHANISM 3: Check if human agent responded recently ===
      const { data: lastOutgoing } = await supabase
        .from("messages")
        .select("is_from_bot, metadata, created_at")
        .eq("conversation_id", conversation_id)
        .eq("direction", "outgoing")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastOutgoing && !lastOutgoing.is_from_bot) {
        const source = lastOutgoing.metadata?.source;
        if (source === "bitrix24_operator" || source === "whatsapp_manual" || source === "thoth_app") {
          console.log("SKIP: Human agent responded recently via:", source);
          return new Response(JSON.stringify({ 
            skipped: true, 
            reason: "Human agent responded",
            source: source
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // Fetch the default persona for this workspace
      let systemPrompt = "Você é um assistente prestativo e profissional. Responda de forma clara e objetiva.";
      let personaName = "Assistente";
      let temperature = 0.7;
      let voiceId: string | null = null;
      let voiceEnabled = false;

      if (workspace_id) {
        // Try to find active default persona first
        const { data: defaultPersona, error: personaError } = await supabase
          .from("personas")
          .select("*")
          .eq("workspace_id", workspace_id)
          .eq("is_default", true)
          .eq("is_active", true)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (personaError) {
          console.error("Error fetching default persona:", personaError);
        }

        let persona = defaultPersona;

        // Fallback: if no active default, get any active persona
        if (!persona) {
          console.log("No active default persona found, trying fallback...");
          const { data: fallbackPersona } = await supabase
            .from("personas")
            .select("*")
            .eq("workspace_id", workspace_id)
            .eq("is_active", true)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          
          if (fallbackPersona) {
            persona = fallbackPersona;
            console.log("Using fallback persona:", fallbackPersona.name);
          }
        }

        if (persona) {
          systemPrompt = persona.system_prompt || systemPrompt;
          personaName = persona.name || personaName;
          temperature = persona.temperature || temperature;
          voiceId = persona.voice_id || null;
          voiceEnabled = persona.voice_enabled || false;
          console.log("Using persona:", personaName, "voice_enabled:", voiceEnabled, "voice_id:", voiceId);
        } else {
          console.warn("No persona found for workspace:", workspace_id);
        }
      }

      // Search knowledge base for relevant context
      let knowledgeContext = "";
      if (workspace_id && content) {
        const relevantChunks = await searchKnowledge(supabase, workspace_id, content);
        
        if (relevantChunks.length > 0) {
          knowledgeContext = `\n\n## Base de Conhecimento\nUse as seguintes informações para responder quando relevante:\n\n${relevantChunks.join("\n\n---\n\n")}`;
          console.log(`Found ${relevantChunks.length} relevant knowledge chunks`);
        }
      }

      // Fetch conversation history (last 15 messages for better context)
      const { data: history } = await supabase
        .from("messages")
        .select("content, direction, is_from_bot, created_at")
        .eq("conversation_id", conversation_id)
        .order("created_at", { ascending: false })
        .limit(15);

      // Get last bot message to prevent repetition
      const lastBotMessage = history?.find(m => m.is_from_bot && m.direction === "outgoing")?.content || "";

      // Build anti-repetition instruction
      const antiRepetitionPrompt = lastBotMessage 
        ? `\n\nIMPORTANTE: Você já respondeu: "${lastBotMessage.substring(0, 200)}..."\nNÃO repita esta mensagem. Avance a conversa ou peça mais informações se necessário.`
        : "";

      // Build full system prompt with knowledge context and anti-repetition
      const fullSystemPrompt = systemPrompt + knowledgeContext + antiRepetitionPrompt;

      // Build messages array - handle multimodal content for images
      const messages: any[] = [
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

      // Add current message - handle image if present
      if (image_url) {
        // Multimodal message with image
        const userContent: any[] = [];
        
        if (content) {
          userContent.push({ type: "text", text: content });
        } else {
          userContent.push({ type: "text", text: "O que você vê nesta imagem?" });
        }
        
        userContent.push({
          type: "image_url",
          image_url: { url: image_url }
        });
        
        messages.push({ role: "user", content: userContent });
        console.log("Added multimodal message with image");
      } else if (content && !history?.some(h => h.content === content)) {
        // Text-only message
        messages.push({ role: "user", content });
      }

      console.log("Sending to AI with", messages.length, "messages (knowledge context:", knowledgeContext.length > 0 ? "yes" : "no", ", image:", !!image_url, ")");

      // Call Lovable AI Gateway
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
      
      if (responseHash === lastBotHash) {
        console.log("ANTI-LOOP: AI generated same response as before, modifying...");
        // Don't send duplicate, update bot state
        await supabase
          .from("conversations")
          .update({ 
            bot_state: { 
              ...conversation?.bot_state,
              duplicate_detected_at: new Date().toISOString(),
              last_duplicate_hash: responseHash
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

      // Get contact phone number
      const { data: contact } = await supabase
        .from("contacts")
        .select("phone_number")
        .eq("id", contact_id)
        .single();

      if (!contact) {
        throw new Error("Contact not found");
      }

      // Determine if we should respond with audio
      const shouldRespondWithAudio = original_message_type === "audio" && voiceEnabled;
      console.log("Should respond with audio:", shouldRespondWithAudio, "original_type:", original_message_type, "voice_enabled:", voiceEnabled);

      let audioBase64: string | null = null;

      if (shouldRespondWithAudio) {
        // Generate audio response using ElevenLabs TTS
        try {
          console.log("Generating audio response via ElevenLabs TTS...");
          const ttsResponse = await fetch(`${supabaseUrl}/functions/v1/elevenlabs-tts`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({
              text: aiContent,
              voice: voiceId || "jessica", // Use persona's voice or default
            }),
          });

          if (ttsResponse.ok) {
            const ttsResult = await ttsResponse.json();
            audioBase64 = ttsResult.audio_base64;
            console.log("TTS audio generated successfully, size:", audioBase64?.length || 0);
          } else {
            const ttsError = await ttsResponse.text();
            console.error("TTS failed, falling back to text:", ttsError);
          }
        } catch (ttsErr) {
          console.error("TTS error, falling back to text:", ttsErr);
        }
      }

      // Send message via WhatsApp (audio or text)
      // Get instance to determine provider type
      const { data: instance } = await supabase
        .from("instances")
        .select("provider_type, evolution_instance_name")
        .eq("id", instance_id)
        .single();

      const providerType = instance?.provider_type || "wapi";
      
      // Determine which send function to use based on provider_type
      let sendFunction = "wapi-send-message";
      if (providerType === "evolution") {
        sendFunction = "evolution-send-message";
      } else if (providerType === "gupshup") {
        sendFunction = "gupshup-send-message";
      }

      console.log(`Provider factory: Using ${sendFunction} for provider_type=${providerType}`);

      const sendPayload: Record<string, unknown> = {
        instance_id,
        phone_number: contact.phone_number,
        conversation_id,
        contact_id,
        workspace_id,
        internal_call: true,
        evolution_instance_name: instance?.evolution_instance_name,
      };

      if (audioBase64) {
        sendPayload.message_type = "audio";
        sendPayload.audio_base64 = audioBase64;
        sendPayload.message = aiContent; // Keep text for fallback/storage
      } else {
        sendPayload.message = aiContent;
      }

      const sendResponse = await fetch(`${supabaseUrl}/functions/v1/${sendFunction}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify(sendPayload),
      });

      if (!sendResponse.ok) {
        const sendError = await sendResponse.text();
        console.error(`Failed to send message via ${sendFunction}:`, sendError);
        throw new Error("Failed to send WhatsApp message");
      }

      // Update conversation bot_state and message hash
      await supabase
        .from("conversations")
        .update({ 
          last_bot_message_hash: responseHash,
          bot_state: {
            ...conversation?.bot_state,
            last_processed_at: new Date().toISOString(),
            last_processed_message_id: message_id
          }
        })
        .eq("id", conversation_id);

      console.log("AI message sent successfully", audioBase64 ? "(audio)" : "(text)");

      return new Response(JSON.stringify({ 
        success: true, 
        response: aiContent,
        persona: personaName,
        sent_as_audio: !!audioBase64
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } finally {
      // Always release the lock when done
      await releaseLock(supabase, conversation_id);
    }

  } catch (error: unknown) {
    console.error("Error in ai-process-message:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

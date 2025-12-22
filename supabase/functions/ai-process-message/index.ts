import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    // Get all completed documents for this workspace
    const { data: documents } = await supabase
      .from("knowledge_documents")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("status", "completed");

    if (!documents || documents.length === 0) {
      return [];
    }

    const documentIds = documents.map((d: any) => d.id);

    // Get chunks from these documents
    const { data: chunks } = await supabase
      .from("knowledge_chunks")
      .select("content")
      .in("document_id", documentIds)
      .limit(limit * 3); // Get more to filter

    if (!chunks || chunks.length === 0) {
      return [];
    }

    // Simple keyword matching (in production, use embeddings)
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

    // Sort by relevance and take top chunks
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message_id, conversation_id, instance_id, contact_id, content, workspace_id, original_message_type = "text" } = await req.json();
    
    console.log("AI Process Message called:", { message_id, conversation_id, instance_id, content, original_message_type });

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch the default persona for this workspace
    let systemPrompt = "Você é um assistente prestativo e profissional. Responda de forma clara e objetiva.";
    let personaName = "Assistente";
    let temperature = 0.7;
    let voiceId: string | null = null;
    let voiceEnabled = false;

    if (workspace_id) {
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
        voiceId = persona.voice_id || null;
        voiceEnabled = persona.voice_enabled || false;
        console.log("Using persona:", personaName, "voice_enabled:", voiceEnabled, "voice_id:", voiceId);
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

    // Build system prompt with knowledge context
    const fullSystemPrompt = systemPrompt + knowledgeContext;

    // Fetch conversation history (last 10 messages for context)
    const { data: history } = await supabase
      .from("messages")
      .select("content, direction, is_from_bot")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: false })
      .limit(10);

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

    console.log("Sending to AI with", messages.length, "messages (knowledge context:", knowledgeContext.length > 0 ? "yes" : "no", ")");

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
    const sendPayload: Record<string, unknown> = {
      instance_id,
      phone_number: contact.phone_number,
      conversation_id,
      contact_id,
      workspace_id,
      internal_call: true,
    };

    if (audioBase64) {
      sendPayload.message_type = "audio";
      sendPayload.audio_base64 = audioBase64;
      sendPayload.message = aiContent; // Keep text for fallback/storage
    } else {
      sendPayload.message = aiContent;
    }

    const sendResponse = await fetch(`${supabaseUrl}/functions/v1/wapi-send-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify(sendPayload),
    });

    if (!sendResponse.ok) {
      const sendError = await sendResponse.text();
      console.error("Failed to send message:", sendError);
      throw new Error("Failed to send WhatsApp message");
    }

    console.log("AI message sent successfully", audioBase64 ? "(audio)" : "(text)");

    return new Response(JSON.stringify({ 
      success: true, 
      response: aiContent,
      persona: personaName,
      sent_as_audio: !!audioBase64
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Error in ai-process-message:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

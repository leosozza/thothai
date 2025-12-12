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
    const { message_id, conversation_id, instance_id, contact_id, content, workspace_id } = await req.json();
    
    console.log("AI Process Message called:", { message_id, conversation_id, instance_id, content });

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
        console.log("Using persona:", personaName);
      }
    }

    // Fetch conversation history (last 10 messages for context)
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

    // Send message via WhatsApp
    const sendResponse = await fetch(`${supabaseUrl}/functions/v1/wapi-send-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        instance_id,
        phone_number: contact.phone_number,
        message: aiContent,
        conversation_id,
        contact_id,
      }),
    });

    if (!sendResponse.ok) {
      const sendError = await sendResponse.text();
      console.error("Failed to send message:", sendError);
      throw new Error("Failed to send WhatsApp message");
    }

    console.log("AI message sent successfully");

    return new Response(JSON.stringify({ 
      success: true, 
      response: aiContent,
      persona: personaName 
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

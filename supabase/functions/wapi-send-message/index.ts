import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WAPI_BASE_URL = "https://api.w-api.app/v1";

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

    const { 
      instanceId, 
      conversationId,
      contactId,
      phoneNumber, 
      message, 
      messageType = "text",
      mediaUrl,
      workspaceId
    } = await req.json();

    console.log("Send message request:", { instanceId, phoneNumber, messageType });

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

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

    if (instance.status !== "connected") {
      return new Response(JSON.stringify({ error: "Instância não está conectada" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get W-API config
    const { data: integration, error: intError } = await supabaseAdmin
      .from("integrations")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("type", "wapi")
      .eq("is_active", true)
      .single();

    if (intError || !integration) {
      return new Response(JSON.stringify({ error: "W-API não configurada" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const config = integration.config as { api_key?: string };
    const wapiApiKey = config?.api_key;
    const wapiInstanceId = instance.instance_key;

    if (!wapiApiKey || !wapiInstanceId) {
      return new Response(JSON.stringify({ error: "Configuração W-API incompleta" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Format phone number for WhatsApp (W-API expects just the number)
    const formattedPhone = phoneNumber.replace(/\D/g, "");

    let endpoint = "message/send-text";
    let body: Record<string, unknown> = {
      phone: formattedPhone,
      message: message,
    };

    // Handle different message types
    if (messageType === "audio" && mediaUrl) {
      endpoint = "message/send-audio";
      body = { phone: formattedPhone, audioUrl: mediaUrl };
    } else if (messageType === "image" && mediaUrl) {
      endpoint = "message/send-image";
      body = { phone: formattedPhone, imageUrl: mediaUrl, caption: message };
    } else if (messageType === "document" && mediaUrl) {
      endpoint = "message/send-document";
      body = { phone: formattedPhone, documentUrl: mediaUrl, fileName: message || "document" };
    }

    console.log("W-API request body:", JSON.stringify(body));

    // Send message via W-API
    console.log(`Sending ${messageType} message via W-API...`);
    
    const sendResponse = await fetch(
      `${WAPI_BASE_URL}/${endpoint}?instanceId=${wapiInstanceId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${wapiApiKey}`,
        },
        body: JSON.stringify(body),
      }
    );

    if (!sendResponse.ok) {
      const errorText = await sendResponse.text();
      console.error("W-API send error:", errorText);
      return new Response(JSON.stringify({ error: "Erro ao enviar mensagem" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sendData = await sendResponse.json();
    console.log("Message sent:", sendData);

    const waMessageId = sendData.key?.id || sendData.id || sendData.messageId;

    // Save message to database
    const { data: savedMessage, error: saveError } = await supabaseAdmin
      .from("messages")
      .insert({
        instance_id: instanceId,
        contact_id: contactId,
        conversation_id: conversationId,
        whatsapp_message_id: waMessageId,
        direction: "outgoing",
        message_type: messageType,
        content: message,
        media_url: mediaUrl,
        status: "sent",
        is_from_bot: false,
      })
      .select()
      .single();

    if (saveError) {
      console.error("Error saving message:", saveError);
    }

    // Update conversation last_message_at
    await supabaseAdmin
      .from("conversations")
      .update({
        last_message_at: new Date().toISOString(),
        unread_count: 0,
      })
      .eq("id", conversationId);

    return new Response(JSON.stringify({ 
      success: true, 
      messageId: waMessageId,
      message: savedMessage
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Send message error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

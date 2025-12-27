import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

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

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const requestBody = await req.json();
    console.log("=== WAPI-SEND-MESSAGE REQUEST ===");
    console.log("Request body keys:", Object.keys(requestBody));
    console.log("Request body:", JSON.stringify(requestBody));
    
    const { 
      instanceId, 
      instance_id, // Alternative naming
      conversationId,
      conversation_id, // Alternative naming
      contactId,
      contact_id, // Alternative naming
      phoneNumber, 
      phone_number, // Alternative naming
      phone, // Another alternative
      message, 
      messageType,
      message_type, // Alternative naming
      mediaUrl,
      media_url, // Alternative naming
      audio_base64, // Base64 encoded audio from TTS
      workspaceId,
      workspace_id, // Alternative naming
      internal_call, // Flag for internal edge function calls
      source // Message source: "bot", "thoth_app", "bitrix24_operator"
    } = requestBody;

    // Normalize parameter names - support all naming conventions
    const finalInstanceId = instanceId || instance_id;
    const finalConversationId = conversationId || conversation_id;
    const finalContactId = contactId || contact_id;
    const finalPhoneNumber = phoneNumber || phone_number || phone;
    const finalMessageType = message_type || messageType || "text";
    const finalMediaUrl = mediaUrl || media_url;
    const finalWorkspaceId = workspaceId || workspace_id;
    
    // Determine message source
    const messageSource = source || (internal_call ? "bot" : "thoth_app");

    console.log("Normalized params:", { 
      instanceId: finalInstanceId, 
      phoneNumber: finalPhoneNumber, 
      messageLength: message?.length || 0,
      messageType: finalMessageType, 
      internal_call,
      source: messageSource
    });
    
    // Validate required parameters
    if (!finalInstanceId) {
      console.error("Missing instance_id");
      return new Response(JSON.stringify({ success: false, error: "instance_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    if (!finalPhoneNumber) {
      console.error("Missing phone number");
      return new Response(JSON.stringify({ success: false, error: "phone_number is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    if (!message) {
      console.error("Missing message");
      return new Response(JSON.stringify({ success: false, error: "message is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get auth token from request (optional for internal calls)
    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;

    // If not an internal call, require authentication
    if (!internal_call && !finalWorkspaceId) {
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
      userId = user.id;
    }

    // Verify instance exists
    let instanceQuery = supabaseAdmin
      .from("instances")
      .select("*")
      .eq("id", finalInstanceId);

    // If we have a userId, verify ownership
    if (userId) {
      instanceQuery = instanceQuery.eq("user_id", userId);
    }

    const { data: instance, error: instanceError } = await instanceQuery.single();

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

    const effectiveWorkspaceId = finalWorkspaceId || instance.workspace_id;

    // Get W-API config
    const { data: integration, error: intError } = await supabaseAdmin
      .from("integrations")
      .select("*")
      .eq("workspace_id", effectiveWorkspaceId)
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
      console.error("W-API config incomplete. apiKey:", !!wapiApiKey, "instanceId:", !!wapiInstanceId);
      return new Response(JSON.stringify({ success: false, error: "Configuração W-API incompleta" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    console.log("W-API config loaded:", { 
      wapiInstanceId, 
      hasApiKey: !!wapiApiKey,
      apiKeyPrefix: wapiApiKey?.substring(0, 10) + "..."
    });

    // Format phone number for WhatsApp (W-API expects just the number)
    const formattedPhone = finalPhoneNumber.replace(/\D/g, "");
    console.log("Formatted phone:", formattedPhone);

    let endpoint = "message/send-text";
    let body: Record<string, unknown> = {
      phone: formattedPhone,
      message: message,
    };
    
    let mediaUrlToSave = finalMediaUrl;

    // Handle different message types
    if (finalMessageType === "audio" && audio_base64) {
      // W-API doesn't support audio base64 directly (endpoint returns 404).
      // Upload to public storage and send as URL.
      const audioBytes = new Uint8Array(base64Decode(audio_base64));
      const objectPath = `tts/${effectiveWorkspaceId}/${crypto.randomUUID()}.mp3`;

      const audioBlob = new Blob([audioBytes], { type: "audio/mpeg" });
      const { error: uploadError } = await supabaseAdmin.storage
        .from("assets")
        .upload(objectPath, audioBlob, {
          contentType: "audio/mpeg",
          upsert: true,
        });

      if (uploadError) {
        console.error("Audio upload error:", uploadError);
        return new Response(JSON.stringify({ error: "Erro ao preparar áudio" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: publicData } = supabaseAdmin.storage.from("assets").getPublicUrl(objectPath);
      const publicUrl = publicData.publicUrl;

      endpoint = "message/send-audio";
      body = { phone: formattedPhone, audio: publicUrl };
      mediaUrlToSave = publicUrl;
      console.log("Sending audio via public URL:", publicUrl);
    } else if (finalMessageType === "audio" && finalMediaUrl) {
      endpoint = "message/send-audio";
      body = { phone: formattedPhone, audio: finalMediaUrl };
    } else if (finalMessageType === "image" && finalMediaUrl) {
      endpoint = "message/send-image";
      body = { phone: formattedPhone, imageUrl: finalMediaUrl, caption: message };
    } else if (finalMessageType === "document" && finalMediaUrl) {
      endpoint = "message/send-document";
      body = { phone: formattedPhone, documentUrl: finalMediaUrl, fileName: message || "document" };
    }

    const fullUrl = `${WAPI_BASE_URL}/${endpoint}?instanceId=${wapiInstanceId}`;
    console.log("W-API request:", {
      url: fullUrl,
      method: "POST",
      body: JSON.stringify(body),
    });

    // Send message via W-API
    console.log(`Sending ${finalMessageType} message via W-API...`);
    
    const sendResponse = await fetch(fullUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${wapiApiKey}`,
      },
      body: JSON.stringify(body),
    });

    const responseText = await sendResponse.text();
    console.log("W-API response status:", sendResponse.status);
    console.log("W-API response body:", responseText);

    if (!sendResponse.ok) {
      console.error("W-API send error - Status:", sendResponse.status, "Body:", responseText);
      return new Response(JSON.stringify({ 
        success: false, 
        error: `W-API error: ${sendResponse.status} - ${responseText}` 
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sendData;
    try {
      sendData = JSON.parse(responseText);
    } catch {
      sendData = { raw: responseText };
    }
    console.log("Message sent:", sendData);

    const waMessageId = sendData.key?.id || sendData.id || sendData.messageId;

    // Save message to database (only if we have conversation info)
    let savedMessage = null;
    if (finalConversationId && finalContactId) {
      const isFromBot = messageSource === "bot";
      
      const { data: msgData, error: saveError } = await supabaseAdmin
        .from("messages")
        .insert({
          instance_id: finalInstanceId,
          contact_id: finalContactId,
          conversation_id: finalConversationId,
          whatsapp_message_id: waMessageId,
          direction: "outgoing",
          message_type: finalMessageType,
          content: message,
          media_url: mediaUrlToSave,
          status: "sent",
          is_from_bot: isFromBot,
          metadata: { source: messageSource }
        })
        .select()
        .single();

      if (saveError) {
        console.error("Error saving message:", saveError);
      }
      savedMessage = msgData;

      // If human agent sent the message, switch to human mode
      if (messageSource === "thoth_app") {
        await supabaseAdmin
          .from("conversations")
          .update({
            attendance_mode: "human",
            assigned_to: "thoth_app",
            last_message_at: new Date().toISOString(),
            unread_count: 0,
          })
          .eq("id", finalConversationId);
        console.log("Human agent sent message via ThothAI app - switched to human mode");
      } else {
        // Just update timestamp for bot messages
        await supabaseAdmin
          .from("conversations")
          .update({
            last_message_at: new Date().toISOString(),
            unread_count: 0,
          })
          .eq("id", finalConversationId);
      }
    }

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

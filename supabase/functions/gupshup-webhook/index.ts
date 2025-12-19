import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get instance ID from query params
    const url = new URL(req.url);
    const instanceId = url.searchParams.get("instanceId");

    const body = await req.json();
    console.log("[gupshup-webhook] Received webhook:", JSON.stringify(body, null, 2));

    if (!instanceId) {
      console.error("[gupshup-webhook] Missing instanceId in query params");
      return new Response(
        JSON.stringify({ error: "Missing instanceId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get instance
    const { data: instance, error: instanceError } = await supabase
      .from("instances")
      .select("*, workspaces!instances_workspace_id_fkey(*)")
      .eq("id", instanceId)
      .single();

    if (instanceError || !instance) {
      console.error("[gupshup-webhook] Instance not found:", instanceError);
      return new Response(
        JSON.stringify({ error: "Instance not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse Gupshup webhook payload
    // Gupshup sends different event types: message, message-event, user-event
    const { type, payload } = body;

    if (type === "message" || type === "message-event") {
      await handleMessage(supabase, instance, body);
    } else if (type === "user-event") {
      await handleUserEvent(supabase, instance, body);
    } else if (type === "message-event") {
      await handleMessageStatus(supabase, instance, body);
    } else {
      console.log("[gupshup-webhook] Unhandled event type:", type);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[gupshup-webhook] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function handleMessage(supabase: any, instance: any, webhookData: any) {
  const { payload } = webhookData;
  
  if (!payload) {
    console.log("[gupshup-webhook] No payload in message");
    return;
  }

  const senderPhone = payload.source || payload.sender?.phone;
  const messageContent = payload.payload?.text || payload.text || "";
  const messageType = payload.type || "text";
  const gupshupMessageId = payload.id || webhookData.messageId;

  console.log(`[gupshup-webhook] Processing message from ${senderPhone}: ${messageContent}`);

  if (!senderPhone) {
    console.error("[gupshup-webhook] No sender phone in message");
    return;
  }

  // Normalize phone number (remove + and spaces)
  const normalizedPhone = senderPhone.replace(/\D/g, "");

  // Find or create contact
  let { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("*")
    .eq("instance_id", instance.id)
    .eq("phone_number", normalizedPhone)
    .single();

  if (contactError || !contact) {
    // Create new contact
    const { data: newContact, error: createContactError } = await supabase
      .from("contacts")
      .insert({
        instance_id: instance.id,
        phone_number: normalizedPhone,
        push_name: payload.sender?.name || payload.senderName || null,
      })
      .select()
      .single();

    if (createContactError) {
      console.error("[gupshup-webhook] Error creating contact:", createContactError);
      return;
    }
    contact = newContact;
    console.log("[gupshup-webhook] Created new contact:", contact.id);
  }

  // Find or create conversation
  let { data: conversation, error: convError } = await supabase
    .from("conversations")
    .select("*")
    .eq("instance_id", instance.id)
    .eq("contact_id", contact.id)
    .eq("status", "open")
    .single();

  if (convError || !conversation) {
    // Create new conversation
    const { data: newConversation, error: createConvError } = await supabase
      .from("conversations")
      .insert({
        instance_id: instance.id,
        contact_id: contact.id,
        status: "open",
        last_message_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (createConvError) {
      console.error("[gupshup-webhook] Error creating conversation:", createConvError);
      return;
    }
    conversation = newConversation;
    console.log("[gupshup-webhook] Created new conversation:", conversation.id);
  }

  // Determine message type
  let dbMessageType = "text";
  let mediaUrl = null;
  let mediaMimeType = null;

  if (messageType === "image" || payload.type === "image") {
    dbMessageType = "image";
    mediaUrl = payload.payload?.url || payload.url;
    mediaMimeType = "image/jpeg";
  } else if (messageType === "audio" || messageType === "voice" || payload.type === "audio") {
    dbMessageType = "audio";
    mediaUrl = payload.payload?.url || payload.url;
    mediaMimeType = "audio/ogg";
  } else if (messageType === "document" || payload.type === "document") {
    dbMessageType = "document";
    mediaUrl = payload.payload?.url || payload.url;
    mediaMimeType = payload.payload?.contentType || "application/pdf";
  } else if (messageType === "video" || payload.type === "video") {
    dbMessageType = "video";
    mediaUrl = payload.payload?.url || payload.url;
    mediaMimeType = "video/mp4";
  }

  // Save message
  const { error: messageError } = await supabase
    .from("messages")
    .insert({
      instance_id: instance.id,
      contact_id: contact.id,
      conversation_id: conversation.id,
      content: messageContent,
      message_type: dbMessageType,
      media_url: mediaUrl,
      media_mime_type: mediaMimeType,
      direction: "inbound",
      status: "received",
      whatsapp_message_id: gupshupMessageId,
      metadata: { gupshup: webhookData },
    });

  if (messageError) {
    console.error("[gupshup-webhook] Error saving message:", messageError);
    return;
  }

  // Update conversation
  await supabase
    .from("conversations")
    .update({
      last_message_at: new Date().toISOString(),
      unread_count: conversation.unread_count + 1,
    })
    .eq("id", conversation.id);

  console.log("[gupshup-webhook] Message saved successfully");

  // Trigger AI processing if attendance_mode is 'ai'
  if (conversation.attendance_mode === "ai") {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      await fetch(`${supabaseUrl}/functions/v1/ai-process-message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          conversationId: conversation.id,
          instanceId: instance.id,
          contactId: contact.id,
          messageContent: messageContent,
        }),
      });
    } catch (aiError) {
      console.error("[gupshup-webhook] Error triggering AI processing:", aiError);
    }
  }
}

async function handleUserEvent(supabase: any, instance: any, webhookData: any) {
  const { payload } = webhookData;
  console.log("[gupshup-webhook] User event:", payload);
  
  // Handle user events like "opted-in", "opted-out"
  // Can be used to update contact preferences
}

async function handleMessageStatus(supabase: any, instance: any, webhookData: any) {
  const { payload } = webhookData;
  console.log("[gupshup-webhook] Message status update:", payload);

  if (!payload?.gsId && !payload?.id) {
    return;
  }

  const gupshupMessageId = payload.gsId || payload.id;
  const status = payload.type || payload.status;

  // Map Gupshup statuses to our statuses
  let dbStatus = "pending";
  if (status === "sent" || status === "enqueued") {
    dbStatus = "sent";
  } else if (status === "delivered") {
    dbStatus = "delivered";
  } else if (status === "read") {
    dbStatus = "read";
  } else if (status === "failed" || status === "error") {
    dbStatus = "failed";
  }

  // Update message status
  await supabase
    .from("messages")
    .update({ status: dbStatus })
    .eq("whatsapp_message_id", gupshupMessageId);

  console.log(`[gupshup-webhook] Updated message ${gupshupMessageId} status to ${dbStatus}`);
}

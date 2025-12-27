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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get instanceId from query params
    const url = new URL(req.url);
    const instanceId = url.searchParams.get("instanceId");

    if (!instanceId) {
      console.error("Missing instanceId in query params");
      return new Response(JSON.stringify({ error: "instanceId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    console.log("APIBrasil Webhook received:", JSON.stringify(body).substring(0, 500));

    // Get instance details
    const { data: instance, error: instanceError } = await supabase
      .from("instances")
      .select("*")
      .eq("id", instanceId)
      .single();

    if (instanceError || !instance) {
      console.error("Instance not found:", instanceId);
      return new Response(JSON.stringify({ error: "Instance not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine event type based on webhook payload
    const eventType = body.event || body.type || "message";

    // Handle connection status updates
    if (eventType === "connection" || body.status) {
      const status = body.status || body.state;
      console.log("Connection status update:", status);

      if (status === "CONNECTED" || status === "open" || status === "connected") {
        await supabase
          .from("instances")
          .update({
            status: "connected",
            phone_number: body.phone || body.number || body.wid?.replace("@s.whatsapp.net", ""),
            qr_code: null,
          })
          .eq("id", instanceId);
      } else if (status === "DISCONNECTED" || status === "close") {
        await supabase
          .from("instances")
          .update({
            status: "disconnected",
            qr_code: null,
          })
          .eq("id", instanceId);
      } else if (status === "QRCODE" || body.qrcode) {
        await supabase
          .from("instances")
          .update({
            status: "qr_pending",
            qr_code: body.qrcode || body.qr,
          })
          .eq("id", instanceId);
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle message events
    if (eventType === "message" || body.message || body.data?.message) {
      const message = body.message || body.data?.message || body;
      
      // Skip outgoing messages (from us)
      if (message.fromMe === true || message.isFromMe === true) {
        console.log("Skipping outgoing message");
        return new Response(JSON.stringify({ success: true, skipped: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Extract message details
      const senderPhone = (message.from || message.remoteJid || message.phone || "")
        .replace("@s.whatsapp.net", "")
        .replace("@c.us", "")
        .replace(/\D/g, "");

      if (!senderPhone) {
        console.error("Could not extract sender phone");
        return new Response(JSON.stringify({ error: "Invalid sender" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Extract message content
      let messageContent = "";
      let messageType = "text";
      let mediaUrl = null;
      let mediaBase64 = null;

      // Handle different message types
      if (message.body || message.text || message.conversation) {
        messageContent = message.body || message.text || message.conversation;
        messageType = "text";
      } else if (message.imageMessage || message.type === "image") {
        messageType = "image";
        mediaUrl = message.imageMessage?.url || message.mediaUrl || message.url;
        mediaBase64 = message.imageMessage?.base64 || message.base64;
        messageContent = message.imageMessage?.caption || message.caption || "[Imagem]";
      } else if (message.audioMessage || message.type === "audio" || message.type === "ptt") {
        messageType = "audio";
        mediaUrl = message.audioMessage?.url || message.mediaUrl || message.url;
        mediaBase64 = message.audioMessage?.base64 || message.base64;
        messageContent = "[Áudio]";
      } else if (message.videoMessage || message.type === "video") {
        messageType = "video";
        mediaUrl = message.videoMessage?.url || message.mediaUrl || message.url;
        messageContent = message.videoMessage?.caption || message.caption || "[Vídeo]";
      } else if (message.documentMessage || message.type === "document") {
        messageType = "document";
        mediaUrl = message.documentMessage?.url || message.mediaUrl || message.url;
        messageContent = message.documentMessage?.fileName || message.fileName || "[Documento]";
      } else if (message.buttonResponse || message.listResponse || message.selectedButtonId) {
        // Handle interactive button/list responses
        messageType = "text";
        messageContent = message.buttonResponse?.selectedButtonId || 
                        message.listResponse?.title ||
                        message.selectedButtonId ||
                        message.listResponse?.rowId ||
                        message.text ||
                        "[Resposta interativa]";
        console.log("Interactive response:", messageContent);
      }

      console.log("Processing message from:", senderPhone, "type:", messageType, "content:", messageContent?.substring(0, 50));

      // Find or create contact
      let { data: contact } = await supabase
        .from("contacts")
        .select("*")
        .eq("instance_id", instanceId)
        .eq("phone_number", senderPhone)
        .maybeSingle();

      if (!contact) {
        const pushName = message.pushName || message.notifyName || message.senderName;
        const { data: newContact, error: contactError } = await supabase
          .from("contacts")
          .insert({
            instance_id: instanceId,
            phone_number: senderPhone,
            name: pushName || null,
            push_name: pushName || null,
          })
          .select()
          .single();

        if (contactError) {
          console.error("Error creating contact:", contactError);
          return new Response(JSON.stringify({ error: "Failed to create contact" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        contact = newContact;
      } else if (message.pushName && !contact.name) {
        // Update contact name if we got a push name
        await supabase
          .from("contacts")
          .update({ name: message.pushName, push_name: message.pushName })
          .eq("id", contact.id);
      }

      // Find or create conversation
      let { data: conversation } = await supabase
        .from("conversations")
        .select("*")
        .eq("instance_id", instanceId)
        .eq("contact_id", contact.id)
        .eq("status", "open")
        .maybeSingle();

      const isFirstMessage = !conversation;

      if (!conversation) {
        const { data: newConversation, error: convError } = await supabase
          .from("conversations")
          .insert({
            instance_id: instanceId,
            contact_id: contact.id,
            status: "open",
            attendance_mode: "ai",
            unread_count: 1,
            last_message_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (convError) {
          console.error("Error creating conversation:", convError);
          return new Response(JSON.stringify({ error: "Failed to create conversation" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        conversation = newConversation;
      } else {
        // Update conversation
        await supabase
          .from("conversations")
          .update({
            last_message_at: new Date().toISOString(),
            unread_count: (conversation.unread_count || 0) + 1,
          })
          .eq("id", conversation.id);
      }

      // Save message
      const whatsappMessageId = message.id || message.messageId || message.key?.id || `apibrasil_${Date.now()}`;

      const { data: savedMessage, error: msgError } = await supabase
        .from("messages")
        .insert({
          instance_id: instanceId,
          contact_id: contact.id,
          conversation_id: conversation.id,
          whatsapp_message_id: whatsappMessageId,
          direction: "incoming",
          message_type: messageType,
          content: messageContent,
          media_url: mediaUrl,
          status: "received",
          is_from_bot: false,
          metadata: { 
            source: "apibrasil",
            raw: body 
          },
        })
        .select()
        .single();

      if (msgError) {
        console.error("Error saving message:", msgError);
        return new Response(JSON.stringify({ error: "Failed to save message" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Process with AI if in AI mode
      if (conversation.attendance_mode === "ai" && !conversation.processing_blocked) {
        console.log("Triggering flow-engine for AI processing");
        
        try {
          // Handle audio transcription if needed
          let processContent = messageContent;
          let imageUrl = null;

          if (messageType === "audio" && (mediaUrl || mediaBase64)) {
            // Transcribe audio
            try {
              const sttResponse = await fetch(`${supabaseUrl}/functions/v1/elevenlabs-stt`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${supabaseKey}`,
                },
                body: JSON.stringify({
                  audio_url: mediaUrl,
                  audio_base64: mediaBase64,
                }),
              });

              if (sttResponse.ok) {
                const sttResult = await sttResponse.json();
                if (sttResult.text) {
                  processContent = sttResult.text;
                  // Update message with transcription
                  await supabase
                    .from("messages")
                    .update({ audio_transcription: sttResult.text })
                    .eq("id", savedMessage.id);
                }
              }
            } catch (sttError) {
              console.error("STT error:", sttError);
            }
          }

          if (messageType === "image" && mediaUrl) {
            imageUrl = mediaUrl;
          }

          // Call flow-engine
          const flowResponse = await fetch(`${supabaseUrl}/functions/v1/flow-engine`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({
              message_id: savedMessage.id,
              conversation_id: conversation.id,
              instance_id: instanceId,
              contact_id: contact.id,
              content: processContent,
              workspace_id: instance.workspace_id,
              is_first_message: isFirstMessage,
              original_message_type: messageType,
              image_url: imageUrl,
            }),
          });

          console.log("Flow-engine response:", flowResponse.status);
        } catch (flowError) {
          console.error("Error calling flow-engine:", flowError);
        }
      }

      return new Response(JSON.stringify({ 
        success: true, 
        message_id: savedMessage.id,
        contact_id: contact.id,
        conversation_id: conversation.id
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle message status updates
    if (eventType === "message_status" || eventType === "ack" || body.ack !== undefined) {
      const messageId = body.messageId || body.id || body.key?.id;
      const ack = body.ack ?? body.status;
      
      let status = "sent";
      if (ack === 2 || ack === "delivered") status = "delivered";
      if (ack === 3 || ack === "read") status = "read";
      if (ack === -1 || ack === "failed") status = "failed";

      if (messageId) {
        await supabase
          .from("messages")
          .update({ status })
          .eq("whatsapp_message_id", messageId);
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, handled: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("APIBrasil Webhook error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

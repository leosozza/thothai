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
    console.log("APIBrasil Webhook received:", JSON.stringify(body).substring(0, 1000));

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

    // Determine event type (formato Evolution API via APIBrasil)
    const eventType = body.event || body.type || "messages.upsert";

    // Handle QRCODE_UPDATED event
    if (eventType === "QRCODE_UPDATED" || eventType === "qrcode.updated" || body.qrcode) {
      const qrCode = body.qrcode?.base64 || body.base64 || body.qr;
      
      if (qrCode) {
        await supabase
          .from("instances")
          .update({
            status: "qr_pending",
            qr_code: qrCode,
          })
          .eq("id", instanceId);
        
        console.log("QR Code updated for instance:", instanceId);
      }

      return new Response(JSON.stringify({ success: true, event: "qrcode" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle CONNECTION_UPDATE event
    if (eventType === "CONNECTION_UPDATE" || eventType === "connection.update" || body.state) {
      const state = body.state || body.instance?.state || body.status;
      console.log("Connection update:", state);

      if (state === "open" || state === "connected" || state === "CONNECTED") {
        const owner = body.instance?.owner || body.owner || body.wid;
        const phoneNumber = owner?.split("@")[0] || body.phone || body.number;
        
        await supabase
          .from("instances")
          .update({
            status: "connected",
            phone_number: phoneNumber || null,
            qr_code: null,
          })
          .eq("id", instanceId);
        
        console.log("Instance connected:", instanceId, phoneNumber);
      } else if (state === "close" || state === "disconnected" || state === "DISCONNECTED") {
        await supabase
          .from("instances")
          .update({
            status: "disconnected",
            qr_code: null,
          })
          .eq("id", instanceId);
        
        console.log("Instance disconnected:", instanceId);
      } else if (state === "connecting") {
        await supabase
          .from("instances")
          .update({
            status: "connecting",
          })
          .eq("id", instanceId);
      }

      return new Response(JSON.stringify({ success: true, event: "connection" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle MESSAGES_UPSERT event (mensagens recebidas)
    if (eventType === "MESSAGES_UPSERT" || eventType === "messages.upsert" || body.data?.message || body.message) {
      // Extract message data (formato Evolution API)
      const messageData = body.data || body;
      const message = messageData.message || messageData;
      const key = messageData.key || message.key || {};
      
      // Skip outgoing messages (fromMe = true)
      if (key.fromMe === true || message.fromMe === true) {
        console.log("Skipping outgoing message");
        return new Response(JSON.stringify({ success: true, skipped: "outgoing" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Extract sender phone
      const remoteJid = key.remoteJid || message.from || message.remoteJid || "";
      const senderPhone = remoteJid
        .replace("@s.whatsapp.net", "")
        .replace("@c.us", "")
        .replace(/\D/g, "");

      if (!senderPhone) {
        console.error("Could not extract sender phone from:", remoteJid);
        return new Response(JSON.stringify({ error: "Invalid sender" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Extract message content (formato Evolution API)
      let messageContent = "";
      let messageType = "text";
      let mediaUrl: string | null = null;
      let mediaMimeType: string | null = null;

      // Check message types
      const msgContent = message.message || message;
      
      if (msgContent.conversation || msgContent.extendedTextMessage?.text) {
        messageType = "text";
        messageContent = msgContent.conversation || msgContent.extendedTextMessage?.text || "";
      } else if (msgContent.imageMessage) {
        messageType = "image";
        mediaUrl = msgContent.imageMessage.url || null;
        mediaMimeType = msgContent.imageMessage.mimetype || "image/jpeg";
        messageContent = msgContent.imageMessage.caption || "[Imagem]";
      } else if (msgContent.audioMessage) {
        messageType = "audio";
        mediaUrl = msgContent.audioMessage.url || null;
        mediaMimeType = msgContent.audioMessage.mimetype || "audio/ogg";
        messageContent = "[Áudio]";
      } else if (msgContent.videoMessage) {
        messageType = "video";
        mediaUrl = msgContent.videoMessage.url || null;
        mediaMimeType = msgContent.videoMessage.mimetype || "video/mp4";
        messageContent = msgContent.videoMessage.caption || "[Vídeo]";
      } else if (msgContent.documentMessage) {
        messageType = "document";
        mediaUrl = msgContent.documentMessage.url || null;
        mediaMimeType = msgContent.documentMessage.mimetype;
        messageContent = msgContent.documentMessage.fileName || "[Documento]";
      } else if (msgContent.stickerMessage) {
        messageType = "sticker";
        mediaUrl = msgContent.stickerMessage.url || null;
        messageContent = "[Sticker]";
      } else if (msgContent.locationMessage) {
        messageType = "location";
        messageContent = `[Localização: ${msgContent.locationMessage.degreesLatitude}, ${msgContent.locationMessage.degreesLongitude}]`;
      } else if (msgContent.contactMessage || msgContent.contactsArrayMessage) {
        messageType = "contact";
        messageContent = "[Contato]";
      } else if (msgContent.buttonsResponseMessage || msgContent.listResponseMessage) {
        // Interactive button/list response
        messageType = "text";
        messageContent = msgContent.buttonsResponseMessage?.selectedButtonId ||
                        msgContent.buttonsResponseMessage?.selectedDisplayText ||
                        msgContent.listResponseMessage?.title ||
                        msgContent.listResponseMessage?.singleSelectReply?.selectedRowId ||
                        "[Resposta interativa]";
      } else if (msgContent.body || msgContent.text) {
        // Fallback for simple format
        messageType = "text";
        messageContent = msgContent.body || msgContent.text || "";
      }

      console.log("Processing message from:", senderPhone, "type:", messageType, "content:", messageContent?.substring(0, 100));

      // Find or create contact
      let { data: contact } = await supabase
        .from("contacts")
        .select("*")
        .eq("instance_id", instanceId)
        .eq("phone_number", senderPhone)
        .maybeSingle();

      if (!contact) {
        const pushName = messageData.pushName || message.pushName || message.notifyName;
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
      } else if (messageData.pushName && !contact.name) {
        await supabase
          .from("contacts")
          .update({ name: messageData.pushName, push_name: messageData.pushName })
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
        await supabase
          .from("conversations")
          .update({
            last_message_at: new Date().toISOString(),
            unread_count: (conversation.unread_count || 0) + 1,
          })
          .eq("id", conversation.id);
      }

      // Save message
      const whatsappMessageId = key.id || message.id || message.messageId || `apibrasil_${Date.now()}`;

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
          media_mime_type: mediaMimeType,
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
          let processContent = messageContent;
          let imageUrl: string | null = null;

          // Handle audio transcription
          if (messageType === "audio" && mediaUrl) {
            try {
              const sttResponse = await fetch(`${supabaseUrl}/functions/v1/elevenlabs-stt`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${supabaseKey}`,
                },
                body: JSON.stringify({
                  audio_url: mediaUrl,
                }),
              });

              if (sttResponse.ok) {
                const sttResult = await sttResponse.json();
                if (sttResult.text) {
                  processContent = sttResult.text;
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
        event: "message",
        message_id: savedMessage.id,
        contact_id: contact.id,
        conversation_id: conversation.id
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle MESSAGES_UPDATE (status updates)
    if (eventType === "MESSAGES_UPDATE" || eventType === "messages.update" || body.ack !== undefined) {
      const messages = body.data || [body];
      
      for (const msg of Array.isArray(messages) ? messages : [messages]) {
        const messageId = msg.key?.id || msg.messageId || msg.id;
        const status = msg.status || msg.update?.status;
        
        let dbStatus = "sent";
        if (status === "DELIVERY_ACK" || status === 2) dbStatus = "delivered";
        if (status === "READ" || status === 3) dbStatus = "read";
        if (status === "PLAYED" || status === 4) dbStatus = "read";
        if (status === "FAILED" || status === -1) dbStatus = "failed";

        if (messageId) {
          await supabase
            .from("messages")
            .update({ status: dbStatus })
            .eq("whatsapp_message_id", messageId);
        }
      }

      return new Response(JSON.stringify({ success: true, event: "status" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle SEND_MESSAGE event (confirmação de envio)
    if (eventType === "SEND_MESSAGE" || eventType === "send.message") {
      const messageId = body.key?.id || body.messageId;
      if (messageId) {
        await supabase
          .from("messages")
          .update({ status: "sent" })
          .eq("whatsapp_message_id", messageId);
      }

      return new Response(JSON.stringify({ success: true, event: "send" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Unhandled event type:", eventType);
    return new Response(JSON.stringify({ success: true, handled: false, event: eventType }), {
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

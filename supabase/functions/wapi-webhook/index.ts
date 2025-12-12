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
    const url = new URL(req.url);
    const instanceId = url.searchParams.get("instance_id");

    if (!instanceId) {
      console.error("Missing instance_id in webhook");
      return new Response(JSON.stringify({ error: "Missing instance_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = await req.json();
    console.log("W-API Webhook received:", JSON.stringify(payload, null, 2));

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify instance exists
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

    const event = payload.event || payload.type;
    console.log("Processing event:", event);

    switch (event) {
      // =====================
      // W-API specific events
      // =====================
      
      case "webhookReceived": {
        // W-API format: incoming message
        console.log("Processing webhookReceived event");
        
        const isGroup = payload.isGroup === true;
        if (isGroup) {
          console.log("Skipping group message");
          break;
        }

        const senderPhone = payload.sender?.id || payload.chat?.id;
        if (!senderPhone) {
          console.error("No sender phone found in payload");
          break;
        }

        // Clean phone number (remove any non-digits)
        const contactPhone = senderPhone.replace(/\D/g, "");
        const isFromMe = payload.fromMe === true;
        const messageId = payload.messageId;
        const pushName = payload.sender?.pushName || "";
        const profilePic = payload.sender?.profilePicture || payload.chat?.profilePicture;

        // Extract message content from W-API format
        const msgContent = payload.msgContent?.conversation ||
          payload.msgContent?.extendedTextMessage?.text ||
          payload.msgContent?.imageMessage?.caption ||
          payload.msgContent?.videoMessage?.caption ||
          payload.msgContent?.documentMessage?.caption ||
          "";

        // Determine message type
        let messageType = "text";
        if (payload.msgContent?.imageMessage) messageType = "image";
        else if (payload.msgContent?.audioMessage) messageType = "audio";
        else if (payload.msgContent?.videoMessage) messageType = "video";
        else if (payload.msgContent?.documentMessage) messageType = "document";
        else if (payload.msgContent?.stickerMessage) messageType = "sticker";

        console.log(`Message from ${contactPhone}: ${msgContent} (type: ${messageType})`);

        // Get or create contact
        let { data: contact } = await supabase
          .from("contacts")
          .select("*")
          .eq("instance_id", instanceId)
          .eq("phone_number", contactPhone)
          .maybeSingle();

        if (!contact) {
          console.log("Creating new contact:", contactPhone);
          const { data: newContact, error: contactError } = await supabase
            .from("contacts")
            .insert({
              instance_id: instanceId,
              phone_number: contactPhone,
              push_name: pushName || null,
              profile_picture_url: profilePic || null,
            })
            .select()
            .single();

          if (contactError) {
            console.error("Error creating contact:", contactError);
            break;
          }
          contact = newContact;
        } else if ((pushName && pushName !== contact.push_name) || (profilePic && profilePic !== contact.profile_picture_url)) {
          // Update contact info if changed
          await supabase
            .from("contacts")
            .update({ 
              push_name: pushName || contact.push_name,
              profile_picture_url: profilePic || contact.profile_picture_url 
            })
            .eq("id", contact.id);
        }

        // Get or create conversation
        let { data: conversation } = await supabase
          .from("conversations")
          .select("*")
          .eq("instance_id", instanceId)
          .eq("contact_id", contact.id)
          .maybeSingle();

        let isFirstMessage = false;
        if (!conversation) {
          console.log("Creating new conversation for contact:", contact.id);
          isFirstMessage = true;
          const { data: newConversation, error: convError } = await supabase
            .from("conversations")
            .insert({
              instance_id: instanceId,
              contact_id: contact.id,
              status: "open",
              last_message_at: new Date().toISOString(),
            })
            .select()
            .single();

          if (convError) {
            console.error("Error creating conversation:", convError);
            break;
          }
          conversation = newConversation;
        }

        // Check if message already exists (avoid duplicates)
        if (messageId) {
          const { data: existingMsg } = await supabase
            .from("messages")
            .select("id")
            .eq("whatsapp_message_id", messageId)
            .maybeSingle();

          if (existingMsg) {
            console.log("Message already exists, skipping:", messageId);
            break;
          }
        }

        // Insert message
        const { data: savedMessage, error: msgError } = await supabase
          .from("messages")
          .insert({
            instance_id: instanceId,
            contact_id: contact.id,
            conversation_id: conversation.id,
            whatsapp_message_id: messageId,
            direction: isFromMe ? "outgoing" : "incoming",
            message_type: messageType,
            content: msgContent,
            status: isFromMe ? "sent" : "delivered",
            is_from_bot: false,
          })
          .select()
          .single();

        if (msgError) {
          console.error("Error inserting message:", msgError);
          break;
        }

        // Update conversation
        const unreadIncrement = isFromMe ? 0 : 1;
        await supabase
          .from("conversations")
          .update({
            last_message_at: new Date().toISOString(),
            unread_count: (conversation.unread_count || 0) + unreadIncrement,
          })
          .eq("id", conversation.id);

        console.log("Message saved successfully:", messageId);

        // Check if workspace has Bitrix24 integration active - send incoming messages to Bitrix24
        if (!isFromMe) {
          try {
            const { data: bitrixIntegration } = await supabase
              .from("integrations")
              .select("*")
              .eq("workspace_id", instance.workspace_id)
              .eq("type", "bitrix24")
              .eq("is_active", true)
              .maybeSingle();

            if (bitrixIntegration) {
              console.log("Sending message to Bitrix24...");
              
              const bitrixResponse = await fetch(`${supabaseUrl}/functions/v1/bitrix24-send`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${supabaseServiceKey}`,
                },
                body: JSON.stringify({
                  integration_id: bitrixIntegration.id,
                  contact_phone: contactPhone,
                  contact_name: pushName || contactPhone,
                  contact_picture: profilePic,
                  message: msgContent,
                  message_type: messageType,
                  message_id: messageId,
                }),
              });

              const bitrixResult = await bitrixResponse.json();
              console.log("Bitrix24 send result:", bitrixResult);
            }
          } catch (bitrixErr) {
            console.error("Error sending to Bitrix24:", bitrixErr);
          }
        }

        // Check attendance mode before processing with AI
        const attendanceMode = conversation.attendance_mode || 'ai';
        const assignedTo = conversation.assigned_to;
        
        // Only trigger AI processing if:
        // 1. Message is incoming (not from me)
        // 2. Has content
        // 3. Attendance mode is 'ai' or 'hybrid'
        // 4. No human is assigned (or mode is hybrid)
        if (!isFromMe && msgContent) {
          const shouldProcessWithAI = attendanceMode === 'ai' || 
            (attendanceMode === 'hybrid' && !assignedTo);
          
          if (shouldProcessWithAI) {
            console.log("Triggering flow-engine for incoming message (mode:", attendanceMode, ")");
            
            try {
              const flowResponse = await fetch(`${supabaseUrl}/functions/v1/flow-engine`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${supabaseServiceKey}`,
                },
                body: JSON.stringify({
                  message_id: savedMessage.id,
                  conversation_id: conversation.id,
                  instance_id: instanceId,
                  contact_id: contact.id,
                  content: msgContent,
                  workspace_id: instance.workspace_id,
                  is_first_message: isFirstMessage,
                }),
              });

              if (!flowResponse.ok) {
                const flowError = await flowResponse.text();
                console.error("Flow engine error:", flowError);
              } else {
                const flowResult = await flowResponse.json();
                console.log("Flow engine result:", flowResult);
              }
            } catch (flowErr) {
              console.error("Error calling flow-engine:", flowErr);
            }
          } else {
            console.log("Skipping AI - attendance mode is:", attendanceMode, ", assigned_to:", assignedTo);
          }
        }
        
        break;
      }

      case "webhookStatus": {
        // W-API format: message status update (DELIVERY, READ, etc)
        console.log("Processing webhookStatus event");
        
        const msgId = payload.messageId;
        const status = payload.status; // DELIVERY, READ, PLAYED
        
        let statusText = "sent";
        if (status === "DELIVERY" || status === "delivered") statusText = "delivered";
        if (status === "READ" || status === "read") statusText = "read";
        if (status === "PLAYED" || status === "played") statusText = "read";

        if (msgId) {
          const { error } = await supabase
            .from("messages")
            .update({ status: statusText })
            .eq("whatsapp_message_id", msgId);
          
          if (error) {
            console.error("Error updating message status:", error);
          } else {
            console.log(`Message ${msgId} status updated to: ${statusText}`);
          }
        }
        break;
      }

      case "webhookConnected": {
        // W-API: instance connected
        console.log("Instance connected via webhookConnected:", instanceId);
        
        const phoneNumber = payload.connectedPhone || payload.phone;
        const profilePic = payload.profilePicture;
        
        await supabase
          .from("instances")
          .update({
            status: "connected",
            phone_number: phoneNumber || instance.phone_number,
            profile_picture_url: profilePic || instance.profile_picture_url,
            qr_code: null,
            updated_at: new Date().toISOString()
          })
          .eq("id", instanceId);
        break;
      }

      case "webhookDisconnected": {
        // W-API: instance disconnected
        console.log("Instance disconnected via webhookDisconnected:", instanceId);
        
        await supabase
          .from("instances")
          .update({
            status: "disconnected",
            qr_code: null,
            updated_at: new Date().toISOString()
          })
          .eq("id", instanceId);
        break;
      }

      case "webhookQrCode": {
        // W-API: QR code received
        console.log("QR Code received via webhookQrCode:", instanceId);
        
        const qrCode = payload.qrCode || payload.qr;
        
        await supabase
          .from("instances")
          .update({ 
            qr_code: qrCode,
            status: "qr_pending",
            updated_at: new Date().toISOString()
          })
          .eq("id", instanceId);
        break;
      }

      // =====================
      // Legacy/fallback events
      // =====================

      case "qr":
      case "qrcode":
        // QR Code received - update instance
        const qrCode = payload.qrcode || payload.data?.qrcode || payload.qr;
        console.log("QR Code event for instance:", instanceId);
        
        await supabase
          .from("instances")
          .update({ 
            qr_code: qrCode,
            status: "qr_pending",
            updated_at: new Date().toISOString()
          })
          .eq("id", instanceId);
        break;

      case "authenticated":
      case "connected":
      case "ready":
        // Instance connected successfully
        console.log("Instance connected:", instanceId);
        
        const connPhoneNumber = payload.phone || payload.data?.phone || payload.wid?.split("@")[0] || payload.connectedPhone;
        const connProfilePic = payload.profilePicUrl || payload.data?.profilePicUrl;
        
        await supabase
          .from("instances")
          .update({
            status: "connected",
            phone_number: connPhoneNumber || instance.phone_number,
            profile_picture_url: connProfilePic || instance.profile_picture_url,
            qr_code: null,
            updated_at: new Date().toISOString()
          })
          .eq("id", instanceId);
        break;

      case "disconnected":
      case "logout":
        // Instance disconnected
        console.log("Instance disconnected:", instanceId);
        
        await supabase
          .from("instances")
          .update({
            status: "disconnected",
            qr_code: null,
            updated_at: new Date().toISOString()
          })
          .eq("id", instanceId);
        break;

      case "message":
      case "messages.upsert": {
        // Legacy format: New message received
        const messageData = payload.data || payload.message || payload;
        console.log("Legacy message received:", JSON.stringify(messageData, null, 2));

        // Extract message details
        const remoteJid = messageData.key?.remoteJid || messageData.from || messageData.chatId;
        if (!remoteJid || remoteJid.includes("@g.us")) {
          // Skip group messages for now
          console.log("Skipping group message or invalid jid");
          break;
        }

        const contactPhone = remoteJid.replace("@s.whatsapp.net", "").replace("@c.us", "");
        const isFromMe = messageData.key?.fromMe || messageData.fromMe || false;
        const messageId = messageData.key?.id || messageData.id;
        const pushName = messageData.pushName || messageData.notifyName;

        // Get or create contact
        let { data: contact } = await supabase
          .from("contacts")
          .select("*")
          .eq("instance_id", instanceId)
          .eq("phone_number", contactPhone)
          .maybeSingle();

        if (!contact) {
          const { data: newContact, error: contactError } = await supabase
            .from("contacts")
            .insert({
              instance_id: instanceId,
              phone_number: contactPhone,
              push_name: pushName,
            })
            .select()
            .single();

          if (contactError) {
            console.error("Error creating contact:", contactError);
            break;
          }
          contact = newContact;
        } else if (pushName && pushName !== contact.push_name) {
          // Update push_name if changed
          await supabase
            .from("contacts")
            .update({ push_name: pushName })
            .eq("id", contact.id);
        }

        // Get or create conversation
        let { data: conversation } = await supabase
          .from("conversations")
          .select("*")
          .eq("instance_id", instanceId)
          .eq("contact_id", contact.id)
          .maybeSingle();

        if (!conversation) {
          const { data: newConversation, error: convError } = await supabase
            .from("conversations")
            .insert({
              instance_id: instanceId,
              contact_id: contact.id,
              status: "open",
              last_message_at: new Date().toISOString(),
            })
            .select()
            .single();

          if (convError) {
            console.error("Error creating conversation:", convError);
            break;
          }
          conversation = newConversation;
        }

        // Extract message content
        const msgContent = messageData.message?.conversation ||
          messageData.message?.extendedTextMessage?.text ||
          messageData.body ||
          messageData.content ||
          "";

        const messageType = messageData.message?.imageMessage ? "image" :
          messageData.message?.audioMessage ? "audio" :
          messageData.message?.videoMessage ? "video" :
          messageData.message?.documentMessage ? "document" :
          "text";

        // Insert message
        const { error: msgError } = await supabase
          .from("messages")
          .insert({
            instance_id: instanceId,
            contact_id: contact.id,
            conversation_id: conversation.id,
            whatsapp_message_id: messageId,
            direction: isFromMe ? "outgoing" : "incoming",
            message_type: messageType,
            content: msgContent,
            status: isFromMe ? "sent" : "delivered",
            is_from_bot: false,
          });

        if (msgError) {
          console.error("Error inserting message:", msgError);
          break;
        }

        // Update conversation
        const unreadIncrement = isFromMe ? 0 : 1;
        await supabase
          .from("conversations")
          .update({
            last_message_at: new Date().toISOString(),
            unread_count: (conversation.unread_count || 0) + unreadIncrement,
          })
          .eq("id", conversation.id);

        console.log("Message saved successfully");
        break;
      }

      case "message_ack":
      case "ack":
        // Message status update
        const ackMsgId = payload.id || payload.data?.id;
        const ackStatus = payload.ack || payload.data?.ack;
        
        let statusText = "sent";
        if (ackStatus === 2 || ackStatus === "delivered") statusText = "delivered";
        if (ackStatus === 3 || ackStatus === "read") statusText = "read";

        if (ackMsgId) {
          await supabase
            .from("messages")
            .update({ status: statusText })
            .eq("whatsapp_message_id", ackMsgId);
        }
        break;

      default:
        console.log("Unhandled event:", event);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

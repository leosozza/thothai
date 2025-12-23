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
    const url = new URL(req.url);
    const payload = await req.json().catch(() => null) as any;

    // Health check
    if (payload?.action === "health_check") {
      return new Response(JSON.stringify({ status: "ok", function: "evolution-webhook" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const instanceId = url.searchParams.get("instance_id") || payload?.instance_id;

    if (!instanceId) {
      console.error("Missing instance_id in webhook");
      return new Response(JSON.stringify({ error: "Missing instance_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!payload) {
      return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Evolution Webhook received:", JSON.stringify(payload, null, 2));

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
    console.log("Processing Evolution event:", event);

    switch (event) {
      // =====================
      // Connection Events
      // =====================
      
      case "CONNECTION_UPDATE":
      case "connection.update": {
        const state = payload.data?.state || payload.state || payload.status;
        console.log("Connection state update:", state);

        if (state === "open" || state === "connected") {
          const phoneNumber = payload.data?.instance?.owner || 
                              payload.data?.number ||
                              payload.number;

          await supabase
            .from("instances")
            .update({ 
              status: "connected",
              phone_number: phoneNumber?.replace(/\D/g, "") || instance.phone_number,
              qr_code: null,
              updated_at: new Date().toISOString()
            })
            .eq("id", instanceId);

          console.log("Instance connected:", phoneNumber);
        } else if (state === "close" || state === "disconnected") {
          await supabase
            .from("instances")
            .update({ 
              status: "disconnected",
              updated_at: new Date().toISOString()
            })
            .eq("id", instanceId);

          console.log("Instance disconnected");
        }
        break;
      }

      // =====================
      // QR Code Events
      // =====================
      
      case "QRCODE_UPDATED":
      case "qrcode.updated": {
        let qrCode = payload.data?.qrcode?.base64 || 
                     payload.data?.base64 ||
                     payload.qrcode?.base64 ||
                     payload.base64 ||
                     payload.data?.qr ||
                     payload.qr;

        if (qrCode) {
          // Ensure proper base64 format
          if (!qrCode.startsWith("data:image")) {
            qrCode = `data:image/png;base64,${qrCode}`;
          }

          await supabase
            .from("instances")
            .update({ 
              qr_code: qrCode,
              status: "qr_pending",
              updated_at: new Date().toISOString()
            })
            .eq("id", instanceId);

          console.log("QR Code updated");
        }
        break;
      }

      // =====================
      // Message Events
      // =====================
      
      case "MESSAGES_UPSERT":
      case "messages.upsert": {
        const messages = payload.data?.messages || payload.messages || [payload.data];
        
        for (const msg of messages) {
          if (!msg) continue;

          const key = msg.key || {};
          const messageInfo = msg.message || msg;
          
          const isFromMe = key.fromMe === true;
          const isGroup = key.remoteJid?.includes("@g.us") || false;
          
          if (isGroup) {
            console.log("Skipping group message");
            continue;
          }

          const remoteJid = key.remoteJid || "";
          const contactPhone = remoteJid.split("@")[0].replace(/\D/g, "");
          const messageId = key.id || msg.id || `evo_${Date.now()}`;
          const pushName = msg.pushName || payload.data?.pushName || "";

          if (!contactPhone) {
            console.log("No contact phone found");
            continue;
          }

          // Determine message type and content
          let messageType = "text";
          let content = "";
          let mediaUrl = null;
          let mediaMimeType = null;

          if (messageInfo.conversation) {
            content = messageInfo.conversation;
          } else if (messageInfo.extendedTextMessage?.text) {
            content = messageInfo.extendedTextMessage.text;
          } else if (messageInfo.imageMessage) {
            messageType = "image";
            content = messageInfo.imageMessage.caption || "";
            mediaUrl = messageInfo.imageMessage.url;
            mediaMimeType = messageInfo.imageMessage.mimetype || "image/jpeg";
          } else if (messageInfo.audioMessage) {
            messageType = messageInfo.audioMessage.ptt ? "ptt" : "audio";
            mediaUrl = messageInfo.audioMessage.url;
            mediaMimeType = messageInfo.audioMessage.mimetype || "audio/ogg";
          } else if (messageInfo.videoMessage) {
            messageType = "video";
            content = messageInfo.videoMessage.caption || "";
            mediaUrl = messageInfo.videoMessage.url;
            mediaMimeType = messageInfo.videoMessage.mimetype || "video/mp4";
          } else if (messageInfo.documentMessage) {
            messageType = "document";
            content = messageInfo.documentMessage.fileName || "";
            mediaUrl = messageInfo.documentMessage.url;
            mediaMimeType = messageInfo.documentMessage.mimetype;
          } else if (messageInfo.stickerMessage) {
            messageType = "sticker";
            mediaUrl = messageInfo.stickerMessage.url;
          }

          // Skip if outgoing and already in DB
          if (isFromMe) {
            const { data: existingMsg } = await supabase
              .from("messages")
              .select("id")
              .eq("whatsapp_message_id", messageId)
              .maybeSingle();

            if (existingMsg) {
              console.log("Skipping - message already exists (echo)");
              continue;
            }
          }

          // Get or create contact
          let { data: contact } = await supabase
            .from("contacts")
            .select("*")
            .eq("instance_id", instanceId)
            .ilike("phone_number", `%${contactPhone.slice(-10)}`)
            .maybeSingle();

          if (!contact) {
            const { data: newContact, error: contactError } = await supabase
              .from("contacts")
              .insert({
                instance_id: instanceId,
                phone_number: contactPhone,
                push_name: pushName,
                name: pushName || null,
              })
              .select()
              .single();

            if (contactError) {
              console.error("Error creating contact:", contactError);
              continue;
            }
            contact = newContact;
            console.log("Created contact:", contact.id);
          } else if (pushName && !contact.name) {
            // Update push_name if changed
            await supabase
              .from("contacts")
              .update({ push_name: pushName, name: pushName })
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
                attendance_mode: "ai",
              })
              .select()
              .single();

            if (convError) {
              console.error("Error creating conversation:", convError);
              continue;
            }
            conversation = newConversation;
            console.log("Created conversation:", conversation.id);
          }

          // Save message
          const { error: msgError } = await supabase
            .from("messages")
            .insert({
              instance_id: instanceId,
              contact_id: contact.id,
              conversation_id: conversation.id,
              whatsapp_message_id: messageId,
              direction: isFromMe ? "outgoing" : "incoming",
              message_type: messageType,
              content: content,
              media_url: mediaUrl,
              media_mime_type: mediaMimeType,
              status: isFromMe ? "sent" : "received",
              is_from_bot: false,
              metadata: { 
                source: isFromMe ? "evolution_echo" : "evolution_webhook",
                pushName: pushName
              }
            });

          if (msgError) {
            console.error("Error saving message:", msgError);
            continue;
          }

          console.log("Message saved:", messageId);

          // If incoming message, process with AI
          if (!isFromMe && conversation.attendance_mode === "ai") {
            // Update conversation
            await supabase
              .from("conversations")
              .update({
                last_message_at: new Date().toISOString(),
                unread_count: (conversation.unread_count || 0) + 1,
                status: "open",
                updated_at: new Date().toISOString()
              })
              .eq("id", conversation.id);

            // Call flow engine or AI processor
            try {
              console.log("Invoking flow-engine for message processing...");
              
              const flowResponse = await fetch(
                `${supabaseUrl}/functions/v1/flow-engine`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${supabaseServiceKey}`,
                  },
                  body: JSON.stringify({
                    instance_id: instanceId,
                    contact_id: contact.id,
                    conversation_id: conversation.id,
                    content: content,
                    message_type: messageType,
                    is_first_message: conversation.last_message_at === null
                  }),
                }
              );

              if (!flowResponse.ok) {
                console.error("Flow engine error:", await flowResponse.text());
              }
            } catch (flowError) {
              console.error("Error calling flow engine:", flowError);
            }
          }
        }
        break;
      }

      // =====================
      // Message Status Updates
      // =====================
      
      case "MESSAGES_UPDATE":
      case "messages.update": {
        const updates = payload.data || [payload];
        
        for (const update of Array.isArray(updates) ? updates : [updates]) {
          const messageId = update.key?.id || update.id;
          const status = update.status || update.update?.status;
          
          if (!messageId || !status) continue;

          // Map Evolution status to our status
          let dbStatus = "pending";
          switch (status) {
            case 0:
            case "ERROR":
              dbStatus = "failed";
              break;
            case 1:
            case "PENDING":
              dbStatus = "pending";
              break;
            case 2:
            case "SERVER_ACK":
              dbStatus = "sent";
              break;
            case 3:
            case "DELIVERY_ACK":
              dbStatus = "delivered";
              break;
            case 4:
            case "READ":
              dbStatus = "read";
              break;
            case 5:
            case "PLAYED":
              dbStatus = "played";
              break;
          }

          await supabase
            .from("messages")
            .update({ status: dbStatus })
            .eq("whatsapp_message_id", messageId);

          console.log(`Message ${messageId} status updated to ${dbStatus}`);
        }
        break;
      }

      default:
        console.log("Unhandled Evolution event:", event);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Evolution Webhook error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

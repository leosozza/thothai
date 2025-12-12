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

    switch (event) {
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
        
        const phoneNumber = payload.phone || payload.data?.phone || payload.wid?.split("@")[0];
        const profilePic = payload.profilePicUrl || payload.data?.profilePicUrl;
        
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
      case "messages.upsert":
        // New message received
        const messageData = payload.data || payload.message || payload;
        console.log("Message received:", JSON.stringify(messageData, null, 2));

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
          .single();

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
          .single();

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
            status: isFromMe ? "sent" : "received",
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
            unread_count: conversation.unread_count + unreadIncrement,
          })
          .eq("id", conversation.id);

        console.log("Message saved successfully");
        break;

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

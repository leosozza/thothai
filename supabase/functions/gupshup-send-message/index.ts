import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GUPSHUP_API_URL = "https://api.gupshup.io/wa/api/v1/msg";

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { 
      instanceId, 
      to, 
      message, 
      messageType = "text",
      mediaUrl,
      fileName,
      caption,
      // For internal calls
      isInternal = false,
    } = body;

    console.log(`[gupshup-send-message] Sending ${messageType} to ${to} from instance ${instanceId}`);

    if (!instanceId || !to) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: instanceId, to" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get instance with Gupshup credentials
    const { data: instance, error: instanceError } = await supabase
      .from("instances")
      .select("*")
      .eq("id", instanceId)
      .single();

    if (instanceError || !instance) {
      console.error("[gupshup-send-message] Instance not found:", instanceError);
      return new Response(
        JSON.stringify({ error: "Instance not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (instance.connection_type !== "official") {
      return new Response(
        JSON.stringify({ error: "Instance is not using Gupshup. Use wapi-send-message instead." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!instance.gupshup_api_key || !instance.gupshup_app_id) {
      return new Response(
        JSON.stringify({ error: "Gupshup credentials not configured for this instance" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalize phone number
    const normalizedTo = to.replace(/\D/g, "");
    const source = instance.phone_number?.replace(/\D/g, "") || instance.gupshup_app_id;

    // Build message payload based on type
    let gupshupPayload: any = {
      channel: "whatsapp",
      source: source,
      destination: normalizedTo,
      "src.name": instance.gupshup_app_id,
    };

    if (messageType === "text") {
      gupshupPayload.message = JSON.stringify({
        type: "text",
        text: message,
      });
    } else if (messageType === "image") {
      gupshupPayload.message = JSON.stringify({
        type: "image",
        originalUrl: mediaUrl,
        previewUrl: mediaUrl,
        caption: caption || "",
      });
    } else if (messageType === "audio") {
      gupshupPayload.message = JSON.stringify({
        type: "audio",
        url: mediaUrl,
      });
    } else if (messageType === "document") {
      gupshupPayload.message = JSON.stringify({
        type: "file",
        url: mediaUrl,
        filename: fileName || "document",
      });
    } else if (messageType === "video") {
      gupshupPayload.message = JSON.stringify({
        type: "video",
        url: mediaUrl,
        caption: caption || "",
      });
    } else {
      // Default to text
      gupshupPayload.message = JSON.stringify({
        type: "text",
        text: message,
      });
    }

    console.log("[gupshup-send-message] Sending to Gupshup:", gupshupPayload);

    // Send via Gupshup API
    const formData = new URLSearchParams();
    Object.entries(gupshupPayload).forEach(([key, value]) => {
      formData.append(key, value as string);
    });

    const gupshupResponse = await fetch(GUPSHUP_API_URL, {
      method: "POST",
      headers: {
        "apikey": instance.gupshup_api_key,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    const gupshupResult = await gupshupResponse.json();
    console.log("[gupshup-send-message] Gupshup response:", gupshupResult);

    if (gupshupResult.status === "error" || !gupshupResponse.ok) {
      console.error("[gupshup-send-message] Gupshup error:", gupshupResult);
      return new Response(
        JSON.stringify({ 
          error: gupshupResult.message || "Failed to send message via Gupshup",
          details: gupshupResult,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find or create contact and conversation for saving the message
    let { data: contact } = await supabase
      .from("contacts")
      .select("*")
      .eq("instance_id", instanceId)
      .eq("phone_number", normalizedTo)
      .single();

    if (!contact) {
      const { data: newContact } = await supabase
        .from("contacts")
        .insert({
          instance_id: instanceId,
          phone_number: normalizedTo,
        })
        .select()
        .single();
      contact = newContact;
    }

    if (contact) {
      let { data: conversation } = await supabase
        .from("conversations")
        .select("*")
        .eq("instance_id", instanceId)
        .eq("contact_id", contact.id)
        .eq("status", "open")
        .single();

      if (!conversation) {
        const { data: newConversation } = await supabase
          .from("conversations")
          .insert({
            instance_id: instanceId,
            contact_id: contact.id,
            status: "open",
          })
          .select()
          .single();
        conversation = newConversation;
      }

      if (conversation) {
        // Save outgoing message
        await supabase.from("messages").insert({
          instance_id: instanceId,
          contact_id: contact.id,
          conversation_id: conversation.id,
          content: message,
          message_type: messageType,
          media_url: mediaUrl || null,
          direction: "outbound",
          status: "sent",
          is_from_bot: isInternal,
          whatsapp_message_id: gupshupResult.messageId,
          metadata: { gupshup: gupshupResult },
        });

        // Update conversation
        await supabase
          .from("conversations")
          .update({ last_message_at: new Date().toISOString() })
          .eq("id", conversation.id);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        messageId: gupshupResult.messageId,
        status: gupshupResult.status,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[gupshup-send-message] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

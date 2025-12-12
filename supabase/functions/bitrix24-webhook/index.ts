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
    const workspaceId = url.searchParams.get("workspace_id");
    const connectorId = url.searchParams.get("connector_id");

    const payload = await req.json();
    console.log("Bitrix24 webhook received:", JSON.stringify(payload, null, 2));

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const event = payload.event;
    console.log("Processing Bitrix24 event:", event);

    switch (event) {
      case "ONIMCONNECTORMESSAGEADD": {
        // Operator sent a message from Bitrix24 → Send to WhatsApp
        const data = payload.data?.MESSAGES?.[0] || payload.data;
        
        if (!data) {
          console.log("No message data in payload");
          break;
        }

        const userId = data.im?.chat_id || data.user?.id;
        const messageText = data.message?.text || data.text || "";
        const line = data.line || payload.data?.LINE;
        const connector = data.connector || connectorId;

        console.log("Bitrix24 operator message:", { userId, messageText, line, connector });

        if (!messageText) {
          console.log("Empty message, skipping");
          break;
        }

        // Find the integration to get instance_id
        const { data: integration } = await supabase
          .from("integrations")
          .select("*")
          .eq("type", "bitrix24")
          .eq("is_active", true)
          .maybeSingle();

        if (!integration) {
          console.error("No active Bitrix24 integration found");
          break;
        }

        const config = integration.config as Record<string, unknown>;
        const instanceId = config?.instance_id as string;

        if (!instanceId) {
          console.error("No instance_id configured for Bitrix24 integration");
          break;
        }

        // Find the contact by Bitrix24 user ID (stored in metadata)
        const { data: contact } = await supabase
          .from("contacts")
          .select("*")
          .eq("instance_id", instanceId)
          .contains("metadata", { bitrix24_user_id: userId })
          .maybeSingle();

        if (!contact) {
          console.error("Contact not found for Bitrix24 user:", userId);
          break;
        }

        // Send message to WhatsApp via wapi-send-message
        console.log("Sending message to WhatsApp:", { phone: contact.phone_number, message: messageText });

        const sendResponse = await fetch(`${supabaseUrl}/functions/v1/wapi-send-message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            instance_id: instanceId,
            phone_number: contact.phone_number,
            message: messageText,
            source: "bitrix24",
          }),
        });

        const sendResult = await sendResponse.json();
        console.log("wapi-send-message result:", sendResult);
        break;
      }

      case "ONIMCONNECTORTYPING": {
        // Operator is typing in Bitrix24 → Send typing indicator to WhatsApp
        console.log("Bitrix24 operator typing event");
        
        const userId = payload.data?.USER_ID || payload.data?.user_id;
        const line = payload.data?.LINE;
        
        // Find the integration
        const { data: integration } = await supabase
          .from("integrations")
          .select("*")
          .eq("type", "bitrix24")
          .eq("is_active", true)
          .maybeSingle();

        if (!integration) {
          console.log("No active Bitrix24 integration for typing");
          break;
        }

        const config = integration.config as Record<string, unknown>;
        const instanceId = config?.instance_id as string;

        if (!instanceId) {
          console.log("No instance configured for typing");
          break;
        }

        // Find the contact
        const { data: contact } = await supabase
          .from("contacts")
          .select("*")
          .eq("instance_id", instanceId)
          .contains("metadata", { bitrix24_user_id: userId })
          .maybeSingle();

        if (contact) {
          // TODO: Send typing indicator to WhatsApp if W-API supports it
          console.log("Would send typing indicator to WhatsApp for:", contact.phone_number);
        }
        break;
      }

      case "ONIMCONNECTORDIALOGFINISH": {
        // Conversation closed in Bitrix24
        const dialogId = payload.data?.DIALOG_ID;
        console.log("Bitrix24 dialog finished:", dialogId);
        
        // Optionally update conversation status
        break;
      }

      case "ONIMCONNECTORSTATUSDELETE": {
        // Line disconnected in Bitrix24
        console.log("Bitrix24 connector status deleted");
        break;
      }

      default:
        console.log("Unhandled Bitrix24 event:", event);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Bitrix24 webhook error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

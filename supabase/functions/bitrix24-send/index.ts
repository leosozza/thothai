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
    const { 
      integration_id,
      workspace_id,
      contact_phone, 
      contact_name, 
      contact_picture,
      message, 
      message_type,
      message_id,
    } = await req.json();

    console.log("Bitrix24 send - sending message to Bitrix24:", { contact_phone, message });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get integration config
    let integration;
    if (integration_id) {
      const { data } = await supabase
        .from("integrations")
        .select("*")
        .eq("id", integration_id)
        .single();
      integration = data;
    } else if (workspace_id) {
      const { data } = await supabase
        .from("integrations")
        .select("*")
        .eq("workspace_id", workspace_id)
        .eq("type", "bitrix24")
        .eq("is_active", true)
        .maybeSingle();
      integration = data;
    }

    if (!integration) {
      console.error("No Bitrix24 integration found");
      return new Response(
        JSON.stringify({ error: "No Bitrix24 integration found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const config = integration.config as Record<string, unknown>;
    const webhookUrl = config?.webhook_url as string;
    const connectorId = config?.connector_id as string;
    const lineId = config?.line_id as string || "1";

    if (!webhookUrl || !connectorId) {
      console.error("Invalid Bitrix24 configuration");
      return new Response(
        JSON.stringify({ error: "Invalid Bitrix24 configuration" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build message payload for Bitrix24
    const messagePayload = {
      CONNECTOR: connectorId,
      LINE: lineId,
      MESSAGES: [
        {
          user: {
            id: contact_phone,
            name: contact_name || contact_phone,
            picture: contact_picture ? { url: contact_picture } : undefined,
          },
          message: {
            id: message_id || `msg_${Date.now()}`,
            date: Math.floor(Date.now() / 1000),
            text: message,
          },
          chat: {
            id: contact_phone,
          },
        },
      ],
    };

    console.log("Calling imconnector.send.messages:", JSON.stringify(messagePayload));

    const response = await fetch(`${webhookUrl}imconnector.send.messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messagePayload),
    });

    const result = await response.json();
    console.log("imconnector.send.messages result:", JSON.stringify(result));

    if (result.error) {
      return new Response(
        JSON.stringify({ error: result.error_description || result.error }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update contact metadata with Bitrix24 user ID if returned
    if (result.result?.USER_ID) {
      await supabase
        .from("contacts")
        .update({ 
          metadata: { 
            bitrix24_user_id: result.result.USER_ID,
            bitrix24_chat_id: result.result.CHAT_ID,
          } 
        })
        .eq("phone_number", contact_phone);
    }

    return new Response(
      JSON.stringify({ success: true, result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Bitrix24 send error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

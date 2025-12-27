import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  console.log("=== BITRIX24-SMS-HANDLER REQUEST ===");
  console.log("Method:", req.method);
  console.log("Timestamp:", new Date().toISOString());
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.text();
    console.log("Raw body (first 500 chars):", body.substring(0, 500));
    console.log("Content-Type:", req.headers.get("content-type"));
    
    // Parse the request - Bitrix24 sends form-urlencoded data
    let data: Record<string, string> = {};
    
    if (req.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) {
      const formData = new URLSearchParams(body);
      for (const [key, value] of formData.entries()) {
        data[key] = value;
      }
    } else {
      try {
        data = JSON.parse(body);
      } catch {
        const formData = new URLSearchParams(body);
        for (const [key, value] of formData.entries()) {
          data[key] = value;
        }
      }
    }
    
    console.log("Parsed data keys:", Object.keys(data));
    console.log("Parsed data:", JSON.stringify(data));

    // Extract message parameters from Bitrix24 SMS provider call
    // Bitrix24 can send these in many different formats depending on the context
    const phoneNumber = 
      data.PHONE_NUMBER || data.phone_number || 
      data.MESSAGE_TO || data.message_to ||
      data.to || data.TO ||
      data["properties[phone_number]"] || data["properties[PHONE_NUMBER]"] ||
      data["PROPERTIES[phone_number]"] || data["PROPERTIES[PHONE_NUMBER]"] ||
      "";
    
    const messageText = 
      data.MESSAGE_TEXT || data.message_text || 
      data.MESSAGE_BODY || data.message_body ||
      data.message || data.MESSAGE ||
      data.text || data.TEXT ||
      data["properties[message_text]"] || data["properties[MESSAGE_TEXT]"] ||
      data["PROPERTIES[message_text]"] || data["PROPERTIES[MESSAGE_TEXT]"] ||
      "";
    
    const authMemberId = 
      data.AUTH_MEMBER_ID || data.auth_member_id || 
      data.member_id || data.MEMBER_ID ||
      "";
    
    const messageId = 
      data.MESSAGE_ID || data.message_id || 
      data.ID || data.id ||
      "";
    
    console.log("Extracted params:", { 
      phoneNumber: phoneNumber ? `${phoneNumber.substring(0, 5)}...` : "(empty)", 
      messageTextLength: messageText.length,
      authMemberId: authMemberId ? `${authMemberId.substring(0, 10)}...` : "(empty)", 
      messageId 
    });

    if (!phoneNumber || !messageText) {
      console.error("Missing required parameters. Phone:", !!phoneNumber, "Message:", !!messageText);
      console.error("Available keys:", Object.keys(data).join(", "));
      return new Response(
        JSON.stringify({ 
          error: "phone_number and message_text are required",
          received_keys: Object.keys(data),
          hint: "Check Bitrix24 SMS provider configuration"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find the Bitrix24 integration by member_id
    let integration: any = null;
    
    if (authMemberId) {
      const { data: found } = await supabase
        .from("integrations")
        .select("*")
        .eq("type", "bitrix24")
        .or(`config->>member_id.eq.${authMemberId},config->>domain.ilike.%${authMemberId}%`)
        .maybeSingle();
      integration = found;
    }

    if (!integration) {
      // Fallback: get the first active Bitrix24 integration
      const { data: fallback } = await supabase
        .from("integrations")
        .select("*")
        .eq("type", "bitrix24")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      integration = fallback;
    }

    if (!integration) {
      console.error("No Bitrix24 integration found");
      return new Response(
        JSON.stringify({ error: "Bitrix24 integration not found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Found integration:", integration.id);
    
    const config = integration.config || {};
    const workspaceId = integration.workspace_id;
    const instanceId = config.instance_id;

    if (!instanceId) {
      console.error("No WhatsApp instance linked to this integration");
      return new Response(
        JSON.stringify({ error: "No WhatsApp instance configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the WhatsApp instance details
    const { data: instance } = await supabase
      .from("instances")
      .select("*")
      .eq("id", instanceId)
      .maybeSingle();

    if (!instance) {
      console.error("WhatsApp instance not found:", instanceId);
      return new Response(
        JSON.stringify({ error: "WhatsApp instance not found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Using instance:", instance.name, instance.provider_type);

    // Format phone number (remove non-digits, ensure country code)
    let formattedPhone = phoneNumber.replace(/\D/g, "");
    if (formattedPhone.startsWith("0")) {
      formattedPhone = "55" + formattedPhone.substring(1);
    }
    if (!formattedPhone.startsWith("55") && formattedPhone.length === 10 || formattedPhone.length === 11) {
      formattedPhone = "55" + formattedPhone;
    }

    console.log("Formatted phone:", formattedPhone);

    // Send the message using the appropriate provider
    let sendResult: { success: boolean; message_id?: string; error?: string } = { success: false };

    const providerType = instance.provider_type || instance.connection_type || "evolution";
    console.log("Provider type:", providerType);

    if (providerType === "evolution") {
      // Send via Evolution API
      const response = await supabase.functions.invoke("evolution-send-message", {
        body: {
          instance_id: instanceId,
          phone_number: formattedPhone,
          phoneNumber: formattedPhone,
          phone: formattedPhone,
          message: messageText,
          workspace_id: workspaceId,
          internal_call: true,
          source: "bitrix24_sms",
        }
      });

      if (response.error) {
        sendResult = { success: false, error: response.error.message };
      } else if (response.data?.success) {
        sendResult = { success: true, message_id: response.data.message_id || response.data.messageId || messageId };
      } else {
        sendResult = { success: false, error: response.data?.error || "Failed to send via Evolution" };
      }
    } else if (providerType === "gupshup") {
      // Send via Gupshup API
      const response = await supabase.functions.invoke("gupshup-send-message", {
        body: {
          instance_id: instanceId,
          phone_number: formattedPhone,
          phoneNumber: formattedPhone,
          phone: formattedPhone,
          message: messageText,
          workspace_id: workspaceId,
          internal_call: true,
          source: "bitrix24_sms",
        }
      });

      if (response.error) {
        sendResult = { success: false, error: response.error.message };
      } else if (response.data?.success) {
        sendResult = { success: true, message_id: response.data.message_id || response.data.messageId || messageId };
      } else {
        sendResult = { success: false, error: response.data?.error || "Failed to send via Gupshup" };
      }
    } else if (providerType === "wapi") {
      // Send via WAPI
      const response = await supabase.functions.invoke("wapi-send-message", {
        body: {
          instance_id: instanceId,
          phone_number: formattedPhone,
          phoneNumber: formattedPhone,
          phone: formattedPhone,
          message: messageText,
          workspace_id: workspaceId,
          internal_call: true,
          source: "bitrix24_sms",
        }
      });

      if (response.error) {
        sendResult = { success: false, error: response.error.message };
      } else if (response.data?.success) {
        sendResult = { success: true, message_id: response.data.message_id || response.data.messageId || messageId };
      } else {
        sendResult = { success: false, error: response.data?.error || "Failed to send via WAPI" };
      }
    } else {
      sendResult = { success: false, error: `Unsupported provider: ${providerType}` };
    }

    console.log("Send result:", JSON.stringify(sendResult));

    // Log the SMS sending activity
    try {
      await supabase.from("bitrix_debug_logs").insert({
        function_name: "bitrix24-sms-handler",
        level: sendResult.success ? "info" : "error",
        message: sendResult.success ? "SMS/WhatsApp message sent successfully" : "Failed to send SMS/WhatsApp message",
        category: "sms_provider",
        details: {
          phone_number: formattedPhone,
          message_length: messageText.length,
          bitrix_message_id: messageId,
          send_result: sendResult,
          instance_id: instanceId,
          provider_type: providerType,
        },
        integration_id: integration.id,
        workspace_id: workspaceId,
      });
    } catch (logErr) {
      console.error("Error logging to bitrix_debug_logs:", logErr);
    }

    if (sendResult.success) {
      // Return success in the format Bitrix24 expects
      return new Response(
        JSON.stringify({ 
          result: true,
          message_id: sendResult.message_id,
          status: "sent"
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      return new Response(
        JSON.stringify({ 
          error: sendResult.error,
          result: false
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

  } catch (error) {
    console.error("SMS Handler error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage, result: false }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

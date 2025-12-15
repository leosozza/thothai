import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper to refresh Bitrix24 OAuth token
async function refreshBitrixToken(integration: any, supabase: any): Promise<string | null> {
  const config = integration.config;
  
  // Check if token is still valid (with 5 minute buffer)
  if (config.token_expires_at) {
    const expiresAt = new Date(config.token_expires_at);
    const now = new Date();
    const bufferMs = 5 * 60 * 1000;
    
    if (expiresAt.getTime() - now.getTime() > bufferMs) {
      return config.access_token;
    }
  } else if (config.access_token) {
    return config.access_token;
  }

  console.log("Token expired or missing, attempting refresh...");

  if (!config.refresh_token) {
    console.log("No refresh token, returning existing access_token");
    return config.access_token || null;
  }

  const refreshUrl = `https://oauth.bitrix.info/oauth/token/?grant_type=refresh_token&client_id=${config.client_id || ""}&client_secret=${config.client_secret || ""}&refresh_token=${config.refresh_token}`;
  
  try {
    const response = await fetch(refreshUrl);
    const data = await response.json();

    if (data.access_token) {
      const newExpiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
      
      await supabase
        .from("integrations")
        .update({
          config: {
            ...config,
            access_token: data.access_token,
            refresh_token: data.refresh_token || config.refresh_token,
            token_expires_at: newExpiresAt,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", integration.id);

      console.log("Token refreshed successfully");
      return data.access_token;
    }
  } catch (error) {
    console.error("Error refreshing token:", error);
  }

  return config.access_token || null;
}

// Handler for PLACEMENT calls (when user connects Open Channel in Contact Center)
async function handlePlacement(supabase: any, payload: any, supabaseUrl: string) {
  console.log("=== PLACEMENT HANDLER ===");
  console.log("Payload:", JSON.stringify(payload, null, 2));

  // Parse PLACEMENT_OPTIONS
  let options: { LINE?: number; ACTIVE_STATUS?: number } = {};
  if (typeof payload.PLACEMENT_OPTIONS === "string") {
    try {
      options = JSON.parse(payload.PLACEMENT_OPTIONS);
    } catch (e) {
      console.log("Failed to parse PLACEMENT_OPTIONS as JSON, trying as object");
      options = payload.PLACEMENT_OPTIONS || {};
    }
  } else {
    options = payload.PLACEMENT_OPTIONS || {};
  }

  const lineId = options.LINE;
  const activeStatus = options.ACTIVE_STATUS ?? 1;
  const accessToken = payload.auth?.access_token || payload.AUTH_ID;
  const domain = payload.auth?.domain || payload.DOMAIN;
  const memberId = payload.auth?.member_id || payload.member_id;

  console.log("Parsed values - Line ID:", lineId, "Active Status:", activeStatus, "Domain:", domain);

  if (!lineId) {
    console.error("LINE not provided in PLACEMENT_OPTIONS");
    return new Response(
      JSON.stringify({ error: "LINE not provided" }), 
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Find the integration
  let integration = null;

  // Try to find by member_id first
  if (memberId) {
    const { data } = await supabase
      .from("integrations")
      .select("*")
      .eq("type", "bitrix24")
      .eq("config->>member_id", memberId)
      .maybeSingle();
    integration = data;
  }

  // Try by domain
  if (!integration && domain) {
    const { data } = await supabase
      .from("integrations")
      .select("*")
      .eq("type", "bitrix24")
      .ilike("config->>domain", `%${domain}%`)
      .maybeSingle();
    integration = data;
  }

  // Fallback: get any active bitrix24 integration
  if (!integration) {
    const { data } = await supabase
      .from("integrations")
      .select("*")
      .eq("type", "bitrix24")
      .eq("is_active", true)
      .maybeSingle();
    integration = data;
  }

  if (!integration) {
    console.error("No Bitrix24 integration found");
    return new Response(
      JSON.stringify({ error: "Integration not found" }), 
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log("Found integration:", integration.id);

  const connectorId = integration.config?.connector_id || "thoth_whatsapp";
  const token = accessToken || await refreshBitrixToken(integration, supabase);
  const bitrixDomain = domain || integration.config?.domain;
  
  if (!token) {
    console.error("No access token available");
    return new Response(
      JSON.stringify({ error: "No access token" }), 
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const bitrixApiUrl = `https://${bitrixDomain}/rest/`;
  console.log("Using Bitrix API URL:", bitrixApiUrl, "Connector ID:", connectorId);

  // 1. Activate the connector for this LINE
  console.log("Calling imconnector.activate for LINE:", lineId);
  const activateResponse = await fetch(
    `${bitrixApiUrl}imconnector.activate?auth=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        CONNECTOR: connectorId,
        LINE: lineId,
        ACTIVE: activeStatus,
      }),
    }
  );
  const activateResult = await activateResponse.json();
  console.log("imconnector.activate result:", JSON.stringify(activateResult));

  // 2. If activating, configure connector data
  if (activeStatus === 1) {
    console.log("Calling imconnector.connector.data.set...");
    const dataSetResponse = await fetch(
      `${bitrixApiUrl}imconnector.connector.data.set?auth=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          CONNECTOR: connectorId,
          LINE: lineId,
          DATA: {
            id: `${connectorId}_line_${lineId}`,
            url: supabaseUrl,
            url_im: supabaseUrl,
            name: "Thoth WhatsApp",
          },
        }),
      }
    );
    const dataSetResult = await dataSetResponse.json();
    console.log("imconnector.connector.data.set result:", JSON.stringify(dataSetResult));

    // 3. Save LINE ID in integration config
    await supabase
      .from("integrations")
      .update({
        config: {
          ...integration.config,
          line_id: lineId,
          connected: true,
          connected_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", integration.id);

    console.log("Integration updated with line_id:", lineId);
  }

  // Return success response for Bitrix24
  // Bitrix24 expects a simple response
  return new Response("successfully", {
    headers: { "Content-Type": "text/plain" },
  });
}

serve(async (req) => {
  console.log("=== BITRIX24-WEBHOOK REQUEST ===");
  console.log("Method:", req.method);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get("workspace_id");
    const connectorId = url.searchParams.get("connector_id");

    // Parse request body - Bitrix24 can send as JSON or form-urlencoded
    const contentType = req.headers.get("content-type") || "";
    let payload: any = {};

    if (contentType.includes("application/json")) {
      payload = await req.json();
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.text();
      const params = new URLSearchParams(formData);
      
      payload = {
        event: params.get("event"),
        data: params.get("data") ? JSON.parse(params.get("data")!) : {},
        PLACEMENT: params.get("PLACEMENT"),
        PLACEMENT_OPTIONS: params.get("PLACEMENT_OPTIONS"),
        AUTH_ID: params.get("AUTH_ID") || params.get("auth[access_token]"),
        DOMAIN: params.get("DOMAIN") || params.get("auth[domain]"),
        member_id: params.get("member_id") || params.get("auth[member_id]"),
        auth: {
          access_token: params.get("AUTH_ID") || params.get("auth[access_token]"),
          domain: params.get("DOMAIN") || params.get("auth[domain]"),
          member_id: params.get("member_id") || params.get("auth[member_id]"),
        },
      };
    } else {
      // Try to parse as JSON first, fallback to form
      const text = await req.text();
      try {
        payload = JSON.parse(text);
      } catch {
        const params = new URLSearchParams(text);
        payload = {
          event: params.get("event"),
          PLACEMENT: params.get("PLACEMENT"),
          PLACEMENT_OPTIONS: params.get("PLACEMENT_OPTIONS"),
          AUTH_ID: params.get("AUTH_ID"),
          DOMAIN: params.get("DOMAIN"),
          member_id: params.get("member_id"),
          auth: {
            access_token: params.get("AUTH_ID"),
            domain: params.get("DOMAIN"),
            member_id: params.get("member_id"),
          },
        };
      }
    }

    console.log("Bitrix24 webhook received:", JSON.stringify(payload, null, 2));

    // Check if this is a PLACEMENT call (user connecting Open Channel)
    if (payload.PLACEMENT || payload.PLACEMENT_OPTIONS) {
      console.log("=== DETECTED PLACEMENT CALL ===");
      return await handlePlacement(supabase, payload, supabaseUrl);
    }

    // Otherwise, process as event
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
          console.log("Would send typing indicator to WhatsApp for:", contact.phone_number);
        }
        break;
      }

      case "ONIMCONNECTORDIALOGFINISH": {
        // Conversation closed in Bitrix24
        const dialogId = payload.data?.DIALOG_ID;
        console.log("Bitrix24 dialog finished:", dialogId);
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

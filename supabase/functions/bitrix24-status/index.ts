import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Refresh Bitrix24 access token if expired
async function refreshBitrixToken(integration: any, supabase: any): Promise<string | null> {
  const config = integration.config;
  const tokenExpiresAt = config.token_expires_at ? new Date(config.token_expires_at) : null;
  const now = new Date();

  // If token is still valid, return it
  if (tokenExpiresAt && tokenExpiresAt > now) {
    return config.access_token;
  }

  // Token expired, try to refresh
  if (!config.refresh_token || !config.domain) {
    console.error("Cannot refresh token: missing refresh_token or domain");
    return null;
  }

  console.log("Refreshing Bitrix24 access token...");

  try {
    // MARKETPLACE: Use credentials from environment variables, NOT from database
    const clientId = Deno.env.get("BITRIX24_CLIENT_ID") || "";
    const clientSecret = Deno.env.get("BITRIX24_CLIENT_SECRET") || "";
    const refreshUrl = `https://oauth.bitrix.info/oauth/token/?grant_type=refresh_token&client_id=${clientId}&client_secret=${clientSecret}&refresh_token=${config.refresh_token}`;
    
    const response = await fetch(refreshUrl);
    const data = await response.json();

    if (data.access_token) {
      const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();

      await supabase
        .from("integrations")
        .update({
          config: {
            ...config,
            access_token: data.access_token,
            refresh_token: data.refresh_token || config.refresh_token,
            token_expires_at: expiresAt,
          },
        })
        .eq("id", integration.id);

      console.log("Bitrix24 token refreshed successfully");
      return data.access_token;
    } else {
      console.error("Failed to refresh token:", data);
      return null;
    }
  } catch (error) {
    console.error("Error refreshing Bitrix24 token:", error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      type,
      integration_id,
      contact_phone,
      message_ids,
      instance_id,
    } = await req.json();

    console.log("Bitrix24 status request:", { type, integration_id, contact_phone, message_ids });

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
    } else if (instance_id) {
      const { data: instance } = await supabase
        .from("instances")
        .select("workspace_id")
        .eq("id", instance_id)
        .single();

      if (instance) {
        const { data } = await supabase
          .from("integrations")
          .select("*")
          .eq("workspace_id", instance.workspace_id)
          .eq("type", "bitrix24")
          .eq("is_active", true)
          .maybeSingle();
        integration = data;
      }
    }

    if (!integration) {
      console.log("No active Bitrix24 integration found");
      return new Response(
        JSON.stringify({ success: false, error: "No active Bitrix24 integration" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const config = integration.config as Record<string, unknown>;
    
    // OAuth mode only
    if (!config.client_endpoint || !config.access_token) {
      console.error("No OAuth configuration found");
      return new Response(
        JSON.stringify({ success: false, error: "No valid OAuth configuration" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accessToken = await refreshBitrixToken(integration, supabase);
    if (!accessToken) {
      return new Response(
        JSON.stringify({ success: false, error: "Failed to get valid access token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // IMPORTANT: Use config.domain for REST API calls, NOT client_endpoint (which is oauth.bitrix.info)
    const apiEndpoint = config.domain ? `https://${config.domain}/rest/` : config.client_endpoint as string;
    const connectorId = config.connector_id || "thoth_whatsapp";
    const lineId = config.line_id || "1";

    const buildUrl = (method: string) => {
      const baseUrl = apiEndpoint.endsWith("/") ? apiEndpoint : `${apiEndpoint}/`;
      return `${baseUrl}${method}?auth=${accessToken}`;
    };

    let result;

    switch (type) {
      case "delivery": {
        console.log("Sending delivery status to Bitrix24");

        const url = buildUrl("imconnector.send.status.delivery");
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            CONNECTOR: connectorId,
            LINE: lineId,
            MESSAGES: message_ids?.map((id: string) => ({
              im: id,
            })) || [],
          }),
        });

        result = await response.json();
        console.log("Delivery status result:", result);
        break;
      }

      case "reading": {
        console.log("Sending reading status to Bitrix24");

        const url = buildUrl("imconnector.send.status.reading");
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            CONNECTOR: connectorId,
            LINE: lineId,
            MESSAGES: message_ids?.map((id: string) => ({
              im: id,
            })) || [],
          }),
        });

        result = await response.json();
        console.log("Reading status result:", result);
        break;
      }

      case "typing": {
        console.log("Typing indicator - no Bitrix24 equivalent");
        result = { success: true, message: "Typing indicator not supported" };
        break;
      }

      default:
        console.log("Unknown status type:", type);
        result = { success: false, error: "Unknown status type" };
    }

    return new Response(
      JSON.stringify({ success: true, result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Bitrix24 status error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

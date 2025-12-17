import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper function to refresh Bitrix24 OAuth token
async function refreshBitrixToken(integration: any, supabase: any): Promise<string | null> {
  const config = integration.config;
  
  if (!config?.refresh_token || !config?.client_id || !config?.client_secret) {
    console.log("No OAuth credentials for refresh");
    return null;
  }

  const now = Date.now();
  const expiresAt = config.token_expires_at ? new Date(config.token_expires_at).getTime() : 0;
  
  // Check if token needs refresh (10 minutes buffer)
  if (expiresAt - now > 10 * 60 * 1000) {
    console.log("Token still valid, no refresh needed");
    return config.access_token;
  }

  console.log("Token expiring soon, refreshing...");

  try {
    const tokenUrl = `https://oauth.bitrix.info/oauth/token/?grant_type=refresh_token&client_id=${config.client_id}&client_secret=${config.client_secret}&refresh_token=${config.refresh_token}`;
    
    const response = await fetch(tokenUrl);
    const data = await response.json();

    if (data.error) {
      console.error("Token refresh error:", data.error);
      // Mark token as failed
      await supabase
        .from("integrations")
        .update({
          config: { ...config, token_refresh_failed: true },
          updated_at: new Date().toISOString()
        })
        .eq("id", integration.id);
      return null;
    }

    // Update integration with new tokens
    const newConfig = {
      ...config,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_expires_at: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
      token_refresh_failed: false,
    };

    await supabase
      .from("integrations")
      .update({
        config: newConfig,
        updated_at: new Date().toISOString()
      })
      .eq("id", integration.id);

    console.log("Token refreshed successfully");
    return data.access_token;
  } catch (error) {
    console.error("Error refreshing token:", error);
    return null;
  }
}

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
    let webhookUrl = config?.webhook_url as string;
    const connectorId = config?.connector_id as string;
    const lineId = config?.line_id as string || "1";

    // For OAuth-based integrations, ensure we have a valid access token
    if (config?.access_token) {
      const validToken = await refreshBitrixToken(integration, supabase);
      if (!validToken) {
        console.error("Failed to get valid OAuth token");
        return new Response(
          JSON.stringify({ error: "OAuth token expired or invalid. Please reconnect Bitrix24." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // Use client_endpoint for OAuth-based calls
      const clientEndpoint = config.client_endpoint as string;
      if (clientEndpoint) {
        webhookUrl = clientEndpoint;
      }
    }

    if (!webhookUrl || !connectorId) {
      console.error("Invalid Bitrix24 configuration");
      return new Response(
        JSON.stringify({ error: "Invalid Bitrix24 configuration" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build message payload for Bitrix24
    const messagePayload: Record<string, unknown> = {
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

    // Add auth token for OAuth-based calls
    if (config?.access_token) {
      messagePayload.auth = config.access_token;
    }

    console.log("Calling imconnector.send.messages:", JSON.stringify(messagePayload));

    const response = await fetch(`${webhookUrl}imconnector.send.messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messagePayload),
    });

    const result = await response.json();
    console.log("imconnector.send.messages result:", JSON.stringify(result));

    if (result.error) {
      // Check for token expiration errors
      if (result.error === "expired_token" || result.error === "invalid_token") {
        return new Response(
          JSON.stringify({ error: "Token OAuth expirado. Reconecte o Bitrix24." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
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

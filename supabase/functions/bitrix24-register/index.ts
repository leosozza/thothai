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
  const expiresAt = new Date(config.token_expires_at);
  const now = new Date();
  const bufferMs = 5 * 60 * 1000; // 5 minutes
  
  if (expiresAt.getTime() - now.getTime() > bufferMs) {
    return config.access_token;
  }

  console.log("Token expired, refreshing...");

  // Token needs refresh
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

  return null;
}

serve(async (req) => {
  console.log("=== BITRIX24-REGISTER REQUEST ===");
  console.log("Method:", req.method);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log("Request body:", JSON.stringify(body));
    
    const { webhook_url, connector_id, instance_id, workspace_id, integration_id, member_id } = body;

    // Validate that we have at least member_id or webhook_url
    if (!member_id && !webhook_url) {
      console.error("No member_id or webhook_url provided");
      return new Response(
        JSON.stringify({ error: "member_id ou webhook_url é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Registering Bitrix24 connector:", { connector_id, workspace_id, member_id, instance_id });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let bitrixApiUrl: string = "";
    let integration: any = null;

    // Mode 1: Using member_id (OAuth app installation)
    if (member_id) {
      console.log("Looking for integration with member_id:", member_id);
      
      const { data: existingIntegration, error: lookupError } = await supabase
        .from("integrations")
        .select("*")
        .eq("type", "bitrix24")
        .filter("config->>member_id", "eq", member_id)
        .maybeSingle();

      if (lookupError) {
        console.error("Error looking up integration:", lookupError);
        return new Response(
          JSON.stringify({ error: "Erro ao buscar integração" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!existingIntegration) {
        console.error("No integration found for member_id:", member_id);
        return new Response(
          JSON.stringify({ error: "Integração Bitrix24 não encontrada. Por favor, reinstale o aplicativo." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("Found integration:", existingIntegration.id, "workspace:", existingIntegration.workspace_id);
      integration = existingIntegration;
      
      const accessToken = await refreshBitrixToken(integration, supabase);
      
      if (!accessToken) {
        console.error("Failed to get access token for integration:", integration.id);
        return new Response(
          JSON.stringify({ error: "Falha ao obter token de acesso. Por favor, reinstale o aplicativo." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const clientEndpoint = integration.config.client_endpoint || `https://${integration.config.domain}/rest/`;
      bitrixApiUrl = `${clientEndpoint}`;
      console.log("Using Bitrix API URL:", bitrixApiUrl);
    }
    // Mode 2: Using webhook_url (manual configuration)
    else if (webhook_url) {
      console.log("Using webhook_url mode");
      if (!connector_id || !workspace_id) {
        return new Response(
          JSON.stringify({ error: "Campos obrigatórios: connector_id, workspace_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      bitrixApiUrl = webhook_url;
    }

    const finalConnectorId = connector_id || `thoth_whatsapp_${member_id?.substring(0, 8) || "default"}`;
    console.log("Final connector ID:", finalConnectorId);

    // 1. Register connector in Bitrix24
    const registerPayload = {
      ID: finalConnectorId,
      NAME: "Thoth WhatsApp",
      ICON: {
        DATA_IMAGE: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMyNUQ0NjYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMjEgMTEuNWE4LjM4IDguMzggMCAwIDEtLjkgMy44IDguNSA4LjUgMCAwIDEtNy42IDQuNyA4LjM4IDguMzggMCAwIDEtMy44LS45TDMgMjFsMS45LTUuN2E4LjM4IDguMzggMCAwIDEtLjktMy44IDguNSA4LjUgMCAwIDEgNC43LTcuNiA4LjM4IDguMzggMCAwIDEgMy44LS45aC41YTguNDggOC40OCAwIDAgMSA4IDh2LjV6Ij48L3BhdGg+PC9zdmc+",
      },
      PLACEMENT_HANDLER: `${supabaseUrl}/functions/v1/bitrix24-webhook`,
    };

    console.log("Calling imconnector.register with:", JSON.stringify(registerPayload));

    // Build the API call URL based on auth mode
    let registerUrl: string;
    if (member_id && integration) {
      const accessToken = integration.config.access_token;
      registerUrl = `${bitrixApiUrl}imconnector.register?auth=${accessToken}`;
    } else {
      registerUrl = `${bitrixApiUrl}imconnector.register`;
    }

    const registerResponse = await fetch(registerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(registerPayload),
    });

    const registerResult = await registerResponse.json();
    console.log("imconnector.register result:", JSON.stringify(registerResult));

    if (registerResult.error && registerResult.error !== "CONNECTOR_ALREADY_EXISTS") {
      return new Response(
        JSON.stringify({ error: `Bitrix24 register error: ${registerResult.error_description || registerResult.error}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Activate the connector
    let activateUrl: string;
    if (member_id && integration) {
      const accessToken = integration.config.access_token;
      activateUrl = `${bitrixApiUrl}imconnector.activate?auth=${accessToken}`;
    } else {
      activateUrl = `${bitrixApiUrl}imconnector.activate`;
    }

    const activateResponse = await fetch(activateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        CONNECTOR: finalConnectorId,
        LINE: 1,
        ACTIVE: 1,
      }),
    });

    const activateResult = await activateResponse.json();
    console.log("imconnector.activate result:", JSON.stringify(activateResult));

    // 3. Bind events to receive messages from Bitrix24 operators
    const workspaceIdForWebhook = workspace_id || integration?.workspace_id || "default";
    const webhookEndpoint = `${supabaseUrl}/functions/v1/bitrix24-webhook?workspace_id=${workspaceIdForWebhook}&connector_id=${finalConnectorId}`;
    
    const events = [
      "OnImConnectorMessageAdd",
      "OnImConnectorDialogFinish", 
      "OnImConnectorStatusDelete",
    ];

    for (const event of events) {
      let bindUrl: string;
      if (member_id && integration) {
        const accessToken = integration.config.access_token;
        bindUrl = `${bitrixApiUrl}event.bind?auth=${accessToken}`;
      } else {
        bindUrl = `${bitrixApiUrl}event.bind`;
      }

      const bindResponse = await fetch(bindUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: event,
          handler: webhookEndpoint,
        }),
      });
      const bindResult = await bindResponse.json();
      console.log(`event.bind ${event} result:`, JSON.stringify(bindResult));
    }

    // 4. Update integration in database with registration details
    const configUpdate = {
      webhook_url: webhook_url || null,
      connector_id: finalConnectorId,
      instance_id: instance_id || null,
      registered: true,
      events_url: webhookEndpoint,
      line_id: "1",
    };

    if (integration_id || integration?.id) {
      const idToUpdate = integration_id || integration.id;
      const { data: currentIntegration } = await supabase
        .from("integrations")
        .select("config")
        .eq("id", idToUpdate)
        .single();

      await supabase
        .from("integrations")
        .update({ 
          config: { ...currentIntegration?.config, ...configUpdate }, 
          is_active: true 
        })
        .eq("id", idToUpdate);
    } else if (workspace_id) {
      await supabase.from("integrations").insert({
        workspace_id,
        type: "bitrix24",
        name: "Bitrix24",
        config: configUpdate,
        is_active: true,
      });
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Connector registered successfully",
        connector_id: finalConnectorId,
        events_url: webhookEndpoint,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Bitrix24 register error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

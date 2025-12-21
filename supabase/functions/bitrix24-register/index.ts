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
  // MARKETPLACE: Use credentials from environment variables, NOT from database
  const clientId = Deno.env.get("BITRIX24_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("BITRIX24_CLIENT_SECRET") || "";
  const refreshUrl = `https://oauth.bitrix.info/oauth/token/?grant_type=refresh_token&client_id=${clientId}&client_secret=${clientSecret}&refresh_token=${config.refresh_token}`;
  
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
  console.log("Timestamp:", new Date().toISOString());
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log("Request body:", JSON.stringify(body));
    
    const { action, connector_id, instance_id, workspace_id, integration_id, member_id, domain } = body;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Action: Clean connectors
    if (action === "clean_connectors") {
      console.log("=== CLEAN CONNECTORS ACTION ===");
      
      let integration: any = null;

      // Try to find integration by integration_id first
      if (integration_id) {
        const { data } = await supabase
          .from("integrations")
          .select("*")
          .eq("id", integration_id)
          .maybeSingle();
        integration = data;
      }

      // If not found, try by member_id or domain
      if (!integration) {
        const searchId = member_id || domain;
        if (searchId) {
          const { data } = await supabase
            .from("integrations")
            .select("*")
            .eq("type", "bitrix24")
            .or(`config->>member_id.eq.${searchId},config->>domain.eq.${searchId}`)
            .maybeSingle();
          integration = data;
        }
      }

      // If still not found, try by workspace_id
      if (!integration && workspace_id) {
        const { data } = await supabase
          .from("integrations")
          .select("*")
          .eq("type", "bitrix24")
          .eq("workspace_id", workspace_id)
          .maybeSingle();
        integration = data;
      }

      if (!integration) {
        return new Response(
          JSON.stringify({ error: "Integração Bitrix24 não encontrada" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const config = integration.config || {};
      
      if (!config.access_token) {
        return new Response(
          JSON.stringify({ error: "Integração não possui token OAuth configurado" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Refresh token if needed
      const accessToken = await refreshBitrixToken(integration, supabase);
      if (!accessToken) {
        return new Response(
          JSON.stringify({ error: "Falha ao obter token de acesso" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      const clientEndpoint = config.client_endpoint || `https://${config.domain}/rest/`;
      
      // List all connectors
      console.log("Listing connectors...");
      const listUrl = `${clientEndpoint}imconnector.list?auth=${accessToken}`;
      const listResponse = await fetch(listUrl);
      const listResult = await listResponse.json();
      console.log("imconnector.list result:", JSON.stringify(listResult));

      const removedConnectors: string[] = [];
      
      if (listResult.result) {
        const connectorsToRemove = Object.keys(listResult.result).filter(id => {
          const idLower = id.toLowerCase();
          return idLower.includes("thoth") || idLower.includes("whatsapp");
        });

        console.log("Connectors to remove:", connectorsToRemove);

        for (const connectorId of connectorsToRemove) {
          console.log(`Unregistering connector: ${connectorId}`);
          const unregisterUrl = `${clientEndpoint}imconnector.unregister?auth=${accessToken}`;
          try {
            const unregisterResponse = await fetch(unregisterUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ID: connectorId }),
            });
            const unregisterResult = await unregisterResponse.json();
            console.log(`Unregister ${connectorId} result:`, JSON.stringify(unregisterResult));
            
            if (unregisterResult.result || !unregisterResult.error) {
              removedConnectors.push(connectorId);
            }
          } catch (e) {
            console.log(`Failed to unregister ${connectorId}:`, e);
          }
        }
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          removed_count: removedConnectors.length,
          removed_connectors: removedConnectors,
          message: `${removedConnectors.length} conector(es) removido(s)`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate that we have member_id for OAuth mode
    if (!member_id) {
      console.error("No member_id provided");
      return new Response(
        JSON.stringify({ error: "member_id é obrigatório para registro via Marketplace" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Registering Bitrix24 connector:", { connector_id, workspace_id, member_id, instance_id });

    // Find integration by member_id
    let integration: any = null;
    
    const { data: byMemberId } = await supabase
      .from("integrations")
      .select("*")
      .eq("type", "bitrix24")
      .eq("config->>member_id", member_id)
      .maybeSingle();
    
    if (byMemberId) {
      integration = byMemberId;
    } else {
      const { data: byDomain } = await supabase
        .from("integrations")
        .select("*")
        .eq("type", "bitrix24")
        .eq("config->>domain", member_id)
        .maybeSingle();
      
      if (byDomain) {
        integration = byDomain;
      } else {
        const { data: byLike } = await supabase
          .from("integrations")
          .select("*")
          .eq("type", "bitrix24")
          .or(`config->>member_id.ilike.%${member_id}%,config->>domain.ilike.%${member_id}%`)
          .maybeSingle();
        integration = byLike;
      }
    }

    if (!integration) {
      console.error("No integration found for member_id:", member_id);
      return new Response(
        JSON.stringify({ error: "Integração Bitrix24 não encontrada. Por favor, reinstale o aplicativo." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Found integration:", integration.id);

    // Get access token (OAuth mode)
    const accessToken = await refreshBitrixToken(integration, supabase);
    
    if (!accessToken) {
      console.error("Failed to get access token for integration:", integration.id);
      return new Response(
        JSON.stringify({ 
          error: "Falha ao obter token de acesso. Por favor, reinstale o aplicativo via Marketplace.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const clientEndpoint = integration.config.client_endpoint || `https://${integration.config.domain}/rest/`;

    // Use a FIXED connector_id to avoid duplicates
    const finalConnectorId = connector_id || "thoth_whatsapp";
    console.log("Using fixed connector ID:", finalConnectorId);

    console.log("=== OAUTH MODE: Registering imconnector for Contact Center ===");

    // Register the connector
    const registerUrl = `${clientEndpoint}imconnector.register?auth=${accessToken}`;
    console.log("Calling imconnector.register...");
    
    const registerResponse = await fetch(registerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ID: finalConnectorId,
        NAME: "Thoth WhatsApp",
        ICON: {
          DATA_IMAGE: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAADhklEQVR4nO2ZW4hNURjHf2OMMYZxGYYZMi4PDMaDiKTkRuSWSx4oL0peJC9ueJEXJZIXJZLkgSTJg9zKNS+6lMsLuYu4ZGacMWbQ5//0f9i2s/fea59zzln7R6e99t5rfWv9v/XdhzCEIQxByOIQmtCGEFqRQCeyGI0EhtKJCIYhxhBaHcE/xBkIwQsJqONYzs+wH9gNPNM97gJ7gMNIYgISaMUnAQsMNuuBfUA18A7YAngCNqJRh01CBLJ5zE1gBfAB2Ap8Bm6j0Y2OaUQjoI3xAjoBbNJn3AM6EMEWJNBVvwR0YAEPgE1AvjYeCJ6BEN+N7nUSGMSI96MT6NW0wONA0/qkRDThBNqQQxNSsJjxwC7gKXAWqNKxR8D5qAkYiV7kMQbYBTyJWQJRYyLwEqgE7gNXYhZA1BgPdAIL/Tgx/gFDEh3IBjaHsQ9wWtuOqIFlEJLDwAJgYxgBtOvYLeBqtOEnJQR0AbYDWb6PpPD8gYFKYAuwyuWg2cBGYJ8dYAvgog5yFNjiJsAJYCNwDJgNvEP6xPb9xQJuA4cSmECvq+2N7gSK4o/xOAAMRyQfkz7pD9iJTgBuBs4hkdQNqDgPBSZGpYKjSKLUiwNWuH3jGvA0bCVfBuYC9cC0oG9OASuBNj1+Hzgb8R8kxCDgKDAKmAM8cBPIbWCy9h8FxkYsgMFAL2AVMBd46CZAA1ChB4bxNYL/SILjQC/gk0eiNOhLVyKLJz+Rww6gN1AQ8aXYYKAbsBC44ibAOWC5djxBMqUeGI5MGPOwg7H2eS6+R7IvyI7twHRgWdBLVgM7gKnAfqfXnRw+D1zo78FNSD0e1AtjE+oK7PWymDrNvgFcQKdDvZrxjS9fmAbUSv8kMAc4AVQE/RNPA2OR+wdwDFgNTPHihDVID7AT2KAOXxH8pzEPeIxsAhuBYuA8cAaYj/RJ5wIfI/6TjFADlgJ7gz6yAimQw5EuvzC8QyZ0o9YPjgPfkU2nE3BcJ0qNQBGwHpgQ1Mv5uu/z0G/n9fsooA2oDjhJCbBGAjuFvI0mIO1HJVBO9JPkRxYBQ5AOYBLSD9YBj4J+t1CnU51ILDAZuKrjDqAmqJ8LlwKL/S5gCpKt1CA7EKgLaLMSOIQMyCrkJTAzYqMlxCJgE3Ir4J9wPrL70ga0ALeDPp+ElA5kWMjAkA+xPQghCAD/AF3FgPgqhI7fAAAAAElFTkSuQmCC"
        },
        PLACEMENT_HANDLER: `${supabaseUrl}/functions/v1/bitrix24-connector-settings`,
      }),
    });

    const registerResult = await registerResponse.json();
    console.log("imconnector.register result:", JSON.stringify(registerResult));

    // Even if registration fails (e.g., already exists), try to activate
    if (registerResult.error && !registerResult.error.includes("already")) {
      console.log("Registration error (non-duplicate):", registerResult.error);
    }

    // Activate the connector on line 1
    const activateUrl = `${clientEndpoint}imconnector.activate?auth=${accessToken}`;
    console.log("Calling imconnector.activate...");
    
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

    // Set connector data with webhook URL
    const eventsUrl = `${supabaseUrl}/functions/v1/bitrix24-events`;
    const dataSetUrl = `${clientEndpoint}imconnector.connector.data.set?auth=${accessToken}`;
    
    console.log("Calling imconnector.connector.data.set...");
    
    const dataSetResponse = await fetch(dataSetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        CONNECTOR: finalConnectorId,
        LINE: 1,
        DATA: {
          id: `${finalConnectorId}_line_1`,
          url: eventsUrl,
          url_im: eventsUrl,
          name: "Thoth WhatsApp",
        },
      }),
    });

    const dataSetResult = await dataSetResponse.json();
    console.log("imconnector.connector.data.set result:", JSON.stringify(dataSetResult));

    // Bind events
    const events = [
      "OnImConnectorMessageAdd",
      "OnImConnectorDialogStart", 
      "OnImConnectorDialogFinish",
    ];

    for (const eventName of events) {
      try {
        await fetch(`${clientEndpoint}event.bind?auth=${accessToken}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: eventName,
            handler: eventsUrl,
          }),
        });
        console.log(`Event ${eventName} bound`);
      } catch (e) {
        console.error(`Error binding ${eventName}:`, e);
      }
    }

    // Update integration config
    const updatedConfig = {
      ...integration.config,
      connector_id: finalConnectorId,
      instance_id: instance_id || integration.config.instance_id,
      registered: true,
      registered_at: new Date().toISOString(),
      activated: !activateResult.error,
      activated_line_id: 1,
    };

    await supabase
      .from("integrations")
      .update({
        config: updatedConfig,
        updated_at: new Date().toISOString(),
      })
      .eq("id", integration.id);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Conector registrado e ativado via Marketplace OAuth",
        connector_id: finalConnectorId,
        registered: !registerResult.error || registerResult.error.includes("already"),
        activated: !activateResult.error,
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

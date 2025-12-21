import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Parse PHP-style form data (e.g., data[MESSAGES][0][text]=hello)
function parsePhpStyleFormData(formDataString: string): Record<string, any> {
  const result: Record<string, any> = {};
  const params = new URLSearchParams(formDataString);
  
  for (const [key, value] of params.entries()) {
    // Parse keys like "data[MESSAGES][0][text]" into nested object
    const keys = key.match(/[^\[\]]+/g);
    if (!keys) continue;
    
    let current = result;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      const nextKey = keys[i + 1];
      const isNextNumeric = /^\d+$/.test(nextKey);
      
      if (!(k in current)) {
        current[k] = isNextNumeric ? [] : {};
      }
      current = current[k];
    }
    
    const lastKey = keys[keys.length - 1];
    current[lastKey] = value;
  }
  
  return result;
}

// Helper to refresh Bitrix24 OAuth token with proactive refresh
async function refreshBitrixToken(integration: any, supabase: any): Promise<string | null> {
  const config = integration.config;
  
  // Check if token exists
  if (!config.access_token) {
    console.log("No access token configured");
    return null;
  }

  // Check token expiration with 10 minute buffer for proactive refresh
  if (config.token_expires_at) {
    const expiresAt = new Date(config.token_expires_at);
    const now = new Date();
    const bufferMs = 10 * 60 * 1000; // 10 minutes buffer
    
    if (expiresAt.getTime() - now.getTime() > bufferMs) {
      console.log("Token still valid, expires at:", config.token_expires_at);
      return config.access_token;
    }
    
    console.log("Token expired or expiring soon, attempting refresh...");
  }

  // No refresh token available
  if (!config.refresh_token) {
    console.log("No refresh token available, returning existing access_token");
    return config.access_token;
  }

  // Try to refresh the token
  const refreshUrl = `https://oauth.bitrix.info/oauth/token/?grant_type=refresh_token&client_id=${config.client_id || ""}&client_secret=${config.client_secret || ""}&refresh_token=${config.refresh_token}`;
  
  try {
    console.log("Calling OAuth refresh endpoint...");
    const response = await fetch(refreshUrl);
    const data = await response.json();

    if (data.error) {
      console.error("OAuth refresh error:", data.error, data.error_description);
      // Mark token as invalid if refresh fails
      await supabase
        .from("integrations")
        .update({
          config: {
            ...config,
            token_refresh_failed: true,
            token_refresh_error: data.error_description || data.error,
            token_refresh_failed_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", integration.id);
      return config.access_token; // Return old token as fallback
    }

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
            token_refresh_failed: false,
            token_refresh_error: null,
            last_token_refresh_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", integration.id);

      console.log("Token refreshed successfully, new expiry:", newExpiresAt);
      return data.access_token;
    }
  } catch (error) {
    console.error("Error refreshing token:", error);
  }

  return config.access_token;
}

// Helper to send bot message
async function sendBotMessage(integration: any, supabase: any, dialogId: string, message: string): Promise<boolean> {
  const config = integration.config;
  const accessToken = await refreshBitrixToken(integration, supabase);
  
  if (!accessToken || !config.bot_id) {
    console.error("Cannot send bot message: no token or bot_id");
    return false;
  }

  const clientEndpoint = config.client_endpoint || `https://${config.domain}/rest/`;
  
  try {
    const response = await fetch(`${clientEndpoint}imbot.message.add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth: accessToken,
        BOT_ID: config.bot_id,
        DIALOG_ID: dialogId,
        MESSAGE: message
      })
    });

    const result = await response.json();
    console.log("Bot message sent:", result.result ? "success" : "failed", result.error || "");
    return !!result.result;
  } catch (error) {
    console.error("Error sending bot message:", error);
    return false;
  }
}

// Activate/Deactivate connector via Bitrix24 REST API
async function activateConnectorViaAPI(
  integration: any, 
  supabase: any, 
  lineId: number, 
  active: number,
  webhookUrl: string
): Promise<{ success: boolean; error?: string }> {
  console.log("=== ACTIVATING CONNECTOR VIA API ===");
  console.log("Integration ID:", integration.id);
  console.log("Line ID:", lineId, "Active:", active);
  
  const config = integration.config;
  const connectorId = config?.connector_id || "thoth_whatsapp";
  
  // Get fresh access token
  const accessToken = await refreshBitrixToken(integration, supabase);
  
  if (!accessToken) {
    console.error("No access token available");
    return { success: false, error: "Token de acesso não disponível" };
  }
  
  // Determine API endpoint
  const clientEndpoint = config.client_endpoint || `https://${config.domain}/rest/`;
  
  console.log("Using endpoint:", clientEndpoint);
  console.log("Connector ID:", connectorId);
  console.log("Access token (first 20 chars):", accessToken.substring(0, 20) + "...");
  
  try {
    // 1. Activate/Deactivate the connector for this line
    const activateUrl = `${clientEndpoint}imconnector.activate`;
    console.log("Calling:", activateUrl);
    console.log("Body:", JSON.stringify({ CONNECTOR: connectorId, LINE: lineId, ACTIVE: active }));
    
    const activateResponse = await fetch(activateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth: accessToken,
        CONNECTOR: connectorId,
        LINE: lineId,
        ACTIVE: active
      })
    });
    
    const activateResult = await activateResponse.json();
    console.log("imconnector.activate result:", JSON.stringify(activateResult, null, 2));
    
    if (activateResult.error) {
      console.error("Activate error:", activateResult.error, activateResult.error_description);
      // Don't return error, continue to try setting data
    }
    
    // Only set connector data if activating (not deactivating)
    if (active === 1) {
      // 2. Set connector data with URLs
      const dataSetUrl = `${clientEndpoint}imconnector.connector.data.set`;
      console.log("Calling:", dataSetUrl);
      
      const dataPayload = {
        auth: accessToken,
        CONNECTOR: connectorId,
        LINE: lineId,
        DATA: {
          id: `${connectorId}_line_${lineId}`,
          url: webhookUrl,
          url_im: webhookUrl,
          name: "Thoth WhatsApp"
        }
      };
      console.log("Body:", JSON.stringify(dataPayload));
      
      const dataSetResponse = await fetch(dataSetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dataPayload)
      });
      
      const dataSetResult = await dataSetResponse.json();
      console.log("imconnector.connector.data.set result:", JSON.stringify(dataSetResult, null, 2));
      
      if (dataSetResult.error) {
        console.error("Data set error:", dataSetResult.error, dataSetResult.error_description);
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error("Error activating connector:", error);
    return { success: false, error: error instanceof Error ? error.message : "Erro desconhecido" };
  }
}

// Handler for PLACEMENT calls (when user opens connector settings in Contact Center)
// CRITICAL: Must return "successfully" as plain text for Bitrix24 to mark setup as complete
async function handlePlacement(supabase: any, payload: any, supabaseUrl: string) {
  console.log("=== PLACEMENT HANDLER ===");
  console.log("PLACEMENT:", payload.PLACEMENT);
  console.log("Full payload:", JSON.stringify(payload, null, 2));

  // Get AUTH_ID directly from Bitrix24 - this is the access token for this request
  const authId = payload.AUTH_ID || payload.auth?.access_token;
  const domain = payload.auth?.domain || payload.DOMAIN;
  const memberId = payload.auth?.member_id || payload.member_id;
  
  console.log("AUTH_ID present:", !!authId);
  console.log("Domain:", domain, "MemberId:", memberId);

  // Parse PLACEMENT_OPTIONS
  let options: { LINE?: number; ACTIVE_STATUS?: number; CONNECTOR?: string } = {};
  if (typeof payload.PLACEMENT_OPTIONS === "string") {
    try {
      options = JSON.parse(payload.PLACEMENT_OPTIONS);
    } catch (e) {
      console.log("Failed to parse PLACEMENT_OPTIONS as JSON:", e);
      // Try URL decoding
      try {
        options = JSON.parse(decodeURIComponent(payload.PLACEMENT_OPTIONS));
      } catch (e2) {
        console.log("Failed to decode and parse PLACEMENT_OPTIONS");
        options = {};
      }
    }
  } else if (payload.PLACEMENT_OPTIONS) {
    options = payload.PLACEMENT_OPTIONS;
  }

  console.log("Parsed PLACEMENT_OPTIONS:", JSON.stringify(options));

  const lineId = options.LINE || 1; // Default to LINE 1 if not specified
  const activeStatus = options.ACTIVE_STATUS ?? 1; // Default to activate
  const connectorId = options.CONNECTOR || "thoth_whatsapp";

  console.log("Using - LINE:", lineId, "ACTIVE_STATUS:", activeStatus, "CONNECTOR:", connectorId);

  // Find the integration
  let integration = null;

  if (memberId) {
    console.log("Searching by member_id:", memberId);
    const { data } = await supabase
      .from("integrations")
      .select("*")
      .eq("type", "bitrix24")
      .eq("config->>member_id", memberId)
      .maybeSingle();
    integration = data;
  }

  if (!integration && domain) {
    console.log("Searching by domain:", domain);
    const { data } = await supabase
      .from("integrations")
      .select("*")
      .eq("type", "bitrix24")
      .ilike("config->>domain", `%${domain}%`)
      .maybeSingle();
    integration = data;
  }

  if (!integration) {
    console.log("Searching for any active bitrix24 integration");
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
    // Return "successfully" anyway - Bitrix24 expects this
    // The integration will need to be set up later
    return new Response("successfully", {
      headers: { ...corsHeaders, "Content-Type": "text/plain" }
    });
  }

  console.log("Found integration:", integration.id, "workspace:", integration.workspace_id);

  // CRITICAL: Use bitrix24-events (public, no JWT) for Bitrix24 event callbacks
  const eventsUrl = `${supabaseUrl}/functions/v1/bitrix24-events`;
  const config = integration.config || {};

  // Determine API endpoint and access token
  // IMPORTANT: Use AUTH_ID from Bitrix24 if available (more reliable for PLACEMENT calls)
  const accessToken = authId || await refreshBitrixToken(integration, supabase);
  const apiUrl = domain ? `https://${domain}/rest/` : (config.client_endpoint || `https://${config.domain}/rest/`);

  console.log("Using API URL:", apiUrl);
  console.log("Access token available:", !!accessToken);

  // For SETTING_CONNECTOR placement, we need to activate the connector
  if (payload.PLACEMENT === "SETTING_CONNECTOR" || lineId > 0) {
    console.log("=== ACTIVATING CONNECTOR FOR LINE", lineId, "===");
    
    try {
      // 1. Activate the connector
      const activateUrl = `${apiUrl}imconnector.activate`;
      console.log("Calling:", activateUrl);
      
      const activateBody = {
        auth: accessToken,
        CONNECTOR: connectorId,
        LINE: lineId,
        ACTIVE: activeStatus
      };
      console.log("Activate body:", JSON.stringify(activateBody));
      
      const activateResponse = await fetch(activateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(activateBody)
      });
      
      const activateResult = await activateResponse.json();
      console.log("imconnector.activate result:", JSON.stringify(activateResult));
      
      // 2. Set connector data with events URL (public, no JWT)
      if (activeStatus === 1) {
        const dataSetUrl = `${apiUrl}imconnector.connector.data.set`;
        console.log("Calling:", dataSetUrl);
        
        const dataBody = {
          auth: accessToken,
          CONNECTOR: connectorId,
          LINE: lineId,
          DATA: {
            id: `${connectorId}_line_${lineId}`,
            url: eventsUrl,
            url_im: eventsUrl,
            name: "Thoth WhatsApp"
          }
        };
        console.log("Data body:", JSON.stringify(dataBody));
        
        const dataSetResponse = await fetch(dataSetUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(dataBody)
        });
        
        const dataSetResult = await dataSetResponse.json();
        console.log("imconnector.connector.data.set result:", JSON.stringify(dataSetResult));
      }
      
      // 3. Save line_id to integration config
      const updatedConfig = {
        ...config,
        connector_id: connectorId,
        line_id: lineId,
        activated_line_id: lineId,
        last_placement_call: new Date().toISOString(),
        placement_auth_id: authId ? "present" : "missing"
      };
      
      await supabase
        .from("integrations")
        .update({
          config: updatedConfig,
          updated_at: new Date().toISOString()
        })
        .eq("id", integration.id);
      
      console.log("Saved line_id to integration config");
      
    } catch (error) {
      console.error("Error in PLACEMENT activation:", error);
      // Still return "successfully" - Bitrix24 needs this
    }
  }

  // CRITICAL: Return "successfully" as plain text
  // This is what Bitrix24 expects to mark the setup as complete
  console.log("=== Returning 'successfully' to Bitrix24 ===");
  return new Response("successfully", {
    headers: { ...corsHeaders, "Content-Type": "text/plain" }
  });
}

// Handle check_app_installed - verify if app is marked as INSTALLED in Bitrix24
async function handleCheckAppInstalled(supabase: any, payload: any) {
  console.log("=== CHECK APP INSTALLED ===");
  
  const { integration_id } = payload;
  
  if (!integration_id) {
    return new Response(
      JSON.stringify({ error: "integration_id is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", integration_id)
    .single();

  if (integrationError || !integration) {
    return new Response(
      JSON.stringify({ error: "Integration not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const config = integration.config || {};
  const accessToken = await refreshBitrixToken(integration, supabase);
  
  if (!accessToken) {
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: "No access token",
        app_installed: false
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const clientEndpoint = config.client_endpoint || `https://${config.domain}/rest/`;
  
  try {
    // Call app.info to check if app is installed
    const response = await fetch(`${clientEndpoint}app.info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth: accessToken })
    });
    
    const result = await response.json();
    console.log("app.info result:", JSON.stringify(result, null, 2));
    
    if (result.error) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: result.error_description || result.error,
          app_installed: false 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const appInfo = result.result || {};
    const isInstalled = appInfo.INSTALLED === true || appInfo.INSTALLED === "Y" || appInfo.INSTALLED === "1";
    
    return new Response(
      JSON.stringify({ 
        success: true,
        app_installed: isInstalled,
        app_info: {
          installed: isInstalled,
          id: appInfo.ID,
          code: appInfo.CODE,
          version: appInfo.VERSION,
          status: appInfo.STATUS,
          payment_expired: appInfo.PAYMENT_EXPIRED,
          days: appInfo.DAYS,
        }
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error checking app.info:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error",
        app_installed: false
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// Handle force_reinstall_events - unbind all events and rebind to force Bitrix24 to re-evaluate
async function handleForceReinstallEvents(supabase: any, payload: any, supabaseUrl: string) {
  console.log("=== FORCE REINSTALL EVENTS ===");
  
  const { integration_id } = payload;
  
  if (!integration_id) {
    return new Response(
      JSON.stringify({ error: "integration_id is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", integration_id)
    .single();

  if (integrationError || !integration) {
    return new Response(
      JSON.stringify({ error: "Integration not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const config = integration.config || {};
  const accessToken = await refreshBitrixToken(integration, supabase);
  
  if (!accessToken) {
    return new Response(
      JSON.stringify({ success: false, error: "No access token" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const clientEndpoint = config.client_endpoint || `https://${config.domain}/rest/`;
  const connectorId = config.connector_id || "thoth_whatsapp";
  const lineId = config.line_id || config.activated_line_id || 2;
  const eventsUrl = `${supabaseUrl}/functions/v1/bitrix24-events`;
  
  const results = {
    unbound: [] as string[],
    bound: [] as string[],
    errors: [] as string[],
    connector_reactivated: false,
    app_info: null as any
  };
  
  const eventsToRebind = [
    "OnImConnectorMessageAdd",
    "OnImConnectorDialogStart", 
    "OnImConnectorDialogFinish",
    "OnImConnectorStatusDelete"
  ];

  try {
    // 1. First check app.info
    console.log("Step 1: Checking app.info...");
    const appInfoResponse = await fetch(`${clientEndpoint}app.info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth: accessToken })
    });
    const appInfoResult = await appInfoResponse.json();
    console.log("app.info result:", JSON.stringify(appInfoResult));
    results.app_info = appInfoResult.result;
    
    // 2. Unbind all existing events
    console.log("Step 2: Unbinding existing events...");
    for (const eventName of eventsToRebind) {
      try {
        const unbindResponse = await fetch(`${clientEndpoint}event.unbind`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth: accessToken,
            event: eventName,
            handler: eventsUrl
          })
        });
        const unbindResult = await unbindResponse.json();
        console.log(`Unbind ${eventName}:`, JSON.stringify(unbindResult));
        
        if (unbindResult.result) {
          results.unbound.push(eventName);
        }
      } catch (e) {
        console.error(`Error unbinding ${eventName}:`, e);
        results.errors.push(`unbind ${eventName}: ${e}`);
      }
    }
    
    // 3. Wait a moment for Bitrix24 to process
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 4. Rebind all events
    console.log("Step 3: Rebinding events...");
    for (const eventName of eventsToRebind) {
      try {
        const bindResponse = await fetch(`${clientEndpoint}event.bind`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth: accessToken,
            event: eventName,
            handler: eventsUrl,
            auth_type: 0,
            event_type: "online"
          })
        });
        const bindResult = await bindResponse.json();
        console.log(`Bind ${eventName}:`, JSON.stringify(bindResult));
        
        if (bindResult.result) {
          results.bound.push(eventName);
        } else if (bindResult.error === "HANDLER_ALREADY_BINDED") {
          results.bound.push(eventName + " (already)");
        } else {
          results.errors.push(`bind ${eventName}: ${JSON.stringify(bindResult.error)}`);
        }
      } catch (e) {
        console.error(`Error binding ${eventName}:`, e);
        results.errors.push(`bind ${eventName}: ${e}`);
      }
    }
    
    // 5. Reactivate connector on the line
    console.log("Step 4: Reactivating connector on line", lineId);
    try {
      // First deactivate
      await fetch(`${clientEndpoint}imconnector.activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: accessToken,
          CONNECTOR: connectorId,
          LINE: lineId,
          ACTIVE: 0
        })
      });
      
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Then reactivate
      const activateResponse = await fetch(`${clientEndpoint}imconnector.activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: accessToken,
          CONNECTOR: connectorId,
          LINE: lineId,
          ACTIVE: 1
        })
      });
      const activateResult = await activateResponse.json();
      console.log("Reactivate connector result:", JSON.stringify(activateResult));
      results.connector_reactivated = !!activateResult.result;
      
      // Set connector data
      await fetch(`${clientEndpoint}imconnector.connector.data.set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: accessToken,
          CONNECTOR: connectorId,
          LINE: lineId,
          DATA: {
            id: `${connectorId}_line_${lineId}`,
            url: eventsUrl,
            url_im: eventsUrl,
            name: "Thoth WhatsApp"
          }
        })
      });
      
    } catch (e) {
      console.error("Error reactivating connector:", e);
      results.errors.push(`reactivate connector: ${e}`);
    }
    
    // 6. Update integration config with reinstall timestamp
    await supabase
      .from("integrations")
      .update({
        config: {
          ...config,
          last_force_reinstall: new Date().toISOString(),
          events_reinstalled_count: (config.events_reinstalled_count || 0) + 1
        },
        updated_at: new Date().toISOString()
      })
      .eq("id", integration_id);
    
    const success = results.bound.length >= 3 && results.errors.length === 0;
    
    return new Response(
      JSON.stringify({ 
        success,
        message: success 
          ? `Reinstalação forçada concluída: ${results.bound.length} eventos rebindados` 
          : `Reinstalação parcial: ${results.errors.length} erros`,
        results
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
    
  } catch (error) {
    console.error("Error in force reinstall:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error",
        results
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// Handle complete_setup action (called from Thoth.ai Integrations page)
async function handleCompleteSetup(supabase: any, payload: any, supabaseUrl: string) {
  console.log("=== COMPLETE SETUP ===");
  console.log("Payload:", JSON.stringify(payload, null, 2));

  const { workspace_id, integration_id, instance_id, line_id, line_name } = payload;

  if (!workspace_id || !integration_id || !instance_id || !line_id) {
    return new Response(
      JSON.stringify({ error: "Campos obrigatórios não preenchidos" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get integration to activate connector
  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", integration_id)
    .single();

  if (integrationError || !integration) {
    console.error("Integration not found:", integrationError);
    return new Response(
      JSON.stringify({ error: "Integração não encontrada" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // CRITICAL: Use bitrix24-events (public, no JWT) for event callbacks
  const eventsUrl = `${supabaseUrl}/functions/v1/bitrix24-events`;

  // Activate connector via API (with ACTIVE = 1)
  const activationResult = await activateConnectorViaAPI(integration, supabase, line_id, 1, eventsUrl);
  console.log("Activation result:", activationResult);

  // Verify activation succeeded by checking status
  const config = integration.config || {};
  const clientEndpoint = config.client_endpoint || `https://${config.domain}/rest/`;
  const connectorId = config.connector_id || "thoth_whatsapp";
  const accessToken = await refreshBitrixToken(integration, supabase);

  let verificationResult = { active: false, verified: false };
  
  if (accessToken) {
    try {
      console.log("Verifying connector activation...");
      const statusResponse = await fetch(`${clientEndpoint}imconnector.status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: accessToken,
          CONNECTOR: connectorId,
          LINE: line_id
        })
      });
      const statusResult = await statusResponse.json();
      console.log("Verification status:", JSON.stringify(statusResult, null, 2));

      verificationResult.verified = true;
      verificationResult.active = statusResult.result?.active === true || statusResult.result?.ACTIVE === "Y";

      // If not active, try activating again with a different approach
      if (!verificationResult.active) {
        console.log("Connector not active after first attempt, trying again...");
        
        // Try imconnector.register first
        const registerResponse = await fetch(`${clientEndpoint}imconnector.register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth: accessToken,
            ID: connectorId,
            NAME: "Thoth WhatsApp",
            ICON: {
              DATA_IMAGE: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDQ4IDQ4Ij48cGF0aCBmaWxsPSIjMjVEMzY2IiBkPSJNMjQgNEMxMi45NTQgNCgICAyNC4wMzggMjQuMDM4IDQ0IDI0LjAzOCA0NGgtLjAzMkM1LjY2NSA0NCA0IDM0LjMzNSA0IDI0eiIvPjwvc3ZnPg=="
            },
            PLACEMENT_HANDLER: eventsUrl
          })
        });
        const registerResult = await registerResponse.json();
        console.log("Register result:", JSON.stringify(registerResult, null, 2));

        // Try activation again
        const reactivateResponse = await fetch(`${clientEndpoint}imconnector.activate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth: accessToken,
            CONNECTOR: connectorId,
            LINE: line_id,
            ACTIVE: 1
          })
        });
        const reactivateResult = await reactivateResponse.json();
        console.log("Reactivate result:", JSON.stringify(reactivateResult, null, 2));

        // Set connector data again
        await fetch(`${clientEndpoint}imconnector.connector.data.set`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth: accessToken,
            CONNECTOR: connectorId,
            LINE: line_id,
            DATA: {
              id: `${connectorId}_line_${line_id}`,
              url: eventsUrl,
              url_im: eventsUrl,
              name: "Thoth WhatsApp"
            }
          })
        });

        // Check status again
        const finalStatusResponse = await fetch(`${clientEndpoint}imconnector.status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth: accessToken,
            CONNECTOR: connectorId,
            LINE: line_id
          })
        });
        const finalStatusResult = await finalStatusResponse.json();
        console.log("Final verification status:", JSON.stringify(finalStatusResult, null, 2));
        verificationResult.active = finalStatusResult.result?.active === true || finalStatusResult.result?.ACTIVE === "Y";
      }

      // Bind events to ensure we receive messages - use bitrix24-events (public, no JWT)
      console.log("Binding connector events...");
      const eventsToBind = ["OnImConnectorMessageAdd", "OnImConnectorDialogStart", "OnImConnectorDialogFinish"];
      
      for (const eventName of eventsToBind) {
        try {
          await fetch(`${clientEndpoint}event.bind`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              auth: accessToken,
              event: eventName,
              handler: eventsUrl
            })
          });
        } catch (e) {
          console.log(`Failed to bind ${eventName}:`, e);
        }
      }
    } catch (e) {
      console.error("Error verifying activation:", e);
    }
  }

  console.log("Verification result:", verificationResult);

  // Save the mapping
  const { data, error } = await supabase
    .from("bitrix_channel_mappings")
    .upsert({
      workspace_id,
      integration_id,
      instance_id,
      line_id,
      line_name,
      is_active: true,
      updated_at: new Date().toISOString()
    }, { 
      onConflict: "integration_id,line_id"
    })
    .select()
    .single();

  if (error) {
    console.error("Error saving mapping:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log("Mapping saved:", data);

  return new Response(
    JSON.stringify({ success: true, mapping: data, activation: activationResult }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// Handle save_mapping action
async function handleSaveMapping(supabase: any, payload: any) {
  console.log("=== SAVE MAPPING ===");
  const { workspace_id, integration_id, instance_id, line_id, line_name } = payload;

  if (!workspace_id || !integration_id || !instance_id || !line_id) {
    return new Response(
      JSON.stringify({ error: "Campos obrigatórios não preenchidos" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data, error } = await supabase
    .from("bitrix_channel_mappings")
    .upsert({
      workspace_id,
      integration_id,
      instance_id,
      line_id,
      line_name,
      is_active: true,
      updated_at: new Date().toISOString()
    }, { 
      onConflict: "integration_id,line_id"
    })
    .select()
    .single();

  if (error) {
    console.error("Error saving mapping:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ success: true, mapping: data }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// Handle diagnose_connector action - Diagnose and auto-fix connector issues
async function handleDiagnoseConnector(supabase: any, payload: any, supabaseUrl: string) {
  console.log("=== DIAGNOSE CONNECTOR ===");
  const { integration_id, line_id, auto_fix } = payload;

  if (!integration_id) {
    return new Response(
      JSON.stringify({ error: "Integration ID não fornecido" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", integration_id)
    .single();

  if (integrationError || !integration) {
    console.error("Integration not found:", integrationError);
    return new Response(
      JSON.stringify({ error: "Integração não encontrada" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const accessToken = await refreshBitrixToken(integration, supabase);
  if (!accessToken) {
    return new Response(
      JSON.stringify({ error: "Token de acesso não disponível" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const config = integration.config;
  const clientEndpoint = config.client_endpoint || `https://${config.domain}/rest/`;
  const connectorId = config.connector_id || "thoth_whatsapp";
  const targetLineId = line_id || config.line_id || config.activated_line_id || 2;
  // CRITICAL: Use bitrix24-events (public, no JWT) for event callbacks
  const eventsUrl = `${supabaseUrl}/functions/v1/bitrix24-events`;

  console.log("Diagnosing connector:", { connectorId, targetLineId, clientEndpoint });

  const diagnosis = {
    connector_id: connectorId,
    line_id: targetLineId,
    connector_registered: false,
    connector_active: false,
    connector_connection: false,
    events_bound: false,
    issues: [] as string[],
    fixes_applied: [] as string[],
  };

  try {
    // 1. Check if connector is registered
    console.log("Step 1: Checking connector list...");
    const listResponse = await fetch(`${clientEndpoint}imconnector.list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth: accessToken })
    });
    const listResult = await listResponse.json();
    console.log("Connector list:", JSON.stringify(listResult, null, 2));

    // imconnector.list returns an object with connector IDs as keys, not an array
    const connectorsResult = listResult.result || {};
    let connectorsList: any[] = [];
    
    if (Array.isArray(connectorsResult)) {
      connectorsList = connectorsResult;
    } else if (typeof connectorsResult === 'object') {
      // Convert object to array
      connectorsList = Object.keys(connectorsResult).map(key => ({
        ID: key,
        ...connectorsResult[key]
      }));
    }
    
    const ourConnector = connectorsList.find((c: any) => 
      c.ID === connectorId || c.ID?.toLowerCase().includes("thoth") || String(c.ID).includes("thoth")
    );
    diagnosis.connector_registered = !!ourConnector || Object.keys(connectorsResult).some(k => k.includes("thoth") || k === connectorId);

    if (!ourConnector) {
      diagnosis.issues.push("Conector não está registrado no Bitrix24");
    }

    // 2. Check connector status for the line
    console.log("Step 2: Checking connector status for line", targetLineId);
    const statusResponse = await fetch(`${clientEndpoint}imconnector.status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth: accessToken,
        CONNECTOR: connectorId,
        LINE: targetLineId
      })
    });
    const statusResult = await statusResponse.json();
    console.log("Connector status:", JSON.stringify(statusResult, null, 2));

    if (statusResult.result) {
      // Bitrix24 returns STATUS (boolean) or ACTIVE (string "Y"/"N")
      diagnosis.connector_active = statusResult.result.active === true || 
                                   statusResult.result.ACTIVE === "Y" || 
                                   statusResult.result.STATUS === true ||
                                   statusResult.result.status === true;
      diagnosis.connector_connection = statusResult.result.connection === true || 
                                       statusResult.result.CONNECTION === "Y" ||
                                       statusResult.result.CONFIGURED === true ||
                                       statusResult.result.configured === true;
    }

    if (!diagnosis.connector_active) {
      diagnosis.issues.push(`Conector não está ativo para a linha ${targetLineId}`);
    }

    // 3. Check events binding
    console.log("Step 3: Checking event bindings...");
    const eventsResponse = await fetch(`${clientEndpoint}event.get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth: accessToken })
    });
    const eventsResult = await eventsResponse.json();
    console.log("Events:", JSON.stringify(eventsResult, null, 2));

    const boundEvents = eventsResult.result || [];
    const requiredEvents = ["OnImConnectorMessageAdd", "ONIMCONNECTORMESSAGEADD"];
    const hasRequiredEvents = boundEvents.some((e: any) => 
      requiredEvents.includes(e.event) || requiredEvents.includes(e.event?.toUpperCase())
    );
    diagnosis.events_bound = hasRequiredEvents;

    if (!hasRequiredEvents) {
      diagnosis.issues.push("Evento OnImConnectorMessageAdd não está configurado");
    }

    // 4. Auto-fix if requested
    if (auto_fix && diagnosis.issues.length > 0) {
      console.log("Auto-fix requested, applying fixes...");

      // Fix 1: Activate connector
      if (!diagnosis.connector_active) {
        console.log("Activating connector for line", targetLineId);
        const activateResponse = await fetch(`${clientEndpoint}imconnector.activate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth: accessToken,
            CONNECTOR: connectorId,
            LINE: targetLineId,
            ACTIVE: 1
          })
        });
        const activateResult = await activateResponse.json();
        console.log("Activate result:", JSON.stringify(activateResult, null, 2));

        if (activateResult.result || !activateResult.error) {
          diagnosis.fixes_applied.push("Conector ativado para a linha " + targetLineId);
          diagnosis.connector_active = true;

          // Set connector data
          const dataSetResponse = await fetch(`${clientEndpoint}imconnector.connector.data.set`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              auth: accessToken,
              CONNECTOR: connectorId,
              LINE: targetLineId,
              DATA: {
                id: `${connectorId}_line_${targetLineId}`,
                url: eventsUrl,
                url_im: eventsUrl,
                name: "Thoth WhatsApp"
              }
            })
          });
          const dataSetResult = await dataSetResponse.json();
          console.log("Data set result:", JSON.stringify(dataSetResult, null, 2));
          
          if (dataSetResult.result || !dataSetResult.error) {
            diagnosis.fixes_applied.push("Dados do conector configurados");
          }
        } else {
          console.error("Failed to activate connector:", activateResult.error);
        }
      }

      // Fix 2: Bind events if not bound - use bitrix24-events (public, no JWT)
      if (!diagnosis.events_bound) {
        console.log("Binding events...");
        
        const eventsToBind = [
          "OnImConnectorMessageAdd",
          "OnImConnectorDialogStart", 
          "OnImConnectorDialogFinish"
        ];

        for (const eventName of eventsToBind) {
          const bindResponse = await fetch(`${clientEndpoint}event.bind`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              auth: accessToken,
              event: eventName,
              handler: eventsUrl
            })
          });
          const bindResult = await bindResponse.json();
          console.log(`Bind ${eventName} result:`, JSON.stringify(bindResult, null, 2));

          if (bindResult.result || bindResult.error === "HANDLER_ALREADY_BINDED") {
            diagnosis.fixes_applied.push(`Evento ${eventName} configurado`);
          }
        }
        diagnosis.events_bound = true;
      }

      // Re-check status after fixes
      if (diagnosis.fixes_applied.length > 0) {
        console.log("Re-checking status after fixes...");
        const reStatusResponse = await fetch(`${clientEndpoint}imconnector.status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth: accessToken,
            CONNECTOR: connectorId,
            LINE: targetLineId
          })
        });
        const reStatusResult = await reStatusResponse.json();
        console.log("Re-check status:", JSON.stringify(reStatusResult, null, 2));

        if (reStatusResult.result) {
          diagnosis.connector_active = reStatusResult.result.active === true || reStatusResult.result.ACTIVE === "Y";
          diagnosis.connector_connection = reStatusResult.result.connection === true || reStatusResult.result.CONNECTION === "Y";
        }
      }
    }

    // Update issues list after fixes
    diagnosis.issues = [];
    if (!diagnosis.connector_registered) diagnosis.issues.push("Conector não registrado");
    if (!diagnosis.connector_active) diagnosis.issues.push("Conector não ativo");
    if (!diagnosis.events_bound) diagnosis.issues.push("Eventos não configurados");

    console.log("Final diagnosis:", diagnosis);

    return new Response(
      JSON.stringify({
        success: true,
        diagnosis,
        healthy: diagnosis.issues.length === 0,
        message: diagnosis.issues.length === 0 
          ? "Conector funcionando corretamente" 
          : `${diagnosis.issues.length} problema(s) encontrado(s)`
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error diagnosing connector:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erro ao diagnosticar" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// Handle clean_connectors action - Remove all duplicate connectors and events
async function handleCleanConnectors(supabase: any, payload: any, supabaseUrl: string) {
  console.log("=== CLEAN CONNECTORS ===");
  console.log("Payload:", JSON.stringify(payload, null, 2));

  const { integration_id } = payload;

  if (!integration_id) {
    return new Response(
      JSON.stringify({ error: "Integration ID não fornecido" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", integration_id)
    .single();

  if (integrationError || !integration) {
    console.error("Integration not found:", integrationError);
    return new Response(
      JSON.stringify({ error: "Integração não encontrada" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const accessToken = await refreshBitrixToken(integration, supabase);
  if (!accessToken) {
    return new Response(
      JSON.stringify({ error: "Token de acesso não disponível" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const config = integration.config;
  const clientEndpoint = config.client_endpoint || `https://${config.domain}/rest/`;
  // Note: This is for cleanup, we check for both old webhook and new events URLs
  const eventsUrl = `${supabaseUrl}/functions/v1/bitrix24-events`;

  let removedCount = 0;
  let eventsRemoved = 0;
  const errors: string[] = [];

  try {
    // 1. List all connectors
    console.log("Step 1: Listing all connectors...");
    const listResponse = await fetch(`${clientEndpoint}imconnector.list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth: accessToken })
    });
    const listResult = await listResponse.json();
    console.log("Connector list:", JSON.stringify(listResult, null, 2));

    const connectorsResult = listResult.result || {};
    let connectorIds: string[] = [];
    
    if (Array.isArray(connectorsResult)) {
      connectorIds = connectorsResult.map((c: any) => c.ID || c.id);
    } else if (typeof connectorsResult === 'object') {
      connectorIds = Object.keys(connectorsResult);
    }

    // Find all connectors with "thoth" or "whatsapp" in the name
    const ourConnectors = connectorIds.filter(id => 
      id.toLowerCase().includes("thoth") || id.toLowerCase().includes("whatsapp")
    );
    console.log("Found our connectors:", ourConnectors);

    // 2. Unregister all except the main one (thoth_whatsapp)
    const mainConnectorId = "thoth_whatsapp";
    const duplicates = ourConnectors.filter(id => id !== mainConnectorId);

    for (const connectorId of duplicates) {
      console.log(`Unregistering duplicate connector: ${connectorId}`);
      try {
        // First deactivate for all lines
        for (let lineId = 1; lineId <= 10; lineId++) {
          await fetch(`${clientEndpoint}imconnector.activate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              auth: accessToken,
              CONNECTOR: connectorId,
              LINE: lineId,
              ACTIVE: 0
            })
          });
        }

        // Then unregister
        const unregisterResponse = await fetch(`${clientEndpoint}imconnector.unregister`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth: accessToken,
            ID: connectorId
          })
        });
        const unregisterResult = await unregisterResponse.json();
        console.log(`Unregister ${connectorId} result:`, JSON.stringify(unregisterResult, null, 2));

        if (unregisterResult.result || !unregisterResult.error) {
          removedCount++;
        } else if (unregisterResult.error) {
          errors.push(`Erro ao remover ${connectorId}: ${unregisterResult.error_description || unregisterResult.error}`);
        }
      } catch (e) {
        console.error(`Error unregistering ${connectorId}:`, e);
        errors.push(`Erro ao remover ${connectorId}`);
      }
    }

    // 3. Clean duplicate events
    console.log("Step 3: Cleaning duplicate events...");
    const eventsResponse = await fetch(`${clientEndpoint}event.get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth: accessToken })
    });
    const eventsResult = await eventsResponse.json();
    console.log("Events:", JSON.stringify(eventsResult, null, 2));

    const boundEvents = eventsResult.result || [];
    
    // Find events that point to our webhook
    const ourEvents = boundEvents.filter((e: any) => 
      e.handler?.includes("bitrix24") || e.HANDLER?.includes("bitrix24")
    );
    console.log("Our events:", ourEvents.length);

    // Group events by event name and keep only one per event type
    const eventsByName: Record<string, any[]> = {};
    for (const event of ourEvents) {
      const eventName = event.event || event.EVENT;
      if (!eventsByName[eventName]) {
        eventsByName[eventName] = [];
      }
      eventsByName[eventName].push(event);
    }

    // Remove duplicates (keep only the first one for each event type)
    for (const [eventName, events] of Object.entries(eventsByName)) {
      if (events.length > 1) {
        console.log(`Found ${events.length} duplicate events for ${eventName}, keeping one and removing ${events.length - 1}`);
        
        for (let i = 1; i < events.length; i++) {
          const event = events[i];
          const eventId = event.id || event.ID;
          const handler = event.handler || event.HANDLER;
          
          try {
            const unbindResponse = await fetch(`${clientEndpoint}event.unbind`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                auth: accessToken,
                event: eventName,
                handler: handler
              })
            });
            const unbindResult = await unbindResponse.json();
            console.log(`Unbind ${eventName} result:`, JSON.stringify(unbindResult, null, 2));
            
            if (unbindResult.result) {
              eventsRemoved++;
            }
          } catch (e) {
            console.error(`Error unbinding event ${eventName}:`, e);
          }
        }
      }
    }

    // 4. Update integration config to use the main connector ID
    await supabase
      .from("integrations")
      .update({
        config: {
          ...config,
          connector_id: mainConnectorId,
          connectors_cleaned_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString()
      })
      .eq("id", integration.id);

    console.log("Clean complete:", { removedCount, eventsRemoved, errors });

    return new Response(
      JSON.stringify({
        success: true,
        removed_count: removedCount,
        events_removed: eventsRemoved,
        errors: errors.length > 0 ? errors : undefined,
        message: `${removedCount} conector(es) e ${eventsRemoved} evento(s) duplicado(s) removidos`
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error cleaning connectors:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erro ao limpar conectores" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// Handle refresh_token action - Refresh OAuth token and return status
async function handleRefreshToken(supabase: any, payload: any) {
  console.log("=== REFRESH TOKEN ===");
  const { integration_id } = payload;

  if (!integration_id) {
    return new Response(
      JSON.stringify({ error: "Integration ID não fornecido" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", integration_id)
    .single();

  if (integrationError || !integration) {
    console.error("Integration not found:", integrationError);
    return new Response(
      JSON.stringify({ error: "Integração não encontrada" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // Attempt to refresh the token
    const newToken = await refreshBitrixToken(integration, supabase);
    
    if (!newToken) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Não foi possível atualizar o token de acesso",
          hint: "Pode ser necessário reinstalar o app no Bitrix24"
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Reload integration to get updated config
    const { data: updatedIntegration } = await supabase
      .from("integrations")
      .select("*")
      .eq("id", integration_id)
      .single();

    const config = updatedIntegration?.config || integration.config;

    return new Response(
      JSON.stringify({
        success: true,
        message: "Token atualizado com sucesso",
        token_valid: true,
        token_expires_at: config.token_expires_at,
        domain: config.domain,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error refreshing token:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Erro ao atualizar token" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// Handle check_connector_status action - Check real connector status on Bitrix24
async function handleCheckConnectorStatus(supabase: any, payload: any) {
  console.log("=== CHECK CONNECTOR STATUS ===");
  const { integration_id, line_id } = payload;

  if (!integration_id) {
    return new Response(
      JSON.stringify({ error: "Integration ID não fornecido" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", integration_id)
    .single();

  if (integrationError || !integration) {
    console.error("Integration not found:", integrationError);
    return new Response(
      JSON.stringify({ error: "Integração não encontrada" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const accessToken = await refreshBitrixToken(integration, supabase);
  if (!accessToken) {
    return new Response(
      JSON.stringify({ error: "Token de acesso não disponível" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const config = integration.config;
  const clientEndpoint = config.client_endpoint || `https://${config.domain}/rest/`;
  const connectorId = config.connector_id || "thoth_whatsapp";
  const targetLineId = line_id || config.line_id || config.activated_line_id || 2;

  console.log("Checking connector status for:", { connectorId, targetLineId, clientEndpoint });

  try {
    // 1. Check connector status
    const statusResponse = await fetch(`${clientEndpoint}imconnector.status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth: accessToken,
        CONNECTOR: connectorId,
        LINE: targetLineId
      })
    });
    const statusResult = await statusResponse.json();
    console.log("Connector status result:", JSON.stringify(statusResult, null, 2));

    // 2. List all registered connectors
    const listResponse = await fetch(`${clientEndpoint}imconnector.list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth: accessToken })
    });
    const listResult = await listResponse.json();
    console.log("Connector list result:", JSON.stringify(listResult, null, 2));

    // 3. Check if our connector is in the list
    const connectorsList = listResult.result || [];
    const ourConnector = connectorsList.find((c: any) => 
      c.ID === connectorId || c.NAME?.includes("Thoth") || c.NAME?.includes("thoth")
    );

    // 4. Get mapping from database
    const { data: mapping } = await supabase
      .from("bitrix_channel_mappings")
      .select("*")
      .eq("integration_id", integration_id)
      .eq("line_id", targetLineId)
      .maybeSingle();

    // Build response
    const response = {
      success: true,
      connector_id: connectorId,
      line_id: targetLineId,
      status: {
        active: statusResult.result?.active === true || statusResult.result?.ACTIVE === "Y",
        registered: statusResult.result?.register === true || statusResult.result?.REGISTER === "Y",
        connection: statusResult.result?.connection === true || statusResult.result?.CONNECTION === "Y",
        error: statusResult.result?.error,
        raw: statusResult.result
      },
      connector_in_list: !!ourConnector,
      our_connector: ourConnector,
      all_connectors: connectorsList.length,
      database_mapping: mapping ? {
        instance_id: mapping.instance_id,
        is_active: mapping.is_active,
        line_id: mapping.line_id
      } : null,
      integration_config: {
        line_id: config.line_id,
        activated_line_id: config.activated_line_id,
        connector_id: config.connector_id,
        connector_registered: config.connector_registered
      }
    };

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error checking connector status:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erro ao verificar status" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// Handle delete_mapping action
async function handleDeleteMapping(supabase: any, payload: any) {
  console.log("=== DELETE MAPPING ===");
  const { mapping_id } = payload;

  if (!mapping_id) {
    return new Response(
      JSON.stringify({ error: "ID do mapeamento não fornecido" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { error } = await supabase
    .from("bitrix_channel_mappings")
    .delete()
    .eq("id", mapping_id);

  if (error) {
    console.error("Error deleting mapping:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ success: true }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// Handle list_channels action - List all Open Channels from Bitrix24 with connector status
async function handleListChannels(supabase: any, payload: any) {
  console.log("=== LIST CHANNELS ===");
  const { integration_id, include_connector_status } = payload;

  if (!integration_id) {
    return new Response(
      JSON.stringify({ error: "Integration ID não fornecido" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", integration_id)
    .single();

  if (integrationError || !integration) {
    console.error("Integration not found:", integrationError);
    return new Response(
      JSON.stringify({ error: "Integração não encontrada" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const accessToken = await refreshBitrixToken(integration, supabase);
  if (!accessToken) {
    return new Response(
      JSON.stringify({ error: "Token de acesso não disponível" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const config = integration.config;
  const clientEndpoint = config.client_endpoint || `https://${config.domain}/rest/`;
  const connectorId = config.connector_id || "thoth_whatsapp";

  try {
    // Call imopenlines.config.list.get to get all open channels
    const response = await fetch(`${clientEndpoint}imopenlines.config.list.get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth: accessToken,
        PARAMS: {
          select: ["ID", "LINE_NAME", "ACTIVE"]
        }
      })
    });

    const result = await response.json();
    console.log("imopenlines.config.list.get result:", JSON.stringify(result, null, 2));

    if (result.error) {
      console.error("Bitrix API error:", result.error, result.error_description);
      return new Response(
        JSON.stringify({ error: result.error_description || result.error }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Map the result to a simpler format
    const channels = (result.result || []).map((ch: any) => ({
      id: parseInt(ch.ID),
      name: ch.LINE_NAME || `Canal ${ch.ID}`,
      active: ch.ACTIVE === "Y",
      connector_active: false, // Will be updated below if include_connector_status
    }));

    // If requested, check connector status for each line
    if (include_connector_status) {
      for (const channel of channels) {
        try {
          const statusResponse = await fetch(`${clientEndpoint}imconnector.status`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              auth: accessToken,
              CONNECTOR: connectorId,
              LINE: channel.id
            })
          });
          const statusResult = await statusResponse.json();
          console.log(`Connector status for line ${channel.id}:`, statusResult);
          
          if (statusResult.result) {
            // Bitrix24 returns: STATUS (active), CONFIGURED (registered), ERROR
            channel.connector_active = statusResult.result.STATUS === true || statusResult.result.active === true || statusResult.result.ACTIVE === "Y";
            channel.connector_registered = statusResult.result.CONFIGURED === true || statusResult.result.register === true || statusResult.result.REGISTER === "Y";
            channel.connector_connection = !statusResult.result.ERROR;
          }
        } catch (e) {
          console.error(`Error getting connector status for line ${channel.id}:`, e);
        }
      }
    }

    // Get mappings from database to add instance info
    const { data: mappings } = await supabase
      .from("bitrix_channel_mappings")
      .select(`
        line_id,
        instance_id,
        is_active,
        instances (id, name, phone_number)
      `)
      .eq("integration_id", integration_id);

    // Enrich channels with mapping info
    for (const channel of channels) {
      const mapping = mappings?.find((m: any) => m.line_id === channel.id);
      if (mapping) {
        channel.mapping = {
          instance_id: mapping.instance_id,
          instance_name: mapping.instances?.name,
          phone_number: mapping.instances?.phone_number,
          is_active: mapping.is_active
        };
      }
    }

    console.log("Final channels with status:", channels);

    return new Response(
      JSON.stringify({ success: true, channels }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error listing channels:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erro ao listar canais" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// Handle activate_connector_for_line action - Activate/deactivate connector for a specific line
async function handleActivateConnectorForLine(supabase: any, payload: any, supabaseUrl: string) {
  console.log("=== ACTIVATE CONNECTOR FOR LINE ===");
  const { integration_id, line_id, active } = payload;

  if (!integration_id || !line_id) {
    return new Response(
      JSON.stringify({ error: "Integration ID e Line ID são obrigatórios" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", integration_id)
    .single();

  if (integrationError || !integration) {
    console.error("Integration not found:", integrationError);
    return new Response(
      JSON.stringify({ error: "Integração não encontrada" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // CRITICAL: Use bitrix24-events (public, no JWT) for event callbacks
  const eventsUrl = `${supabaseUrl}/functions/v1/bitrix24-events`;
  const activeValue = active === true || active === 1 ? 1 : 0;

  // Use the existing activateConnectorViaAPI function
  const result = await activateConnectorViaAPI(integration, supabase, line_id, activeValue, eventsUrl);

  if (result.success) {
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: activeValue === 1 ? "Conector ativado com sucesso" : "Conector desativado com sucesso",
        line_id,
        active: activeValue === 1
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } else {
    return new Response(
      JSON.stringify({ error: result.error || "Erro ao ativar/desativar conector" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// Handle create_channel action - Create a new Open Channel in Bitrix24
async function handleCreateChannel(supabase: any, payload: any) {
  console.log("=== CREATE CHANNEL ===");
  const { integration_id, channel_name } = payload;

  if (!integration_id || !channel_name) {
    return new Response(
      JSON.stringify({ error: "Integration ID e nome do canal são obrigatórios" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", integration_id)
    .single();

  if (integrationError || !integration) {
    console.error("Integration not found:", integrationError);
    return new Response(
      JSON.stringify({ error: "Integração não encontrada" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const accessToken = await refreshBitrixToken(integration, supabase);
  if (!accessToken) {
    return new Response(
      JSON.stringify({ error: "Token de acesso não disponível" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const config = integration.config;
  const clientEndpoint = config.client_endpoint || `https://${config.domain}/rest/`;

  try {
    // Call imopenlines.config.add to create a new channel
    const response = await fetch(`${clientEndpoint}imopenlines.config.add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth: accessToken,
        PARAMS: {
          LINE_NAME: channel_name,
          ACTIVE: "Y"
        }
      })
    });

    const result = await response.json();
    console.log("imopenlines.config.add result:", JSON.stringify(result, null, 2));

    if (result.error) {
      console.error("Bitrix API error:", result.error, result.error_description);
      return new Response(
        JSON.stringify({ error: result.error_description || result.error }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const channelId = result.result;
    if (channelId) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          channel: {
            id: channelId,
            name: channel_name,
            active: true
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      return new Response(
        JSON.stringify({ error: "Canal criado mas ID não retornado" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("Error creating channel:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erro ao criar canal" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// Handle register_sms_provider action - Register as SMS/messaging provider in Bitrix24
async function handleRegisterSmsProvider(supabase: any, payload: any, supabaseUrl: string) {
  console.log("=== REGISTER SMS PROVIDER ===");
  const { integration_id, provider_name } = payload;

  if (!integration_id) {
    return new Response(
      JSON.stringify({ error: "Integration ID é obrigatório" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", integration_id)
    .single();

  if (integrationError || !integration) {
    console.error("Integration not found:", integrationError);
    return new Response(
      JSON.stringify({ error: "Integração não encontrada" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const accessToken = await refreshBitrixToken(integration, supabase);
  if (!accessToken) {
    return new Response(
      JSON.stringify({ error: "Token de acesso não disponível" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const config = integration.config;
  const clientEndpoint = config.client_endpoint || `https://${config.domain}/rest/`;
  const smsProviderId = "thoth_whatsapp_sms";
  const name = provider_name || "Thoth WhatsApp";
  const webhookUrl = `${supabaseUrl}/functions/v1/bitrix24-webhook`;

  try {
    // First, check if provider already exists
    console.log("Checking existing SMS providers...");
    const listResponse = await fetch(`${clientEndpoint}messageservice.sender.list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth: accessToken })
    });

    const listResult = await listResponse.json();
    console.log("messageservice.sender.list result:", JSON.stringify(listResult));

    // Check if our provider already exists
    const existingProvider = listResult.result?.find((p: any) => 
      p.CODE === smsProviderId || p.ID === smsProviderId || 
      (p.NAME && p.NAME.toLowerCase().includes("thoth"))
    );

    if (existingProvider) {
      console.log("Provider already exists:", existingProvider);
      
      // Update integration config
      await supabase
        .from("integrations")
        .update({
          config: {
            ...config,
            sms_provider_id: existingProvider.CODE || existingProvider.ID,
            sms_provider_registered: true,
          },
          updated_at: new Date().toISOString()
        })
        .eq("id", integration.id);

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Provedor de SMS já registrado",
          provider: existingProvider
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Register new SMS provider
    console.log("Registering new SMS provider...");
    const registerResponse = await fetch(`${clientEndpoint}messageservice.sender.add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth: accessToken,
        CODE: smsProviderId,
        TYPE: "SMS",
        NAME: name,
        DESCRIPTION: "Envio de mensagens WhatsApp via Thoth.ai",
        HANDLER: webhookUrl,
        // Options for Bitrix24 CRM automations
        CRM_SETTINGS: {
          CONTACT: "Y",
          COMPANY: "Y", 
          LEAD: "Y",
          DEAL: "Y"
        }
      })
    });

    const registerResult = await registerResponse.json();
    console.log("messageservice.sender.add result:", JSON.stringify(registerResult));

    if (registerResult.error) {
      console.error("Registration error:", registerResult.error, registerResult.error_description);
      
      // If error is "Provider already exists", try to get the existing one
      if (registerResult.error === "ERROR_PROVIDER_ALREADY_EXISTS" || 
          registerResult.error_description?.includes("already exists")) {
        return new Response(
          JSON.stringify({ 
            success: true, 
            message: "Provedor de SMS já existe no Bitrix24",
            provider_id: smsProviderId
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ error: registerResult.error_description || registerResult.error }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update integration config with SMS provider info
    await supabase
      .from("integrations")
      .update({
        config: {
          ...config,
          sms_provider_id: smsProviderId,
          sms_provider_registered: true,
          sms_provider_registered_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString()
      })
      .eq("id", integration.id);

    console.log("SMS provider registered successfully");

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Provedor de SMS registrado com sucesso! Agora você pode usar WhatsApp nas automações do CRM.",
        provider_id: smsProviderId,
        result: registerResult.result
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error registering SMS provider:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erro ao registrar provedor de SMS" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// Handle register_robot action - Register automation robot in Bitrix24 (bizproc.robot.add)
async function handleRegisterRobot(supabase: any, payload: any, supabaseUrl: string) {
  console.log("=== REGISTER AUTOMATION ROBOT ===");
  const { integration_id, robot_name } = payload;

  if (!integration_id) {
    return new Response(
      JSON.stringify({ error: "Integration ID é obrigatório" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", integration_id)
    .single();

  if (integrationError || !integration) {
    console.error("Integration not found:", integrationError);
    return new Response(
      JSON.stringify({ error: "Integração não encontrada" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const accessToken = await refreshBitrixToken(integration, supabase);
  if (!accessToken) {
    return new Response(
      JSON.stringify({ error: "Token de acesso não disponível" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const config = integration.config;
  const clientEndpoint = config.client_endpoint || `https://${config.domain}/rest/`;
  const robotCode = "thoth_whatsapp_robot";
  const name = robot_name || "Thoth WhatsApp - Enviar Mensagem";
  const webhookUrl = `${supabaseUrl}/functions/v1/bitrix24-webhook`;

  try {
    // First, check if robot already exists
    console.log("Checking existing robots...");
    const listResponse = await fetch(`${clientEndpoint}bizproc.robot.list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth: accessToken })
    });

    const listResult = await listResponse.json();
    console.log("bizproc.robot.list result:", JSON.stringify(listResult));

    // Check if our robot already exists
    const existingRobot = listResult.result?.find((r: any) => r.CODE === robotCode);

    if (existingRobot) {
      console.log("Robot already exists:", existingRobot);
      
      // Update integration config
      await supabase
        .from("integrations")
        .update({
          config: {
            ...config,
            robot_code: robotCode,
            robot_registered: true,
          },
          updated_at: new Date().toISOString()
        })
        .eq("id", integration.id);

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Robot de automação já registrado",
          robot_code: robotCode
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Register new robot
    console.log("Registering new automation robot...");
    const registerResponse = await fetch(`${clientEndpoint}bizproc.robot.add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth: accessToken,
        CODE: robotCode,
        HANDLER: webhookUrl,
        AUTH_USER_ID: 1,
        USE_SUBSCRIPTION: "Y",
        NAME: {
          "pt": name,
          "en": "Thoth WhatsApp - Send Message"
        },
        DESCRIPTION: {
          "pt": "Envia mensagem WhatsApp para o contato do Lead/Deal/Contato",
          "en": "Sends WhatsApp message to Lead/Deal/Contact"
        },
        PROPERTIES: {
          phone: {
            Name: { pt: "Telefone", en: "Phone" },
            Description: { pt: "Número de telefone do destinatário", en: "Recipient phone number" },
            Type: "string",
            Required: "Y",
            Default: "{=Document:PHONE}"
          },
          message: {
            Name: { pt: "Mensagem", en: "Message" },
            Description: { pt: "Texto da mensagem a ser enviada", en: "Message text to send" },
            Type: "text",
            Required: "Y"
          }
        },
        RETURN_PROPERTIES: {
          status: {
            Name: { pt: "Status", en: "Status" },
            Type: "string"
          },
          message_id: {
            Name: { pt: "ID da Mensagem", en: "Message ID" },
            Type: "string"
          }
        },
        FILTER: {
          INCLUDE: [
            ["crm", "CCrmDocumentDeal"],
            ["crm", "CCrmDocumentLead"],
            ["crm", "CCrmDocumentContact"]
          ]
        }
      })
    });

    const registerResult = await registerResponse.json();
    console.log("bizproc.robot.add result:", JSON.stringify(registerResult));

    if (registerResult.error) {
      console.error("Registration error:", registerResult.error, registerResult.error_description);
      
      // If error is "Robot already exists", treat as success
      if (registerResult.error === "ERROR_ACTIVITY_ALREADY_INSTALLED" || 
          registerResult.error_description?.includes("already")) {
        await supabase
          .from("integrations")
          .update({
            config: {
              ...config,
              robot_code: robotCode,
              robot_registered: true,
            },
            updated_at: new Date().toISOString()
          })
          .eq("id", integration.id);

        return new Response(
          JSON.stringify({ 
            success: true, 
            message: "Robot de automação já existe no Bitrix24",
            robot_code: robotCode
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ error: registerResult.error_description || registerResult.error }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update integration config with robot info
    await supabase
      .from("integrations")
      .update({
        config: {
          ...config,
          robot_code: robotCode,
          robot_registered: true,
          robot_registered_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString()
      })
      .eq("id", integration.id);

    console.log("Automation robot registered successfully");

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Robot de automação registrado com sucesso! Agora você pode usar WhatsApp nas automações do CRM.",
        robot_code: robotCode,
        result: registerResult.result
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error registering automation robot:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erro ao registrar robot de automação" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// Handle reconfigure_connector action - Completely reconfigure connector with clean URLs
async function handleReconfigureConnector(supabase: any, payload: any, supabaseUrl: string) {
  console.log("=== RECONFIGURE CONNECTOR (Full Reset) ===");
  const { integration_id, line_id } = payload;

  if (!integration_id) {
    return new Response(
      JSON.stringify({ error: "Integration ID é obrigatório" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", integration_id)
    .single();

  if (integrationError || !integration) {
    console.error("Integration not found:", integrationError);
    return new Response(
      JSON.stringify({ error: "Integração não encontrada" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const accessToken = await refreshBitrixToken(integration, supabase);
  if (!accessToken) {
    return new Response(
      JSON.stringify({ error: "Token de acesso não disponível" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const config = integration.config;
  const clientEndpoint = config.client_endpoint || `https://${config.domain}/rest/`;
  
  // Use fixed connector ID - avoid duplicates
  const connectorId = "thoth_whatsapp";
  
  // CRITICAL: Use bitrix24-events (PUBLIC) for receiving Bitrix24 events
  const cleanWebhookUrl = `${supabaseUrl}/functions/v1/bitrix24-events`;
  
  // Default to LINE 2 if not specified (where "Thoth whatsapp" channel is configured)
  const targetLineId = line_id || 2;

  const results = {
    connector_unregistered: false,
    connector_registered: false,
    connector_activated: false,
    events_bound: false,
    data_set: false,
    errors: [] as string[],
  };

  try {
    // 1. Unregister existing connector (clean slate)
    console.log("Step 1: Unregistering existing connector...");
    try {
      const unregisterResponse = await fetch(`${clientEndpoint}imconnector.unregister`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: accessToken,
          ID: connectorId
        })
      });
      const unregisterResult = await unregisterResponse.json();
      console.log("Unregister result:", unregisterResult);
      results.connector_unregistered = true;
    } catch (e: any) {
      console.log("Unregister failed (may not exist):", e.message);
    }

    // 2. Register connector fresh with proper Marketplace-compliant icons
    console.log("Step 2: Registering connector fresh with Marketplace-compliant icons...");
    console.log("=== STEP 2 DETAILED DEBUG ===");
    console.log("clientEndpoint:", clientEndpoint);
    console.log("connectorId:", connectorId);
    console.log("accessToken length:", accessToken?.length || 0);
    console.log("accessToken first 20 chars:", accessToken?.substring(0, 20) || "N/A");
    
    // Thoth Ibis icon - Ibis inside speech bubble on WhatsApp green background
    const thothIbisSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="#25D366"/><circle cx="50" cy="45" r="30" fill="none" stroke="white" stroke-width="4"/><path d="M35 75 L50 90 L50 75" fill="white"/><g fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M50 65 C42 62, 36 52, 38 40 C40 30, 46 26, 52 26 C58 26, 64 32, 64 42 C64 52, 58 62, 50 65"/><path d="M48 26 C45 22, 38 18, 32 14"/><circle cx="30" cy="12" r="5"/><path d="M25 12 C22 16, 18 22, 16 28"/><circle cx="29" cy="11" r="1.5" fill="white"/></g></svg>`;
    const whatsappSvgIcon = btoa(thothIbisSvg);
    
    const registerPayload = {
      auth: accessToken,
      ID: connectorId,
      NAME: "Thoth WhatsApp",
      ICON: {
        DATA_IMAGE: `data:image/svg+xml;base64,${whatsappSvgIcon}`,
        COLOR: "#25D366",
        SIZE: "90%",
        POSITION: "center"
      },
      // Point to dedicated PLACEMENT_HANDLER
      PLACEMENT_HANDLER: `${supabaseUrl}/functions/v1/bitrix24-connector-settings`
    };
    
    console.log("Register URL:", `${clientEndpoint}imconnector.register`);
    console.log("Register payload (without auth):", JSON.stringify({ ...registerPayload, auth: "[REDACTED]" }, null, 2));
    
    try {
      const registerResponse = await fetch(`${clientEndpoint}imconnector.register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registerPayload)
      });
      
      console.log("Register response status:", registerResponse.status);
      console.log("Register response headers:", JSON.stringify(Object.fromEntries(registerResponse.headers.entries())));
      
      const registerResult = await registerResponse.json();
      console.log("Register result (FULL):", JSON.stringify(registerResult, null, 2));
      
      if (registerResult.result) {
        console.log("✅ Connector registered successfully!");
        results.connector_registered = true;
        
        // Save registration timestamp
        await supabase
          .from("integrations")
          .update({
            config: {
              ...config,
              connector_registered_at: new Date().toISOString(),
            }
          })
          .eq("id", integration.id);
          
      } else if (registerResult.error === "ERROR_CONNECTOR_ALREADY_EXISTS") {
        console.log("⚠️ Connector already exists - treating as success");
        results.connector_registered = true;
      } else if (registerResult.error) {
        console.error("❌ Register failed with error:", registerResult.error);
        console.error("Error description:", registerResult.error_description);
        results.errors.push(`Register: ${registerResult.error_description || registerResult.error}`);
        
        // Try alternative registration method if main fails
        console.log("Attempting alternative registration via imconnector.connector.data.set...");
      }
    } catch (e: any) {
      console.error("Register exception:", e);
      console.error("Error stack:", e.stack);
      results.errors.push(`Register: ${e.message}`);
    }

    // 3. Activate connector for target line
    console.log(`Step 3: Activating connector for LINE ${targetLineId}...`);
    try {
      const activateResponse = await fetch(`${clientEndpoint}imconnector.activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: accessToken,
          CONNECTOR: connectorId,
          LINE: targetLineId,
          ACTIVE: 1
        })
      });
      const activateResult = await activateResponse.json();
      console.log("Activate result:", activateResult);
      
      if (activateResult.result || !activateResult.error) {
        results.connector_activated = true;
      } else if (activateResult.error) {
        results.errors.push(`Activate: ${activateResult.error_description || activateResult.error}`);
      }
    } catch (e: any) {
      console.error("Activate error:", e);
      results.errors.push(`Activate: ${e.message}`);
    }

    // 4. Set connector data with CLEAN URL
    console.log("Step 4: Setting connector data with clean URL...");
    try {
      const dataSetResponse = await fetch(`${clientEndpoint}imconnector.connector.data.set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: accessToken,
          CONNECTOR: connectorId,
          LINE: targetLineId,
          DATA: {
            id: `${connectorId}_line_${targetLineId}`,
            url: cleanWebhookUrl,
            url_im: cleanWebhookUrl,
            name: "Thoth WhatsApp"
          }
        })
      });
      const dataSetResult = await dataSetResponse.json();
      console.log("Data set result:", dataSetResult);
      
      if (dataSetResult.result || !dataSetResult.error) {
        results.data_set = true;
      }
    } catch (e: any) {
      console.error("Data set error:", e);
    }

    // 4.5. Try to bind SETTING_CONNECTOR placement explicitly (for local apps)
    console.log("Step 4.5: Binding SETTING_CONNECTOR placement explicitly...");
    try {
      const placementUrl = `${supabaseUrl}/functions/v1/bitrix24-connector-settings`;
      const placementResponse = await fetch(`${clientEndpoint}placement.bind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: accessToken,
          PLACEMENT: "SETTING_CONNECTOR",
          HANDLER: placementUrl,
          TITLE: "Thoth WhatsApp Settings",
          DESCRIPTION: "Configure Thoth WhatsApp connector"
        })
      });
      const placementResult = await placementResponse.json();
      console.log("placement.bind SETTING_CONNECTOR result:", placementResult);
    } catch (e: any) {
      console.log("placement.bind failed (may require Marketplace app):", e.message);
    }

    // 5. Bind events with CLEAN URL (no query params!)
    console.log("Step 5: Binding events with CLEAN URL...");
    const events = [
      "OnImConnectorMessageAdd",
      "OnImConnectorDialogStart", 
      "OnImConnectorDialogFinish",
      "OnImConnectorStatusDelete",
    ];

    let eventsBound = 0;
    for (const event of events) {
      try {
        const bindResponse = await fetch(`${clientEndpoint}event.bind`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth: accessToken,
            event: event,
            handler: cleanWebhookUrl  // CLEAN URL - no query params!
          })
        });
        const bindResult = await bindResponse.json();
        console.log(`event.bind ${event}:`, bindResult);
        
        if (bindResult.result || !bindResult.error) {
          eventsBound++;
        }
      } catch (e: any) {
        console.error(`Event bind error for ${event}:`, e);
      }
    }
    results.events_bound = eventsBound === events.length;

    // 6. Update integration config
    console.log("Step 6: Updating integration config...");
    await supabase
      .from("integrations")
      .update({
        config: {
          ...config,
          connector_id: connectorId,
          line_id: String(targetLineId),
          activated_line_id: targetLineId,
          events_url: cleanWebhookUrl,
          reconfigured_at: new Date().toISOString(),
          connector_registered: results.connector_registered,
        },
        updated_at: new Date().toISOString()
      })
      .eq("id", integration.id);

    console.log("Reconfigure completed:", results);

    const success = results.connector_registered && results.connector_activated && results.events_bound;

    return new Response(
      JSON.stringify({
        success,
        message: success 
          ? `Conector reconfigurado com sucesso na LINE ${targetLineId}! Eventos vinculados com URL limpa.`
          : "Reconfiguração parcial. Verifique os erros.",
        results,
        webhook_url: cleanWebhookUrl,
        line_id: targetLineId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Reconfigure error:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Erro na reconfiguração",
        results 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// Handle auto_setup action - Automatically configure all Bitrix24 integrations
async function handleAutoSetup(supabase: any, payload: any, supabaseUrl: string) {
  console.log("=== AUTO SETUP (FULL RECONFIGURATION) ===");
  console.log("Timestamp:", new Date().toISOString());
  console.log("Payload:", JSON.stringify(payload, null, 2));
  const { integration_id, instance_id } = payload;

  if (!integration_id) {
    return new Response(
      JSON.stringify({ error: "Integration ID é obrigatório" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", integration_id)
    .single();

  if (integrationError || !integration) {
    console.error("Integration not found:", integrationError);
    return new Response(
      JSON.stringify({ error: "Integração não encontrada" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const accessToken = await refreshBitrixToken(integration, supabase);
  if (!accessToken) {
    return new Response(
      JSON.stringify({ error: "Token de acesso não disponível" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const config = integration.config;
  const clientEndpoint = config.client_endpoint || `https://${config.domain}/rest/`;
  
  // Use fixed connector ID to avoid duplicates
  const connectorId = "thoth_whatsapp";
  
  // CRITICAL: Use bitrix24-events (PUBLIC) for receiving Bitrix24 events
  // PLACEMENT_HANDLER for UI settings, but event.bind and connector.data.set use events URL
  const eventsUrl = `${supabaseUrl}/functions/v1/bitrix24-events`;
  const placementHandlerUrl = `${supabaseUrl}/functions/v1/bitrix24-connector-settings`;
  const effectiveInstanceId = instance_id || config.instance_id;

  const results = {
    connectors_cleaned: 0,
    events_cleaned: 0,
    connector_registered: false,
    lines_activated: 0,
    lines_total: 0,
    mappings_created: 0,
    sms_provider_registered: false,
    robot_registered: false,
    errors: [] as string[],
    warnings: [] as string[],
  };

  try {
    // STEP 0: CLEAN ALL DUPLICATE CONNECTORS FIRST (Critical for fixing duplicates!)
    console.log("Step 0: Cleaning duplicate connectors and events...");
    try {
      // List all existing connectors
      const listResponse = await fetch(`${clientEndpoint}imconnector.list`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auth: accessToken })
      });
      const listResult = await listResponse.json();
      console.log("Existing connectors:", JSON.stringify(listResult));

      const connectorsObj = listResult.result || {};
      const connectorIds = Object.keys(connectorsObj);
      
      // Find and remove ALL connectors with "thoth" or "whatsapp" in the ID
      for (const cId of connectorIds) {
        const cIdLower = cId.toLowerCase();
        if (cIdLower.includes("thoth") || cIdLower.includes("whatsapp")) {
          console.log(`Removing duplicate connector: ${cId}`);
          
          // First deactivate for all lines (0-10)
          for (let lineId = 0; lineId <= 10; lineId++) {
            try {
              await fetch(`${clientEndpoint}imconnector.deactivate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  auth: accessToken,
                  CONNECTOR: cId,
                  LINE: lineId
                })
              });
            } catch (e) {
              // Ignore errors
            }
          }
          
          // Then unregister
          try {
            const unregResponse = await fetch(`${clientEndpoint}imconnector.unregister`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ auth: accessToken, ID: cId })
            });
            const unregResult = await unregResponse.json();
            console.log(`Unregister ${cId}:`, unregResult);
            if (unregResult.result || !unregResult.error) {
              results.connectors_cleaned++;
            }
          } catch (e) {
            console.log(`Failed to unregister ${cId}`);
          }
        }
      }

      // Also clean duplicate events
      const eventsResponse = await fetch(`${clientEndpoint}event.get`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auth: accessToken })
      });
      const eventsResult = await eventsResponse.json();
      const boundEvents = eventsResult.result || [];
      
      // Find events pointing to our webhook and group by event name
      const eventsByName: Record<string, any[]> = {};
      for (const ev of boundEvents) {
        const handler = ev.handler || ev.HANDLER || "";
        if (handler.includes("bitrix24-webhook")) {
          const evName = ev.event || ev.EVENT;
          if (!eventsByName[evName]) {
            eventsByName[evName] = [];
          }
          eventsByName[evName].push(ev);
        }
      }

      // Remove duplicate events (keep only one per event type)
      for (const [evName, events] of Object.entries(eventsByName)) {
        if (events.length > 1) {
          console.log(`Cleaning ${events.length - 1} duplicate events for ${evName}`);
          for (let i = 1; i < events.length; i++) {
            try {
              await fetch(`${clientEndpoint}event.unbind`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  auth: accessToken,
                  event: evName,
                  handler: events[i].handler || events[i].HANDLER
                })
              });
              results.events_cleaned++;
            } catch (e) {
              // Ignore
            }
          }
        }
      }

      console.log(`Cleanup complete: ${results.connectors_cleaned} connectors, ${results.events_cleaned} events removed`);
    } catch (cleanupError) {
      console.error("Error during cleanup:", cleanupError);
      results.warnings.push("Limpeza parcial de conectores");
    }

    // 1. Register connector if not already registered with Marketplace-compliant icons
    // IMPORTANT: PLACEMENT_HANDLER is for the UI settings page, NOT for receiving events
    console.log("Step 1: Registering connector with PLACEMENT_HANDLER pointing to settings UI...");
    
    // Thoth Ibis icon
    const thothIbisSvg = "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDQ4IDQ4Ij48cmVjdCB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHJ4PSIxMiIgZmlsbD0iIzI1RDM2NiIvPjxwYXRoIGQ9Ik0zNCAyOGMtMS41IDItNCAxLTYgMHMtMy41LTMtNS01Yy0xLTEuNS0xLjUtMy41LTEtNS41LjUtMiAyLTMuNSA0LTRzNC0uNSA1LjUuNWMxLjUgMSAyLjUgMi41IDIuNSA0LjUgMCAxLjUtLjUgMy0xLjUgNC41TDMyIDI0bDItNHoiIGZpbGw9IiNmZmYiLz48Y2lyY2xlIGN4PSIzMCIgY3k9IjE2IiByPSIyIiBmaWxsPSIjMjVEMzY2Ii8+PHBhdGggZD0iTTE4IDM0Yy0yIDAtNC0xLTUtMy0xLTIgMC00IDItNWwyLTFjMSAwIDIgMSAyIDJ2M2MwIDEtLjUgMi0xIDIuNXMtMS41LjUtMiAuNXoiIGZpbGw9IiNmZmYiLz48L3N2Zz4=";
    const thothIbisSvgDisabled = "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDQ4IDQ4Ij48cmVjdCB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHJ4PSIxMiIgZmlsbD0iIzk5OTk5OSIvPjxwYXRoIGQ9Ik0zNCAyOGMtMS41IDItNCAxLTYgMHMtMy41LTMtNS01Yy0xLTEuNS0xLjUtMy41LTEtNS41LjUtMiAyLTMuNSA0LTRzNC0uNSA1LjUuNWMxLjUgMSAyLjUgMi41IDIuNSA0LjUgMCAxLjUtLjUgMy0xLjUgNC41TDMyIDI0bDItNHoiIGZpbGw9IiNmZmYiLz48Y2lyY2xlIGN4PSIzMCIgY3k9IjE2IiByPSIyIiBmaWxsPSIjOTk5OTk5Ii8+PHBhdGggZD0iTTE4IDM0Yy0yIDAtNC0xLTUtMy0xLTIgMC00IDItNWwyLTFjMSAwIDIgMSAyIDJ2M2MwIDEtLjUgMi0xIDIuNXMtMS41LjUtMiAuNXoiIGZpbGw9IiNmZmYiLz48L3N2Zz4=";
    
    try {
      const registerResponse = await fetch(`${clientEndpoint}imconnector.register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: accessToken,
          ID: connectorId,
          NAME: "Thoth WhatsApp",
          ICON: {
            DATA_IMAGE: `data:image/svg+xml;base64,${thothIbisSvg}`,
            COLOR: "#25D366",
            SIZE: "90%",
            POSITION: "center"
          },
          ICON_DISABLED: {
            DATA_IMAGE: `data:image/svg+xml;base64,${thothIbisSvgDisabled}`,
            COLOR: "#999999",
            SIZE: "90%",
            POSITION: "center"
          },
          // PLACEMENT_HANDLER is for UI settings page (when user clicks connector in Contact Center)
          PLACEMENT_HANDLER: placementHandlerUrl,
          // Indicate this is not for group chats
          CHAT_GROUP: "N"
        })
      });
      const registerResult = await registerResponse.json();
      console.log("Connector register result:", registerResult);
      
      if (registerResult.result || registerResult.error === "ERROR_CONNECTOR_ALREADY_EXISTS") {
        results.connector_registered = true;
      } else if (registerResult.error) {
        results.warnings.push(`Conector: ${registerResult.error_description || registerResult.error}`);
      }
    } catch (e: any) {
      console.error("Error registering connector:", e);
      results.warnings.push(`Conector: ${e.message}`);
    }

    // 2. Get Open Lines and activate connector for each
    console.log("Step 2: Getting Open Lines and activating connector...");
    try {
      const linesResponse = await fetch(`${clientEndpoint}imopenlines.config.list.get`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: accessToken,
          PARAMS: { select: ["ID", "LINE_NAME", "ACTIVE"] }
        })
      });
      const linesResult = await linesResponse.json();
      console.log("Open Lines result:", linesResult);

      const lines = linesResult.result || [];
      results.lines_total = lines.length;

      for (const line of lines) {
        const lineId = parseInt(line.ID);
        const lineName = line.LINE_NAME || `Canal ${lineId}`;
        
        try {
          // Activate connector for this line
          const activateResponse = await fetch(`${clientEndpoint}imconnector.activate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              auth: accessToken,
              CONNECTOR: connectorId,
              LINE: lineId,
              ACTIVE: 1
            })
          });
          const activateResult = await activateResponse.json();
          console.log(`Activate line ${lineId} result:`, activateResult);

          if (activateResult.result || !activateResult.error) {
            results.lines_activated++;

            // Set connector data - CRITICAL: use eventsUrl for receiving messages
            await fetch(`${clientEndpoint}imconnector.connector.data.set`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                auth: accessToken,
                CONNECTOR: connectorId,
                LINE: lineId,
                DATA: {
                  id: `${connectorId}_line_${lineId}`,
                  url: eventsUrl,
                  url_im: eventsUrl,
                  name: "Thoth WhatsApp"
                }
              })
            });

            // Create mapping if instance_id is provided
            if (effectiveInstanceId) {
              const { error: mappingError } = await supabase
                .from("bitrix_channel_mappings")
                .upsert({
                  workspace_id: integration.workspace_id,
                  integration_id: integration.id,
                  instance_id: effectiveInstanceId,
                  line_id: lineId,
                  line_name: lineName,
                  is_active: true,
                  updated_at: new Date().toISOString()
                }, { onConflict: "integration_id,line_id" });

              if (!mappingError) {
                results.mappings_created++;
              }
            }
          }
        } catch (lineError: any) {
          console.error(`Error activating line ${lineId}:`, lineError);
        }
      }
    } catch (e: any) {
      console.error("Error getting/activating lines:", e);
      results.errors.push(`Open Lines: ${e.message}`);
    }

    // 3. Register SMS Provider
    console.log("Step 3: Registering SMS Provider...");
    try {
      const smsProviderId = "thoth_whatsapp_sms";
      const smsResponse = await fetch(`${clientEndpoint}messageservice.sender.add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: accessToken,
          CODE: smsProviderId,
          TYPE: "SMS",
          NAME: "Thoth WhatsApp",
          DESCRIPTION: "Envio de mensagens WhatsApp via Thoth.ai",
          HANDLER: eventsUrl,
          CRM_SETTINGS: {
            CONTACT: "Y",
            COMPANY: "Y",
            LEAD: "Y",
            DEAL: "Y"
          }
        })
      });
      const smsResult = await smsResponse.json();
      console.log("SMS Provider result:", smsResult);

      if (smsResult.result || smsResult.error === "ERROR_PROVIDER_ALREADY_EXISTS") {
        results.sms_provider_registered = true;
      } else if (smsResult.error) {
        results.warnings.push(`SMS Provider: ${smsResult.error_description || smsResult.error}`);
      }
    } catch (e: any) {
      console.error("Error registering SMS provider:", e);
      results.warnings.push(`SMS Provider: ${e.message}`);
    }

    // 4. Try to register Automation Robot (optional - requires bizproc scope)
    console.log("Step 4: Attempting to register Automation Robot...");
    try {
      const robotCode = "thoth_whatsapp_robot";
      const robotResponse = await fetch(`${clientEndpoint}bizproc.robot.add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: accessToken,
          CODE: robotCode,
          HANDLER: eventsUrl,
          AUTH_USER_ID: 1,
          USE_SUBSCRIPTION: "Y",
          NAME: { pt: "Thoth WhatsApp - Enviar Mensagem", en: "Thoth WhatsApp - Send Message" },
          DESCRIPTION: { pt: "Envia mensagem WhatsApp", en: "Send WhatsApp message" },
          PROPERTIES: {
            phone: {
              Name: { pt: "Telefone", en: "Phone" },
              Type: "string",
              Required: "Y",
              Default: "{=Document:PHONE}"
            },
            message: {
              Name: { pt: "Mensagem", en: "Message" },
              Type: "text",
              Required: "Y"
            }
          },
          FILTER: {
            INCLUDE: [
              ["crm", "CCrmDocumentDeal"],
              ["crm", "CCrmDocumentLead"],
              ["crm", "CCrmDocumentContact"]
            ]
          }
        })
      });
      const robotResult = await robotResponse.json();
      console.log("Robot result:", robotResult);

      if (robotResult.result || robotResult.error === "ERROR_ACTIVITY_ALREADY_INSTALLED") {
        results.robot_registered = true;
      } else if (robotResult.error) {
        // This is expected if bizproc scope is not available
        results.warnings.push(`Robot: ${robotResult.error_description || robotResult.error} (adicione o escopo bizproc para habilitar)`);
      }
    } catch (e: any) {
      console.error("Error registering robot:", e);
      results.warnings.push(`Robot: ${e.message}`);
    }

    // 5. CRITICAL: Bind events for receiving messages from operators
    console.log("Step 5: Binding events with CLEAN webhook URL...");
    const eventsToBind = [
      "OnImConnectorMessageAdd",      // CRITICAL: When operator sends message to WhatsApp
      "OnImConnectorDialogStart",     // When dialog starts
      "OnImConnectorDialogFinish",    // When dialog finishes
      "OnImConnectorStatusDelete",    // When connector is removed
    ];

    let eventsBound = 0;
    for (const eventName of eventsToBind) {
      try {
        // First, unbind any existing handlers for this event to avoid duplicates
        const unbindResponse = await fetch(`${clientEndpoint}event.unbind`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth: accessToken,
            event: eventName,
            handler: eventsUrl
          })
        });
        console.log(`Unbind ${eventName}:`, await unbindResponse.json());

        // Now bind fresh
        const bindResponse = await fetch(`${clientEndpoint}event.bind`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth: accessToken,
            event: eventName,
            handler: eventsUrl
          })
        });
        const bindResult = await bindResponse.json();
        console.log(`Bind ${eventName}:`, bindResult);
        
        if (bindResult.result || bindResult.error === "HANDLER_ALREADY_BINDED") {
          eventsBound++;
        }
      } catch (bindError) {
        console.error(`Error binding ${eventName}:`, bindError);
      }
    }
    console.log(`Events bound: ${eventsBound}/${eventsToBind.length}`);

    // 6. Verify activation with imconnector.status for each activated line (with retry)
    console.log("Step 6: Verifying connector activation status with retry...");
    const verificationResults: Record<number, boolean> = {};
    
    // Wait a moment for Bitrix24 to process the activation
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
      const linesResponse = await fetch(`${clientEndpoint}imopenlines.config.list.get`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: accessToken,
          PARAMS: { select: ["ID", "LINE_NAME", "ACTIVE"] }
        })
      });
      const linesResult = await linesResponse.json();
      
      for (const line of (linesResult.result || [])) {
        const lineId = parseInt(line.ID);
        const lineName = line.LINE_NAME || `Canal ${lineId}`;
        
        // Retry activation up to 3 times with verification
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const statusResponse = await fetch(`${clientEndpoint}imconnector.status`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                auth: accessToken,
                CONNECTOR: connectorId,
                LINE: lineId
              })
            });
            const statusResult = await statusResponse.json();
            console.log(`Line ${lineId} status (attempt ${attempt}):`, JSON.stringify(statusResult));
            
            const isActive = statusResult.result?.active === true || 
                            statusResult.result?.ACTIVE === "Y" ||
                            statusResult.result?.status === true;
            
            if (isActive) {
              verificationResults[lineId] = true;
              console.log(`Line ${lineId} (${lineName}) is ACTIVE!`);
              break;
            }
            
            if (attempt < 3) {
              console.log(`Line ${lineId} not active yet, retrying activation (attempt ${attempt})...`);
              
              // Try to activate again
              await fetch(`${clientEndpoint}imconnector.activate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  auth: accessToken,
                  CONNECTOR: connectorId,
                  LINE: lineId,
                  ACTIVE: 1
                })
              });
              
              // Set connector data again (CRITICAL for activation)
              await fetch(`${clientEndpoint}imconnector.connector.data.set`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  auth: accessToken,
                  CONNECTOR: connectorId,
                  LINE: lineId,
                  DATA: {
                    id: `${connectorId}_line_${lineId}`,
                    url: eventsUrl,
                    url_im: eventsUrl,
                    name: "Thoth WhatsApp"
                  }
                })
              });
              
              // Wait before next verification
              await new Promise(resolve => setTimeout(resolve, 1500));
            } else {
              // Last attempt - record as not active
              verificationResults[lineId] = false;
              console.log(`Line ${lineId} (${lineName}) still NOT active after ${attempt} attempts`);
            }
          } catch (e) {
            console.error(`Error verifying line ${lineId} (attempt ${attempt}):`, e);
            if (attempt === 3) {
              verificationResults[lineId] = false;
            }
          }
        }
      }
    } catch (e) {
      console.error("Error in verification step:", e);
    }

    // 7. Update integration config with results
    console.log("Step 7: Updating integration config...");
    await supabase
      .from("integrations")
      .update({
        config: {
          ...config,
          instance_id: effectiveInstanceId || config.instance_id,
          connector_id: connectorId,
          connector_registered: results.connector_registered,
          sms_provider_registered: results.sms_provider_registered,
          robot_registered: results.robot_registered,
          auto_setup_completed: true,
          auto_setup_at: new Date().toISOString(),
          lines_activated: results.lines_activated,
          events_url: eventsUrl,
          events_bound: eventsBound,
          line_verification: verificationResults,
        },
        updated_at: new Date().toISOString()
      })
      .eq("id", integration.id);

    console.log("Auto setup completed:", results);
    console.log("Verification results:", verificationResults);

    // Calculate overall success - be more permissive
    // Success if: connector registered AND events bound (line verification may take time)
    const activeLines = Object.values(verificationResults).filter(v => v).length;
    const hasConnectorRegistered = results.connector_registered;
    const hasEvents = eventsBound > 0;
    const hasLinesActivated = results.lines_activated > 0;
    
    // Consider success if we have the essential parts configured
    // The line verification status may not immediately reflect the actual state
    const isSuccess = hasConnectorRegistered && hasEvents && hasLinesActivated;

    return new Response(
      JSON.stringify({
        success: isSuccess,
        message: isSuccess
          ? `Configuração concluída! ${results.lines_activated}/${results.lines_total} canais ativados. ${eventsBound} eventos vinculados.`
          : `Configuração parcial. Conector: ${hasConnectorRegistered ? 'OK' : 'FALHA'}. Eventos: ${eventsBound}. Canais: ${results.lines_activated}.`,
        results: {
          ...results,
          events_bound: eventsBound,
          line_verification: verificationResults,
        },
        webhook_url: eventsUrl,
        critical_info: {
          message: "Para receber mensagens do operador, o evento OnImConnectorMessageAdd DEVE estar vinculado.",
          events_bound: eventsBound,
          active_lines: activeLines,
          connector_registered: hasConnectorRegistered,
          lines_activated: results.lines_activated,
        }
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Auto setup error:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Erro na configuração automática",
        results 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// Handle force_activate action - Force activate connector for a specific line
// This is the definitive fix based on Bitrix24 documentation
async function handleForceActivate(supabase: any, payload: any, supabaseUrl: string) {
  console.log("=== FORCE ACTIVATE CONNECTOR ===");
  console.log("Payload:", JSON.stringify(payload, null, 2));
  
  const { integration_id, line_id } = payload;

  if (!integration_id || !line_id) {
    return new Response(
      JSON.stringify({ error: "integration_id e line_id são obrigatórios" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", integration_id)
    .single();

  if (integrationError || !integration) {
    console.error("Integration not found:", integrationError);
    return new Response(
      JSON.stringify({ error: "Integração não encontrada" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const accessToken = await refreshBitrixToken(integration, supabase);
  if (!accessToken) {
    return new Response(
      JSON.stringify({ error: "Token de acesso não disponível" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const config = integration.config;
  const clientEndpoint = config.client_endpoint || `https://${config.domain}/rest/`;
  const connectorId = config.connector_id || "thoth_whatsapp";
  // CRITICAL: Use bitrix24-events (public, no JWT) for event callbacks
  const eventsUrl = `${supabaseUrl}/functions/v1/bitrix24-events`;

  console.log("Force activating connector:", connectorId, "for line:", line_id);
  console.log("Using endpoint:", clientEndpoint);
  console.log("Events URL:", eventsUrl);

  const results = {
    activate: { success: false, result: null as any, error: null as any },
    dataSet: { success: false, result: null as any, error: null as any },
    status: { success: false, result: null as any, active: false },
  };

  try {
    // Step 1: Activate the connector for this line
    console.log("Step 1: Calling imconnector.activate...");
    const activateResponse = await fetch(`${clientEndpoint}imconnector.activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth: accessToken,
        CONNECTOR: connectorId,
        LINE: parseInt(line_id),
        ACTIVE: 1
      })
    });
    const activateResult = await activateResponse.json();
    console.log("imconnector.activate result:", JSON.stringify(activateResult, null, 2));
    
    results.activate.result = activateResult;
    results.activate.success = !!activateResult.result || !activateResult.error;
    if (activateResult.error) {
      results.activate.error = activateResult.error_description || activateResult.error;
    }

    // Step 2: CRITICAL - Set connector data (required by Bitrix24 documentation)
    console.log("Step 2: Calling imconnector.connector.data.set...");
    const dataSetResponse = await fetch(`${clientEndpoint}imconnector.connector.data.set`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth: accessToken,
        CONNECTOR: connectorId,
        LINE: parseInt(line_id),
        DATA: {
          id: `${connectorId}_line_${line_id}`,
          url: eventsUrl,
          url_im: eventsUrl,
          name: "Thoth WhatsApp"
        }
      })
    });
    const dataSetResult = await dataSetResponse.json();
    console.log("imconnector.connector.data.set result:", JSON.stringify(dataSetResult, null, 2));
    
    results.dataSet.result = dataSetResult;
    results.dataSet.success = !!dataSetResult.result || !dataSetResult.error;
    if (dataSetResult.error) {
      results.dataSet.error = dataSetResult.error_description || dataSetResult.error;
    }

    // Wait for Bitrix24 to process
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Step 3: Verify the status
    console.log("Step 3: Verifying with imconnector.status...");
    const statusResponse = await fetch(`${clientEndpoint}imconnector.status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth: accessToken,
        CONNECTOR: connectorId,
        LINE: parseInt(line_id)
      })
    });
    const statusResult = await statusResponse.json();
    console.log("imconnector.status result:", JSON.stringify(statusResult, null, 2));
    
    results.status.result = statusResult;
    results.status.success = !statusResult.error;
    results.status.active = statusResult.result?.active === true || 
                            statusResult.result?.ACTIVE === "Y" ||
                            statusResult.result?.connection === true;

    // If still not active, try one more time with a delay
    if (!results.status.active) {
      console.log("Connector still not active, retrying activation...");
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await fetch(`${clientEndpoint}imconnector.activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: accessToken,
          CONNECTOR: connectorId,
          LINE: parseInt(line_id),
          ACTIVE: 1
        })
      });

      await fetch(`${clientEndpoint}imconnector.connector.data.set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: accessToken,
          CONNECTOR: connectorId,
          LINE: parseInt(line_id),
          DATA: {
            id: `${connectorId}_line_${line_id}`,
            url: eventsUrl,
            url_im: eventsUrl,
            name: "Thoth WhatsApp"
          }
        })
      });

      // Check status again
      await new Promise(resolve => setTimeout(resolve, 1500));
      const finalStatusResponse = await fetch(`${clientEndpoint}imconnector.status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: accessToken,
          CONNECTOR: connectorId,
          LINE: parseInt(line_id)
        })
      });
      const finalStatusResult = await finalStatusResponse.json();
      console.log("Final status check:", JSON.stringify(finalStatusResult, null, 2));
      
      results.status.result = finalStatusResult;
      results.status.active = finalStatusResult.result?.active === true || 
                              finalStatusResult.result?.ACTIVE === "Y" ||
                              finalStatusResult.result?.connection === true;
    }

    const success = results.activate.success && results.dataSet.success;
    
    console.log("Force activate complete:", { success, active: results.status.active });

    return new Response(
      JSON.stringify({
        success,
        active: results.status.active,
        message: success 
          ? (results.status.active 
            ? "Conector ativado com sucesso!" 
            : "Comandos enviados. A ativação pode levar alguns segundos para refletir.")
          : "Erro na ativação",
        results,
        line_id: parseInt(line_id),
        connector_id: connectorId
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Force activate error:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Erro ao forçar ativação",
        results 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// Handle unregister_robot action - Remove automation robot from Bitrix24
async function handleUnregisterRobot(supabase: any, payload: any) {
  console.log("=== UNREGISTER AUTOMATION ROBOT ===");
  const { integration_id } = payload;

  if (!integration_id) {
    return new Response(
      JSON.stringify({ error: "Integration ID é obrigatório" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", integration_id)
    .single();

  if (integrationError || !integration) {
    console.error("Integration not found:", integrationError);
    return new Response(
      JSON.stringify({ error: "Integração não encontrada" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const accessToken = await refreshBitrixToken(integration, supabase);
  if (!accessToken) {
    return new Response(
      JSON.stringify({ error: "Token de acesso não disponível" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const config = integration.config;
  const clientEndpoint = config.client_endpoint || `https://${config.domain}/rest/`;
  const robotCode = config.robot_code || "thoth_whatsapp_robot";

  try {
    console.log("Removing automation robot:", robotCode);
    const deleteResponse = await fetch(`${clientEndpoint}bizproc.robot.delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth: accessToken,
        CODE: robotCode
      })
    });

    const deleteResult = await deleteResponse.json();
    console.log("bizproc.robot.delete result:", JSON.stringify(deleteResult));

    // Update integration config
    const { robot_code, robot_registered, robot_registered_at, ...restConfig } = config;
    await supabase
      .from("integrations")
      .update({
        config: {
          ...restConfig,
          robot_registered: false,
        },
        updated_at: new Date().toISOString()
      })
      .eq("id", integration.id);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Robot de automação removido com sucesso"
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error unregistering automation robot:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erro ao remover robot de automação" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// Handle robot execution - Called by Bitrix24 when automation robot is triggered
async function handleRobotExecution(supabase: any, payload: any, supabaseUrl: string) {
  console.log("=== ROBOT EXECUTION (from Bitrix24 automation) ===");
  console.log("Full payload:", JSON.stringify(payload, null, 2));

  // Extract data from Bitrix24's bizproc robot call
  const eventToken = payload.event_token || payload.EVENT_TOKEN;
  const documentId = payload.document_id || payload.DOCUMENT_ID;
  const documentType = payload.document_type || payload.DOCUMENT_TYPE;
  const properties = payload.properties || payload.PROPERTIES || {};
  const tsResult = payload.ts || payload.TS; // Timestamp result
  const workflowId = payload.workflow_id || payload.WORKFLOW_ID;

  // Get phone and message from properties
  const phone = properties.phone || properties.PHONE;
  const message = properties.message || properties.MESSAGE;

  console.log("Robot execution data:", { eventToken, documentId, documentType, phone, message, workflowId });

  if (!phone || !message) {
    console.error("Missing phone or message in robot execution");
    return new Response(
      JSON.stringify({ error: "Telefone e mensagem são obrigatórios" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Clean phone number
  const cleanPhone = phone.replace(/\D/g, "");
  console.log("Sending WhatsApp message to:", cleanPhone);

  // Find the integration by member_id or domain
  const memberId = payload.auth?.member_id || payload.member_id;
  const domain = payload.auth?.domain || payload.DOMAIN;

  let integration = null;
  if (memberId) {
    const { data } = await supabase
      .from("integrations")
      .select("*")
      .eq("type", "bitrix24")
      .eq("config->>member_id", memberId)
      .maybeSingle();
    integration = data;
  }

  if (!integration && domain) {
    const { data } = await supabase
      .from("integrations")
      .select("*")
      .eq("type", "bitrix24")
      .ilike("config->>domain", `%${domain}%`)
      .maybeSingle();
    integration = data;
  }

  if (!integration) {
    // Try to find any active integration
    const { data } = await supabase
      .from("integrations")
      .select("*")
      .eq("type", "bitrix24")
      .eq("is_active", true)
      .maybeSingle();
    integration = data;
  }

  if (!integration) {
    console.error("No Bitrix24 integration found for robot execution");
    return new Response(
      JSON.stringify({ error: "Integração não encontrada" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Find instance to send from
  const instanceId = integration.config?.instance_id;

  if (!instanceId) {
    console.error("No instance configured for robot execution");
    return new Response(
      JSON.stringify({ error: "Nenhuma instância WhatsApp configurada" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Send message via wapi-send-message
  let sendResult: any = null;
  try {
    const sendResponse = await fetch(`${supabaseUrl}/functions/v1/wapi-send-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instance_id: instanceId,
        phone_number: cleanPhone,
        message: message,
        message_type: "text",
        workspace_id: integration.workspace_id,
        internal_call: true, // Skip JWT validation
      })
    });

    sendResult = await sendResponse.json();
    console.log("WhatsApp send result for robot:", sendResult);
  } catch (error) {
    console.error("Error sending WhatsApp message from robot:", error);
    sendResult = { error: error instanceof Error ? error.message : "Erro ao enviar mensagem" };
  }

  // Send completion event back to Bitrix24 if event_token is present
  if (eventToken && integration.config?.access_token) {
    try {
      const accessToken = await refreshBitrixToken(integration, supabase);
      const clientEndpoint = integration.config.client_endpoint || `https://${integration.config.domain}/rest/`;

      console.log("Sending bizproc.event.send to complete workflow...");
      const eventResponse = await fetch(`${clientEndpoint}bizproc.event.send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: accessToken,
          EVENT_TOKEN: eventToken,
          RETURN_VALUES: {
            status: sendResult?.error ? "error" : "sent",
            message_id: sendResult?.message_id || sendResult?.id || ""
          }
        })
      });

      const eventResult = await eventResponse.json();
      console.log("bizproc.event.send result:", eventResult);
    } catch (error) {
      console.error("Error sending bizproc event:", error);
    }
  }

  // Return result
  if (sendResult?.error) {
    return new Response(
      JSON.stringify({ 
        success: false,
        error: sendResult.error 
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ 
      success: true,
      message_id: sendResult?.message_id || sendResult?.id,
      status: "sent"
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// Handle send_sms action - Called by Bitrix24 when sending SMS via our provider
async function handleSendSms(supabase: any, payload: any, supabaseUrl: string) {
  console.log("=== SEND SMS (from Bitrix24 automation) ===");
  console.log("Payload:", JSON.stringify(payload, null, 2));

  // Extract data from Bitrix24's messageservice call
  const phoneNumber = payload.PHONE_NUMBER || payload.phone || payload.MESSAGE_TO;
  const message = payload.MESSAGE_BODY || payload.message || payload.MESSAGE;
  const entityType = payload.ENTITY_TYPE || payload.entity_type; // CONTACT, LEAD, DEAL
  const entityId = payload.ENTITY_ID || payload.entity_id;

  if (!phoneNumber || !message) {
    console.error("Missing phone or message");
    return new Response(
      JSON.stringify({ error: "Número de telefone e mensagem são obrigatórios" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Clean phone number
  const cleanPhone = phoneNumber.replace(/\D/g, "");
  console.log("Sending WhatsApp message to:", cleanPhone);

  // Find the integration by member_id or domain
  const memberId = payload.auth?.member_id || payload.member_id;
  const domain = payload.auth?.domain || payload.DOMAIN;

  let integration = null;
  if (memberId) {
    const { data } = await supabase
      .from("integrations")
      .select("*")
      .eq("type", "bitrix24")
      .eq("config->>member_id", memberId)
      .maybeSingle();
    integration = data;
  }

  if (!integration && domain) {
    const { data } = await supabase
      .from("integrations")
      .select("*")
      .eq("type", "bitrix24")
      .ilike("config->>domain", `%${domain}%`)
      .maybeSingle();
    integration = data;
  }

  if (!integration) {
    // Try to find any active integration
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
      JSON.stringify({ error: "Integração não encontrada" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Find instance to send from
  const instanceId = integration.config?.instance_id;

  if (!instanceId) {
    console.error("No instance configured");
    return new Response(
      JSON.stringify({ error: "Nenhuma instância WhatsApp configurada" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Send message via wapi-send-message
  try {
    const sendResponse = await fetch(`${supabaseUrl}/functions/v1/wapi-send-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instance_id: instanceId,
        phone_number: cleanPhone,
        message: message,
        message_type: "text",
        workspace_id: integration.workspace_id,
      })
    });

    const sendResult = await sendResponse.json();
    console.log("WhatsApp send result:", sendResult);

    if (sendResult.error) {
      return new Response(
        JSON.stringify({ 
          STATUS: "ERROR",
          error: sendResult.error 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Return success in Bitrix24 expected format
    return new Response(
      JSON.stringify({ 
        STATUS: "SENT",
        MESSAGE_ID: sendResult.message_id || sendResult.id,
        success: true
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error sending SMS via WhatsApp:", error);
    return new Response(
      JSON.stringify({ 
        STATUS: "ERROR",
        error: error instanceof Error ? error.message : "Erro ao enviar mensagem" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// Handle verify_integration action - Complete verification AND auto-fix of Bitrix24 integration
// This is AGGRESSIVE auto-correction - it will fix ALL problems automatically
async function handleVerifyIntegration(supabase: any, payload: any, supabaseUrl: string) {
  console.log("=== VERIFY AND AUTO-FIX INTEGRATION ===");
  const { integration_id, auto_fix = true } = payload; // auto_fix defaults to true for aggressive correction

  if (!integration_id) {
    return new Response(
      JSON.stringify({ error: "Integration ID não fornecido" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", integration_id)
    .single();

  if (integrationError || !integration) {
    return new Response(
      JSON.stringify({ error: "Integração não encontrada" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const accessToken = await refreshBitrixToken(integration, supabase);
  if (!accessToken) {
    return new Response(
      JSON.stringify({ error: "Token de acesso não disponível" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const config = integration.config;
  const clientEndpoint = config.client_endpoint || `https://${config.domain}/rest/`;
  const connectorId = config.connector_id || "thoth_whatsapp";
  // Use bitrix24-events for webhook URL (public, no JWT)
  const webhookUrl = `${supabaseUrl}/functions/v1/bitrix24-events`;

  const verification = {
    connector_id: connectorId,
    domain: config.domain,
    token_valid: true,
    connectors: [] as any[],
    duplicate_connectors: [] as string[],
    events: [] as any[],
    duplicate_events: 0,
    lines: [] as any[],
    mappings: [] as any[],
    issues: [] as string[],
    recommendations: [] as string[],
    fixes_applied: [] as string[],
  };

  try {
    // ========== STEP 1: LIST AND CLEAN DUPLICATE CONNECTORS ==========
    console.log("Step 1: Listing all connectors...");
    const listResponse = await fetch(`${clientEndpoint}imconnector.list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth: accessToken })
    });
    const listResult = await listResponse.json();
    console.log("Connectors:", JSON.stringify(listResult));

    const connectorsObj = listResult.result || {};
    verification.connectors = Object.keys(connectorsObj).map(id => ({
      id,
      name: connectorsObj[id]?.NAME || connectorsObj[id]?.name || id
    }));

    // ========== STEP 2: CHECK IF MAIN CONNECTOR IS REGISTERED, IF NOT - REGISTER IT ==========
    // IMPORTANT: Do this FIRST before any cleanup to ensure we have a working connector
    const mainConnectorExists = verification.connectors.some(c => c.id === connectorId);
    
    // Thoth Ibis icon URL - beautiful ibis inside WhatsApp-style speech bubble on green background
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    const PROJECT_ID = SUPABASE_URL.includes("supabase.co") ? SUPABASE_URL.split("//")[1]?.split(".")[0] : "ybqwwipwimnkonnebbys";
    const THOTH_WHATSAPP_ICON_URL = `https://${PROJECT_ID}.supabase.co/storage/v1/object/public/assets/thoth-whatsapp-icon.png`;
    
    if (!mainConnectorExists && auto_fix) {
      console.log("AUTO-FIX: Main connector not registered, registering now...");
      try {
        const registerResponse = await fetch(`${clientEndpoint}imconnector.register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth: accessToken,
            ID: connectorId,
            NAME: "Thoth WhatsApp",
            ICON: THOTH_WHATSAPP_ICON_URL,
            PLACEMENT_HANDLER: webhookUrl,
            CHAT_GROUP: "N"
          })
        });
        const registerResult = await registerResponse.json();
        console.log("Register result:", registerResult);
        
        if (registerResult.result) {
          verification.fixes_applied.push("Conector principal registrado");
          verification.connectors.push({ id: connectorId, name: "Thoth WhatsApp" });
        } else if (registerResult.error === "ERROR_CONNECTOR_ALREADY_EXISTS") {
          // Connector exists, just add to list
          verification.connectors.push({ id: connectorId, name: "Thoth WhatsApp" });
        } else {
          console.error("Failed to register connector:", registerResult);
          verification.issues.push(`Falha ao registrar conector: ${registerResult.error_description || registerResult.error || "Erro desconhecido"}`);
        }
      } catch (e: unknown) {
        console.error("Error registering connector:", e);
        verification.issues.push(`Erro ao registrar conector: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Check for OUR duplicate connectors only (NOT Bitrix24 native ones!)
    // IMPORTANT: Only remove connectors that start with "thoth" - never touch native connectors
    const BITRIX_NATIVE_CONNECTORS = [
      "livechat", "viber", "telegrambot", "telegram", "imessage", 
      "facebook", "facebookcomments", "fbinstagramdirect", "network", 
      "notifications", "whatsappbytwilio", "whatsappbyedna", "whatsapp",
      "vkgroup", "vkgrouporder", "avito", "olx", "yandex"
    ];
    
    const thothConnectors = verification.connectors.filter(c => {
      const id = c.id.toLowerCase();
      // Only consider as "ours" if it contains "thoth" 
      // NEVER touch native Bitrix24 connectors or third-party integrations
      return id.includes("thoth");
    });
    
    // Only remove duplicates if we have more than one thoth connector AND the main one exists
    const mainConnectorNowExists = verification.connectors.some(c => c.id === connectorId);
    
    if (thothConnectors.length > 1 && mainConnectorNowExists && auto_fix) {
      console.log("AUTO-FIX: Removing duplicate THOTH connectors only...");
      const duplicates = thothConnectors.filter(c => c.id !== connectorId);
      
      for (const dup of duplicates) {
        console.log(`AUTO-FIX: Removing duplicate thoth connector: ${dup.id}`);
        try {
          // First deactivate from all lines
          for (let lineId = 1; lineId <= 10; lineId++) {
            await fetch(`${clientEndpoint}imconnector.activate`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ auth: accessToken, CONNECTOR: dup.id, LINE: lineId, ACTIVE: 0 })
            });
          }
          // Then unregister
          await fetch(`${clientEndpoint}imconnector.unregister`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ auth: accessToken, ID: dup.id })
          });
          verification.fixes_applied.push(`Removido conector thoth duplicado: ${dup.id}`);
        } catch (e) {
          console.error(`Error removing ${dup.id}:`, e);
        }
      }
      verification.duplicate_connectors = duplicates.map(c => c.id);
      verification.connectors = verification.connectors.filter(c => 
        !duplicates.some(d => d.id === c.id)
      );
    }

    // ========== STEP 3: GET OPEN LINES AND CHECK/ACTIVATE CONNECTOR ==========
    console.log("Step 3: Checking and activating Open Lines...");
    const linesResponse = await fetch(`${clientEndpoint}imopenlines.config.list.get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth: accessToken, PARAMS: { select: ["ID", "LINE_NAME", "ACTIVE"] } })
    });
    const linesResult = await linesResponse.json();
    
    for (const line of (linesResult.result || [])) {
      const lineId = parseInt(line.ID);
      const lineName = line.LINE_NAME || `Canal ${lineId}`;
      const isLineActive = line.ACTIVE === "Y";
      
      // Check connector status for this line
      const statusResponse = await fetch(`${clientEndpoint}imconnector.status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auth: accessToken, CONNECTOR: connectorId, LINE: lineId })
      });
      const statusResult = await statusResponse.json();
      console.log(`Status for line ${lineId}:`, JSON.stringify(statusResult));

      const result = statusResult.result || {};
      let isActive = result.STATUS === true || result.active === true || result.ACTIVE === "Y";
      let isRegistered = result.CONFIGURED === true || result.register === true || result.REGISTER === "Y";
      const hasConnection = result.ERROR === false;
      
      // AUTO-FIX: If line is active but connector is not active, activate it
      if (isLineActive && (!isActive || !isRegistered) && auto_fix) {
        console.log(`AUTO-FIX: Activating connector for line ${lineId}...`);
        try {
          // Activate connector
          await fetch(`${clientEndpoint}imconnector.activate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ auth: accessToken, CONNECTOR: connectorId, LINE: lineId, ACTIVE: 1 })
          });
          
          // Set connector data
          await fetch(`${clientEndpoint}imconnector.connector.data.set`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              auth: accessToken,
              CONNECTOR: connectorId,
              LINE: lineId,
              DATA: { id: `${connectorId}_line_${lineId}`, url: webhookUrl, url_im: webhookUrl, name: "Thoth WhatsApp" }
            })
          });
          
          verification.fixes_applied.push(`Conector ativado na linha ${lineName}`);
          isActive = true;
          isRegistered = true;
        } catch (e) {
          console.error(`Error activating line ${lineId}:`, e);
        }
      }
      
      verification.lines.push({
        id: lineId,
        name: lineName,
        active: isLineActive,
        connector_active: isActive,
        connector_registered: isRegistered,
        connector_connection: hasConnection,
      });
    }

    // ========== STEP 4: CHECK AND BIND MISSING EVENTS ==========
    console.log("Step 4: Checking and binding events...");
    const eventsResponse = await fetch(`${clientEndpoint}event.get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth: accessToken })
    });
    const eventsResult = await eventsResponse.json();
    
    const ourEvents = (eventsResult.result || []).filter((e: any) => 
      (e.handler || e.HANDLER || "").includes("bitrix24")
    );
    
    verification.events = ourEvents.map((e: any) => ({
      event: e.event || e.EVENT,
      handler: e.handler || e.HANDLER
    }));

    // Required events
    const requiredEvents = [
      "OnImConnectorMessageAdd",
      "OnImConnectorDialogStart",
      "OnImConnectorDialogFinish",
      "OnImConnectorStatusDelete"
    ];
    
    // Check and bind missing events
    for (const eventName of requiredEvents) {
      const hasEvent = ourEvents.some((e: any) => 
        (e.event || e.EVENT).toUpperCase() === eventName.toUpperCase()
      );
      
      if (!hasEvent && auto_fix) {
        console.log(`AUTO-FIX: Binding missing event ${eventName}...`);
        try {
          const bindResponse = await fetch(`${clientEndpoint}event.bind`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ auth: accessToken, event: eventName, handler: webhookUrl })
          });
          const bindResult = await bindResponse.json();
          
          if (bindResult.result || bindResult.error === "HANDLER_ALREADY_BINDED") {
            verification.fixes_applied.push(`Evento ${eventName} vinculado`);
            verification.events.push({ event: eventName, handler: webhookUrl });
          }
        } catch (e) {
          console.error(`Error binding ${eventName}:`, e);
        }
      }
    }

    // Check for duplicate events and clean them
    const eventCounts: Record<string, { count: number; handlers: string[] }> = {};
    for (const e of ourEvents) {
      const evName = (e.event || e.EVENT).toUpperCase();
      if (!eventCounts[evName]) {
        eventCounts[evName] = { count: 0, handlers: [] };
      }
      eventCounts[evName].count++;
      eventCounts[evName].handlers.push(e.handler || e.HANDLER);
    }
    
    // AUTO-FIX: Remove duplicate event handlers
    for (const [evName, info] of Object.entries(eventCounts)) {
      if (info.count > 1 && auto_fix) {
        console.log(`AUTO-FIX: Cleaning ${info.count - 1} duplicate handlers for ${evName}...`);
        verification.duplicate_events += info.count - 1;
        
        // Keep only the clean URL, remove others
        const cleanHandler = info.handlers.find(h => !h.includes("?")) || info.handlers[0];
        const duplicateHandlers = info.handlers.filter(h => h !== cleanHandler);
        
        for (const dupHandler of duplicateHandlers) {
          try {
            await fetch(`${clientEndpoint}event.unbind`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ auth: accessToken, event: evName, handler: dupHandler })
            });
            verification.fixes_applied.push(`Evento duplicado ${evName} removido`);
          } catch (e) {
            console.error(`Error unbinding ${evName}:`, e);
          }
        }
      }
    }

    // ========== STEP 5: GET DATABASE MAPPINGS ==========
    console.log("Step 5: Getting database mappings...");
    const { data: mappings } = await supabase
      .from("bitrix_channel_mappings")
      .select(`line_id, line_name, instance_id, is_active, instances (id, name, phone_number, status)`)
      .eq("integration_id", integration_id);

    verification.mappings = (mappings || []).map((m: any) => ({
      line_id: m.line_id,
      line_name: m.line_name,
      instance_id: m.instance_id,
      instance_name: m.instances?.name,
      instance_status: m.instances?.status,
      is_active: m.is_active
    }));

    // ========== FINAL ASSESSMENT ==========
    // Re-check for any remaining issues after auto-fix
    const activeLines = verification.lines.filter(l => l.active);
    const inactiveConnectors = activeLines.filter(l => !l.connector_active);
    const unregisteredConnectors = activeLines.filter(l => !l.connector_registered);
    
    const hasMessageEvent = verification.events.some((e: any) => 
      e.event.toUpperCase() === "ONIMCONNECTORMESSAGEADD"
    );

    if (unregisteredConnectors.length > 0) {
      verification.issues.push(`Conector não registrado em ${unregisteredConnectors.length} linha(s)`);
    }
    if (inactiveConnectors.length > 0) {
      verification.issues.push(`Conector inativo em ${inactiveConnectors.length} linha(s)`);
    }
    if (!hasMessageEvent) {
      verification.issues.push("Evento OnImConnectorMessageAdd não configurado");
    }

    // Separate critical issues from warnings
    const criticalIssues = verification.issues.filter(issue => 
      !issue.includes("duplicado") && !issue.includes("duplicate") && !issue.includes("removido")
    );
    const warnings = verification.issues.filter(issue => 
      issue.includes("duplicado") || issue.includes("duplicate") || issue.includes("removido")
    );

    const healthy = criticalIssues.length === 0;

    // Generate summary
    let summary = "";
    if (healthy) {
      if (verification.fixes_applied.length > 0) {
        summary = `✅ Corrigido automaticamente (${verification.fixes_applied.length} correção(ões))`;
      } else if (warnings.length > 0) {
        summary = `Funcionando com ${warnings.length} aviso(s)`;
      } else {
        summary = "Integração funcionando corretamente";
      }
    } else {
      summary = `${criticalIssues.length} problema(s) não corrigido(s)`;
    }

    console.log("Verification complete:", { healthy, fixes_applied: verification.fixes_applied.length, issues: criticalIssues.length });

    return new Response(
      JSON.stringify({
        success: true,
        healthy,
        verification: { ...verification, warnings },
        summary,
        fixes_applied: verification.fixes_applied,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error verifying integration:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erro na verificação" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// Handle get_bound_events action - List all events bound to our webhook
async function handleGetBoundEvents(supabase: any, payload: any) {
  console.log("=== GET BOUND EVENTS ===");
  const { integration_id } = payload;

  if (!integration_id) {
    return new Response(
      JSON.stringify({ error: "Integration ID é obrigatório" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", integration_id)
    .single();

  if (integrationError || !integration) {
    console.error("Integration not found:", integrationError);
    return new Response(
      JSON.stringify({ error: "Integração não encontrada" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const accessToken = await refreshBitrixToken(integration, supabase);
  if (!accessToken) {
    return new Response(
      JSON.stringify({ error: "Token de acesso não disponível" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const config = integration.config;
  const clientEndpoint = config.client_endpoint || `https://${config.domain}/rest/`;

  try {
    console.log("Fetching events from Bitrix24...");
    const eventsResponse = await fetch(`${clientEndpoint}event.get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth: accessToken })
    });
    const eventsResult = await eventsResponse.json();
    console.log("Events result:", JSON.stringify(eventsResult, null, 2));

    if (eventsResult.error) {
      return new Response(
        JSON.stringify({ error: eventsResult.error_description || eventsResult.error }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Filter our events (those pointing to bitrix24-webhook)
    const ourEvents = (eventsResult.result || []).filter((e: any) => 
      (e.handler || e.HANDLER || "").includes("bitrix24-webhook")
    );

    // Group by event type to identify duplicates
    const eventsByType: Record<string, any[]> = {};
    for (const e of ourEvents) {
      const eventName = (e.event || e.EVENT).toUpperCase();
      if (!eventsByType[eventName]) {
        eventsByType[eventName] = [];
      }
      eventsByType[eventName].push({
        event: e.event || e.EVENT,
        handler: e.handler || e.HANDLER,
        auth_type: e.auth_type || e.AUTH_TYPE,
        offline: e.offline || e.OFFLINE
      });
    }

    // Identify duplicates (events with same type but different handlers)
    const duplicates: any[] = [];
    for (const [eventName, handlers] of Object.entries(eventsByType)) {
      if (handlers.length > 1) {
        duplicates.push({
          event: eventName,
          count: handlers.length,
          handlers: handlers.map((h: any) => h.handler)
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        events: ourEvents,
        events_by_type: eventsByType,
        duplicates,
        total_events: ourEvents.length,
        duplicate_count: duplicates.reduce((sum, d) => sum + d.count - 1, 0)
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error fetching events:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erro ao buscar eventos" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// Handle cleanup_duplicate_events action - Remove duplicate events keeping only those with CLEAN URLs (no query params)
async function handleCleanupDuplicateEvents(supabase: any, payload: any, supabaseUrl: string) {
  console.log("=== CLEANUP DUPLICATE EVENTS ===");
  const { integration_id, dry_run = false } = payload;

  if (!integration_id) {
    return new Response(
      JSON.stringify({ error: "Integration ID é obrigatório" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", integration_id)
    .single();

  if (integrationError || !integration) {
    console.error("Integration not found:", integrationError);
    return new Response(
      JSON.stringify({ error: "Integração não encontrada" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const accessToken = await refreshBitrixToken(integration, supabase);
  if (!accessToken) {
    return new Response(
      JSON.stringify({ error: "Token de acesso não disponível" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const config = integration.config;
  const clientEndpoint = config.client_endpoint || `https://${config.domain}/rest/`;
  const cleanWebhookUrl = `${supabaseUrl}/functions/v1/bitrix24-webhook`;

  try {
    // Get all events
    console.log("Fetching events from Bitrix24...");
    const eventsResponse = await fetch(`${clientEndpoint}event.get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth: accessToken })
    });
    const eventsResult = await eventsResponse.json();

    if (eventsResult.error) {
      return new Response(
        JSON.stringify({ error: eventsResult.error_description || eventsResult.error }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Filter our events
    const ourEvents = (eventsResult.result || []).filter((e: any) => 
      (e.handler || e.HANDLER || "").includes("bitrix24-webhook")
    );

    console.log("Found events:", ourEvents.length);

    // NEW LOGIC: Keep CLEAN URLs (no query params), remove those WITH query params
    // This is the INVERTED logic - we now standardize on clean URLs
    const eventsToRemove: any[] = [];
    const eventsToKeep: any[] = [];
    const seenCleanEvents: Set<string> = new Set();

    // Sort events: prefer those WITHOUT query params (shorter/cleaner URLs)
    const sortedEvents = [...ourEvents].sort((a, b) => {
      const urlA = a.handler || a.HANDLER || "";
      const urlB = b.handler || b.HANDLER || "";
      return urlA.length - urlB.length; // Shorter URLs first (clean, no params)
    });

    for (const event of sortedEvents) {
      const eventName = (event.event || event.EVENT).toUpperCase();
      const handler = event.handler || event.HANDLER || "";
      
      // Check if handler has query params (workspace_id, connector_id, etc.)
      const hasQueryParams = handler.includes("?") || handler.includes("workspace_id=") || handler.includes("connector_id=");

      if (hasQueryParams) {
        // Events WITH query params should be REMOVED (old pattern)
        eventsToRemove.push({
          event: eventName,
          handler: handler,
          reason: "has_query_params"
        });
      } else if (seenCleanEvents.has(eventName)) {
        // Duplicate clean event - remove it
        eventsToRemove.push({
          event: eventName,
          handler: handler,
          reason: "duplicate_clean"
        });
      } else {
        // Clean URL, first occurrence - KEEP
        seenCleanEvents.add(eventName);
        eventsToKeep.push({ event: eventName, handler });
      }
    }

    console.log("Events to remove:", eventsToRemove.length);
    console.log("Events to keep:", eventsToKeep.length);

    if (dry_run) {
      return new Response(
        JSON.stringify({
          success: true,
          dry_run: true,
          events_to_remove: eventsToRemove,
          events_to_keep: eventsToKeep,
          summary: `${eventsToRemove.length} eventos seriam removidos, ${eventsToKeep.length} seriam mantidos`
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Actually remove the events
    const removeResults: any[] = [];
    for (const event of eventsToRemove) {
      try {
        console.log(`Removing event: ${event.event} -> ${event.handler}`);
        const unbindResponse = await fetch(`${clientEndpoint}event.unbind`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth: accessToken,
            event: event.event,
            handler: event.handler
          })
        });
        const unbindResult = await unbindResponse.json();
        removeResults.push({
          event: event.event,
          handler: event.handler,
          success: !unbindResult.error,
          result: unbindResult.result,
          error: unbindResult.error
        });
      } catch (e) {
        console.error(`Failed to remove event ${event.event}:`, e);
        removeResults.push({
          event: event.event,
          handler: event.handler,
          success: false,
          error: e instanceof Error ? e.message : "Unknown error"
        });
      }
    }

    const successCount = removeResults.filter(r => r.success).length;

    return new Response(
      JSON.stringify({
        success: true,
        removed: successCount,
        failed: removeResults.length - successCount,
        results: removeResults,
        events_kept: eventsToKeep,
        summary: `${successCount} de ${eventsToRemove.length} eventos removidos com sucesso`
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error cleaning up events:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erro ao limpar eventos" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

/**
 * Handle rebind_events_to_new_url action
 * Migrates all Bitrix24 event bindings from old webhook URL to new bitrix24-events URL
 */
async function handleRebindEventsToNewUrl(supabase: any, payload: any, supabaseUrl: string) {
  console.log("=== REBIND EVENTS TO NEW URL ===");
  console.log("Payload:", JSON.stringify(payload, null, 2));

  const { integration_id } = payload;

  if (!integration_id) {
    return new Response(
      JSON.stringify({ error: "Integration ID não fornecido" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", integration_id)
    .single();

  if (integrationError || !integration) {
    console.error("Integration not found:", integrationError);
    return new Response(
      JSON.stringify({ error: "Integração não encontrada" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const accessToken = await refreshBitrixToken(integration, supabase);
  if (!accessToken) {
    return new Response(
      JSON.stringify({ error: "Token de acesso não disponível" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const config = integration.config;
  const clientEndpoint = config.client_endpoint || `https://${config.domain}/rest/`;
  
  // Old URL (webhook) and new URL (events - public endpoint)
  const oldWebhookUrl = `${supabaseUrl}/functions/v1/bitrix24-webhook`;
  const newEventsUrl = `${supabaseUrl}/functions/v1/bitrix24-events`;

  console.log("Old webhook URL:", oldWebhookUrl);
  console.log("New events URL:", newEventsUrl);
  console.log("Client endpoint:", clientEndpoint);

  const results = {
    events_unbound: [] as any[],
    events_bound: [] as any[],
    errors: [] as string[],
  };

  try {
    // 1. Get all current event bindings
    console.log("Step 1: Fetching current event bindings...");
    const eventsResponse = await fetch(`${clientEndpoint}event.get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth: accessToken })
    });
    const eventsResult = await eventsResponse.json();
    console.log("Current events:", JSON.stringify(eventsResult, null, 2));

    const currentEvents = eventsResult.result || [];
    
    // 2. Find events bound to old webhook URL
    const eventsToMigrate = currentEvents.filter((e: any) => 
      e.handler && (
        e.handler.includes("/bitrix24-webhook") || 
        e.handler.includes("bitrix24-webhook")
      )
    );

    console.log(`Found ${eventsToMigrate.length} events to migrate`);

    // 3. Events that should be migrated to new endpoint
    const eventNamesToMigrate = [
      "ONIMCONNECTORMESSAGEADD",
      "OnImConnectorMessageAdd",
      "ONIMCONNECTORMESSAGERECEIVE",
      "OnImConnectorMessageReceive",
      "ONIMBOTMESSAGEADD",
      "OnImBotMessageAdd",
      "ONIMBOTJOINOPEN",
      "OnImBotJoinOpen",
      "ONIMCONNECTORDIALOGSTART",
      "OnImConnectorDialogStart",
      "ONIMCONNECTORDIALOGFINISH",
      "OnImConnectorDialogFinish",
      "ONIMCONNECTORSTATUSDELETE",
      "OnImConnectorStatusDelete",
      "ONAPPTEST",
      "OnAppTest",
    ];

    // 4. Unbind old events and bind to new URL
    for (const event of eventsToMigrate) {
      const eventName = event.event;
      const oldHandler = event.handler;

      // Check if this event should be migrated
      const shouldMigrate = eventNamesToMigrate.some(e => 
        e.toLowerCase() === eventName.toLowerCase()
      );

      if (!shouldMigrate) {
        console.log(`Skipping event ${eventName} - not in migration list`);
        continue;
      }

      console.log(`Migrating event: ${eventName}`);

      // Unbind from old URL
      try {
        console.log(`Unbinding ${eventName} from ${oldHandler}...`);
        const unbindResponse = await fetch(`${clientEndpoint}event.unbind`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth: accessToken,
            event: eventName,
            handler: oldHandler
          })
        });
        const unbindResult = await unbindResponse.json();
        console.log(`Unbind result:`, JSON.stringify(unbindResult));
        
        results.events_unbound.push({
          event: eventName,
          old_handler: oldHandler,
          success: !unbindResult.error,
          result: unbindResult.result
        });
      } catch (e) {
        console.error(`Failed to unbind ${eventName}:`, e);
        results.errors.push(`Failed to unbind ${eventName}: ${e}`);
      }

      // Bind to new URL
      try {
        console.log(`Binding ${eventName} to ${newEventsUrl}...`);
        const bindResponse = await fetch(`${clientEndpoint}event.bind`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth: accessToken,
            event: eventName,
            handler: newEventsUrl
          })
        });
        const bindResult = await bindResponse.json();
        console.log(`Bind result:`, JSON.stringify(bindResult));
        
        results.events_bound.push({
          event: eventName,
          new_handler: newEventsUrl,
          success: !bindResult.error || bindResult.error === "HANDLER_ALREADY_BINDED",
          result: bindResult.result,
          error: bindResult.error
        });
      } catch (e) {
        console.error(`Failed to bind ${eventName}:`, e);
        results.errors.push(`Failed to bind ${eventName}: ${e}`);
      }
    }

    // 5. Also bind any missing events directly to new URL
    console.log("Step 5: Ensuring all required events are bound to new URL...");
    const requiredEvents = [
      "OnImConnectorMessageAdd",
      "OnImConnectorDialogStart",
      "OnImConnectorDialogFinish",
      "OnImConnectorStatusDelete",
    ];

    for (const eventName of requiredEvents) {
      // Check if already bound to new URL
      const alreadyBound = results.events_bound.some(e => 
        e.event.toLowerCase() === eventName.toLowerCase() && e.success
      );

      if (!alreadyBound) {
        try {
          console.log(`Binding missing event ${eventName} to ${newEventsUrl}...`);
          const bindResponse = await fetch(`${clientEndpoint}event.bind`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              auth: accessToken,
              event: eventName,
              handler: newEventsUrl
            })
          });
          const bindResult = await bindResponse.json();
          
          if (!bindResult.error || bindResult.error === "HANDLER_ALREADY_BINDED") {
            results.events_bound.push({
              event: eventName,
              new_handler: newEventsUrl,
              success: true,
              was_missing: true
            });
          }
        } catch (e) {
          console.error(`Failed to bind missing ${eventName}:`, e);
        }
      }
    }

    // 6. Update connector data to use new URL
    console.log("Step 6: Updating connector data with new URL...");
    const connectorId = config.connector_id || "thoth_whatsapp";
    const lineId = config.line_id || config.activated_line_id || 2;

    try {
      const dataSetResponse = await fetch(`${clientEndpoint}imconnector.connector.data.set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: accessToken,
          CONNECTOR: connectorId,
          LINE: lineId,
          DATA: {
            id: `${connectorId}_line_${lineId}`,
            url: newEventsUrl,
            url_im: newEventsUrl,
            name: "Thoth WhatsApp"
          }
        })
      });
      const dataSetResult = await dataSetResponse.json();
      console.log("Connector data set result:", JSON.stringify(dataSetResult));
    } catch (e) {
      console.error("Failed to update connector data:", e);
      results.errors.push(`Failed to update connector data: ${e}`);
    }

    // 7. Update integration config with new URL
    await supabase
      .from("integrations")
      .update({
        config: {
          ...config,
          events_url: newEventsUrl,
          events_migrated_at: new Date().toISOString(),
          old_webhook_url: oldWebhookUrl,
        },
        updated_at: new Date().toISOString()
      })
      .eq("id", integration.id);

    // Summary
    const successfulUnbinds = results.events_unbound.filter(e => e.success).length;
    const successfulBinds = results.events_bound.filter(e => e.success).length;

    console.log("=== MIGRATION COMPLETE ===");
    console.log(`Unbound: ${successfulUnbinds}/${results.events_unbound.length}`);
    console.log(`Bound: ${successfulBinds}/${results.events_bound.length}`);
    console.log(`Errors: ${results.errors.length}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Migração concluída: ${successfulUnbinds} eventos removidos, ${successfulBinds} eventos vinculados`,
        old_url: oldWebhookUrl,
        new_url: newEventsUrl,
        results,
        summary: {
          events_unbound: successfulUnbinds,
          events_bound: successfulBinds,
          errors: results.errors.length
        }
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error rebinding events:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Erro ao migrar eventos",
        results
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

/**
 * Rebind placements to correct URLs
 * REST_APP -> https://chat.thoth24.com/bitrix24-app (main app)
 * SETTING_CONNECTOR -> bitrix24-connector-settings (contact center)
 */
async function handleRebindPlacements(supabase: any, payload: any, supabaseUrl: string) {
  console.log("=== REBIND PLACEMENTS ===");
  console.log("Payload:", JSON.stringify(payload, null, 2));

  const { integration_id } = payload;

  if (!integration_id) {
    return new Response(
      JSON.stringify({ error: "Integration ID não fornecido" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", integration_id)
    .single();

  if (integrationError || !integration) {
    console.error("Integration not found:", integrationError);
    return new Response(
      JSON.stringify({ error: "Integração não encontrada" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const accessToken = await refreshBitrixToken(integration, supabase);
  if (!accessToken) {
    return new Response(
      JSON.stringify({ error: "Token de acesso não disponível" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const config = integration.config;
  const clientEndpoint = config.client_endpoint || `https://${config.domain}/rest/`;
  
  const results = {
    placements_unbound: [] as any[],
    placements_bound: [] as any[],
    errors: [] as string[],
  };

  try {
    // 1. Get current placements
    console.log("Step 1: Fetching current placements...");
    const placementsResponse = await fetch(`${clientEndpoint}placement.get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth: accessToken })
    });
    const placementsResult = await placementsResponse.json();
    console.log("Current placements:", JSON.stringify(placementsResult, null, 2));

    // 2. Unbind old placements that point to wrong URLs
    const currentPlacements = placementsResult.result || [];
    for (const placement of currentPlacements) {
      // Check if this is our placement with wrong URL
      if (placement.placement === "REST_APP" && placement.handler && !placement.handler.includes("/bitrix24-app")) {
        console.log("Unbinding old REST_APP placement:", placement.handler);
        try {
          const unbindResponse = await fetch(`${clientEndpoint}placement.unbind`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              auth: accessToken,
              PLACEMENT: "REST_APP",
              HANDLER: placement.handler
            })
          });
          const unbindResult = await unbindResponse.json();
          results.placements_unbound.push({
            placement: "REST_APP",
            handler: placement.handler,
            result: unbindResult
          });
        } catch (e) {
          console.error("Error unbinding REST_APP:", e);
        }
      }
    }

    // 3. Bind REST_APP to correct URL (main app)
    console.log("Step 3: Binding REST_APP to correct URL...");
    try {
      const restAppResponse = await fetch(`${clientEndpoint}placement.bind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: accessToken,
          PLACEMENT: "REST_APP",
          HANDLER: "https://chat.thoth24.com/bitrix24-app",
          TITLE: "Thoth WhatsApp"
        })
      });
      const restAppResult = await restAppResponse.json();
      console.log("REST_APP bind result:", JSON.stringify(restAppResult));
      results.placements_bound.push({
        placement: "REST_APP",
        handler: "https://chat.thoth24.com/bitrix24-app",
        success: !restAppResult.error || restAppResult.error === "HANDLER_ALREADY_BINDED",
        result: restAppResult
      });
    } catch (e) {
      console.error("Error binding REST_APP:", e);
      results.errors.push(`Error binding REST_APP: ${e}`);
    }

    // 4. Bind SETTING_CONNECTOR to contact center settings
    console.log("Step 4: Binding SETTING_CONNECTOR...");
    try {
      const settingConnectorResponse = await fetch(`${clientEndpoint}placement.bind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: accessToken,
          PLACEMENT: "SETTING_CONNECTOR",
          HANDLER: `${supabaseUrl}/functions/v1/bitrix24-connector-settings`,
          TITLE: "Thoth WhatsApp"
        })
      });
      const settingConnectorResult = await settingConnectorResponse.json();
      console.log("SETTING_CONNECTOR bind result:", JSON.stringify(settingConnectorResult));
      results.placements_bound.push({
        placement: "SETTING_CONNECTOR",
        handler: `${supabaseUrl}/functions/v1/bitrix24-connector-settings`,
        success: !settingConnectorResult.error || settingConnectorResult.error === "HANDLER_ALREADY_BINDED",
        result: settingConnectorResult
      });
    } catch (e) {
      console.error("Error binding SETTING_CONNECTOR:", e);
      results.errors.push(`Error binding SETTING_CONNECTOR: ${e}`);
    }

    // 5. Update integration config
    await supabase
      .from("integrations")
      .update({
        config: {
          ...config,
          placements_rebound_at: new Date().toISOString(),
          rest_app_url: "https://chat.thoth24.com/bitrix24-app",
          setting_connector_url: `${supabaseUrl}/functions/v1/bitrix24-connector-settings`,
        },
        updated_at: new Date().toISOString()
      })
      .eq("id", integration.id);

    console.log("=== PLACEMENTS REBIND COMPLETE ===");

    return new Response(
      JSON.stringify({
        success: true,
        message: "Placements atualizados com sucesso",
        results
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error rebinding placements:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Erro ao atualizar placements",
        results
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

serve(async (req) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  console.log("=== BITRIX24-WEBHOOK REQUEST ===");
  console.log("Request ID:", requestId);
  console.log("Timestamp:", new Date().toISOString());
  console.log("Method:", req.method);
  console.log("URL:", req.url);
  console.log("Headers:", JSON.stringify(Object.fromEntries(req.headers.entries()), null, 2));

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // Parse request body
    const contentType = req.headers.get("content-type") || "";
    let payload: any = {};

    if (contentType.includes("application/json")) {
      payload = await req.json();
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.text();
      console.log("=== RAW FORM DATA (first 1000 chars) ===");
      console.log(formData.substring(0, 1000));
      
      // Use PHP-style parser for Bitrix24 events
      const parsed = parsePhpStyleFormData(formData);
      console.log("=== PARSED PHP-STYLE FORM DATA ===");
      console.log(JSON.stringify(parsed, null, 2));
      
      payload = {
        event: parsed.event,
        data: parsed.data || {},
        PLACEMENT: parsed.PLACEMENT,
        PLACEMENT_OPTIONS: parsed.PLACEMENT_OPTIONS ? 
          (typeof parsed.PLACEMENT_OPTIONS === 'string' ? 
            JSON.parse(parsed.PLACEMENT_OPTIONS) : parsed.PLACEMENT_OPTIONS) : undefined,
        AUTH_ID: parsed.AUTH_ID || parsed.auth?.access_token,
        DOMAIN: parsed.DOMAIN || parsed.auth?.domain,
        member_id: parsed.member_id || parsed.auth?.member_id,
        auth: parsed.auth || {
          access_token: parsed.AUTH_ID,
          domain: parsed.DOMAIN,
          member_id: parsed.member_id,
        },
        ts: parsed.ts,
        application_token: parsed.application_token,
      };
    } else {
      const text = await req.text();
      console.log("=== RAW TEXT BODY (first 1000 chars) ===");
      console.log(text.substring(0, 1000));
      
      try {
        payload = JSON.parse(text);
      } catch {
        // Try PHP-style parsing as fallback
        const parsed = parsePhpStyleFormData(text);
        console.log("=== PARSED PHP-STYLE (fallback) ===");
        console.log(JSON.stringify(parsed, null, 2));
        
        payload = {
          event: parsed.event,
          data: parsed.data || {},
          PLACEMENT: parsed.PLACEMENT,
          PLACEMENT_OPTIONS: parsed.PLACEMENT_OPTIONS,
          AUTH_ID: parsed.AUTH_ID || parsed.auth?.access_token,
          DOMAIN: parsed.DOMAIN || parsed.auth?.domain,
          member_id: parsed.member_id || parsed.auth?.member_id,
          auth: parsed.auth || {
            access_token: parsed.AUTH_ID,
            domain: parsed.DOMAIN,
            member_id: parsed.member_id,
          },
        };
      }
    }

    console.log("Received payload:", JSON.stringify(payload, null, 2));

    // Handle specific actions
    if (action === "complete_setup" || payload.action === "complete_setup") {
      return await handleCompleteSetup(supabase, payload, supabaseUrl);
    }

    if (action === "save_mapping" || payload.action === "save_mapping") {
      return await handleSaveMapping(supabase, payload);
    }

    if (action === "delete_mapping" || payload.action === "delete_mapping") {
      return await handleDeleteMapping(supabase, payload);
    }

    if (action === "check_connector_status" || payload.action === "check_connector_status") {
      return await handleCheckConnectorStatus(supabase, payload);
    }

    if (action === "list_channels" || payload.action === "list_channels") {
      return await handleListChannels(supabase, payload);
    }

    if (action === "create_channel" || payload.action === "create_channel") {
      return await handleCreateChannel(supabase, payload);
    }

    if (action === "activate_connector_for_line" || payload.action === "activate_connector_for_line") {
      return await handleActivateConnectorForLine(supabase, payload, supabaseUrl);
    }

    if (action === "register_sms_provider" || payload.action === "register_sms_provider") {
      return await handleRegisterSmsProvider(supabase, payload, supabaseUrl);
    }

    if (action === "send_sms" || payload.action === "send_sms") {
      return await handleSendSms(supabase, payload, supabaseUrl);
    }

    // Handle auto setup (configures everything automatically)
    if (action === "auto_setup" || payload.action === "auto_setup") {
      return await handleAutoSetup(supabase, payload, supabaseUrl);
    }

    // Handle reconfigure connector (full reset with clean URLs)
    if (action === "reconfigure_connector" || payload.action === "reconfigure_connector") {
      return await handleReconfigureConnector(supabase, payload, supabaseUrl);
    }

    // Handle diagnose connector (check and auto-fix issues)
    if (action === "diagnose_connector" || payload.action === "diagnose_connector") {
      return await handleDiagnoseConnector(supabase, payload, supabaseUrl);
    }

    // Handle check_status action (alias for verify_integration - used by Bitrix24App iframe)
    if (action === "check_status" || payload.action === "check_status") {
      return await handleVerifyIntegration(supabase, payload, supabaseUrl);
    }

    // Handle refresh_token action (refresh OAuth token and return status)
    if (action === "refresh_token" || payload.action === "refresh_token") {
      return await handleRefreshToken(supabase, payload);
    }

    // Handle diagnose action (alias for diagnose_connector - used by Bitrix24App iframe)
    if (action === "diagnose" || payload.action === "diagnose") {
      return await handleDiagnoseConnector(supabase, payload, supabaseUrl);
    }

    // Handle verify_integration action (full verification)
    if (action === "verify_integration" || payload.action === "verify_integration") {
      return await handleVerifyIntegration(supabase, payload, supabaseUrl);
    }

    // Handle force_activate action - manually force connector activation for a specific line
    if (action === "force_activate" || payload.action === "force_activate") {
      return await handleForceActivate(supabase, payload, supabaseUrl);
    }

    // Handle clean connectors (remove duplicates)
    if (action === "clean_connectors" || payload.action === "clean_connectors") {
      return await handleCleanConnectors(supabase, payload, supabaseUrl);
    }

    // Handle automation robot registration
    if (action === "register_robot" || payload.action === "register_robot") {
      return await handleRegisterRobot(supabase, payload, supabaseUrl);
    }

    if (action === "unregister_robot" || payload.action === "unregister_robot") {
      return await handleUnregisterRobot(supabase, payload);
    }

    // Handle get_bound_events action - list all bound events
    if (action === "get_bound_events" || payload.action === "get_bound_events") {
      return await handleGetBoundEvents(supabase, payload);
    }

    // Handle cleanup_duplicate_events action - remove duplicate events
    if (action === "cleanup_duplicate_events" || payload.action === "cleanup_duplicate_events") {
      return await handleCleanupDuplicateEvents(supabase, payload, supabaseUrl);
    }

    // Handle rebind_events_to_new_url action - migrate events to bitrix24-events endpoint
    if (action === "rebind_events_to_new_url" || payload.action === "rebind_events_to_new_url") {
      return await handleRebindEventsToNewUrl(supabase, payload, supabaseUrl);
    }

    // Handle rebind_placements action - update REST_APP and SETTING_CONNECTOR placements
    if (action === "rebind_placements" || payload.action === "rebind_placements") {
      return await handleRebindPlacements(supabase, payload, supabaseUrl);
    }

    // Handle check_app_installed action - verify if app is marked as INSTALLED in Bitrix24
    if (action === "check_app_installed" || payload.action === "check_app_installed") {
      return await handleCheckAppInstalled(supabase, payload);
    }

    // Handle force_reinstall_events action - unbind and rebind all events to force Bitrix24 to re-evaluate
    if (action === "force_reinstall_events" || payload.action === "force_reinstall_events") {
      return await handleForceReinstallEvents(supabase, payload, supabaseUrl);
    }

    // Check if this is a robot execution call (bizproc.robot handler)
    if (payload.event_token || payload.EVENT_TOKEN || 
        (payload.properties && (payload.properties.phone || payload.properties.message)) ||
        (payload.PROPERTIES && (payload.PROPERTIES.phone || payload.PROPERTIES.message))) {
      console.log("=== DETECTED ROBOT EXECUTION REQUEST ===");
      return await handleRobotExecution(supabase, payload, supabaseUrl);
    }

    // Check if this is a messageservice callback (Bitrix24 automation sending SMS)
    if (payload.MESSAGE_BODY || payload.PHONE_NUMBER || payload.MESSAGE_TO) {
      console.log("=== DETECTED SMS SEND REQUEST ===");
      return await handleSendSms(supabase, payload, supabaseUrl);
    }

    // ========================================
    // NOVA ARQUITETURA: Eventos são processados por bitrix24-events
    // Este webhook agora é apenas para ações ADMIN (protegido por JWT)
    // ========================================

    // Check if this is a PLACEMENT call - redirect to bitrix24-events
    if (payload.PLACEMENT || payload.PLACEMENT_OPTIONS) {
      console.log("=== PLACEMENT CALL - Redirecting to bitrix24-events ===");
      // PLACEMENT calls should go to the public bitrix24-events function
      // But since this function is now protected by JWT, we handle it here for backward compatibility
      return await handlePlacement(supabase, payload, supabaseUrl);
    }

    // Check if this is a Bitrix24 event - redirect to bitrix24-events
    const event = payload.event?.toUpperCase();
    if (event) {
      console.log("=== BITRIX24 EVENT RECEIVED ===");
      console.log("Event type:", event);
      console.log("NOTE: Events should be sent to /bitrix24-events (public) not /bitrix24-webhook (admin)");
      
      // List of events that should be processed by bitrix24-events
      const eventsThatNeedRedirect = [
        "ONIMCONNECTORMESSAGEADD",
        "ONIMCONNECTORMESSAGERECEIVE", 
        "ONIMBOTMESSAGEADD",
        "ONIMBOTJOINOPEN",
        "ONIMBOTMESSAGEDELETE",
        "ONIMBOTMESSAGEUPDATE",
        "ONIMCONNECTORTYPING",
        "ONIMCONNECTORDIALOGFINISH",
        "ONIMCONNECTORSTATUSDELETE",
        "ONIMBOTDELETE",
        "ONAPPTEST",
      ];
      
      if (eventsThatNeedRedirect.includes(event)) {
        console.log("This event should be handled by bitrix24-events function");
        console.log("Forwarding event to queue...");
        
        // Enqueue the event for processing by worker
        const { error: queueError } = await supabase
          .from("bitrix_event_queue")
          .insert({
            event_type: event,
            payload: payload,
            status: "pending"
          });
        
        if (queueError) {
          console.error("Error enqueuing event:", queueError);
        } else {
          console.log("Event enqueued successfully");
          
          // Trigger worker asynchronously
          fetch(`${supabaseUrl}/functions/v1/bitrix24-worker`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({ source: "bitrix24-webhook-redirect" })
          }).catch(err => console.error("Worker trigger error:", err));
        }
        
        // Return success to Bitrix24
        return new Response("successfully", {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" }
        });
      }
      
      // Unknown event - just ACK
      console.log("Unknown event type:", event);
      return new Response("successfully", {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" }
      });
    }

    // No action or event - return info
    console.log("No action or event detected - returning admin endpoint info");
    return new Response(
      JSON.stringify({ 
        status: "ok",
        message: "bitrix24-webhook is now an ADMIN-only endpoint (JWT required)",
        hint: "For Bitrix24 events, use /bitrix24-events (public endpoint)",
        available_actions: [
          "list_channels", "diagnose", "auto_setup", "cleanup", "reconfigure_connector",
          "list_bot_events", "get_bound_events", "cleanup_duplicate_events", "register_robot",
          "get_connector_lines", "activate_line", "sync_contacts", "complete_setup",
          "rebind_events_to_new_url", "rebind_placements", "check_app_installed", "force_reinstall_events"
        ]
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

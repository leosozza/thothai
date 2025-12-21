import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

  const webhookUrl = `${supabaseUrl}/functions/v1/bitrix24-webhook`;
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
      
      // 2. Set connector data with webhook URL
      if (activeStatus === 1) {
        const dataSetUrl = `${apiUrl}imconnector.connector.data.set`;
        console.log("Calling:", dataSetUrl);
        
        const dataBody = {
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

  const webhookUrl = `${supabaseUrl}/functions/v1/bitrix24-webhook`;

  // Activate connector via API (with ACTIVE = 1)
  const activationResult = await activateConnectorViaAPI(integration, supabase, line_id, 1, webhookUrl);
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
            PLACEMENT_HANDLER: webhookUrl
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
              url: webhookUrl,
              url_im: webhookUrl,
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

      // Bind events to ensure we receive messages
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
              handler: webhookUrl
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
  const webhookUrl = `${supabaseUrl}/functions/v1/bitrix24-webhook`;

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
                url: webhookUrl,
                url_im: webhookUrl,
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

      // Fix 2: Bind events if not bound
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
              handler: webhookUrl
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
  const webhookUrl = `${supabaseUrl}/functions/v1/bitrix24-webhook`;

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
            channel.connector_active = statusResult.result.active === true || statusResult.result.ACTIVE === "Y";
            channel.connector_registered = statusResult.result.register === true || statusResult.result.REGISTER === "Y";
            channel.connector_connection = statusResult.result.connection === true || statusResult.result.CONNECTION === "Y";
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

  const webhookUrl = `${supabaseUrl}/functions/v1/bitrix24-webhook`;
  const activeValue = active === true || active === 1 ? 1 : 0;

  // Use the existing activateConnectorViaAPI function
  const result = await activateConnectorViaAPI(integration, supabase, line_id, activeValue, webhookUrl);

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
  
  // CRITICAL: Use CLEAN webhook URL without query parameters
  const cleanWebhookUrl = `${supabaseUrl}/functions/v1/bitrix24-webhook`;
  
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
    
    // WhatsApp filled SVG icon (not stroke) for better visibility
    const whatsappSvgIcon = "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSIjMjVENDY2Ij48cGF0aCBkPSJNMTcuNDcyIDYuMDA1QzE1Ljc4NCA0LjMxNSAxMy41MTIgMy4zODQgMTEuMTUgMy4zODRjLTQuOTQzIDAtOC45NjYgNC4wMjMtOC45NjYgOC45NjYgMCAxLjU4MS40MTMgMy4xMjcgMS4xOTggNC40ODlMMi40MTYgMjEuNjE2bDUuMjEyLTEuMzY4Yy4yNjEuMTQzIDQuNDcgMi41NzIgOC4wNTEuNjgxIDMuNjYxLTEuOTMzIDUuNzUxLTUuODQ1IDUuNzUxLTEwLjE3IDAtMi4zNjItLjkyLTQuNTg0LTIuNTktNi4yNTR6bS0xMS4yMjMgMTAuNjE0bC0uMDk0LS4wNDlIMy4xNDhsLjI4OS0xLjA1NS0uMTg3LS4yOTdjLS44MTQtMS4yOTQtMS4yNDQtMi43ODUtMS4yNDQtNC4zMTggMC00LjQ3NCAzLjY0LTguMTE0IDguMTE0LTguMTE0IDIuMTY2IDAgNC4yMDEuODQzIDUuNzMzIDIuMzc1IDEuNTMyIDEuNTMyIDIuMzc1IDMuNTY3IDIuMzc1IDUuNzMzIDAgNC40NzQtMy42NCA4LjExNC04LjExNCA4LjExNC0xLjQ3MyAwLTIuOTE5LS40LTQuMTc4LTEuMTUzbC0uMjk5LS4xNzctLjMxMy4wODItMi4xNjEuNTY2LjU1NC0yLjAyOHoiLz48cGF0aCBkPSJNMTUuMjk1IDE0LjY0M2MtLjI2MS0uMTMtMS41NDYtLjc2Mi0xLjc4NS0uODQ5LS4yNDEtLjA4Ny0uNDE1LS4xMzEtLjU4OS4xMy0uMTc0LjI2MS0uNjc2Ljg0OS0uODI4IDEuMDI0LS4xNTIuMTc0LS4zMDQuMTk2LS41NjUuMDY1cy0xLjEwMy0uNDA2LTIuMTAyLTEuMjk3Yy0uNzc2LS42OTItMS4zMDItMS41NDYtMS40NTQtMS44MDctLjE1Mi0uMjYxLS4wMTYtLjQwMi4xMTQtLjUzMi4xMTktLjExNy4yNjEtLjMwNC4zOTEtLjQ1Ni4xMy0uMTUyLjE3NC0uMjYxLjI2MS0uNDM1cy4wNDMtLjMyNi0uMDIyLS40NTZjLS4wNjUtLjEzLS41ODktMS40Mi0uODA2LTEuOTQ2LS4yMTMtLjUxMS0uNDI5LS40NDEtLjU4OS0uNDQ5LS4xNTItLjAwOC0uMzI2LS4wMS0uNS0uMDFzLS40NTYuMDY1LS42OTYuMzI2Yy0uMjQxLjI2LS45MTguODk3LS45MTggMi4xODhzLjk0IDIuNTM0IDEuMDcxIDIuNzA4YzEuMDMzIDEuMzc1IDIuNDcgMi4xNjIgMy41MjYgMi41NjguNDY3LjE4Ljg0MS4yODggMS4xMjkuMzY5LjQ3NC4xMzQuOTA2LjExNSAxLjI0Ny4wNy4zOC0uMDUuMTcxLS4yMDkgMS4xNDQtLjk4LjIzOS0uMTk3LjQ4NC0uMTgzLjgxMi0uMTEuMzI4LjA3NCAxLjMyMi41NTEgMS41NDguNjUxLjIyNi4xLjM3Ny4xNDguNDMzLjIzLjA1Ni4wODMuMDU2LjQ3OS0uMTI5Ljk0MXoiLz48L3N2Zz4=";
    
    try {
      const registerResponse = await fetch(`${clientEndpoint}imconnector.register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        })
      });
      const registerResult = await registerResponse.json();
      console.log("Register result:", registerResult);
      
      if (registerResult.result || registerResult.error === "ERROR_CONNECTOR_ALREADY_EXISTS") {
        results.connector_registered = true;
      } else if (registerResult.error) {
        results.errors.push(`Register: ${registerResult.error_description || registerResult.error}`);
      }
    } catch (e: any) {
      console.error("Register error:", e);
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
  
  // CRITICAL: Use CLEAN webhook URL without query parameters for event handlers
  const webhookUrl = `${supabaseUrl}/functions/v1/bitrix24-webhook`;
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
    console.log("Step 1: Registering connector with Marketplace-compliant icons...");
    
    // WhatsApp filled SVG icon for better visibility in Contact Center
    const whatsappSvgIcon = "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSIjMjVENDY2Ij48cGF0aCBkPSJNMTcuNDcyIDYuMDA1QzE1Ljc4NCA0LjMxNSAxMy41MTIgMy4zODQgMTEuMTUgMy4zODRjLTQuOTQzIDAtOC45NjYgNC4wMjMtOC45NjYgOC45NjYgMCAxLjU4MS40MTMgMy4xMjcgMS4xOTggNC40ODlMMi40MTYgMjEuNjE2bDUuMjEyLTEuMzY4Yy4yNjEuMTQzIDQuNDcgMi41NzIgOC4wNTEuNjgxIDMuNjYxLTEuOTMzIDUuNzUxLTUuODQ1IDUuNzUxLTEwLjE3IDAtMi4zNjItLjkyLTQuNTg0LTIuNTktNi4yNTR6Ii8+PC9zdmc+";
    
    try {
      const registerResponse = await fetch(`${clientEndpoint}imconnector.register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: accessToken,
          ID: connectorId,
          NAME: "Thoth WhatsApp",
          ICON: {
            DATA_IMAGE: `data:image/svg+xml;base64,${whatsappSvgIcon}`,
            COLOR: "#25D366",
            SIZE: "90%",
            POSITION: "center"
          },
          // Point to dedicated PLACEMENT_HANDLER for Marketplace compliance
          PLACEMENT_HANDLER: `${supabaseUrl}/functions/v1/bitrix24-connector-settings`
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
                  url: webhookUrl,
                  url_im: webhookUrl,
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
          HANDLER: webhookUrl,
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
          HANDLER: webhookUrl,
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
            handler: webhookUrl
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
            handler: webhookUrl
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

    // 6. Verify activation with imconnector.status for each activated line
    console.log("Step 6: Verifying connector activation status...");
    const verificationResults: Record<number, boolean> = {};
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
          const isActive = statusResult.result?.active === true || statusResult.result?.ACTIVE === "Y";
          verificationResults[lineId] = isActive;
          console.log(`Line ${lineId} (${line.LINE_NAME}) connector active:`, isActive);
          
          // If not active, try to reactivate
          if (!isActive) {
            console.log(`Reactivating connector for line ${lineId}...`);
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
          }
        } catch (e) {
          console.error(`Error verifying line ${lineId}:`, e);
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
          events_url: webhookUrl,
          events_bound: eventsBound,
          line_verification: verificationResults,
        },
        updated_at: new Date().toISOString()
      })
      .eq("id", integration.id);

    console.log("Auto setup completed:", results);
    console.log("Verification results:", verificationResults);

    // Calculate overall success
    const activeLines = Object.values(verificationResults).filter(v => v).length;
    const hasActiveConnector = activeLines > 0;
    const hasEvents = eventsBound > 0;

    return new Response(
      JSON.stringify({
        success: hasActiveConnector && hasEvents,
        message: hasActiveConnector && hasEvents
          ? `Configuração concluída! ${results.lines_activated}/${results.lines_total} canais ativados. ${eventsBound} eventos vinculados.`
          : `Configuração parcial. Canais ativos: ${activeLines}. Eventos: ${eventsBound}. Verifique se o evento OnImConnectorMessageAdd está configurado no Bitrix24.`,
        results: {
          ...results,
          events_bound: eventsBound,
          line_verification: verificationResults,
        },
        webhook_url: webhookUrl,
        critical_info: {
          message: "Para receber mensagens do operador, o evento OnImConnectorMessageAdd DEVE estar vinculado.",
          events_bound: eventsBound,
          active_lines: activeLines,
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

// Handle verify_integration action - Complete verification of Bitrix24 integration
async function handleVerifyIntegration(supabase: any, payload: any, supabaseUrl: string) {
  console.log("=== VERIFY INTEGRATION ===");
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
  };

  try {
    // 1. List all registered connectors
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

    // Check for duplicates (multiple connectors with thoth/whatsapp)
    const thothConnectors = verification.connectors.filter(c => 
      c.id.toLowerCase().includes("thoth") || c.id.toLowerCase().includes("whatsapp")
    );
    if (thothConnectors.length > 1) {
      verification.duplicate_connectors = thothConnectors.map(c => c.id);
      verification.issues.push(`${thothConnectors.length} conectores duplicados encontrados`);
      verification.recommendations.push("Execute 'Reconectar Completo' para limpar duplicados");
    }

    // 2. Check connector status for each line
    console.log("Step 2: Checking Open Lines...");
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
      
      // Check connector status for this line
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

      verification.lines.push({
        id: lineId,
        name: line.LINE_NAME,
        active: line.ACTIVE === "Y",
        connector_active: statusResult.result?.active === true || statusResult.result?.ACTIVE === "Y",
        connector_registered: statusResult.result?.register === true || statusResult.result?.REGISTER === "Y",
        connector_connection: statusResult.result?.connection === true || statusResult.result?.CONNECTION === "Y",
      });
    }

    // Check if any line has inactive connector
    const inactiveLines = verification.lines.filter(l => l.active && !l.connector_active);
    if (inactiveLines.length > 0) {
      verification.issues.push(`Conector inativo em ${inactiveLines.length} linha(s)`);
      verification.recommendations.push("Execute 'Corrigir Automaticamente' para ativar o conector");
    }

    // 3. Check bound events
    console.log("Step 3: Checking events...");
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

    // Check for duplicate events
    const eventCounts: Record<string, number> = {};
    for (const e of ourEvents) {
      const evName = e.event || e.EVENT;
      eventCounts[evName] = (eventCounts[evName] || 0) + 1;
    }
    for (const [evName, count] of Object.entries(eventCounts)) {
      if (count > 1) {
        verification.duplicate_events += count - 1;
      }
    }
    if (verification.duplicate_events > 0) {
      verification.issues.push(`${verification.duplicate_events} eventos duplicados`);
    }

    // Check if OnImConnectorMessageAdd is bound
    const hasMessageEvent = ourEvents.some((e: any) => 
      (e.event || e.EVENT).toUpperCase() === "ONIMCONNECTORMESSAGEADD"
    );
    if (!hasMessageEvent) {
      verification.issues.push("Evento OnImConnectorMessageAdd não configurado");
      verification.recommendations.push("Este evento é obrigatório para receber mensagens do operador");
    }

    // 4. Get database mappings
    console.log("Step 4: Getting database mappings...");
    const { data: mappings } = await supabase
      .from("bitrix_channel_mappings")
      .select(`
        line_id,
        line_name,
        instance_id,
        is_active,
        instances (id, name, phone_number, status)
      `)
      .eq("integration_id", integration_id);

    verification.mappings = (mappings || []).map((m: any) => ({
      line_id: m.line_id,
      line_name: m.line_name,
      instance_id: m.instance_id,
      instance_name: m.instances?.name,
      instance_status: m.instances?.status,
      is_active: m.is_active
    }));

    // Final assessment
    const healthy = verification.issues.length === 0;

    console.log("Verification complete:", verification);

    return new Response(
      JSON.stringify({
        success: true,
        healthy,
        verification,
        summary: healthy 
          ? "Integração funcionando corretamente"
          : `${verification.issues.length} problema(s) encontrado(s)`
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

    // Handle verify_integration action (full verification)
    if (action === "verify_integration" || payload.action === "verify_integration") {
      return await handleVerifyIntegration(supabase, payload, supabaseUrl);
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

    // Check if this is a PLACEMENT call
    if (payload.PLACEMENT || payload.PLACEMENT_OPTIONS) {
      console.log("=== DETECTED PLACEMENT CALL ===");
      return await handlePlacement(supabase, payload, supabaseUrl);
    }

    // Otherwise, process as event
    const event = payload.event;
    console.log("=== PROCESSING BITRIX24 EVENT ===");
    console.log("Event type:", event);
    console.log("Event timestamp:", new Date().toISOString());
    
    // Log all events for debugging
    if (event) {
      console.log("Event payload keys:", Object.keys(payload.data || payload));
    }

    switch (event) {
      case "ONIMCONNECTORMESSAGEADD": {
        // This event is triggered when an operator sends a message from Bitrix24 Open Channel
        // The message needs to be forwarded to WhatsApp
        console.log("=== ONIMCONNECTORMESSAGEADD - OPERATOR MESSAGE TO SEND TO WHATSAPP ===");
        console.log("Event received at:", new Date().toISOString());
        console.log("Full payload:", JSON.stringify(payload, null, 2));
        console.log("Full payload data:", JSON.stringify(payload.data, null, 2));
        
        const messages = payload.data?.MESSAGES || [];
        const firstMessage = messages[0] || payload.data;
        
        if (!firstMessage) {
          console.log("No message data in ONIMCONNECTORMESSAGEADD");
          break;
        }

        // Extract message details - Bitrix24 sends operator's message to be delivered
        // The user object contains the RECIPIENT (client) info, not the operator
        const recipientId = firstMessage.user?.id || firstMessage.im?.user_id;
        const recipientChatId = firstMessage.chat?.id || firstMessage.im?.chat_id;
        const messageText = firstMessage.message?.text || firstMessage.text || "";
        const line = firstMessage.line || payload.data?.LINE;

        console.log("Operator sending message:", { 
          recipientId, 
          recipientChatId, 
          messageText: messageText.substring(0, 50) + "...", 
          line 
        });

        if (!messageText) {
          console.log("Empty message text, skipping");
          break;
        }

        // Find the integration and instance for this line
        let instanceId: string | null = null;
        let workspaceId: string | null = null;

        if (line) {
          const { data: mapping } = await supabase
            .from("bitrix_channel_mappings")
            .select("instance_id, workspace_id")
            .eq("line_id", line)
            .eq("is_active", true)
            .maybeSingle();

          if (mapping) {
            instanceId = mapping.instance_id;
            workspaceId = mapping.workspace_id;
            console.log("Found mapping for line:", line, "instance:", instanceId);
          }
        }

        if (!instanceId) {
          // Fallback: find from integration config
          const { data: integration } = await supabase
            .from("integrations")
            .select("*")
            .eq("type", "bitrix24")
            .eq("is_active", true)
            .maybeSingle();

          if (integration?.config?.instance_id) {
            instanceId = integration.config.instance_id;
            workspaceId = integration.workspace_id;
            console.log("Using instance from integration config:", instanceId);
          }
        }

        if (!instanceId) {
          console.error("No instance_id found for sending message");
          break;
        }

        // The recipientId should be the phone number we originally sent as user.id 
        // when creating the chat in imconnector.send.messages
        const cleanRecipientId = recipientId?.toString().replace(/\D/g, "");
        console.log("Looking for contact:", { recipientId, cleanRecipientId, instanceId });

        // Try multiple strategies to find the contact
        let contact = null;

        // Strategy 1: Find by phone_number (exact match with cleaned ID)
        if (cleanRecipientId) {
          const { data: contactByPhone } = await supabase
            .from("contacts")
            .select("*")
            .eq("instance_id", instanceId)
            .eq("phone_number", cleanRecipientId)
            .maybeSingle();

          if (contactByPhone) {
            contact = contactByPhone;
            console.log("Contact found by exact phone_number:", contact.id, contact.phone_number);
          }
        }

        // Strategy 2: Find by phone ending with the recipientId (in case of formatting differences)
        if (!contact && cleanRecipientId && cleanRecipientId.length >= 8) {
          const { data: contactByPhoneSuffix } = await supabase
            .from("contacts")
            .select("*")
            .eq("instance_id", instanceId)
            .ilike("phone_number", `%${cleanRecipientId.slice(-10)}`)
            .maybeSingle();

          if (contactByPhoneSuffix) {
            contact = contactByPhoneSuffix;
            console.log("Contact found by phone suffix:", contact.id, contact.phone_number);
          }
        }

        // Strategy 3: Find by bitrix24_user_id in metadata
        if (!contact && recipientId) {
          const { data: contactByMetadata } = await supabase
            .from("contacts")
            .select("*")
            .eq("instance_id", instanceId)
            .contains("metadata", { bitrix24_user_id: recipientId.toString() })
            .maybeSingle();
          
          if (contactByMetadata) {
            contact = contactByMetadata;
            console.log("Contact found by bitrix24_user_id metadata:", contact.id);
          }
        }

        // Strategy 4: Find by bitrix24_chat_id in metadata
        if (!contact && recipientChatId) {
          const { data: contactByChatId } = await supabase
            .from("contacts")
            .select("*")
            .eq("instance_id", instanceId)
            .contains("metadata", { bitrix24_chat_id: recipientChatId.toString() })
            .maybeSingle();
          
          if (contactByChatId) {
            contact = contactByChatId;
            console.log("Contact found by bitrix24_chat_id metadata:", contact.id);
          }
        }

        if (!contact) {
          console.error("Contact not found. recipientId:", recipientId, "recipientChatId:", recipientChatId, "cleanRecipientId:", cleanRecipientId);
          console.log("Listing contacts for this instance for debugging...");
          
          const { data: allContacts } = await supabase
            .from("contacts")
            .select("id, phone_number, name, metadata")
            .eq("instance_id", instanceId)
            .limit(5);
          
          console.log("Sample contacts:", JSON.stringify(allContacts, null, 2));
          break;
        }

        // Get conversation if exists
        let conversationId = null;
        const { data: conversation } = await supabase
          .from("conversations")
          .select("id")
          .eq("contact_id", contact.id)
          .eq("instance_id", instanceId)
          .in("status", ["open", "pending"])
          .order("created_at", { ascending: false })
          .maybeSingle();

        if (conversation) {
          conversationId = conversation.id;
        }

        // Send to WhatsApp via W-API
        console.log("Sending message to WhatsApp:", {
          instance_id: instanceId,
          phone_number: contact.phone_number,
          message_preview: messageText.substring(0, 30) + "..."
        });

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
            message_type: "text",
            conversation_id: conversationId,
            contact_id: contact.id,
            workspace_id: workspaceId,
            internal_call: true,
          }),
        });

        const sendResult = await sendResponse.json();
        console.log("WhatsApp send result:", JSON.stringify(sendResult));

        if (sendResult.error) {
          console.error("Error sending to WhatsApp:", sendResult.error);
        } else {
          console.log("Message successfully sent to WhatsApp, messageId:", sendResult.messageId);
          
          // CRITICAL: Call imconnector.send.status.delivery to confirm delivery to Bitrix24
          // This is required for Bitrix24 to mark the message as delivered
          try {
            const messageId = firstMessage.message?.id || firstMessage.im?.message_id;
            if (messageId && line) {
              // Find integration to get access token
              const { data: integrationData } = await supabase
                .from("integrations")
                .select("*")
                .eq("type", "bitrix24")
                .eq("is_active", true)
                .maybeSingle();

              if (integrationData?.config?.access_token) {
                const bitrixAccessToken = await refreshBitrixToken(integrationData, supabase);
                const bitrixEndpoint = integrationData.config.client_endpoint || `https://${integrationData.config.domain}/rest/`;
                const bitrixConnectorId = integrationData.config.connector_id || "thoth_whatsapp";

                console.log("Sending delivery status to Bitrix24...");
                const deliveryResponse = await fetch(`${bitrixEndpoint}imconnector.send.status.delivery`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    auth: bitrixAccessToken,
                    CONNECTOR: bitrixConnectorId,
                    LINE: line,
                    MESSAGES: [{
                      im: {
                        chat_id: recipientChatId,
                        message_id: messageId
                      },
                      message: {
                        id: [sendResult.messageId || sendResult.id || `wa_${Date.now()}`]
                      },
                      chat: {
                        id: recipientChatId
                      }
                    }]
                  })
                });
                const deliveryResult = await deliveryResponse.json();
                console.log("imconnector.send.status.delivery result:", deliveryResult);
              }
            }
          } catch (deliveryError) {
            console.error("Error sending delivery status:", deliveryError);
            // Don't fail the whole operation if delivery status fails
          }
          
          // If we have a conversation, also save the outgoing message
          if (conversationId && !sendResult.message) {
            await supabase
              .from("messages")
              .insert({
                conversation_id: conversationId,
                contact_id: contact.id,
                instance_id: instanceId,
                content: messageText,
                direction: "outgoing",
                is_from_bot: false,
                message_type: "text",
                status: "sent",
                metadata: { source: "bitrix24_operator" }
              });
          }

          // Update conversation
          if (conversationId) {
            await supabase
              .from("conversations")
              .update({ 
                last_message_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
              .eq("id", conversationId);
          }
        }

        break;
      }

      // Handle client messages received via Open Channel (connector)
      case "ONIMCONNECTORMESSAGERECEIVE": {
        console.log("=== CLIENT MESSAGE RECEIVED VIA CONNECTOR ===");
        const data = payload.data?.MESSAGES?.[0] || payload.data;
        
        if (!data) {
          console.log("No message data");
          break;
        }

        const clientUserId = data.user?.id || data.im?.user_id;
        const clientChatId = data.chat?.id || data.im?.chat_id;
        const clientMessageText = data.message?.text || data.text || "";
        const clientLine = data.line || payload.data?.LINE;
        const clientName = data.user?.name || data.user?.first_name || "Cliente";

        console.log("Client message:", { clientUserId, clientChatId, clientMessageText, clientLine, clientName });

        if (!clientMessageText) {
          console.log("Empty message, skipping");
          break;
        }

        // Find integration and mapping for this line
        let integrationData: any = null;
        let mappingData: any = null;

        if (clientLine) {
          const { data: mapping } = await supabase
            .from("bitrix_channel_mappings")
            .select("*, integrations(*)")
            .eq("line_id", clientLine)
            .eq("is_active", true)
            .maybeSingle();

          if (mapping) {
            mappingData = mapping;
            integrationData = mapping.integrations;
          }
        }

        if (!integrationData) {
          // Try to find by member_id or domain
          const memberId = payload.auth?.member_id || payload.member_id;
          const domain = payload.auth?.domain || payload.DOMAIN;

          if (memberId) {
            const { data: integration } = await supabase
              .from("integrations")
              .select("*")
              .eq("type", "bitrix24")
              .eq("config->>member_id", memberId)
              .eq("is_active", true)
              .maybeSingle();
            integrationData = integration;
          }

          if (!integrationData && domain) {
            const { data: integration } = await supabase
              .from("integrations")
              .select("*")
              .eq("type", "bitrix24")
              .ilike("config->>domain", `%${domain}%`)
              .eq("is_active", true)
              .maybeSingle();
            integrationData = integration;
          }
        }

        if (!integrationData) {
          console.error("No integration found for client message");
          break;
        }

        console.log("Found integration:", integrationData.id, "workspace:", integrationData.workspace_id);

        // Check if chatbot is enabled for this integration (connector chatbot)
        if (!integrationData.config?.chatbot_enabled) {
          console.log("Chatbot not enabled for this integration, skipping AI response");
          break;
        }

        const workspaceId = integrationData.workspace_id;
        const instanceId = mappingData?.instance_id || integrationData.config?.instance_id;

        if (!instanceId) {
          console.error("No instance_id configured");
          break;
        }

        // Create or find contact
        let contact: any = null;
        
        // Try to find existing contact by bitrix24_user_id
        const { data: existingContact } = await supabase
          .from("contacts")
          .select("*")
          .eq("instance_id", instanceId)
          .contains("metadata", { bitrix24_user_id: clientUserId })
          .maybeSingle();

        if (existingContact) {
          contact = existingContact;
          console.log("Found existing contact:", contact.id);
        } else {
          // Create new contact
          const { data: newContact, error: contactError } = await supabase
            .from("contacts")
            .insert({
              instance_id: instanceId,
              name: clientName,
              phone_number: `bitrix_${clientUserId}`,
              push_name: clientName,
              metadata: {
                bitrix24_user_id: clientUserId,
                bitrix24_chat_id: clientChatId,
                source: "bitrix24_connector"
              }
            })
            .select()
            .single();

          if (contactError) {
            console.error("Error creating contact:", contactError);
            break;
          }
          contact = newContact;
          console.log("Created new contact:", contact.id);
        }

        // Update contact metadata with latest chat_id
        if (contact && clientChatId) {
          await supabase
            .from("contacts")
            .update({
              metadata: {
                ...contact.metadata,
                bitrix24_chat_id: clientChatId
              }
            })
            .eq("id", contact.id);
        }

        // Create or find conversation
        let conversation: any = null;

        const { data: existingConversation } = await supabase
          .from("conversations")
          .select("*")
          .eq("contact_id", contact.id)
          .eq("instance_id", instanceId)
          .in("status", ["open", "pending"])
          .order("created_at", { ascending: false })
          .maybeSingle();

        if (existingConversation) {
          conversation = existingConversation;
          console.log("Found existing conversation:", conversation.id);
        } else {
          const { data: newConversation, error: convError } = await supabase
            .from("conversations")
            .insert({
              contact_id: contact.id,
              instance_id: instanceId,
              status: "open",
              attendance_mode: "ai",
              last_message_at: new Date().toISOString()
            })
            .select()
            .single();

          if (convError) {
            console.error("Error creating conversation:", convError);
            break;
          }
          conversation = newConversation;
          console.log("Created new conversation:", conversation.id);
        }

        // Save incoming message
        const { error: msgError } = await supabase
          .from("messages")
          .insert({
            conversation_id: conversation.id,
            contact_id: contact.id,
            instance_id: instanceId,
            content: clientMessageText,
            direction: "incoming",
            is_from_bot: false,
            message_type: "text",
            status: "received",
            metadata: { source: "bitrix24_connector", bitrix24_user_id: clientUserId }
          });

        if (msgError) {
          console.error("Error saving message:", msgError);
        }

        // Update conversation
        await supabase
          .from("conversations")
          .update({
            last_message_at: new Date().toISOString(),
            unread_count: (conversation.unread_count || 0) + 1
          })
          .eq("id", conversation.id);

        // Check attendance mode - only call AI if mode is "ai"
        if (conversation.attendance_mode === "ai" || !existingConversation) {
          console.log("Calling AI to process message (connector)...");
          
          // Call ai-process-bitrix24 function with message_type = "connector"
          const aiResponse = await fetch(`${supabaseUrl}/functions/v1/ai-process-bitrix24`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              conversation_id: conversation.id,
              contact_id: contact.id,
              instance_id: instanceId,
              content: clientMessageText,
              workspace_id: workspaceId,
              integration_id: integrationData.id,
              bitrix24_user_id: clientUserId,
              bitrix24_chat_id: clientChatId,
              line_id: clientLine,
              message_type: "connector" // Indicates to use imconnector.send.messages
            })
          });

          const aiResult = await aiResponse.json();
          console.log("AI process result:", aiResult);
        } else {
          console.log("Attendance mode is not AI, skipping automatic response");
        }

        break;
      }

      // Handle messages sent to bot (universal bot)
      case "ONIMBOTMESSAGEADD": {
        console.log("=== BOT MESSAGE RECEIVED ===");
        const data = payload.data || {};
        
        // Bot message data structure is different from connector
        const botId = data.BOT_ID || data.bot_id;
        const dialogId = data.DIALOG_ID || data.dialog_id;
        const fromUserId = data.FROM_USER_ID || data.from_user_id;
        const toUserId = data.TO_USER_ID || data.to_user_id; // Our bot ID
        const messageText = data.MESSAGE || data.message || "";
        const messageId = data.MESSAGE_ID || data.message_id;

        console.log("Bot message data:", { botId, dialogId, fromUserId, toUserId, messageText, messageId });

        if (!messageText) {
          console.log("Empty message, skipping");
          break;
        }

        // Find integration by bot_id or member_id
        let integrationData: any = null;
        const memberId = payload.auth?.member_id || payload.member_id;
        const domain = payload.auth?.domain || payload.DOMAIN;

        // First try to find by bot_id in config
        if (botId) {
          const { data: integration } = await supabase
            .from("integrations")
            .select("*")
            .eq("type", "bitrix24")
            .eq("config->>bot_id", String(botId))
            .eq("is_active", true)
            .maybeSingle();
          integrationData = integration;
        }

        // If not found, try by member_id
        if (!integrationData && memberId) {
          const { data: integration } = await supabase
            .from("integrations")
            .select("*")
            .eq("type", "bitrix24")
            .eq("config->>member_id", memberId)
            .eq("is_active", true)
            .maybeSingle();
          integrationData = integration;
        }

        // If still not found, try by domain
        if (!integrationData && domain) {
          const { data: integration } = await supabase
            .from("integrations")
            .select("*")
            .eq("type", "bitrix24")
            .ilike("config->>domain", `%${domain}%`)
            .eq("is_active", true)
            .maybeSingle();
          integrationData = integration;
        }

        if (!integrationData) {
          console.error("No integration found for bot message");
          break;
        }

        console.log("Found integration:", integrationData.id);

        // Verify this message is for our bot
        const ourBotId = integrationData.config?.bot_id;
        if (!ourBotId) {
          console.log("No bot registered for this integration, skipping");
          break;
        }

        // Check if the message is directed to our bot (TO_USER_ID should match our bot)
        // In group chats, check if bot was mentioned
        if (toUserId && String(toUserId) !== String(ourBotId)) {
          console.log("Message not directed to our bot, skipping. toUserId:", toUserId, "ourBotId:", ourBotId);
          break;
        }

        // Check if bot is enabled
        if (!integrationData.config?.bot_enabled) {
          console.log("Bot not enabled for this integration, skipping");
          break;
        }

        const workspaceId = integrationData.workspace_id;
        const instanceId = integrationData.config?.instance_id;

        // Create a virtual instance ID if not configured (bot doesn't need W-API instance)
        const effectiveInstanceId = instanceId || `bot_${integrationData.id}`;

        // Get user info from Bitrix if available
        let userName = `Usuário ${fromUserId}`;

        // Create or find contact for this bot user
        let contact: any = null;
        
        const { data: existingContact } = await supabase
          .from("contacts")
          .select("*")
          .contains("metadata", { bitrix24_bot_user_id: fromUserId })
          .maybeSingle();

        if (existingContact) {
          contact = existingContact;
          console.log("Found existing bot contact:", contact.id);
        } else {
          // We need a valid instance_id - if no W-API instance, we can't create contact
          if (!instanceId) {
            // Get or create first instance for this workspace to store bot contacts
            const { data: firstInstance } = await supabase
              .from("instances")
              .select("id")
              .eq("workspace_id", workspaceId)
              .limit(1)
              .maybeSingle();

            if (!firstInstance) {
              console.error("No instance available for bot contacts");
              break;
            }

            const { data: newContact, error: contactError } = await supabase
              .from("contacts")
              .insert({
                instance_id: firstInstance.id,
                name: userName,
                phone_number: `bot_user_${fromUserId}`,
                push_name: userName,
                metadata: {
                  bitrix24_bot_user_id: fromUserId,
                  bitrix24_dialog_id: dialogId,
                  source: "bitrix24_bot"
                }
              })
              .select()
              .single();

            if (contactError) {
              console.error("Error creating bot contact:", contactError);
              break;
            }
            contact = newContact;
          } else {
            const { data: newContact, error: contactError } = await supabase
              .from("contacts")
              .insert({
                instance_id: instanceId,
                name: userName,
                phone_number: `bot_user_${fromUserId}`,
                push_name: userName,
                metadata: {
                  bitrix24_bot_user_id: fromUserId,
                  bitrix24_dialog_id: dialogId,
                  source: "bitrix24_bot"
                }
              })
              .select()
              .single();

            if (contactError) {
              console.error("Error creating bot contact:", contactError);
              break;
            }
            contact = newContact;
          }
          console.log("Created new bot contact:", contact.id);
        }

        // Update contact metadata with latest dialog_id
        if (contact && dialogId) {
          await supabase
            .from("contacts")
            .update({
              metadata: {
                ...contact.metadata,
                bitrix24_dialog_id: dialogId
              }
            })
            .eq("id", contact.id);
        }

        // Create or find conversation
        let conversation: any = null;

        const { data: existingConversation } = await supabase
          .from("conversations")
          .select("*")
          .eq("contact_id", contact.id)
          .in("status", ["open", "pending"])
          .order("created_at", { ascending: false })
          .maybeSingle();

        if (existingConversation) {
          conversation = existingConversation;
          console.log("Found existing bot conversation:", conversation.id);
        } else {
          const { data: newConversation, error: convError } = await supabase
            .from("conversations")
            .insert({
              contact_id: contact.id,
              instance_id: contact.instance_id,
              status: "open",
              attendance_mode: "ai",
              last_message_at: new Date().toISOString()
            })
            .select()
            .single();

          if (convError) {
            console.error("Error creating bot conversation:", convError);
            break;
          }
          conversation = newConversation;
          console.log("Created new bot conversation:", conversation.id);
        }

        // Save incoming message
        const { error: msgError } = await supabase
          .from("messages")
          .insert({
            conversation_id: conversation.id,
            contact_id: contact.id,
            instance_id: contact.instance_id,
            content: messageText,
            direction: "incoming",
            is_from_bot: false,
            message_type: "text",
            status: "received",
            metadata: { 
              source: "bitrix24_bot", 
              bitrix24_bot_user_id: fromUserId,
              bitrix24_message_id: messageId
            }
          });

        if (msgError) {
          console.error("Error saving bot message:", msgError);
        }

        // Update conversation
        await supabase
          .from("conversations")
          .update({
            last_message_at: new Date().toISOString(),
            unread_count: (conversation.unread_count || 0) + 1
          })
          .eq("id", conversation.id);

        // Always respond to bot messages (bot is always in AI mode)
        console.log("Calling AI to process bot message...");
        
        // Call ai-process-bitrix24 function with message_type = "bot"
        const aiResponse = await fetch(`${supabaseUrl}/functions/v1/ai-process-bitrix24`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            conversation_id: conversation.id,
            contact_id: contact.id,
            instance_id: contact.instance_id,
            content: messageText,
            workspace_id: workspaceId,
            integration_id: integrationData.id,
            bitrix24_bot_id: ourBotId,
            bitrix24_dialog_id: dialogId,
            bitrix24_user_id: fromUserId,
            message_type: "bot" // Indicates to use imbot.message.add
          })
        });

        const aiResult = await aiResponse.json();
        console.log("AI process result for bot:", aiResult);

        break;
      }

      // Handle bot join open event (when user starts conversation with bot)
      case "ONIMBOTJOINOPEN": {
        console.log("=== BOT JOIN OPEN (User started conversation) ===");
        const data = payload.data || {};
        const dialogId = data.DIALOG_ID || data.dialog_id;
        const botId = data.BOT_ID || data.bot_id;
        const userId = data.USER_ID || data.user_id;

        console.log("Bot join open data:", { dialogId, botId, userId });

        if (!dialogId) {
          console.log("No dialog ID, skipping welcome message");
          break;
        }

        // Find integration by bot_id
        let integrationData: any = null;
        const memberId = payload.auth?.member_id || payload.member_id;

        if (botId) {
          const { data: integration } = await supabase
            .from("integrations")
            .select("*")
            .eq("type", "bitrix24")
            .eq("config->>bot_id", String(botId))
            .eq("is_active", true)
            .maybeSingle();
          integrationData = integration;
        }

        if (!integrationData && memberId) {
          const { data: integration } = await supabase
            .from("integrations")
            .select("*")
            .eq("type", "bitrix24")
            .eq("config->>member_id", memberId)
            .eq("is_active", true)
            .maybeSingle();
          integrationData = integration;
        }

        if (!integrationData) {
          console.log("No integration found for bot join event");
          break;
        }

        // Check if bot is enabled and has welcome message
        if (!integrationData.config?.bot_enabled) {
          console.log("Bot not enabled, skipping welcome");
          break;
        }

        const welcomeMessage = integrationData.config?.bot_welcome_message;
        if (welcomeMessage) {
          console.log("Sending welcome message to dialog:", dialogId);
          await sendBotMessage(integrationData, supabase, dialogId, welcomeMessage);
        } else {
          console.log("No welcome message configured");
        }

        break;
      }

      case "ONIMCONNECTORTYPING":
      case "ONIMCONNECTORDIALOGFINISH":
      case "ONIMCONNECTORSTATUSDELETE":
      case "ONIMBOTDELETE":
        console.log("Event handled:", event);
        break;

      default:
        console.log("Unhandled event:", event);
    }

    return new Response(
      JSON.stringify({ success: true }),
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

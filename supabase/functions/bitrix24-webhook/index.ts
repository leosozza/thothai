import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper to refresh Bitrix24 OAuth token
async function refreshBitrixToken(integration: any, supabase: any): Promise<string | null> {
  const config = integration.config;
  
  if (config.token_expires_at) {
    const expiresAt = new Date(config.token_expires_at);
    const now = new Date();
    const bufferMs = 5 * 60 * 1000;
    
    if (expiresAt.getTime() - now.getTime() > bufferMs) {
      console.log("Token still valid");
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

  const lineId = options.LINE || 0;
  const activeStatus = options.ACTIVE_STATUS ?? 1; // Default to activate
  const domain = payload.auth?.domain || payload.DOMAIN;
  const memberId = payload.auth?.member_id || payload.member_id;

  console.log("Parsed options - LINE:", lineId, "ACTIVE_STATUS:", activeStatus);
  console.log("Domain:", domain, "MemberId:", memberId);

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
    // Return error but as plain text
    return new Response("error: integration not found", {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "text/plain" }
    });
  }

  console.log("Found integration:", integration.id, "workspace:", integration.workspace_id);

  const webhookUrl = `${supabaseUrl}/functions/v1/bitrix24-webhook`;

  // If LINE is specified, handle activation/deactivation
  if (lineId > 0) {
    console.log("LINE specified:", lineId, "calling activateConnectorViaAPI with ACTIVE:", activeStatus);
    
    // Activate or deactivate based on ACTIVE_STATUS
    const activationResult = await activateConnectorViaAPI(integration, supabase, lineId, activeStatus, webhookUrl);
    console.log("Activation result:", activationResult);
    
    // Save line_id to integration config (so we know which line was activated)
    if (activeStatus === 1) {
      const currentConfig = integration.config || {};
      const updatedConfig = {
        ...currentConfig,
        line_id: lineId,
        last_activated_at: new Date().toISOString()
      };
      
      await supabase
        .from("integrations")
        .update({
          config: updatedConfig,
          updated_at: new Date().toISOString()
        })
        .eq("id", integration.id);
      
      console.log("Saved line_id to integration config");
    }
    
    // CRITICAL: Return "successfully" as plain text
    // This is what Bitrix24 expects to mark the setup as complete
    console.log("Returning 'successfully' to Bitrix24");
    return new Response("successfully", {
      headers: { ...corsHeaders, "Content-Type": "text/plain" }
    });
  }

  // If no LINE specified, still return success
  // The user can configure the mapping later in Thoth.ai
  console.log("No LINE specified, returning success anyway");
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

// Handle list_channels action - List all Open Channels from Bitrix24
async function handleListChannels(supabase: any, payload: any) {
  console.log("=== LIST CHANNELS ===");
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
      active: ch.ACTIVE === "Y"
    }));

    console.log("Mapped channels:", channels);

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

serve(async (req) => {
  console.log("=== BITRIX24-WEBHOOK REQUEST ===");
  console.log("Method:", req.method);
  console.log("URL:", req.url);

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

    if (action === "list_channels" || payload.action === "list_channels") {
      return await handleListChannels(supabase, payload);
    }

    if (action === "create_channel" || payload.action === "create_channel") {
      return await handleCreateChannel(supabase, payload);
    }

    // Check if this is a PLACEMENT call
    if (payload.PLACEMENT || payload.PLACEMENT_OPTIONS) {
      console.log("=== DETECTED PLACEMENT CALL ===");
      return await handlePlacement(supabase, payload, supabaseUrl);
    }

    // Otherwise, process as event
    const event = payload.event;
    console.log("Processing event:", event);

    switch (event) {
      case "ONIMCONNECTORMESSAGEADD": {
        const data = payload.data?.MESSAGES?.[0] || payload.data;
        
        if (!data) {
          console.log("No message data");
          break;
        }

        const userId = data.im?.chat_id || data.user?.id;
        const messageText = data.message?.text || data.text || "";
        const line = data.line || payload.data?.LINE;

        console.log("Operator message:", { userId, messageText, line });

        if (!messageText) break;

        // Find instance from mapping
        let instanceId: string | null = null;

        if (line) {
          const { data: mapping } = await supabase
            .from("bitrix_channel_mappings")
            .select("instance_id")
            .eq("line_id", line)
            .eq("is_active", true)
            .maybeSingle();

          if (mapping) {
            instanceId = mapping.instance_id;
          }
        }

        if (!instanceId) {
          const { data: integration } = await supabase
            .from("integrations")
            .select("*")
            .eq("type", "bitrix24")
            .eq("is_active", true)
            .maybeSingle();

          if (integration?.config?.instance_id) {
            instanceId = integration.config.instance_id;
          }
        }

        if (!instanceId) {
          console.error("No instance_id found");
          break;
        }

        // Find contact
        const { data: contact } = await supabase
          .from("contacts")
          .select("*")
          .eq("instance_id", instanceId)
          .contains("metadata", { bitrix24_user_id: userId })
          .maybeSingle();

        if (!contact) {
          console.error("Contact not found for:", userId);
          break;
        }

        // Send to WhatsApp
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
        console.log("Send result:", sendResult);
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

      case "ONIMCONNECTORTYPING":
      case "ONIMCONNECTORDIALOGFINISH":
      case "ONIMCONNECTORSTATUSDELETE":
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

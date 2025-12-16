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
  active: number, // 1 = activate, 0 = deactivate
  webhookUrl: string
): Promise<{ success: boolean; error?: string }> {
  console.log("=== ACTIVATING CONNECTOR VIA API ===");
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
  
  try {
    // 1. Activate/Deactivate the connector for this line
    const activateUrl = `${clientEndpoint}imconnector.activate`;
    console.log("Calling imconnector.activate with ACTIVE:", active);
    
    const activateResponse = await fetch(activateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth: accessToken,
        CONNECTOR: connectorId,
        LINE: lineId,
        ACTIVE: active // Use the parameter value
      })
    });
    
    const activateResult = await activateResponse.json();
    console.log("Activate result:", JSON.stringify(activateResult, null, 2));
    
    if (activateResult.error) {
      console.error("Activate error:", activateResult.error, activateResult.error_description);
    }
    
    // Only set connector data if activating (not deactivating)
    if (active === 1) {
      // 2. Set connector data with URLs
      const dataSetUrl = `${clientEndpoint}imconnector.connector.data.set`;
      console.log("Calling imconnector.connector.data.set...");
      
      const dataSetResponse = await fetch(dataSetUrl, {
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
      
      const dataSetResult = await dataSetResponse.json();
      console.log("Data set result:", JSON.stringify(dataSetResult, null, 2));
      
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

// Generate HTML settings page for the connector
function renderSettingsPage(
  options: { LINE?: number; ACTIVE_STATUS?: number },
  connectorId: string,
  domain: string,
  supabaseUrl: string,
  webhookUrl: string,
  instances: any[],
  mappings: any[],
  integrationId: string,
  workspaceId: string,
  activationResult?: { success: boolean; error?: string }
): string {
  const lineId = options.LINE || 0;
  const activeStatus = options.ACTIVE_STATUS ?? 1;
  const isActivated = activationResult?.success || false;

  // Check if there's already a mapping for this line
  const existingMapping = mappings.find(m => m.line_id === lineId);

  const instancesJson = JSON.stringify(instances || []);
  const mappingsJson = JSON.stringify(mappings || []);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Thoth WhatsApp - Configuração</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      min-height: 100vh;
      padding: 20px;
      color: #e2e8f0;
    }
    .container {
      background: rgba(30, 41, 59, 0.95);
      border-radius: 16px;
      padding: 32px;
      max-width: 500px;
      margin: 0 auto;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(148, 163, 184, 0.1);
    }
    .header {
      text-align: center;
      margin-bottom: 24px;
    }
    .logo {
      width: 64px;
      height: 64px;
      background: linear-gradient(135deg, #25D366 0%, #128C7E 100%);
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 16px;
      font-size: 32px;
    }
    h2 {
      font-size: 22px;
      font-weight: 600;
      color: #f8fafc;
      margin-bottom: 4px;
    }
    .subtitle {
      color: #94a3b8;
      font-size: 14px;
    }
    .status-box {
      padding: 16px;
      border-radius: 12px;
      margin-bottom: 20px;
      text-align: center;
    }
    .status-box.success {
      background: rgba(34, 197, 94, 0.15);
      border: 1px solid rgba(34, 197, 94, 0.3);
    }
    .status-box.pending {
      background: rgba(234, 179, 8, 0.15);
      border: 1px solid rgba(234, 179, 8, 0.3);
    }
    .status-box h3 {
      font-size: 16px;
      margin-bottom: 4px;
    }
    .status-box.success h3 { color: #4ade80; }
    .status-box.pending h3 { color: #fbbf24; }
    .status-box p { font-size: 13px; color: #94a3b8; }
    .channel-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(15, 23, 42, 0.5);
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 20px;
      width: 100%;
    }
    .channel-badge .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #25D366;
    }
    .channel-badge .text {
      font-size: 14px;
      color: #f1f5f9;
    }
    .channel-badge .label {
      font-size: 11px;
      color: #64748b;
      text-transform: uppercase;
    }
    .form-group {
      margin-bottom: 16px;
    }
    label {
      display: block;
      font-size: 14px;
      color: #94a3b8;
      margin-bottom: 8px;
    }
    select {
      width: 100%;
      padding: 12px 16px;
      font-size: 14px;
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.8);
      color: #f1f5f9;
      cursor: pointer;
    }
    select:focus {
      outline: none;
      border-color: #25D366;
    }
    select option {
      background: #1e293b;
      color: #f1f5f9;
    }
    button {
      width: 100%;
      padding: 14px 24px;
      font-size: 15px;
      font-weight: 600;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    button.primary {
      background: linear-gradient(135deg, #25D366 0%, #128C7E 100%);
      color: white;
    }
    button.primary:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 10px 20px -5px rgba(37, 211, 102, 0.4);
    }
    button.primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .help-text {
      font-size: 12px;
      color: #64748b;
      margin-top: 6px;
    }
    .loading {
      display: none;
      color: #94a3b8;
      font-size: 14px;
      text-align: center;
      padding: 16px;
    }
    .loading.show { display: block; }
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(148, 163, 184, 0.3);
      border-top-color: #94a3b8;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-right: 8px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .message {
      padding: 12px;
      border-radius: 8px;
      margin-top: 16px;
      display: none;
      font-size: 14px;
    }
    .message.error {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
    }
    .message.success {
      background: rgba(34, 197, 94, 0.15);
      color: #4ade80;
    }
    .message.show { display: block; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">📱</div>
      <h2>Thoth WhatsApp</h2>
      <p class="subtitle">Vincular número ao Canal Aberto</p>
    </div>

    ${lineId > 0 ? `
    <div class="channel-badge">
      <span class="dot"></span>
      <div>
        <div class="label">Canal Aberto</div>
        <div class="text">Linha ${lineId}</div>
      </div>
    </div>
    ` : ''}

    <div class="status-box ${isActivated ? 'success' : 'pending'}">
      <h3>${isActivated ? '✓ Conector Ativo' : '⏳ Aguardando Configuração'}</h3>
      <p>${isActivated ? 'Selecione uma instância para finalizar' : 'Selecione qual número WhatsApp vincular'}</p>
    </div>

    <div class="form-group">
      <label>Instância W-API (Número WhatsApp)</label>
      <select id="instanceSelect">
        <option value="">Selecione uma instância...</option>
      </select>
      <p class="help-text">O número selecionado receberá mensagens deste canal</p>
    </div>

    <button class="primary" id="saveBtn" onclick="completeSetup()" disabled>
      ✓ Finalizar Configuração
    </button>

    <p class="loading" id="loading">
      <span class="spinner"></span>
      Finalizando configuração...
    </p>

    <div class="message error" id="error"></div>
    <div class="message success" id="success"></div>
  </div>

  <script src="//api.bitrix24.com/api/v1/"></script>
  <script>
    const CONNECTOR = '${connectorId}';
    const WEBHOOK_URL = '${webhookUrl}';
    const INTEGRATION_ID = '${integrationId}';
    const WORKSPACE_ID = '${workspaceId}';
    const LINE_ID = ${lineId};
    const ACTIVE_STATUS = ${activeStatus};
    
    const instances = ${instancesJson};
    const existingMappings = ${mappingsJson};
    
    // Populate instances dropdown
    function populateInstances() {
      const select = document.getElementById('instanceSelect');
      select.innerHTML = '<option value="">Selecione uma instância...</option>';
      
      instances.forEach(inst => {
        const phone = inst.phone_number || 'Sem número';
        const status = inst.status === 'connected' ? '🟢' : '⚪';
        const option = document.createElement('option');
        option.value = inst.id;
        option.textContent = status + ' ' + inst.name + ' (' + phone + ')';
        select.appendChild(option);
      });
      
      // Check if there's already a mapping for this line
      const existingMapping = existingMappings.find(m => m.line_id === LINE_ID);
      if (existingMapping) {
        select.value = existingMapping.instance_id;
      }
      
      updateSaveButton();
    }
    
    function updateSaveButton() {
      const instanceId = document.getElementById('instanceSelect').value;
      document.getElementById('saveBtn').disabled = !instanceId || LINE_ID <= 0;
    }
    
    // Complete setup - THE KEY FUNCTION
    function completeSetup() {
      const instanceId = document.getElementById('instanceSelect').value;
      if (!instanceId || LINE_ID <= 0) return;
      
      const btn = document.getElementById('saveBtn');
      const loading = document.getElementById('loading');
      const errorEl = document.getElementById('error');
      const successEl = document.getElementById('success');
      
      errorEl.classList.remove('show');
      successEl.classList.remove('show');
      btn.disabled = true;
      loading.classList.add('show');
      
      console.log('Starting setup for LINE:', LINE_ID, 'Instance:', instanceId);
      
      // Step 1: Activate connector via BX24.callMethod
      BX24.callMethod('imconnector.activate', {
        CONNECTOR: CONNECTOR,
        LINE: LINE_ID,
        ACTIVE: 1
      }, function(activateResult) {
        console.log('imconnector.activate result:', activateResult.data(), activateResult.error());
        
        // Step 2: Set connector data
        BX24.callMethod('imconnector.connector.data.set', {
          CONNECTOR: CONNECTOR,
          LINE: LINE_ID,
          DATA: {
            id: CONNECTOR + '_line_' + LINE_ID,
            url: WEBHOOK_URL,
            url_im: WEBHOOK_URL,
            name: 'Thoth WhatsApp'
          }
        }, function(dataResult) {
          console.log('imconnector.connector.data.set result:', dataResult.data(), dataResult.error());
          
          // Step 3: Save mapping to our database
          fetch(WEBHOOK_URL + '?action=complete_setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'complete_setup',
              workspace_id: WORKSPACE_ID,
              integration_id: INTEGRATION_ID,
              instance_id: instanceId,
              line_id: LINE_ID,
              line_name: 'Linha ' + LINE_ID
            })
          })
          .then(res => res.json())
          .then(result => {
            console.log('complete_setup result:', result);
            
            if (result.error) {
              errorEl.textContent = '❌ ' + result.error;
              errorEl.classList.add('show');
              btn.disabled = false;
              loading.classList.remove('show');
              return;
            }
            
            successEl.textContent = '✓ Configuração concluída!';
            successEl.classList.add('show');
            loading.classList.remove('show');
            
            // CRITICAL: Close application to signal Bitrix24 that setup is complete
            setTimeout(function() {
              console.log('Closing application...');
              try {
                BX24.closeApplication();
              } catch(e) {
                console.log('BX24.closeApplication error:', e);
              }
            }, 1500);
          })
          .catch(err => {
            console.error('complete_setup error:', err);
            errorEl.textContent = '❌ Erro ao salvar configuração';
            errorEl.classList.add('show');
            btn.disabled = false;
            loading.classList.remove('show');
          });
        });
      });
    }
    
    // Event listeners
    document.getElementById('instanceSelect').addEventListener('change', updateSaveButton);
    
    // Initialize
    BX24.init(function() {
      console.log('BX24 initialized, LINE_ID:', LINE_ID, 'ACTIVE_STATUS:', ACTIVE_STATUS);
      populateInstances();
    });
  </script>
</body>
</html>`;
}

// Handler for PLACEMENT calls (when user opens connector settings in Contact Center)
async function handlePlacement(supabase: any, payload: any, supabaseUrl: string) {
  console.log("=== PLACEMENT HANDLER ===");
  console.log("Payload:", JSON.stringify(payload, null, 2));

  // Parse PLACEMENT_OPTIONS
  let options: { LINE?: number; ACTIVE_STATUS?: number } = {};
  if (typeof payload.PLACEMENT_OPTIONS === "string") {
    try {
      options = JSON.parse(payload.PLACEMENT_OPTIONS);
    } catch (e) {
      console.log("Failed to parse PLACEMENT_OPTIONS as JSON");
      options = payload.PLACEMENT_OPTIONS || {};
    }
  } else {
    options = payload.PLACEMENT_OPTIONS || {};
  }

  const lineId = options.LINE || 0;
  const activeStatus = options.ACTIVE_STATUS ?? 1; // Default to activate
  const domain = payload.auth?.domain || payload.DOMAIN;
  const memberId = payload.auth?.member_id || payload.member_id;

  console.log("Parsed - LINE:", lineId, "ACTIVE_STATUS:", activeStatus, "Domain:", domain, "MemberId:", memberId);

  // Find the integration
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
      `<html><body><h1>Erro</h1><p>Integração Bitrix24 não encontrada.</p></body></html>`,
      { status: 404, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  console.log("Found integration:", integration.id);

  const connectorId = integration.config?.connector_id || "thoth_whatsapp";
  const bitrixDomain = domain || integration.config?.domain;
  const webhookUrl = `${supabaseUrl}/functions/v1/bitrix24-webhook`;

  // Fetch existing mappings first
  const { data: mappings } = await supabase
    .from("bitrix_channel_mappings")
    .select("*")
    .eq("integration_id", integration.id);

  console.log("Existing mappings:", mappings?.length || 0);

  // If LINE is specified, handle activation/deactivation
  let activationResult: { success: boolean; error?: string } = { success: false };
  
  if (lineId > 0) {
    console.log("LINE specified, calling activateConnectorViaAPI with ACTIVE:", activeStatus);
    
    // Activate or deactivate based on ACTIVE_STATUS
    activationResult = await activateConnectorViaAPI(integration, supabase, lineId, activeStatus, webhookUrl);
    console.log("Activation result:", activationResult);
    
    // If deactivating (ACTIVE_STATUS = 0), just return success
    if (activeStatus === 0) {
      console.log("Deactivation requested, returning success");
      return new Response("successfully", {
        headers: { ...corsHeaders, "Content-Type": "text/plain" }
      });
    }
    
    // If activating and there's already a mapping for this line, return success immediately
    const existingMapping = mappings?.find((m: any) => m.line_id === lineId);
    if (existingMapping && activationResult.success) {
      console.log("Existing mapping found for line", lineId, "- returning success");
      return new Response("successfully", {
        headers: { ...corsHeaders, "Content-Type": "text/plain" }
      });
    }
  }

  // Fetch instances from the workspace
  const { data: instances, error: instancesError } = await supabase
    .from("instances")
    .select("id, name, phone_number, status")
    .eq("workspace_id", integration.workspace_id);

  if (instancesError) {
    console.error("Error fetching instances:", instancesError);
  }

  console.log("Found instances:", instances?.length || 0);

  // Show settings page for user to select instance
  return new Response(
    renderSettingsPage(
      options,
      connectorId,
      bitrixDomain,
      supabaseUrl,
      webhookUrl,
      instances || [],
      mappings || [],
      integration.id,
      integration.workspace_id,
      activationResult
    ),
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        ...corsHeaders,
      },
    }
  );
}

// Handle complete_setup action (activate connector + save mapping)
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

// Handle save_mapping action (legacy)
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
    const action = url.searchParams.get("action");
    const connectorId = url.searchParams.get("connector_id");

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

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

// Activate connector via Bitrix24 REST API (backend call)
async function activateConnectorViaAPI(
  integration: any, 
  supabase: any, 
  lineId: number, 
  webhookUrl: string
): Promise<{ success: boolean; error?: string }> {
  console.log("=== ACTIVATING CONNECTOR VIA API ===");
  console.log("Line ID:", lineId);
  
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
    // 1. First, activate the connector for this line
    const activateUrl = `${clientEndpoint}imconnector.activate`;
    console.log("Calling imconnector.activate...");
    
    const activateResponse = await fetch(activateUrl, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        auth: accessToken,
        CONNECTOR: connectorId,
        LINE: lineId,
        ACTIVE: 1
      })
    });
    
    const activateResult = await activateResponse.json();
    console.log("Activate result:", JSON.stringify(activateResult, null, 2));
    
    if (activateResult.error) {
      console.error("Activate error:", activateResult.error, activateResult.error_description);
      // Don't fail completely, try to continue
    }
    
    // 2. Set connector data with URLs
    const dataSetUrl = `${clientEndpoint}imconnector.connector.data.set`;
    console.log("Calling imconnector.connector.data.set...");
    
    const dataSetResponse = await fetch(dataSetUrl, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json"
      },
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
    
    // 3. Also register the connector if not already registered
    const registerUrl = `${clientEndpoint}imconnector.register`;
    console.log("Calling imconnector.register (just in case)...");
    
    const registerResponse = await fetch(registerUrl, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        auth: accessToken,
        ID: connectorId,
        NAME: "Thoth WhatsApp",
        ICON: {
          DATA_IMAGE: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSIjMjVEMzY2Ij48cGF0aCBkPSJNMTcuNDcyIDQuMzA4YTkuOTcgOS45NyAwIDAgMC03LjA1Ni0yLjkyOGMtNS41NDUgMC0xMC4wNTggNC41MS0xMC4wNjIgMTAuMDUxYS45OTQuOTk0IDAgMCAwIC4wMDMuMTc4Yy4wMDcgMS44MTguNDg3IDMuNTk0IDEuMzk0IDUuMTRsLTEuNDk0IDUuNDE3YS41LjUgMCAwIDAgLjYxLjYxTDYuMyAyMS4yOTFhMTAgMTAgMCAwIDAgNC43NjMgMS4yMjJoLjAwNGM1LjU0IDAgMTAuMDUtNC41MDcgMTAuMDU0LTEwLjA1MWE5Ljk3IDkuOTcgMCAwIDAtMi45MDctNy4wNjRsLS43NDItLjA5Wm0tNS45MjYgMTUuNWgtLjAwMWE4LjMzOCA4LjMzOCAwIDAgMS00LjI1Mi0xLjE3bC0uMzA2LS4xODEtMy4xNzEuODMyLjg0Ny0zLjA4OS0uMTk5LS4zMTZhOC4zMjEgOC4zMjEgMCAwIDEtMS4yNzctNC40NGMuMDAzLTQuNjI1IDMuNzY5LTguMzkgOC4zOTgtOC4zOWE4LjMzMiA4LjMzMiAwIDAgMSA1LjkxNCAyLjQ0OCA4LjMxNCA4LjMxNCAwIDAgMSAyLjQ0MyA1LjkxYy0uMDAzIDQuNjI4LTMuNzY4IDguMzk3LTguMzk2IDguMzk2Wm00LjU5Ny05LjQ5Yy0uMjUyLS4xMjYtMS40OS0uNzM1LTEuNzItLjgxOS0uMjMtLjA4NC0uMzk4LS4xMjYtLjU2Ni4xMjYtLjE2OC4yNTItLjY1MS44MTktLjc5OC45ODctLjE0Ny4xNjgtLjI5NC4xOS0uNTQ2LjA2My0uMjUyLS4xMjYtMS4wNjQtLjM5Mi0yLjAyNS0xLjI1LS43NDgtLjY2Ny0xLjI1NC0xLjQ5MS0xLjQwMi0xLjc0NC0uMTQ3LS4yNTItLjAxNS0uMzg4LjExMS0uNTEzLjExNC0uMTEyLjI1Mi0uMjk0LjM3OC0uNDQuMTI2LS4xNDcuMTY4LS4yNTIuMjUyLS40Mi4wODQtLjE2OC4wNDItLjMxNS0uMDIxLS40NC0uMDYzLS4xMjYtLjU2Ni0xLjM2Ny0uNzc2LTEuODcxLS4yMDQtLjQ5MS0uNDEyLS40MjUtLjU2Ni0uNDMzLS4xNDctLjAwNy0uMzE1LS4wMDktLjQ4My0uMDA5cy0uNDQuMDYzLS42NzIuMzE1Yy0uMjMuMjUyLS44ODIuODYxLS44ODIgMi4xczkwMyAyLjQzOC45MDMgMi40MzhjMCAuMDAxIDEuNTY5IDIuMzk1IDMuNzk4IDMuMzU5LjUzMS4yMjkuOTQ1LjM2NiAxLjI2OC40N2ExLjU3NiAxLjU3NiAwIDAgMCAxLjQ0Ny0uMDk3Yy4zNjctLjIxLjk2Ni0uNzc5IDEuMTAyLTEuNTMyLjEzNS0uNzUyLjEzNS0xLjM5Ny4wOTQtMS41My0uMDQxLS4xMzQtLjE1Mi0uMjA4LS4zMjMtLjI3M1oiLz48L3N2Zz4="
        },
        PLACEMENT_HANDLER: webhookUrl
      })
    });
    
    const registerResult = await registerResponse.json();
    console.log("Register result:", JSON.stringify(registerResult, null, 2));
    
    return { success: true };
  } catch (error) {
    console.error("Error activating connector:", error);
    return { success: false, error: error instanceof Error ? error.message : "Erro desconhecido" };
  }
}

// Generate HTML settings page for the connector with instance and channel selection
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
  const isActivated = activationResult?.success || false;

  // JSON encode instances and mappings for JS
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
      max-width: 600px;
      margin: 0 auto;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(148, 163, 184, 0.1);
    }
    .header {
      text-align: center;
      margin-bottom: 32px;
    }
    .logo {
      width: 72px;
      height: 72px;
      background: linear-gradient(135deg, #25D366 0%, #128C7E 100%);
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
      font-size: 36px;
    }
    h2 {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 8px;
      color: #f8fafc;
    }
    .subtitle {
      color: #94a3b8;
      font-size: 14px;
    }
    .activation-status {
      padding: 16px;
      border-radius: 12px;
      margin-bottom: 24px;
      text-align: center;
    }
    .activation-status.success {
      background: rgba(34, 197, 94, 0.15);
      border: 1px solid rgba(34, 197, 94, 0.3);
    }
    .activation-status.error {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
    }
    .activation-status.pending {
      background: rgba(234, 179, 8, 0.15);
      border: 1px solid rgba(234, 179, 8, 0.3);
    }
    .activation-status h3 {
      font-size: 16px;
      margin-bottom: 4px;
    }
    .activation-status.success h3 { color: #4ade80; }
    .activation-status.error h3 { color: #f87171; }
    .activation-status.pending h3 { color: #fbbf24; }
    .activation-status p {
      font-size: 14px;
      color: #94a3b8;
    }
    .channel-info {
      background: rgba(15, 23, 42, 0.5);
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 20px;
    }
    .channel-info .label {
      font-size: 12px;
      color: #64748b;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .channel-info .value {
      font-size: 16px;
      color: #f1f5f9;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .channel-info .value .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #25D366;
    }
    .section {
      margin-bottom: 24px;
    }
    .section-title {
      font-size: 16px;
      font-weight: 600;
      color: #f1f5f9;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
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
      transition: border-color 0.2s;
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
      padding: 12px 24px;
      font-size: 14px;
      font-weight: 600;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    button.primary {
      background: linear-gradient(135deg, #25D366 0%, #128C7E 100%);
      color: white;
      width: 100%;
    }
    button.primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 20px -5px rgba(37, 211, 102, 0.4);
    }
    button.primary:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none !important;
      box-shadow: none !important;
    }
    button.danger {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.3);
      padding: 6px 12px;
      font-size: 12px;
    }
    button.danger:hover {
      background: rgba(239, 68, 68, 0.25);
    }
    .mappings-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 16px;
    }
    .mappings-table th,
    .mappings-table td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    }
    .mappings-table th {
      font-size: 12px;
      color: #94a3b8;
      font-weight: 500;
      text-transform: uppercase;
    }
    .mappings-table td {
      font-size: 14px;
      color: #f1f5f9;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
    }
    .badge.active {
      background: rgba(34, 197, 94, 0.15);
      color: #4ade80;
    }
    .badge.inactive {
      background: rgba(148, 163, 184, 0.15);
      color: #94a3b8;
    }
    .empty-state {
      text-align: center;
      padding: 32px;
      color: #64748b;
    }
    .empty-state svg {
      width: 48px;
      height: 48px;
      margin-bottom: 16px;
      opacity: 0.5;
    }
    .loading {
      display: none;
      color: #94a3b8;
      font-size: 14px;
      text-align: center;
      padding: 16px;
    }
    .loading.show {
      display: block;
    }
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(148, 163, 184, 0.3);
      border-top-color: #94a3b8;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-right: 8px;
      vertical-align: middle;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
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
    .message.show {
      display: block;
    }
    .divider {
      height: 1px;
      background: rgba(148, 163, 184, 0.1);
      margin: 24px 0;
    }
    .help-text {
      font-size: 13px;
      color: #64748b;
      margin-top: 8px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">📱</div>
      <h2>Thoth WhatsApp</h2>
      <p class="subtitle">Vincule seus números W-API aos Canais Abertos do Bitrix24</p>
    </div>

    ${lineId > 0 ? `
    <div class="activation-status ${isActivated ? 'success' : 'pending'}">
      <h3>${isActivated ? '✓ Conector Ativado' : '⏳ Finalizando Configuração...'}</h3>
      <p>${isActivated ? 'O conector está pronto para uso' : 'Selecione uma instância W-API para completar'}</p>
    </div>
    
    <div class="channel-info">
      <div class="label">Canal Aberto Selecionado</div>
      <div class="value">
        <span class="dot"></span>
        Linha ${lineId}
      </div>
    </div>
    ` : ''}

    <div class="section">
      <div class="section-title">
        <span>🔗</span> ${lineId > 0 ? 'Vincular Instância' : 'Novo Mapeamento'}
      </div>
      
      <div class="form-group">
        <label>Instância W-API (Número WhatsApp)</label>
        <select id="instanceSelect">
          <option value="">Selecione uma instância...</option>
        </select>
        <p class="help-text">Selecione qual número de WhatsApp receberá as mensagens deste canal</p>
      </div>
      
      ${lineId === 0 ? `
      <div class="form-group">
        <label>Canal Aberto do Bitrix24</label>
        <select id="channelSelect">
          <option value="">Carregando canais...</option>
        </select>
      </div>
      ` : ''}
      
      <button class="primary" id="saveBtn" onclick="completeSetup()" disabled>
        ✓ ${lineId > 0 ? 'Finalizar Configuração' : 'Vincular Canal'}
      </button>
      
      <p class="loading" id="loading">
        <span class="spinner"></span>
        Processando...
      </p>
      
      <div class="message error" id="error"></div>
      <div class="message success" id="success"></div>
    </div>

    <div class="divider"></div>

    <div class="section">
      <div class="section-title">
        <span>📋</span> Mapeamentos Ativos
      </div>
      
      <div id="mappingsContainer">
        <div class="empty-state" id="emptyState">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path>
          </svg>
          <p>Nenhum mapeamento configurado</p>
        </div>
        
        <table class="mappings-table" id="mappingsTable" style="display: none;">
          <thead>
            <tr>
              <th>Instância W-API</th>
              <th>Canal Bitrix24</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="mappingsBody">
          </tbody>
        </table>
      </div>
    </div>
  </div>
  
  <script src="//api.bitrix24.com/api/v1/"></script>
  <script>
    const CONNECTOR = '${connectorId}';
    const WEBHOOK_URL = '${webhookUrl}';
    const INTEGRATION_ID = '${integrationId}';
    const WORKSPACE_ID = '${workspaceId}';
    const LINE_FROM_BITRIX = ${lineId};
    const ALREADY_ACTIVATED = ${isActivated};
    
    // Data from backend
    const instances = ${instancesJson};
    const existingMappings = ${mappingsJson};
    
    let channels = [];
    let selectedChannelId = LINE_FROM_BITRIX;
    let selectedChannelName = 'Linha ' + LINE_FROM_BITRIX;
    
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
      
      updateSaveButton();
    }
    
    // Load Bitrix24 Open Channels (only if no LINE specified)
    function loadChannels() {
      if (LINE_FROM_BITRIX > 0) {
        // Channel already specified, no need to load
        updateSaveButton();
        return;
      }
      
      const select = document.getElementById('channelSelect');
      if (!select) return;
      
      BX24.callMethod('imopenlines.config.list.get', {}, function(result) {
        console.log('Open Lines result:', result);
        
        if (result.error()) {
          console.error('Error loading channels:', result.error());
          select.innerHTML = '<option value="">Erro ao carregar canais</option>';
          return;
        }
        
        const data = result.data();
        if (!data || data.length === 0) {
          select.innerHTML = '<option value="">Nenhum canal encontrado</option>';
          return;
        }
        
        channels = data;
        select.innerHTML = '<option value="">Selecione um canal...</option>';
        
        data.forEach(channel => {
          const option = document.createElement('option');
          option.value = channel.ID;
          option.dataset.name = channel.LINE_NAME || 'Canal ' + channel.ID;
          option.textContent = (channel.ACTIVE === 'Y' ? '🟢 ' : '⚪ ') + (channel.LINE_NAME || 'Canal ' + channel.ID);
          select.appendChild(option);
        });
        
        updateSaveButton();
      });
    }
    
    // Update save button state
    function updateSaveButton() {
      const instanceId = document.getElementById('instanceSelect').value;
      const channelSelect = document.getElementById('channelSelect');
      const channelId = channelSelect ? channelSelect.value : LINE_FROM_BITRIX;
      document.getElementById('saveBtn').disabled = !instanceId || !channelId;
    }
    
    // Render mappings table
    function renderMappings() {
      const tbody = document.getElementById('mappingsBody');
      const table = document.getElementById('mappingsTable');
      const empty = document.getElementById('emptyState');
      
      if (!existingMappings || existingMappings.length === 0) {
        table.style.display = 'none';
        empty.style.display = 'block';
        return;
      }
      
      table.style.display = 'table';
      empty.style.display = 'none';
      
      tbody.innerHTML = '';
      
      existingMappings.forEach(mapping => {
        // Find instance name
        const inst = instances.find(i => i.id === mapping.instance_id);
        const instName = inst ? inst.name + ' (' + (inst.phone_number || 'Sem número') + ')' : mapping.instance_id;
        
        const tr = document.createElement('tr');
        tr.innerHTML = 
          '<td>' + instName + '</td>' +
          '<td>' + (mapping.line_name || 'Linha ' + mapping.line_id) + '</td>' +
          '<td><span class="badge ' + (mapping.is_active ? 'active' : 'inactive') + '">' + (mapping.is_active ? '✓ Ativo' : '○ Inativo') + '</span></td>' +
          '<td><button class="danger" onclick="deleteMapping(\\'' + mapping.id + '\\')">✕ Remover</button></td>';
        tbody.appendChild(tr);
      });
    }
    
    // Complete setup - activate connector and save mapping
    function completeSetup() {
      const instanceId = document.getElementById('instanceSelect').value;
      const channelSelect = document.getElementById('channelSelect');
      
      let channelId, channelName;
      
      if (LINE_FROM_BITRIX > 0) {
        channelId = LINE_FROM_BITRIX;
        channelName = 'Linha ' + LINE_FROM_BITRIX;
      } else {
        channelId = parseInt(channelSelect.value);
        channelName = channelSelect.options[channelSelect.selectedIndex].dataset.name || 'Canal ' + channelId;
      }
      
      if (!instanceId || !channelId) return;
      
      const btn = document.getElementById('saveBtn');
      const loading = document.getElementById('loading');
      const errorEl = document.getElementById('error');
      const successEl = document.getElementById('success');
      
      errorEl.classList.remove('show');
      successEl.classList.remove('show');
      btn.disabled = true;
      loading.classList.add('show');
      
      // Activate connector via BX24 API (ensures it's activated from Bitrix24 side)
      BX24.callMethod('imconnector.activate', {
        CONNECTOR: CONNECTOR,
        LINE: channelId,
        ACTIVE: 1
      }, function(activateResult) {
        console.log('Activate result:', activateResult);
        
        // Even if activation fails, continue to save mapping
        // (backend already tried to activate)
        
        // Set connector data
        BX24.callMethod('imconnector.connector.data.set', {
          CONNECTOR: CONNECTOR,
          LINE: channelId,
          DATA: {
            id: CONNECTOR + '_line_' + channelId,
            url: WEBHOOK_URL,
            url_im: WEBHOOK_URL,
            name: 'Thoth WhatsApp'
          }
        }, function(dataResult) {
          console.log('Data set result:', dataResult);
          
          // Save mapping to our database
          fetch(WEBHOOK_URL + '?action=complete_setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'complete_setup',
              workspace_id: WORKSPACE_ID,
              integration_id: INTEGRATION_ID,
              instance_id: instanceId,
              line_id: channelId,
              line_name: channelName
            })
          })
          .then(res => res.json())
          .then(result => {
            console.log('Complete setup result:', result);
            
            if (result.error) {
              errorEl.textContent = '❌ ' + result.error;
              errorEl.classList.add('show');
              btn.disabled = false;
              loading.classList.remove('show');
              return;
            }
            
            successEl.textContent = '✓ Configuração concluída com sucesso!';
            successEl.classList.add('show');
            loading.classList.remove('show');
            
            // Notify Bitrix24 that setup is complete
            setTimeout(function() {
              try {
                BX24.closeApplication();
              } catch(e) {
                console.log('Could not close application:', e);
                location.reload();
              }
            }, 2000);
          })
          .catch(err => {
            console.error('Complete setup error:', err);
            errorEl.textContent = '❌ Erro ao salvar configuração';
            errorEl.classList.add('show');
            btn.disabled = false;
            loading.classList.remove('show');
          });
        });
      });
    }
    
    // Delete mapping
    function deleteMapping(mappingId) {
      if (!confirm('Deseja realmente remover este mapeamento?')) return;
      
      fetch(WEBHOOK_URL + '?action=delete_mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_mapping',
          mapping_id: mappingId
        })
      })
      .then(res => res.json())
      .then(result => {
        if (result.error) {
          alert('Erro: ' + result.error);
          return;
        }
        location.reload();
      })
      .catch(err => {
        console.error('Delete error:', err);
        alert('Erro ao remover mapeamento');
      });
    }
    
    // Event listeners
    document.getElementById('instanceSelect').addEventListener('change', updateSaveButton);
    const channelSelect = document.getElementById('channelSelect');
    if (channelSelect) {
      channelSelect.addEventListener('change', updateSaveButton);
    }
    
    // Initialize
    BX24.init(function() {
      console.log('BX24 initialized');
      populateInstances();
      loadChannels();
      renderMappings();
    });
  </script>
</body>
</html>`;
}

// Handler for PLACEMENT calls (when user opens connector settings in Contact Center)
async function handlePlacement(supabase: any, payload: any, supabaseUrl: string) {
  console.log("=== PLACEMENT HANDLER ===");
  console.log("Payload:", JSON.stringify(payload, null, 2));

  const placement = payload.PLACEMENT;

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
  const activeStatus = options.ACTIVE_STATUS ?? 0;
  const domain = payload.auth?.domain || payload.DOMAIN;
  const memberId = payload.auth?.member_id || payload.member_id;

  console.log("Parsed values - Placement:", placement, "Line ID:", lineId, "Active Status:", activeStatus, "Domain:", domain);

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
      `<html><body><h1>Erro</h1><p>Integração Bitrix24 não encontrada. Configure a integração primeiro.</p></body></html>`,
      { 
        status: 404, 
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } 
      }
    );
  }

  console.log("Found integration:", integration.id, "workspace:", integration.workspace_id);

  const connectorId = integration.config?.connector_id || "thoth_whatsapp";
  const bitrixDomain = domain || integration.config?.domain;
  const webhookUrl = `${supabaseUrl}/functions/v1/bitrix24-webhook`;

  // AUTO-ACTIVATE: If a LINE is specified, automatically activate the connector
  let activationResult: { success: boolean; error?: string } = { success: false };
  
  if (lineId && lineId > 0) {
    console.log("LINE specified, auto-activating connector...");
    activationResult = await activateConnectorViaAPI(integration, supabase, lineId, webhookUrl);
    console.log("Auto-activation result:", activationResult);
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

  // Fetch existing mappings
  const { data: mappings, error: mappingsError } = await supabase
    .from("bitrix_channel_mappings")
    .select("*")
    .eq("integration_id", integration.id);

  if (mappingsError) {
    console.error("Error fetching mappings:", mappingsError);
  }

  console.log("Found mappings:", mappings?.length || 0);

  // Return settings page with instances and mappings
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

  // Activate connector via API (redundant but ensures activation)
  const activationResult = await activateConnectorViaAPI(integration, supabase, line_id, webhookUrl);
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
      onConflict: "integration_id,instance_id"
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

// Handle save_mapping action (legacy, redirects to complete_setup)
async function handleSaveMapping(supabase: any, payload: any) {
  console.log("=== SAVE MAPPING ===");
  console.log("Payload:", JSON.stringify(payload, null, 2));

  const { workspace_id, integration_id, instance_id, line_id, line_name } = payload;

  if (!workspace_id || !integration_id || !instance_id || !line_id) {
    return new Response(
      JSON.stringify({ error: "Campos obrigatórios não preenchidos" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Upsert the mapping (update if exists, insert if not)
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
      onConflict: "integration_id,instance_id"
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
    JSON.stringify({ success: true, mapping: data }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// Handle delete_mapping action
async function handleDeleteMapping(supabase: any, payload: any) {
  console.log("=== DELETE MAPPING ===");
  console.log("Payload:", JSON.stringify(payload, null, 2));

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

  console.log("Mapping deleted:", mapping_id);

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
    const workspaceId = url.searchParams.get("workspace_id");
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

    console.log("Bitrix24 webhook received:", JSON.stringify(payload, null, 2));

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

        // Find the mapping for this line to get the correct instance
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
            console.log("Found instance from mapping:", instanceId);
          }
        }

        // Fallback to integration config if no mapping found
        if (!instanceId) {
          const { data: integration } = await supabase
            .from("integrations")
            .select("*")
            .eq("type", "bitrix24")
            .eq("is_active", true)
            .maybeSingle();

          if (integration) {
            const config = integration.config as Record<string, unknown>;
            instanceId = config?.instance_id as string;
          }
        }

        if (!instanceId) {
          console.error("No instance_id found for message routing");
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
        console.log("Bitrix24 operator typing event");
        break;
      }

      case "ONIMCONNECTORDIALOGFINISH": {
        const dialogId = payload.data?.DIALOG_ID;
        console.log("Bitrix24 dialog finished:", dialogId);
        break;
      }

      case "ONIMCONNECTORSTATUSDELETE": {
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

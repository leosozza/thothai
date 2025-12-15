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

// Generate HTML settings page for the connector
function renderSettingsPage(
  options: { LINE?: number; ACTIVE_STATUS?: number },
  connectorId: string,
  domain: string,
  supabaseUrl: string,
  webhookUrl: string
): string {
  const lineId = options.LINE || 0;
  const isConnected = options.ACTIVE_STATUS === 1;

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
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: #e2e8f0;
    }
    .container {
      background: rgba(30, 41, 59, 0.95);
      border-radius: 16px;
      padding: 32px;
      max-width: 400px;
      width: 100%;
      text-align: center;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(148, 163, 184, 0.1);
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
      margin-bottom: 24px;
    }
    .status {
      padding: 12px 20px;
      border-radius: 12px;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      font-weight: 500;
    }
    .status.connected {
      background: rgba(34, 197, 94, 0.15);
      color: #4ade80;
      border: 1px solid rgba(34, 197, 94, 0.3);
    }
    .status.disconnected {
      background: rgba(251, 191, 36, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(251, 191, 36, 0.3);
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid rgba(148, 163, 184, 0.1);
      font-size: 14px;
    }
    .info-row:last-of-type {
      border-bottom: none;
      margin-bottom: 24px;
    }
    .info-label {
      color: #94a3b8;
    }
    .info-value {
      color: #f1f5f9;
      font-weight: 500;
    }
    button {
      width: 100%;
      padding: 14px 24px;
      font-size: 16px;
      font-weight: 600;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    button.connect {
      background: linear-gradient(135deg, #25D366 0%, #128C7E 100%);
      color: white;
    }
    button.connect:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 20px -5px rgba(37, 211, 102, 0.4);
    }
    button.disconnect {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }
    button.disconnect:hover {
      background: rgba(239, 68, 68, 0.25);
    }
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none !important;
      box-shadow: none !important;
    }
    .loading {
      display: none;
      margin-top: 16px;
      color: #94a3b8;
      font-size: 14px;
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
    .error {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      padding: 12px;
      border-radius: 8px;
      margin-top: 16px;
      display: none;
      font-size: 14px;
    }
    .error.show {
      display: block;
    }
    .success {
      background: rgba(34, 197, 94, 0.15);
      color: #4ade80;
      padding: 12px;
      border-radius: 8px;
      margin-top: 16px;
      display: none;
      font-size: 14px;
    }
    .success.show {
      display: block;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">📱</div>
    <h2>Thoth WhatsApp</h2>
    <p class="subtitle">Integração de WhatsApp para Bitrix24</p>
    
    <div class="status ${isConnected ? 'connected' : 'disconnected'}">
      <span>${isConnected ? '✓' : '○'}</span>
      <span>${isConnected ? 'Conectado' : 'Não conectado'}</span>
    </div>
    
    <div class="info-row">
      <span class="info-label">Canal (LINE)</span>
      <span class="info-value">${lineId}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Conector</span>
      <span class="info-value">${connectorId}</span>
    </div>
    
    <button id="actionBtn" class="${isConnected ? 'disconnect' : 'connect'}" onclick="toggleConnection()">
      ${isConnected ? '✕ Desconectar' : '✓ Conectar Canal'}
    </button>
    
    <p class="loading" id="loading">
      <span class="spinner"></span>
      Processando...
    </p>
    
    <div class="error" id="error"></div>
    <div class="success" id="success"></div>
  </div>
  
  <script src="//api.bitrix24.com/api/v1/"></script>
  <script>
    const LINE = ${lineId};
    const CONNECTOR = '${connectorId}';
    const CURRENT_STATUS = ${isConnected ? 1 : 0};
    const WEBHOOK_URL = '${webhookUrl}';
    
    function showError(message) {
      const el = document.getElementById('error');
      el.textContent = '❌ ' + message;
      el.classList.add('show');
    }
    
    function showSuccess(message) {
      const el = document.getElementById('success');
      el.textContent = '✓ ' + message;
      el.classList.add('show');
    }
    
    function toggleConnection() {
      const btn = document.getElementById('actionBtn');
      const loading = document.getElementById('loading');
      
      document.getElementById('error').classList.remove('show');
      document.getElementById('success').classList.remove('show');
      
      btn.disabled = true;
      loading.classList.add('show');
      
      const newStatus = CURRENT_STATUS === 1 ? 0 : 1;
      
      console.log('Calling imconnector.activate with:', {
        CONNECTOR: CONNECTOR,
        LINE: LINE,
        ACTIVE: newStatus
      });
      
      BX24.callMethod('imconnector.activate', {
        CONNECTOR: CONNECTOR,
        LINE: LINE,
        ACTIVE: newStatus
      }, function(result) {
        console.log('imconnector.activate result:', result);
        
        if (result.error()) {
          console.error('Error:', result.error());
          showError(result.error().ex?.error_description || result.error());
          btn.disabled = false;
          loading.classList.remove('show');
          return;
        }
        
        if (newStatus === 1) {
          // When connecting, also set connector data
          console.log('Calling imconnector.connector.data.set');
          
          BX24.callMethod('imconnector.connector.data.set', {
            CONNECTOR: CONNECTOR,
            LINE: LINE,
            DATA: {
              id: CONNECTOR + '_line_' + LINE,
              url: WEBHOOK_URL,
              url_im: WEBHOOK_URL,
              name: 'Thoth WhatsApp'
            }
          }, function(dataResult) {
            console.log('imconnector.connector.data.set result:', dataResult);
            
            if (dataResult.error()) {
              console.error('Data set error:', dataResult.error());
            }
            
            showSuccess('Canal conectado com sucesso!');
            setTimeout(function() {
              location.reload();
            }, 1500);
          });
        } else {
          showSuccess('Canal desconectado.');
          setTimeout(function() {
            location.reload();
          }, 1500);
        }
      });
    }
    
    // Initialize BX24
    BX24.init(function() {
      console.log('BX24 initialized');
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

  console.log("Found integration:", integration.id);

  const connectorId = integration.config?.connector_id || "thoth_whatsapp";
  const bitrixDomain = domain || integration.config?.domain;
  const webhookUrl = `${supabaseUrl}/functions/v1/bitrix24-webhook`;

  // If this is SETTING_CONNECTOR placement, return the settings HTML page
  if (placement === "SETTING_CONNECTOR" || lineId) {
    console.log("=== RENDERING SETTINGS PAGE ===");
    
    return new Response(
      renderSettingsPage(options, connectorId, bitrixDomain, supabaseUrl, webhookUrl),
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          ...corsHeaders,
        },
      }
    );
  }

  // Default: return settings page
  return new Response(
    renderSettingsPage(options, connectorId, bitrixDomain, supabaseUrl, webhookUrl),
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        ...corsHeaders,
      },
    }
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

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * bitrix24-connector-settings
 * 
 * PLACEMENT_HANDLER for Bitrix24 Marketplace
 * Returns an embeddable HTML UI for configuring the Thoth WhatsApp connector
 * 
 * When user clicks on connector in Contact Center → Settings,
 * Bitrix24 opens this page in an iframe slider.
 * 
 * Must return "successfully" as plain text to mark setup as complete
 * OR return HTML for configuration UI
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// CSP for iframe embedding in Bitrix24
const cspValue = [
  "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:",
  "script-src * 'unsafe-inline' 'unsafe-eval'",
  "style-src * 'unsafe-inline'",
  "img-src * data: blob:",
  "connect-src *",
  "frame-ancestors *",
  "font-src * data:",
].join('; ');

// CRITICAL: Headers for iframe embedding - X-Frame-Options must NOT be DENY
const htmlHeaders = {
  ...corsHeaders,
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": cspValue,
  "X-Frame-Options": "ALLOWALL", // Allow embedding in any iframe
  "X-Content-Type-Options": "nosniff",
} as const;

const metaCsp = `<meta http-equiv="Content-Security-Policy" content="${cspValue}">
<meta http-equiv="X-Frame-Options" content="ALLOWALL">`;

// Debug logger interface
interface DebugLogEntry {
  function_name: string;
  integration_id?: string;
  workspace_id?: string;
  level: 'debug' | 'info' | 'warn' | 'error' | 'api_call' | 'api_response';
  category?: string;
  message: string;
  details?: Record<string, unknown>;
  request_id?: string;
  http_method?: string;
  http_path?: string;
  http_status?: number;
  duration_ms?: number;
}

// Debug logger class for collecting and sending logs
class DebugLogger {
  private logs: DebugLogEntry[] = [];
  private requestId: string;
  private functionName = "bitrix24-connector-settings";
  private supabase: any;
  private integrationId?: string;
  private workspaceId?: string;
  private startTime: number;

  constructor(supabase: any, requestId: string) {
    this.supabase = supabase;
    this.requestId = requestId;
    this.startTime = Date.now();
  }

  setContext(integrationId?: string, workspaceId?: string) {
    this.integrationId = integrationId;
    this.workspaceId = workspaceId;
  }

  private addLog(level: DebugLogEntry['level'], message: string, category?: string, details?: Record<string, unknown>) {
    const entry: DebugLogEntry = {
      function_name: this.functionName,
      integration_id: this.integrationId,
      workspace_id: this.workspaceId,
      level,
      category,
      message,
      details,
      request_id: this.requestId,
    };
    this.logs.push(entry);
    
    // Also log to console for immediate visibility
    const prefix = `[${this.requestId}] [${level.toUpperCase()}]`;
    console.log(`${prefix} ${message}`, details ? JSON.stringify(details).substring(0, 500) : "");
  }

  debug(message: string, details?: Record<string, unknown>) {
    this.addLog('debug', message, undefined, details);
  }

  info(message: string, details?: Record<string, unknown>) {
    this.addLog('info', message, undefined, details);
  }

  warn(message: string, details?: Record<string, unknown>) {
    this.addLog('warn', message, undefined, details);
  }

  error(message: string, details?: Record<string, unknown>) {
    this.addLog('error', message, undefined, details);
  }

  request(method: string, path: string, headers: Record<string, string>, body?: unknown) {
    this.addLog('info', `Incoming ${method} request`, 'request', {
      http_method: method,
      http_path: path,
      headers,
      body: body ? JSON.stringify(body).substring(0, 2000) : undefined
    });
  }

  apiCall(url: string, method: string, payload?: unknown) {
    this.addLog('api_call', `API Call: ${method} ${url}`, 'bitrix_api', {
      url,
      method,
      payload: payload ? JSON.stringify(payload).substring(0, 1000) : undefined
    });
  }

  apiResponse(url: string, status: number, response?: unknown) {
    this.addLog('api_response', `API Response: ${status} from ${url}`, 'bitrix_api', {
      url,
      status,
      response: response ? JSON.stringify(response).substring(0, 1000) : undefined
    });
  }

  response(status: number, message: string, headers?: Record<string, string>) {
    const duration = Date.now() - this.startTime;
    this.addLog('info', `Response: ${status} - ${message}`, 'response', {
      http_status: status,
      duration_ms: duration,
      headers
    });
  }

  // Flush all logs to database
  async flush(): Promise<void> {
    if (this.logs.length === 0) return;
    
    try {
      const duration = Date.now() - this.startTime;
      
      // Add duration to all logs
      const logsWithDuration = this.logs.map((log, index) => ({
        ...log,
        duration_ms: index === this.logs.length - 1 ? duration : undefined
      }));

      // Insert logs directly using service role
      const { error } = await this.supabase
        .from("bitrix_debug_logs")
        .insert(logsWithDuration);

      if (error) {
        console.error("Failed to flush debug logs:", error);
      }
    } catch (err) {
      console.error("Error flushing debug logs:", err);
    }
  }
}

// Generate unique request ID
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// Helper to refresh Bitrix24 OAuth token
async function refreshBitrixToken(integration: any, supabase: any, logger?: DebugLogger): Promise<string | null> {
  const config = integration.config;
  
  if (!config.access_token) {
    logger?.warn("No access token configured");
    return null;
  }

  if (config.token_expires_at) {
    const expiresAt = new Date(config.token_expires_at);
    const now = new Date();
    const bufferMs = 5 * 60 * 1000;
    
    if (expiresAt.getTime() - now.getTime() > bufferMs) {
      logger?.debug("Token still valid", { expires_at: config.token_expires_at });
      return config.access_token;
    }
  }

  if (!config.refresh_token) {
    logger?.warn("No refresh token available");
    return config.access_token;
  }

  const refreshUrl = `https://oauth.bitrix.info/oauth/token/?grant_type=refresh_token&client_id=${config.client_id || ""}&client_secret=${config.client_secret || ""}&refresh_token=${config.refresh_token}`;
  
  try {
    logger?.apiCall(refreshUrl, "GET");
    const response = await fetch(refreshUrl);
    const data = await response.json();
    logger?.apiResponse(refreshUrl, response.status, data);

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

      logger?.info("Token refreshed successfully", { new_expires_at: newExpiresAt });
      return data.access_token;
    }
  } catch (error) {
    logger?.error("Error refreshing token", { error: error instanceof Error ? error.message : "Unknown error" });
  }

  return config.access_token;
}

// Helper to create HTML response with logging - ensures proper UTF-8 encoding
function createHtmlResponse(html: string, status = 200, logger?: DebugLogger): Response {
  // Use TextEncoder to ensure proper UTF-8 encoding of Portuguese characters
  const encoder = new TextEncoder();
  const utf8Bytes = encoder.encode(html);
  
  const response = new Response(utf8Bytes, { 
    status, 
    headers: htmlHeaders 
  });
  logger?.response(status, "HTML response sent", Object.fromEntries(response.headers.entries()));
  return response;
}

serve(async (req) => {
  const requestId = generateRequestId();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  // Initialize debug logger
  const logger = new DebugLogger(supabase, requestId);
  
  // Collect ALL request headers for debugging
  const allHeaders: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    allHeaders[key] = value.substring(0, 200); // Limit value length
  });
  
  const url = new URL(req.url);
  logger.info("=== CONNECTOR-SETTINGS REQUEST ===", {
    method: req.method,
    url: req.url,
    pathname: url.pathname,
    search: url.search,
    headers: allHeaders
  });
  
  if (req.method === "OPTIONS") {
    logger.response(200, "CORS preflight");
    await logger.flush();
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Parse body (form or JSON)
    let body: Record<string, any> = {};
    const contentType = req.headers.get("content-type") || "";

    // For GET requests, try to get parameters from URL
    if (req.method === "GET") {
      url.searchParams.forEach((value, key) => {
        body[key] = value;
      });
      logger.info("GET request - parsed URL params", { params: body });
    } else if (contentType.includes("application/json")) {
      try {
        body = await req.json();
      } catch (e) {
        logger.warn("Failed to parse JSON body", { error: e instanceof Error ? e.message : "Unknown" });
      }
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      try {
        const formData = await req.formData();
        for (const [key, value] of formData.entries()) {
          if (key.startsWith("auth[")) {
            const authKey = key.replace("auth[", "").replace("]", "");
            if (!body.auth) body.auth = {};
            body.auth[authKey] = value;
          } else {
            body[key] = value;
          }
        }
      } catch (e) {
        logger.warn("Failed to parse form data", { error: e instanceof Error ? e.message : "Unknown" });
      }
    }

    logger.info("Request body parsed", { 
      body_keys: Object.keys(body),
      body_preview: JSON.stringify(body).substring(0, 500),
      has_placement: !!body.PLACEMENT,
      has_auth: !!body.AUTH_ID || !!body.auth,
      content_type: contentType,
      method: req.method
    });

    // Extract auth data from Bitrix24 PLACEMENT call
    const authId = body.AUTH_ID || body.auth?.access_token;
    let domain = body.auth?.domain || body.DOMAIN;
    let memberId = body.auth?.member_id || body.member_id;
    const placement = body.PLACEMENT;

    // For GET requests without domain/memberId, try to extract from referer
    if (!domain && !memberId) {
      const referer = req.headers.get("referer") || "";
      const origin = req.headers.get("origin") || "";
      
      // Try to extract domain from referer (e.g., https://thoth24.bitrix24.com.br/...)
      const domainMatch = (referer || origin).match(/https?:\/\/([^\/]+\.bitrix24\.[^\/]+)/);
      if (domainMatch) {
        domain = domainMatch[1];
        logger.info("Extracted domain from referer/origin", { domain, referer, origin });
      }
    }

    logger.info("Parsed Bitrix24 parameters", {
      auth_id_present: !!authId,
      auth_id_preview: authId ? authId.substring(0, 20) + "..." : null,
      domain,
      member_id: memberId,
      placement,
      request_method: req.method
    });

    // Parse PLACEMENT_OPTIONS
    let options: { LINE?: number; ACTIVE_STATUS?: number; CONNECTOR?: string } = {};
    if (typeof body.PLACEMENT_OPTIONS === "string") {
      try {
        options = JSON.parse(body.PLACEMENT_OPTIONS);
      } catch {
        try {
          options = JSON.parse(decodeURIComponent(body.PLACEMENT_OPTIONS));
        } catch {
          options = {};
        }
      }
    } else if (body.PLACEMENT_OPTIONS) {
      options = body.PLACEMENT_OPTIONS;
    }

    console.log("PLACEMENT_OPTIONS:", options);

    const lineId = options.LINE || 1;
    const activeStatus = options.ACTIVE_STATUS ?? 1;
    const connectorId = options.CONNECTOR || "thoth_whatsapp";

    // Find integration
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

    // If no integration found, return HTML with instructions
    if (!integration) {
      console.log("No integration found, returning setup HTML");
      
      const setupHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${metaCsp}
  <title>Thoth WhatsApp - Configuração</title>
  <script src="https://api.bitrix24.com/api/v1/"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 24px;
      background: #f5f7fa;
      min-height: 100vh;
    }
    .container { max-width: 480px; margin: 0 auto; }
    .card {
      background: white;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      margin-bottom: 16px;
    }
    h1 { 
      color: #25D366; 
      font-size: 24px; 
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    h1 svg { width: 32px; height: 32px; }
    p { color: #666; line-height: 1.6; margin-bottom: 12px; }
    .steps { margin-top: 20px; }
    .step {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
      padding: 12px;
      background: #f9fafb;
      border-radius: 8px;
    }
    .step-number {
      width: 28px;
      height: 28px;
      background: #25D366;
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      flex-shrink: 0;
    }
    .step-content { flex: 1; }
    .step-title { font-weight: 600; color: #333; margin-bottom: 4px; }
    .step-desc { font-size: 14px; color: #666; }
    .btn {
      display: inline-block;
      background: #25D366;
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      margin-top: 16px;
      border: none;
      cursor: pointer;
    }
    .btn:hover { background: #1da851; }
    .info {
      background: #e8f5e9;
      border-left: 4px solid #25D366;
      padding: 12px;
      border-radius: 4px;
      margin-top: 16px;
    }
    .info p { margin: 0; color: #1b5e20; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>
        <svg viewBox="0 0 24 24" fill="none" stroke="#25D366" stroke-width="2">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
        </svg>
        Thoth WhatsApp
      </h1>
      <p>Para completar a configuração, você precisa vincular seu workspace Thoth.ai a este portal Bitrix24.</p>
      
      <div class="steps">
        <div class="step">
          <div class="step-number">1</div>
          <div class="step-content">
            <div class="step-title">Acesse o Thoth.ai</div>
            <div class="step-desc">Faça login em <strong>chat.thoth24.com</strong></div>
          </div>
        </div>
        <div class="step">
          <div class="step-number">2</div>
          <div class="step-content">
            <div class="step-title">Gere um Token</div>
            <div class="step-desc">Vá em Configurações → Integrações → Bitrix24 → Gerar Token</div>
          </div>
        </div>
        <div class="step">
          <div class="step-number">3</div>
          <div class="step-content">
            <div class="step-title">Cole o Token</div>
            <div class="step-desc">Volte aqui e insira o token gerado para vincular</div>
          </div>
        </div>
      </div>

      <div class="info">
        <p>💡 O token é válido por 7 dias e só pode ser usado uma vez.</p>
      </div>
    </div>
  </div>
  
  <script>
    if (typeof BX24 !== 'undefined') {
      BX24.init(function() {
        // CRITICAL: Always call installFinish to ensure app is marked as installed
        BX24.installFinish();
        console.log('BX24.installFinish() called in setup HTML');
        BX24.fitWindow();
      });
    }
  </script>
</body>
</html>`;

      logger.info("No integration found, returning setup instructions");
      await logger.flush();
      return createHtmlResponse(setupHtml, 200, logger);
    }

    logger.info("Found integration", { integration_id: integration.id, workspace_id: integration.workspace_id });
    logger.setContext(integration.id, integration.workspace_id);

    // Check if already configured
    const config = integration.config || {};
    const eventsUrl = `${supabaseUrl}/functions/v1/bitrix24-events`;

    // Check if connector is already fully configured
    const isFullyConfigured = integration.workspace_id && 
                              config.connector_configured_at && 
                              config.activated_line_id;

    logger.info("Configuration status check", {
      workspace_linked: !!integration.workspace_id,
      connector_configured_at: config.connector_configured_at,
      activated_line_id: config.activated_line_id,
      is_fully_configured: isFullyConfigured,
      placement
    });

    // If already fully configured and this is a status check, return "successfully"
    // Bitrix24 expects "successfully" (plain text) to mark connector as ready
    if (isFullyConfigured && (placement === "SETTING_CONNECTOR" || !placement)) {
      logger.info("Connector already configured, returning 'successfully'");
      await logger.flush();
      return new Response("successfully", {
        status: 200,
        headers: { 
          ...corsHeaders, 
          "Content-Type": "text/plain; charset=utf-8" 
        }
      });
    }

    // If this is a SETTING_CONNECTOR placement call, activate the connector
    if (placement === "SETTING_CONNECTOR" || activeStatus === 1) {
      logger.info("Activating connector", { connector_id: connectorId, line_id: lineId, active_status: activeStatus });
      
      const accessToken = authId || await refreshBitrixToken(integration, supabase, logger);
      // IMPORTANT: Always use config.domain for REST API calls, NOT client_endpoint (which is oauth.bitrix.info)
      const apiUrl = domain ? `https://${domain}/rest/` : `https://${config.domain}/rest/`;

      if (accessToken) {
        try {
          // 1. Activate connector using imconnector.activate
          const activateUrl = `${apiUrl}imconnector.activate`;
          const activatePayload = { auth: accessToken, CONNECTOR: connectorId, LINE: lineId, ACTIVE: activeStatus };
          logger.apiCall(activateUrl, "POST", activatePayload);
          
          const activateResponse = await fetch(activateUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(activatePayload)
          });
          const activateResult = await activateResponse.json();
          logger.apiResponse(activateUrl, activateResponse.status, activateResult);

          // 2. Set connector data - use bitrix24-events (public, no JWT)
          if (activeStatus === 1) {
            // 2. Set connector data
            const dataSetUrl = `${apiUrl}imconnector.connector.data.set`;
            const dataSetPayload = {
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
            logger.apiCall(dataSetUrl, "POST", dataSetPayload);
            
            const dataSetResponse = await fetch(dataSetUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(dataSetPayload)
            });
            const dataSetResult = await dataSetResponse.json();
            logger.apiResponse(dataSetUrl, dataSetResponse.status, dataSetResult);
          }

          // 3. Verify activation status via imopenlines.config.list.get
          const configListUrl = `${apiUrl}imopenlines.config.list.get`;
          logger.apiCall(configListUrl, "POST", { auth: "***" });
          
          const configListResponse = await fetch(configListUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ auth: accessToken })
          });
          const configListResult = await configListResponse.json();
          logger.apiResponse(configListUrl, configListResponse.status, configListResult);

          // Check if our line is active
          let connectorActive = false;
          if (configListResult.result && Array.isArray(configListResult.result)) {
            const ourLine = configListResult.result.find((line: any) => 
              String(line.ID) === String(lineId) || line.ID === lineId
            );
            if (ourLine) {
              connectorActive = ourLine.ACTIVE === "Y" || 
                               ourLine.connector_active === true || 
                               ourLine.connector_active === "true" ||
                               ourLine.connector_active === 1;
              logger.info("Line status found", { line_id: lineId, active: ourLine.ACTIVE, connector_active: ourLine.connector_active });
            } else {
              logger.warn("Line not found in config list", { line_id: lineId });
            }
          }

          // 4. Update integration config with verified status
          await supabase
            .from("integrations")
            .update({
              config: {
                ...config,
                connector_id: connectorId,
                line_id: lineId,
                activated_line_id: lineId,
                connector_active: connectorActive,
                connector_configured_at: new Date().toISOString(),
                activation_verified: true,
              },
              updated_at: new Date().toISOString()
            })
            .eq("id", integration.id);

          logger.info("Connector activation complete", { status: connectorActive ? "ACTIVE" : "PENDING" });

        } catch (error) {
          logger.error("Error activating connector", { error: error instanceof Error ? error.message : "Unknown error" });
        }
      }
    }

    // Check if workspace is linked
    if (!integration.workspace_id) {
      // Return HTML with token input
      const tokenHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${metaCsp}
  <title>Thoth WhatsApp - Vincular Workspace</title>
  <script src="https://api.bitrix24.com/api/v1/"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 24px;
      background: #f5f7fa;
    }
    .container { max-width: 480px; margin: 0 auto; }
    .card {
      background: white;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    h1 { color: #25D366; font-size: 24px; margin-bottom: 8px; }
    h2 { color: #333; font-size: 18px; margin-bottom: 16px; }
    p { color: #666; line-height: 1.6; margin-bottom: 16px; }
    .form-group { margin-bottom: 16px; }
    label { display: block; font-weight: 600; margin-bottom: 8px; color: #333; }
    input {
      width: 100%;
      padding: 12px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 16px;
      text-transform: uppercase;
      letter-spacing: 2px;
    }
    input:focus { border-color: #25D366; outline: none; }
    .btn {
      width: 100%;
      background: #25D366;
      color: white;
      padding: 14px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 16px;
      border: none;
      cursor: pointer;
    }
    .btn:hover { background: #1da851; }
    .btn:disabled { background: #ccc; cursor: not-allowed; }
    .success { color: #25D366; margin-top: 16px; text-align: center; }
    .error { color: #d32f2f; margin-top: 16px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>✓ App Instalado</h1>
      <h2>Vincular Workspace Thoth.ai</h2>
      <p>Insira o token de vinculação gerado no painel do Thoth.ai para conectar sua conta WhatsApp.</p>
      
      <div class="form-group">
        <label for="token">Token de Vinculação</label>
        <input type="text" id="token" placeholder="XXXX-XXXX" maxlength="9">
      </div>
      
      <button class="btn" id="validateBtn" onclick="validateToken()">
        Vincular Workspace
      </button>
      
      <div id="message"></div>
    </div>
  </div>
  
  <script>
    const SUPABASE_URL = "${supabaseUrl}";
    const MEMBER_ID = "${memberId || domain || ""}";
    const DOMAIN = "${domain || ""}";
    
    async function validateToken() {
      const token = document.getElementById('token').value.trim().toUpperCase();
      const btn = document.getElementById('validateBtn');
      const msg = document.getElementById('message');
      
      if (!token || token.length < 4) {
        msg.className = 'error';
        msg.textContent = 'Digite um token válido';
        return;
      }
      
      btn.disabled = true;
      btn.textContent = 'Validando...';
      
      try {
        const response = await fetch(SUPABASE_URL + '/functions/v1/bitrix24-install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'validate_token',
            token: token,
            member_id: MEMBER_ID,
            domain: DOMAIN
          })
        });
        
        const data = await response.json();
        
        if (data.success) {
          msg.className = 'success';
          msg.textContent = '✓ Workspace vinculado com sucesso! Recarregando...';
          setTimeout(() => location.reload(), 2000);
        } else {
          throw new Error(data.error || 'Token inválido');
        }
      } catch (err) {
        msg.className = 'error';
        msg.textContent = err.message || 'Erro ao validar token';
        btn.disabled = false;
        btn.textContent = 'Vincular Workspace';
      }
    }
    
    if (typeof BX24 !== 'undefined') {
      BX24.init(function() {
        // CRITICAL: Always call installFinish to ensure app is marked as installed
        BX24.installFinish();
        console.log('BX24.installFinish() called in token HTML');
        BX24.fitWindow();
      });
    }
  </script>
</body>
</html>`;

      logger.info("Workspace not linked, returning token input HTML");
      await logger.flush();
      return createHtmlResponse(tokenHtml, 200, logger);
    }

    // Workspace is linked - return success confirmation page
    const successHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${metaCsp}
  <title>Thoth WhatsApp - Configurado</title>
  <script src="https://api.bitrix24.com/api/v1/"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 24px;
      background: #f5f7fa;
    }
    .container { max-width: 480px; margin: 0 auto; }
    .card {
      background: white;
      border-radius: 12px;
      padding: 32px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      text-align: center;
    }
    .icon {
      width: 80px;
      height: 80px;
      background: #e8f5e9;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
    }
    .icon svg { width: 48px; height: 48px; color: #25D366; }
    h1 { color: #333; font-size: 24px; margin-bottom: 12px; }
    p { color: #666; line-height: 1.6; margin-bottom: 20px; }
    .status { 
      background: #e8f5e9; 
      color: #1b5e20;
      padding: 12px 20px;
      border-radius: 8px;
      display: inline-block;
      font-weight: 600;
    }
    .info {
      margin-top: 24px;
      padding: 16px;
      background: #f5f5f5;
      border-radius: 8px;
      text-align: left;
    }
    .info h3 { font-size: 14px; color: #333; margin-bottom: 8px; }
    .info p { font-size: 14px; color: #666; margin: 0; }
    .btn {
      display: inline-block;
      background: #25D366;
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      margin-top: 20px;
      border: none;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 6L9 17l-5-5"></path>
        </svg>
      </div>
      <h1>Configura&ccedil;&atilde;o Conclu&iacute;da!</h1>
      <p>O conector Thoth WhatsApp est&aacute; ativo e pronto para receber mensagens.</p>
      <span class="status">&#10003; Conectado</span>
      
      <div class="info">
        <h3>Pr&oacute;ximos passos:</h3>
        <p>Envie uma mensagem para seu n&uacute;mero WhatsApp para testar a integra&ccedil;&atilde;o. As mensagens aparecer&atilde;o no Chat Aberto do Bitrix24.</p>
      </div>
      
      <button class="btn" onclick="closeSettings()">Fechar</button>
    </div>
  </div>
  
  <script>
    function closeSettings() {
      if (typeof BX24 !== 'undefined') {
        // Return "successfully" to mark setup as complete in Bitrix24
        BX24.closeApplication({ result: 'successfully' });
      } else {
        window.close();
      }
    }
    
    if (typeof BX24 !== 'undefined') {
      BX24.init(function() {
        // CRITICAL: Always call installFinish to ensure app is marked as installed
        BX24.installFinish();
        console.log('BX24.installFinish() called in success HTML');
        BX24.fitWindow();
      });
    }
  </script>
</body>
</html>`;

    logger.info("Returning success HTML");
    await logger.flush();
    return createHtmlResponse(successHtml, 200, logger);

  } catch (error) {
    logger.error("Connector settings error", { error: error instanceof Error ? error.message : "Unknown error" });
    await logger.flush();
    
    // Return error HTML with meta CSP
    const errorHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Erro</title>
  ${metaCsp}
</head>
<body style="font-family: sans-serif; padding: 24px; text-align: center;">
  <h1 style="color: #d32f2f;">Erro</h1>
  <p>${error instanceof Error ? error.message : "Erro desconhecido"}</p>
</body>
</html>`;

    return createHtmlResponse(errorHtml, 500, logger);
  }
});

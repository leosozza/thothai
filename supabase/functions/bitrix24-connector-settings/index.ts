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

// Bitrix opens this handler inside an iframe (Contact Center → Settings).
// Some environments inject a very restrictive CSP; we set our own CSP to:
// - allow the Bitrix24 JS SDK
// - allow inline styles/scripts used by these simple HTML pages
// - allow embedding into Bitrix24 portals
const htmlHeaders = {
  ...corsHeaders,
  "Content-Type": "text/html; charset=utf-8",
  "X-Frame-Options": "ALLOWALL",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' https://api.bitrix24.com 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src *",
    "frame-ancestors https://*.bitrix24.com https://*.bitrix24.com.br",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; '),
} as const;

// Helper to refresh Bitrix24 OAuth token
async function refreshBitrixToken(integration: any, supabase: any): Promise<string | null> {
  const config = integration.config;
  
  if (!config.access_token) return null;

  if (config.token_expires_at) {
    const expiresAt = new Date(config.token_expires_at);
    const now = new Date();
    const bufferMs = 5 * 60 * 1000;
    
    if (expiresAt.getTime() - now.getTime() > bufferMs) {
      return config.access_token;
    }
  }

  if (!config.refresh_token) return config.access_token;

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

      return data.access_token;
    }
  } catch (error) {
    console.error("Error refreshing token:", error);
  }

  return config.access_token;
}

serve(async (req) => {
  console.log("=== BITRIX24-CONNECTOR-SETTINGS ===");
  console.log("Method:", req.method);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse body (form or JSON)
    let body: Record<string, any> = {};
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      body = await req.json();
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
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
    }

    console.log("Request body:", JSON.stringify(body, null, 2));

    // Extract auth data from Bitrix24 PLACEMENT call
    const authId = body.AUTH_ID || body.auth?.access_token;
    const domain = body.auth?.domain || body.DOMAIN;
    const memberId = body.auth?.member_id || body.member_id;
    const placement = body.PLACEMENT;

    console.log("Auth data:", { hasAuthId: !!authId, domain, memberId, placement });

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
        BX24.fitWindow();
      });
    }
  </script>
</body>
</html>`;

      return new Response(setupHtml, {
        headers: htmlHeaders,
      });
    }

    console.log("Found integration:", integration.id);

    // Check if already configured
    const config = integration.config || {};
    const eventsUrl = `${supabaseUrl}/functions/v1/bitrix24-events`;

    // If this is a SETTING_CONNECTOR placement call, activate the connector
    if (placement === "SETTING_CONNECTOR" || activeStatus === 1) {
      console.log("=== ACTIVATING CONNECTOR ===");
      
      const accessToken = authId || await refreshBitrixToken(integration, supabase);
      const apiUrl = domain ? `https://${domain}/rest/` : (config.client_endpoint || `https://${config.domain}/rest/`);

      if (accessToken) {
        try {
          // 1. Activate connector
          const activateResponse = await fetch(`${apiUrl}imconnector.activate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              auth: accessToken,
              CONNECTOR: connectorId,
              LINE: lineId,
              ACTIVE: activeStatus
            })
          });
          const activateResult = await activateResponse.json();
          console.log("imconnector.activate result:", activateResult);

          // 2. Set connector data - use bitrix24-events (public, no JWT)
          if (activeStatus === 1) {
            await fetch(`${apiUrl}imconnector.connector.data.set`, {
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
          }

          // 3. Update integration config
          await supabase
            .from("integrations")
            .update({
              config: {
                ...config,
                connector_id: connectorId,
                line_id: lineId,
                activated_line_id: lineId,
                connector_configured_at: new Date().toISOString(),
              },
              updated_at: new Date().toISOString()
            })
            .eq("id", integration.id);

        } catch (error) {
          console.error("Error activating connector:", error);
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
        BX24.fitWindow();
      });
    }
  </script>
</body>
</html>`;

      return new Response(tokenHtml, {
        headers: htmlHeaders,
      });
    }

    // Workspace is linked - return success confirmation page
    const successHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
      <h1>Configuração Concluída!</h1>
      <p>O conector Thoth WhatsApp está ativo e pronto para receber mensagens.</p>
      <span class="status">✓ Conectado</span>
      
      <div class="info">
        <h3>Próximos passos:</h3>
        <p>Envie uma mensagem para seu número WhatsApp para testar a integração. As mensagens aparecerão no Chat Aberto do Bitrix24.</p>
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
        BX24.fitWindow();
      });
    }
  </script>
</body>
</html>`;

    return new Response(successHtml, {
      headers: htmlHeaders,
    });

  } catch (error) {
    console.error("Connector settings error:", error);
    
    // Return error HTML
    const errorHtml = `<!DOCTYPE html>
<html>
<head><title>Erro</title></head>
<body style="font-family: sans-serif; padding: 24px; text-align: center;">
  <h1 style="color: #d32f2f;">Erro</h1>
  <p>${error instanceof Error ? error.message : "Erro desconhecido"}</p>
</body>
</html>`;

    return new Response(errorHtml, {
      status: 500,
      headers: htmlHeaders,
    });
  }
});

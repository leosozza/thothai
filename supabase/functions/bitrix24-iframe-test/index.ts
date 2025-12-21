import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * bitrix24-iframe-test
 * 
 * Minimalist test endpoint to validate iframe embedding for Bitrix24 Contact Center.
 * This endpoint helps diagnose CSP and X-Frame-Options header issues.
 * 
 * Usage:
 * - GET: Returns test HTML page with iframe embedding information
 * - Can be embedded in Bitrix24 iframe to test header handling
 * 
 * Security Note:
 * - External script (api.bitrix24.com/api/v1/) is loaded without SRI for compatibility
 * - This is required for BX24.js API which is provided by Bitrix24
 * - Script is loaded from official Bitrix24 CDN (trusted source)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// CSP configuration for Bitrix24 iframe embedding
// Note: Wildcards (*.bitrix24.*) allow all Bitrix24 cloud customer portals
const cspValue = [
  "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:",
  "script-src * 'unsafe-inline' 'unsafe-eval'",
  "style-src * 'unsafe-inline'",
  "img-src * data: blob:",
  "connect-src *",
  "frame-ancestors 'self' https://*.bitrix24.com https://*.bitrix24.com.br https://*.bitrix24.eu https://*.bitrix24.es https://*.bitrix24.de",
  "font-src * data:",
].join('; ');

const htmlHeaders = {
  ...corsHeaders,
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": cspValue,
} as const;

serve(async (req) => {
  console.log("=== BITRIX24-IFRAME-TEST ===");
  console.log("Method:", req.method);
  console.log("URL:", req.url);
  console.log("Timestamp:", new Date().toISOString());
  
  // Log request headers
  console.log("=== REQUEST HEADERS ===");
  const headerNames = ["referer", "origin", "user-agent", "x-forwarded-for", "x-real-ip"];
  for (const name of headerNames) {
    const value = req.headers.get(name);
    if (value) console.log(`  ${name}: ${value}`);
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Parse URL parameters
  const url = new URL(req.url);
  const format = url.searchParams.get("format") || "html";
  const embedTest = url.searchParams.get("embed") === "true";

  // JSON format - return header information
  if (format === "json") {
    const responseHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(htmlHeaders)) {
      responseHeaders[key] = value;
    }

    return new Response(
      JSON.stringify({
        status: "ok",
        timestamp: new Date().toISOString(),
        headers_sent: responseHeaders,
        request_headers: {
          referer: req.headers.get("referer"),
          origin: req.headers.get("origin"),
          user_agent: req.headers.get("user-agent"),
        },
        csp_policy: cspValue,
        iframe_compatible: true,
        test_url: `${url.origin}${url.pathname}?embed=true`,
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }

  // HTML format - return test page
  const testHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${cspValue}">
  <title>Bitrix24 Iframe Test</title>
  <script src="https://api.bitrix24.com/api/v1/"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 20px;
      background: ${embedTest ? '#f5f7fa' : '#ffffff'};
      min-height: 100vh;
    }
    .container { max-width: 800px; margin: 0 auto; }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      border-radius: 12px;
      margin-bottom: 20px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    .header h1 { font-size: 28px; margin-bottom: 8px; }
    .header p { opacity: 0.9; font-size: 14px; }
    .status-card {
      background: white;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 16px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .status-card h2 { 
      color: #333; 
      font-size: 18px; 
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 12px;
    }
    .status-badge.success { background: #e8f5e9; color: #1b5e20; }
    .status-badge.info { background: #e3f2fd; color: #0d47a1; }
    .info-grid {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 12px 16px;
      font-size: 14px;
    }
    .info-label { color: #666; font-weight: 600; }
    .info-value { 
      color: #333; 
      font-family: 'Courier New', monospace;
      word-break: break-all;
    }
    .test-section {
      background: #f9fafb;
      padding: 16px;
      border-radius: 8px;
      margin-top: 16px;
    }
    .test-section h3 {
      font-size: 14px;
      color: #666;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .test-result {
      background: white;
      padding: 12px;
      border-radius: 6px;
      border-left: 4px solid #4caf50;
      font-family: 'Courier New', monospace;
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .footer {
      text-align: center;
      color: #999;
      font-size: 12px;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #eee;
    }
    code {
      background: #f4f4f4;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔍 Bitrix24 Iframe Test</h1>
      <p>Endpoint de teste para validação de headers HTTP para iframes do Contact Center</p>
    </div>

    <div class="status-card">
      <h2>
        <span style="font-size: 24px;">✓</span>
        Status do Endpoint
      </h2>
      <div class="status-badge success">
        ✓ Endpoint funcionando corretamente
      </div>
      <div class="info-grid">
        <span class="info-label">Timestamp:</span>
        <span class="info-value" id="timestamp">${new Date().toISOString()}</span>
        
        <span class="info-label">Modo:</span>
        <span class="info-value">${embedTest ? 'Embedded (dentro de iframe)' : 'Standalone (acesso direto)'}</span>
        
        <span class="info-label">User Agent:</span>
        <span class="info-value">${req.headers.get("user-agent") || "N/A"}</span>
        
        <span class="info-label">Referer:</span>
        <span class="info-value">${req.headers.get("referer") || "N/A"}</span>
        
        <span class="info-label">Origin:</span>
        <span class="info-value">${req.headers.get("origin") || "N/A"}</span>
      </div>
    </div>

    <div class="status-card">
      <h2>
        <span style="font-size: 24px;">🔒</span>
        Headers de Segurança
      </h2>
      <div class="status-badge info">
        ℹ Headers configurados para Bitrix24 Contact Center
      </div>
      
      <div class="test-section">
        <h3>Content-Security-Policy</h3>
        <div class="test-result">${cspValue.replace(/; /g, ';\n')}</div>
      </div>

      <div class="test-section" style="margin-top: 12px;">
        <h3>Diretivas Relevantes</h3>
        <div class="info-grid" style="font-size: 13px;">
          <span class="info-label">frame-ancestors:</span>
          <span class="info-value">Permite embedding de *.bitrix24.com e variantes</span>
          
          <span class="info-label">script-src:</span>
          <span class="info-value">Permite scripts inline (necessário para BX24.js)</span>
          
          <span class="info-label">connect-src:</span>
          <span class="info-value">Permite conexões para qualquer origem</span>
        </div>
      </div>
    </div>

    <div class="status-card">
      <h2>
        <span style="font-size: 24px;">🧪</span>
        Testes de Integração
      </h2>
      
      <div class="test-section">
        <h3>Verificações Automáticas</h3>
        <div id="tests-results" style="margin-top: 8px;">
          <div style="color: #666; font-size: 13px;">Executando testes...</div>
        </div>
      </div>
    </div>

    <div class="footer">
      <p>Thothai Bitrix24 Integration • ${new Date().getFullYear()}</p>
      <p style="margin-top: 4px;">
        <a href="?format=json" style="color: #667eea; text-decoration: none;">Ver informações em JSON</a>
      </p>
    </div>
  </div>

  <script>
    // Run tests
    function runTests() {
      const results = [];
      
      // Test 1: Check if we're in an iframe
      const inIframe = window.self !== window.top;
      results.push({
        name: 'Iframe Detection',
        passed: true,
        message: inIframe ? '✓ Running inside iframe' : '✓ Running standalone (not in iframe)'
      });

      // Test 2: Check BX24 API availability
      const hasBX24 = typeof BX24 !== 'undefined';
      results.push({
        name: 'Bitrix24 API (BX24)',
        passed: hasBX24,
        message: hasBX24 ? '✓ BX24 API loaded successfully' : '⚠ BX24 API not available (normal if not in Bitrix24)'
      });

      // Test 3: Check document referrer
      const hasReferrer = document.referrer !== '';
      results.push({
        name: 'Document Referrer',
        passed: true,
        message: hasReferrer ? \`✓ Referrer: \${document.referrer}\` : '✓ No referrer (direct access)'
      });

      // Test 4: CSP enforcement
      const hasCSP = document.querySelector('meta[http-equiv="Content-Security-Policy"]') !== null;
      results.push({
        name: 'CSP Meta Tag',
        passed: hasCSP,
        message: hasCSP ? '✓ CSP meta tag present (fallback for CDN override)' : '⚠ CSP meta tag missing'
      });

      // Render results
      const container = document.getElementById('tests-results');
      container.innerHTML = results.map(test => \`
        <div style="padding: 8px 12px; margin-bottom: 8px; background: white; border-radius: 6px; border-left: 4px solid \${test.passed ? '#4caf50' : '#ff9800'};">
          <div style="font-weight: 600; font-size: 13px; color: #333; margin-bottom: 4px;">\${test.name}</div>
          <div style="font-size: 12px; color: #666;">\${test.message}</div>
        </div>
      \`).join('');

      // If BX24 is available, initialize
      if (hasBX24) {
        BX24.init(function() {
          console.log('BX24 initialized successfully');
          BX24.fitWindow();
        });
      }
    }

    // Run tests on load
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', runTests);
    } else {
      runTests();
    }

    // Update timestamp every second
    setInterval(() => {
      document.getElementById('timestamp').textContent = new Date().toISOString();
    }, 1000);
  </script>
</body>
</html>`;

  const response = new Response(testHtml, { status: 200, headers: htmlHeaders });
  
  // Log response headers
  console.log("=== RESPONSE HEADERS ===");
  for (const [key, value] of response.headers.entries()) {
    console.log(`  ${key}: ${value}`);
  }
  
  return response;
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ✅ HANDLE GET REQUESTS FIRST (before trying to parse body)
    if (req.method === "GET") {
      const url = new URL(req.url);
      
      console.log("=== GET REQUEST DEBUG ===");
      console.log("Full URL:", req.url);
      console.log("Search params string:", url.searchParams.toString());
      
      // Check for OAuth callback first
      const oauthCode = url.searchParams.get("code");
      const oauthState = url.searchParams.get("state");
      
      if (oauthCode && oauthState) {
        console.log("OAuth callback received:", { hasCode: !!oauthCode, state: oauthState });
        
        const domain = oauthState;

        // Find integration with OAuth credentials
        let integration = null;
        const { data: byMemberId1 } = await supabase
          .from("integrations")
          .select("*")
          .eq("type", "bitrix24")
          .eq("config->>member_id", domain)
          .maybeSingle();
        
        if (byMemberId1) {
          integration = byMemberId1;
        } else {
          const { data: byDomain1 } = await supabase
            .from("integrations")
            .select("*")
            .eq("type", "bitrix24")
            .eq("config->>domain", domain)
            .maybeSingle();
          integration = byDomain1;
        }

        // MARKETPLACE: Use credentials from environment variables
        const clientId = Deno.env.get("BITRIX24_CLIENT_ID") || "";
        const clientSecret = Deno.env.get("BITRIX24_CLIENT_SECRET") || "";
        
        if (!clientId || !clientSecret) {
          console.error("BITRIX24_CLIENT_ID or BITRIX24_CLIENT_SECRET not configured");
          return new Response(
            `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><h1>Erro</h1><p>Credenciais do Marketplace não configuradas. Contate o suporte.</p></body></html>`,
            { status: 500, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } }
          );
        }
        
        if (!integration) {
          console.error("Integration not found for OAuth callback:", domain);
          return new Response(
            `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><h1>Erro</h1><p>Integração não encontrada. Por favor, reinstale o app.</p></body></html>`,
            { status: 400, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } }
          );
        }

        // Exchange code for tokens
        const tokenUrl = `https://${domain}/oauth/token/`;
        console.log("Exchanging code for tokens at:", tokenUrl);
        
        const tokenResponse = await fetch(tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: clientId,
            client_secret: clientSecret,
            code: oauthCode,
          }),
        });

        const tokenData = await tokenResponse.json();
        console.log("OAuth token response:", { hasAccessToken: !!tokenData.access_token, error: tokenData.error });

        if (!tokenData.access_token) {
          console.error("Failed to get access token:", tokenData);
          return new Response(
            `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><h1>Erro</h1><p>Falha ao obter token: ${tokenData.error_description || tokenData.error}</p></body></html>`,
            { status: 400, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } }
          );
        }

        // Calculate expiration
        const expiresIn = parseInt(tokenData.expires_in || "3600", 10);
        const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

        // IMPORTANTE: Sempre usar o domínio do portal, NUNCA oauth.bitrix.info
        // client_endpoint deve ser https://PORTAL.bitrix24.com.br/rest/
        const correctClientEndpoint = `https://${domain}/rest/`;

        // Update integration with tokens
        const updatedConfig = {
          ...integration.config,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          token_expires_at: tokenExpiresAt,
          member_id: tokenData.member_id || integration.config.member_id,
          client_endpoint: correctClientEndpoint, // Sempre usar domínio correto
          domain: domain, // Garantir que domain está salvo
          oauth_pending: false,
        };

        await supabase
          .from("integrations")
          .update({
            config: updatedConfig,
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", integration.id);

        console.log("OAuth tokens saved successfully for:", domain);

        // Redirect back to setup page with success
        const setupUrl = `https://chat.thoth24.com/bitrix24-setup?member_id=${encodeURIComponent(tokenData.member_id || domain)}&oauth=success`;
        
        return new Response(null, {
          status: 302,
          headers: {
            ...corsHeaders,
            "Location": setupUrl,
          },
        });
      }
      
      const queryMemberId = url.searchParams.get("member_id");
      const queryDomain = url.searchParams.get("domain") || url.searchParams.get("DOMAIN");
      const includeInstances = url.searchParams.get("include_instances") === "true";

      console.log("Parsed - member_id:", queryMemberId, "domain:", queryDomain, "include_instances:", includeInstances);

      const searchValue = queryMemberId || queryDomain;

      if (searchValue) {
        console.log("Searching for integration with value:", searchValue);
        
        // Detect if searchValue looks like a domain (contains "bitrix24")
        const looksLikeDomain = searchValue.includes("bitrix24") || searchValue.includes(".");
        
        // Try to find integration by member_id first
        let integration = null;
        const { data: byMemberId2 } = await supabase
          .from("integrations")
          .select("*")
          .eq("type", "bitrix24")
          .eq("config->>member_id", searchValue)
          .maybeSingle();
        
        if (byMemberId2) {
          integration = byMemberId2;
          console.log("Found integration by member_id:", integration.id);
        }
        
        // If not found and looks like domain, search by domain
        if (!integration) {
          const { data: byDomain2 } = await supabase
            .from("integrations")
            .select("*")
            .eq("type", "bitrix24")
            .eq("config->>domain", searchValue)
            .maybeSingle();
          
          if (byDomain2) {
            integration = byDomain2;
            console.log("Found integration by exact domain:", integration.id);
          }
        }
        
        // If still not found and looks like domain, try partial match (ilike)
        if (!integration && looksLikeDomain) {
          const { data: byDomainPartial } = await supabase
            .from("integrations")
            .select("*")
            .eq("type", "bitrix24")
            .ilike("config->>domain", `%${searchValue}%`)
            .maybeSingle();
          
          if (byDomainPartial) {
            integration = byDomainPartial;
            console.log("Found integration by partial domain match:", integration.id);
          }
        }
        
        // Last resort: search in name field
        if (!integration) {
          const { data: byName } = await supabase
            .from("integrations")
            .select("*")
            .eq("type", "bitrix24")
            .ilike("name", `%${searchValue}%`)
            .maybeSingle();
          
          if (byName) {
            integration = byName;
            console.log("Found integration by name:", integration.id);
          }
        }

        // SIMPLIFIED: Return found:true if integration exists (workspace is OPTIONAL)
        if (integration) {
          let instances: any[] = [];
          
          // If integration has workspace_id, fetch instances from that workspace
          if (integration.workspace_id) {
            const { data: workspaceInstances } = await supabase
              .from("instances")
              .select("id, name, phone_number, status")
              .eq("workspace_id", integration.workspace_id)
              .eq("status", "connected");
            
            instances = workspaceInstances || [];
            console.log("Found workspace instances:", instances.length);
          }

          console.log("✅ Integration found:", integration.id, "- returning found:true");
          return new Response(
            JSON.stringify({
              found: true,
              integration_id: integration.id,
              domain: integration.config?.domain,
              registered: integration.config?.registered || false,
              instance_id: integration.config?.instance_id,
              is_active: integration.is_active,
              instances: instances,
              has_access_token: !!integration.config?.access_token,
              has_oauth_config: !!(integration.config?.client_id && integration.config?.client_secret),
              client_id: integration.config?.client_id || null,
              oauth_pending: integration.config?.oauth_pending || false,
              auto_setup_complete: integration.config?.auto_setup_completed || false,
              connector_active: integration.config?.activated || false,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // No integration found at all
        console.log("No integration found for:", searchValue);
        return new Response(
          JSON.stringify({ 
            found: false,
            instances: [],
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ found: false, message: "No member_id or domain provided" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ✅ ONLY PARSE BODY FOR POST REQUESTS
    const contentType = req.headers.get("content-type") || "";
    let body: Record<string, any> = {};

    if (contentType.includes("application/json")) {
      body = await req.json();
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      for (const [key, value] of formData.entries()) {
        // Handle nested auth object from Bitrix24
        if (key.startsWith("auth[")) {
          const authKey = key.replace("auth[", "").replace("]", "");
          if (!body.auth) body.auth = {};
          body.auth[authKey] = value;
        } else {
          body[key] = value;
        }
      }
    }

    console.log("Bitrix24 POST received:", JSON.stringify(body));

    // ✅ HANDLE VALIDATE TOKEN (for linking workspace)
    if (body.action === "validate_token") {
      const token = body.token;
      const memberId = body.member_id;
      const domain = body.domain;

      console.log("Validating token for linking:", { token, memberId, domain });

      if (!token) {
        return new Response(
          JSON.stringify({ error: "Token é obrigatório" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Find valid token
      const { data: tokenData, error: tokenError } = await supabase
        .from("workspace_tokens")
        .select("*")
        .eq("token", token.toUpperCase())
        .eq("token_type", "bitrix24")
        .eq("is_used", false)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

      if (tokenError || !tokenData) {
        console.error("Token not found or expired:", tokenError);
        return new Response(
          JSON.stringify({ error: "Token inválido ou expirado" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("Valid token found for workspace:", tokenData.workspace_id);

      // Find or create integration for this member_id/domain
      const searchId = memberId || domain;
      let integration = null;
      
      const { data: byMemberId } = await supabase
        .from("integrations")
        .select("*")
        .eq("type", "bitrix24")
        .eq("config->>member_id", searchId)
        .maybeSingle();
      
      if (byMemberId) {
        integration = byMemberId;
      } else {
        const { data: byDomain } = await supabase
          .from("integrations")
          .select("*")
          .eq("type", "bitrix24")
          .eq("config->>domain", searchId)
          .maybeSingle();
        integration = byDomain;
      }

      if (integration) {
        // Update existing integration with workspace_id
        await supabase
          .from("integrations")
          .update({
            workspace_id: tokenData.workspace_id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", integration.id);
        
        console.log("Updated integration with workspace_id:", tokenData.workspace_id);
      } else {
        // Create new integration
        const { data: newIntegration, error: insertError } = await supabase
          .from("integrations")
          .insert({
            workspace_id: tokenData.workspace_id,
            type: "bitrix24",
            name: `Bitrix24 - ${domain || memberId}`,
            config: {
              member_id: memberId,
              domain: domain,
              installed: true,
              installed_at: new Date().toISOString(),
            },
            is_active: true,
          })
          .select()
          .single();

        if (insertError) {
          console.error("Error creating integration:", insertError);
          return new Response(
            JSON.stringify({ error: "Erro ao criar integração" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        integration = newIntegration;
        console.log("Created new integration:", integration.id);
      }

      // Mark token as used
      await supabase
        .from("workspace_tokens")
        .update({
          is_used: true,
          used_at: new Date().toISOString(),
          used_by_member_id: memberId || domain,
        })
        .eq("id", tokenData.id);

      // Fetch instances for this workspace
      const { data: instances } = await supabase
        .from("instances")
        .select("id, name, phone_number, status")
        .eq("workspace_id", tokenData.workspace_id)
        .eq("status", "connected");

      return new Response(
        JSON.stringify({
          success: true,
          message: "Workspace vinculado com sucesso!",
          workspace_id: tokenData.workspace_id,
          integration_id: integration.id,
          instances: instances || [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ✅ HANDLE BITRIX24 EVENTS (ONAPPINSTALL, ONAPPUNINSTALL, PLACEMENT, etc.)
    const event = body.event || body.EVENT;
    const auth = body.auth || {};
    const memberId = auth.member_id || body.member_id || auth.MEMBER_ID;
    const domain = auth.domain || body.DOMAIN || body.domain;

    console.log("Processing Bitrix24 event:", event, "member_id:", memberId, "domain:", domain);

    // ONAPPINSTALL - Marketplace app installation
    if (event === "ONAPPINSTALL" || body.install === "true" || body.INSTALL === "Y") {
      console.log("=== ONAPPINSTALL EVENT ===");
      
      const accessToken = auth.access_token || body.AUTH_ID;
      const refreshToken = auth.refresh_token;
      // IMPORTANTE: Sempre usar domínio do portal, NUNCA oauth.bitrix.info
      // auth.client_endpoint pode vir como oauth.bitrix.info - ignorar e usar domain
      const clientEndpoint = domain ? `https://${domain}/rest/` : auth.client_endpoint;
      const expiresIn = parseInt(auth.expires_in || "3600", 10);
      const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
      
      console.log("ONAPPINSTALL - Using correct client_endpoint:", clientEndpoint);

      // Find existing integration or create new one
      let integration = null;
      
      if (memberId) {
        const { data: byMemberId } = await supabase
          .from("integrations")
          .select("*")
          .eq("type", "bitrix24")
          .eq("config->>member_id", memberId)
          .maybeSingle();
        integration = byMemberId;
      }
      
      if (!integration && domain) {
        const { data: byDomain } = await supabase
          .from("integrations")
          .select("*")
          .eq("type", "bitrix24")
          .eq("config->>domain", domain)
          .maybeSingle();
        integration = byDomain;
      }

      const configData = {
        member_id: memberId,
        domain: domain,
        access_token: accessToken,
        refresh_token: refreshToken,
        token_expires_at: tokenExpiresAt,
        client_endpoint: clientEndpoint,
        installed: true,
        installed_at: new Date().toISOString(),
        app_sid: auth.application_token || body.APP_SID,
      };

      // MARKETPLACE: Integration WITHOUT workspace (simplified flow)
      if (integration) {
        // Update existing integration
        await supabase
          .from("integrations")
          .update({
            config: { ...integration.config, ...configData },
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", integration.id);
        
        console.log("Updated existing integration for ONAPPINSTALL:", integration.id);
      } else {
        // Create NEW integration WITHOUT workspace_id (null)
        const { data: newInt, error: insertError } = await supabase
          .from("integrations")
          .insert({
            type: "bitrix24",
            name: `Bitrix24 - ${domain || memberId}`,
            config: configData,
            is_active: true,
            workspace_id: null, // NO WORKSPACE - direct Bitrix24 marketplace integration
          })
          .select()
          .single();

        if (insertError) {
          console.error("Error creating integration:", insertError);
        } else {
          integration = newInt;
          console.log("✅ Created new integration for ONAPPINSTALL:", integration?.id, "WITHOUT workspace (marketplace mode)");
        }
      }

      // Register placement for settings
      if (accessToken) {
        const placementUrl = `${clientEndpoint}placement.bind?auth=${accessToken}`;
        try {
          await fetch(placementUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              PLACEMENT: "SETTING_CONNECTOR",
              HANDLER: `${supabaseUrl}/functions/v1/bitrix24-connector-settings`,
              TITLE: "Thoth WhatsApp",
              DESCRIPTION: "Configurar conector WhatsApp",
            }),
          });
          console.log("Placement registered successfully");
        } catch (e) {
          console.error("Error registering placement:", e);
        }

        // Bind essential events
        const events = [
          "OnImConnectorMessageAdd",
          "OnImConnectorDialogStart",
          "OnImConnectorDialogFinish",
        ];

        const eventsUrl = `${supabaseUrl}/functions/v1/bitrix24-events`;
        
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
            console.log(`Event ${eventName} bound successfully`);
          } catch (e) {
            console.error(`Error binding event ${eventName}:`, e);
          }
        }
      }

      // Return HTML for marketplace installation with BX24.installFinish()
      // CRITICAL: Must call BX24.installFinish() to notify Bitrix24 that installation is complete
      return new Response(
        `<!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Thoth WhatsApp - Instalação</title>
          <script src="https://api.bitrix24.com/api/v1/"></script>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; text-align: center; }
            .success { color: #22c55e; }
            h1 { margin-bottom: 10px; }
            p { color: #666; }
            .loading { margin-top: 20px; }
          </style>
        </head>
        <body>
          <h1 class="success">✅ Instalado com Sucesso!</h1>
          <p>O aplicativo Thoth WhatsApp foi instalado.</p>
          <p class="loading">Configurando automaticamente...</p>
          
          <script>
            console.log('ONAPPINSTALL HTML loaded');
            
            // CRITICAL: Call BX24.installFinish() to notify Bitrix24
            if (typeof BX24 !== 'undefined') {
              BX24.init(function() {
                console.log('BX24 initialized, calling installFinish...');
                BX24.installFinish();
                console.log('BX24.installFinish() called successfully');
                
                // Wait a moment then redirect to connector settings
                setTimeout(function() {
                  window.location.href = '${supabaseUrl}/functions/v1/bitrix24-connector-settings?member_id=${memberId || ""}&DOMAIN=${domain || ""}';
                }, 1000);
              });
            } else {
              console.log('BX24 not available, redirecting directly');
              window.location.href = '${supabaseUrl}/functions/v1/bitrix24-connector-settings?member_id=${memberId || ""}&DOMAIN=${domain || ""}';
            }
          </script>
        </body>
        </html>`,
        { headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    // ONAPPUNINSTALL - App uninstallation
    if (event === "ONAPPUNINSTALL") {
      console.log("=== ONAPPUNINSTALL EVENT ===");
      
      if (memberId || domain) {
        const searchId = memberId || domain;
        
        const { data: integration } = await supabase
          .from("integrations")
          .select("*")
          .eq("type", "bitrix24")
          .or(`config->>member_id.eq.${searchId},config->>domain.eq.${searchId}`)
          .maybeSingle();

        if (integration) {
          await supabase
            .from("integrations")
            .update({
              is_active: false,
              config: {
                ...integration.config,
                uninstalled: true,
                uninstalled_at: new Date().toISOString(),
              },
              updated_at: new Date().toISOString(),
            })
            .eq("id", integration.id);
          
          console.log("Integration deactivated:", integration.id);
        }
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ONAPPTEST - Test event from Bitrix24
    if (event === "ONAPPTEST") {
      console.log("=== ONAPPTEST EVENT ===");
      return new Response(
        JSON.stringify({ success: true, message: "Test successful" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // PLACEMENT events (SETTING_CONNECTOR, etc.)
    if (body.PLACEMENT) {
      console.log("=== PLACEMENT EVENT ===");
      console.log("Placement type:", body.PLACEMENT);
      console.log("Member ID:", memberId, "Domain:", domain);
      console.log("AUTH_ID:", body.AUTH_ID, "SERVER_ENDPOINT:", body.SERVER_ENDPOINT);
      
      // === CAPTURE REAL DOMAIN VIA BITRIX24 API ===
      let realDomain: string | null = null;
      
      // First, try to get domain from body.DOMAIN (if it looks like a real domain)
      if (domain && domain.includes("bitrix24")) {
        realDomain = domain;
        console.log("Using domain from body.DOMAIN:", realDomain);
      }
      
      // If no real domain yet and we have AUTH_ID, try to fetch from Bitrix24 API
      if (!realDomain && body.AUTH_ID) {
        try {
          console.log("Fetching real domain from Bitrix24 profile API...");
          const profileResp = await fetch(
            `https://oauth.bitrix.info/rest/profile?auth=${body.AUTH_ID}`
          );
          
          if (profileResp.ok) {
            const profile = await profileResp.json();
            console.log("Profile API response:", JSON.stringify(profile.result || {}));
            
            // profile.result.CLIENT_ENDPOINT contains something like:
            // "https://thoth24.bitrix24.com.br/rest/"
            if (profile.result?.CLIENT_ENDPOINT) {
              try {
                const url = new URL(profile.result.CLIENT_ENDPOINT);
                realDomain = url.hostname; // "thoth24.bitrix24.com.br"
                console.log("Extracted real domain from CLIENT_ENDPOINT:", realDomain);
              } catch (e) {
                console.log("Could not parse CLIENT_ENDPOINT as URL:", e);
              }
            }
            
            // Alternative: try ADMIN field
            if (!realDomain && profile.result?.ADMIN) {
              try {
                const adminUrl = profile.result.ADMIN.replace(/\/[^\/]+$/, ''); // Remove trailing path
                const url = new URL(adminUrl.startsWith('http') ? adminUrl : `https://${adminUrl}`);
                realDomain = url.hostname;
                console.log("Extracted real domain from ADMIN:", realDomain);
              } catch (e) {
                console.log("Could not parse ADMIN as URL:", e);
              }
            }
          } else {
            console.log("Profile API request failed:", profileResp.status);
          }
        } catch (e) {
          console.log("Error fetching real domain from profile API:", e);
        }
      }
      
      // If still no real domain, try SERVER_ENDPOINT
      if (!realDomain && body.SERVER_ENDPOINT) {
        try {
          const serverUrl = new URL(body.SERVER_ENDPOINT);
          // Only use if it's not oauth.bitrix.info
          if (!serverUrl.hostname.includes("oauth.bitrix.info")) {
            realDomain = serverUrl.hostname;
            console.log("Extracted domain from SERVER_ENDPOINT:", realDomain);
          }
        } catch (e) {
          console.log("Could not parse SERVER_ENDPOINT:", e);
        }
      }
      
      // Final fallback: use domain from body or generate from member_id
      const actualDomain = realDomain || domain || (memberId ? `portal-${memberId}` : 'unknown');
      console.log("Final domain to use:", actualDomain);
      
      // Check if integration exists for this portal
      const searchId = memberId || domain;
      let integration = null;
      
      if (searchId) {
        const { data: existingInt, error: findError } = await supabase
          .from("integrations")
          .select("*")
          .eq("type", "bitrix24")
          .or(`config->>member_id.eq.${searchId},config->>domain.eq.${searchId}`)
          .maybeSingle();
        
        if (findError) {
          console.log("Error finding integration:", findError);
        }
        integration = existingInt;
        console.log("Existing integration found:", integration?.id || "none");
        
        // If integration exists but has fictional domain, update with real domain
        if (integration && realDomain && integration.config?.domain?.startsWith('portal-')) {
          console.log("Updating integration with real domain:", realDomain);
          const updatedConfig = { ...integration.config, domain: realDomain };
          await supabase
            .from("integrations")
            .update({ config: updatedConfig, updated_at: new Date().toISOString() })
            .eq("id", integration.id);
          integration.config = updatedConfig;
        }
      }
      
      // AUTO-CREATE: If no integration exists, create integration WITHOUT workspace
      if (!integration && searchId) {
        console.log("=== AUTO-CREATING INTEGRATION (NO WORKSPACE) ===");
        
        const integrationName = `Bitrix24 - ${actualDomain}`;
        
        // Calculate token expiration time
        const authExpiresSeconds = parseInt(body.AUTH_EXPIRES || "3600", 10);
        const tokenExpiresAt = new Date(Date.now() + authExpiresSeconds * 1000).toISOString();
        
        // Build correct client endpoint from actual domain
        const clientEndpoint = actualDomain.includes('bitrix24') 
          ? `https://${actualDomain}/rest/` 
          : body.SERVER_ENDPOINT || `https://oauth.bitrix.info/rest/`;
        
        const configData: Record<string, any> = {
          member_id: memberId,
          domain: actualDomain,
          // CORRECT TOKEN FIELDS - AUTH_ID is the access_token, REFRESH_ID is refresh_token
          access_token: body.AUTH_ID,
          refresh_token: body.REFRESH_ID,
          token_expires_at: tokenExpiresAt,
          client_endpoint: clientEndpoint,
          // Legacy fields for debugging
          auth_id: body.AUTH_ID,
          refresh_id: body.REFRESH_ID,
          server_endpoint: body.SERVER_ENDPOINT,
          auth_expires: body.AUTH_EXPIRES,
          status: body.status,
          placement: body.PLACEMENT,
          created_via: 'placement_auto_create',
          created_at: new Date().toISOString()
        };
        
        // Create integration WITHOUT workspace_id (null)
        const { data: newInt, error: intError } = await supabase
          .from("integrations")
          .insert({
            workspace_id: null, // NO WORKSPACE - direct Bitrix24 marketplace integration
            type: "bitrix24",
            name: integrationName,
            config: configData,
            is_active: true
          })
          .select()
          .single();
        
        if (intError) {
          console.error("Error creating integration:", intError);
        } else {
          console.log("✅ Created integration:", newInt?.id, "WITHOUT workspace (marketplace mode)");
          integration = newInt;
        }
      }
      
      // CRITICAL: Do NOT use 302 redirect - return HTML with BX24.installFinish() and JS redirect
      // 302 redirects break the Bitrix24 iframe flow
      const redirectUrl = `${supabaseUrl}/functions/v1/bitrix24-connector-settings?${new URLSearchParams(body as any).toString()}`;
      
      return new Response(
        `<!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Thoth WhatsApp</title>
          <script src="https://api.bitrix24.com/api/v1/"></script>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #f5f7fa; }
            .loading { color: #666; }
            .spinner { margin: 20px auto; width: 40px; height: 40px; border: 4px solid #e0e0e0; border-top: 4px solid #25D366; border-radius: 50%; animation: spin 1s linear infinite; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          </style>
        </head>
        <body>
          <div class="spinner"></div>
          <p class="loading">Carregando configurações...</p>
          
          <script>
            console.log('PLACEMENT event HTML loaded');
            console.log('Integration auto-created: ${integration?.id || "none"}');
            
            if (typeof BX24 !== 'undefined') {
              BX24.init(function() {
                console.log('BX24 initialized in PLACEMENT handler');
                
                // CRITICAL: Always call installFinish to ensure app is marked as installed
                BX24.installFinish();
                console.log('BX24.installFinish() called');
                
                // Now redirect using JavaScript (NOT 302)
                setTimeout(function() {
                  window.location.href = '${redirectUrl}';
                }, 500);
              });
            } else {
              console.log('BX24 not available, redirecting directly');
              window.location.href = '${redirectUrl}';
            }
          </script>
        </body>
        </html>`,
        { headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    // Default response for unhandled events
    console.log("Unhandled event/action:", event || body.action);
    return new Response(
      JSON.stringify({ success: true, message: "Event received" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Bitrix24 install error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

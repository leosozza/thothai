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

        if (!integration || !integration.config?.client_id || !integration.config?.client_secret) {
          console.error("Integration not found for OAuth callback:", domain);
          return new Response(
            `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><h1>Erro</h1><p>Integração OAuth não encontrada. Por favor, configure novamente.</p></body></html>`,
            { status: 400, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } }
          );
        }

        const clientId = integration.config.client_id;
        const clientSecret = integration.config.client_secret;

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
        // Try to find integration by member_id or domain
        let integration = null;
        const { data: byMemberId2 } = await supabase
          .from("integrations")
          .select("*")
          .eq("type", "bitrix24")
          .eq("config->>member_id", searchValue)
          .maybeSingle();
        
        if (byMemberId2) {
          integration = byMemberId2;
        } else {
          const { data: byDomain2 } = await supabase
            .from("integrations")
            .select("*")
            .eq("type", "bitrix24")
            .eq("config->>domain", searchValue)
            .maybeSingle();
          integration = byDomain2;
        }

        let instances: any[] = [];
        
        if (integration?.workspace_id) {
          // Integration exists with workspace - fetch instances from that workspace
          const { data: workspaceInstances } = await supabase
            .from("instances")
            .select("id, name, phone_number, status")
            .eq("workspace_id", integration.workspace_id)
            .eq("status", "connected");
          
          instances = workspaceInstances || [];
          console.log("Found workspace instances:", instances.length);

          return new Response(
            JSON.stringify({
              found: true,
              integration_id: integration.id,
              domain: integration.config?.domain,
              registered: integration.config?.registered || false,
              instance_id: integration.config?.instance_id,
              is_active: integration.is_active,
              workspace_id: integration.workspace_id,
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

        // No integration found - require token for multi-tenant linking
        console.log("No integration found - requires token for workspace linking");
        return new Response(
          JSON.stringify({ 
            found: false,
            requires_token: true,
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

      if (integration) {
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
        const { data: newInt, error: insertError } = await supabase
          .from("integrations")
          .insert({
            type: "bitrix24",
            name: `Bitrix24 - ${domain || memberId}`,
            config: configData,
            is_active: true,
          })
          .select()
          .single();

        if (insertError) {
          console.error("Error creating integration:", insertError);
        } else {
          integration = newInt;
          console.log("Created new integration for ONAPPINSTALL:", integration?.id);
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

      // Return HTML for marketplace installation
      return new Response(
        `<!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Thoth WhatsApp - Instalação</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; text-align: center; }
            .success { color: #22c55e; }
            h1 { margin-bottom: 10px; }
            p { color: #666; }
          </style>
        </head>
        <body>
          <h1 class="success">✅ Instalado com Sucesso!</h1>
          <p>O aplicativo Thoth WhatsApp foi instalado.</p>
          <p>Configure o conector em: Contact Center → Canais → Thoth WhatsApp</p>
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
      
      // Redirect to connector settings function
      return new Response(null, {
        status: 302,
        headers: {
          ...corsHeaders,
          "Location": `${supabaseUrl}/functions/v1/bitrix24-connector-settings?${new URLSearchParams(body as any).toString()}`,
        },
      });
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

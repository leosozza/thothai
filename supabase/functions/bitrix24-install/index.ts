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

        // Find integration with OAuth credentials (two sequential queries for JSONB)
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
            `<html><body><h1>Erro</h1><p>Integração OAuth não encontrada. Por favor, configure novamente.</p></body></html>`,
            { status: 400, headers: { ...corsHeaders, "Content-Type": "text/html" } }
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
            `<html><body><h1>Erro</h1><p>Falha ao obter token: ${tokenData.error_description || tokenData.error}</p></body></html>`,
            { status: 400, headers: { ...corsHeaders, "Content-Type": "text/html" } }
          );
        }

        // Calculate expiration
        const expiresIn = parseInt(tokenData.expires_in || "3600", 10);
        const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

        // Update integration with tokens
        const updatedConfig = {
          ...integration.config,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          token_expires_at: tokenExpiresAt,
          member_id: tokenData.member_id || integration.config.member_id,
          client_endpoint: tokenData.client_endpoint || `https://${domain}/rest/`,
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
        // Try to find integration by member_id or domain (two sequential queries for JSONB)
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
              domain: integration.config?.domain,
              registered: integration.config?.registered || false,
              instance_id: integration.config?.instance_id,
              is_active: integration.is_active,
              workspace_id: integration.workspace_id,
              instances: instances,
              has_access_token: !!integration.config?.access_token,
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
            instances: [], // No instances until token is validated
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

    // ✅ HANDLE SAVE WEBHOOK (for local apps)
    if (body.action === "save_webhook") {
      const webhookUrl = body.webhook_url;
      const memberId = body.member_id;
      const domain = body.domain;

      console.log("Saving webhook URL for local app:", webhookUrl, "member_id:", memberId, "domain:", domain);

      if (!webhookUrl) {
        return new Response(
          JSON.stringify({ error: "URL do webhook é obrigatória" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Extract domain from webhook URL if not provided
      const urlDomain = domain || webhookUrl.match(/https?:\/\/([^\/]+)/)?.[1] || null;
      const identifier = memberId || urlDomain;

      if (!identifier) {
        return new Response(
          JSON.stringify({ error: "Não foi possível identificar o portal Bitrix24" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check if integration already exists (two sequential queries for JSONB)
      let existingIntegration = null;
      const { data: byMemberId3 } = await supabase
        .from("integrations")
        .select("*")
        .eq("type", "bitrix24")
        .eq("config->>member_id", identifier)
        .maybeSingle();
      
      if (byMemberId3) {
        existingIntegration = byMemberId3;
      } else {
        const { data: byDomain3 } = await supabase
          .from("integrations")
          .select("*")
          .eq("type", "bitrix24")
          .eq("config->>domain", urlDomain)
          .maybeSingle();
        existingIntegration = byDomain3;
      }

      const configData = {
        member_id: memberId || urlDomain,
        domain: urlDomain,
        webhook_url: webhookUrl,
        is_local_app: true,
        installed: true,
        installed_at: new Date().toISOString(),
        registered: false,
      };

      if (existingIntegration) {
        // Update existing integration
        const { error: updateError } = await supabase
          .from("integrations")
          .update({
            config: { ...existingIntegration.config, ...configData },
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingIntegration.id);

        if (updateError) {
          console.error("Error updating integration with webhook:", updateError);
          return new Response(
            JSON.stringify({ error: "Erro ao atualizar integração" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        console.log("Updated existing integration with webhook URL");
      } else {
        // Create new integration (without workspace_id - will be linked via token)
        const { error: insertError } = await supabase
          .from("integrations")
          .insert({
            type: "bitrix24",
            name: `Bitrix24 Local - ${urlDomain}`,
            config: configData,
            is_active: true,
          });

        if (insertError) {
          console.error("Error creating integration with webhook:", insertError);
          return new Response(
            JSON.stringify({ error: "Erro ao criar integração" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        console.log("Created new integration with webhook URL");
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "Webhook salvo com sucesso",
          domain: urlDomain,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ✅ HANDLE OAUTH EXCHANGE (manual OAuth setup)
    if (body.action === "oauth_exchange") {
      const clientId = body.client_id;
      const clientSecret = body.client_secret;
      const memberId = body.member_id;
      const domain = body.domain;

      console.log("OAuth exchange request:", { clientId, hasDomain: !!domain, memberId });

      if (!clientId || !clientSecret) {
        return new Response(
          JSON.stringify({ error: "Client ID e Client Secret são obrigatórios" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Extract domain from memberId if needed
      const bitrixDomain = domain || memberId;
      if (!bitrixDomain) {
        return new Response(
          JSON.stringify({ error: "Domínio do Bitrix24 não identificado" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Normalize domain
      const normalizedDomain = bitrixDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");

      // Save OAuth credentials and create/update integration (two sequential queries for JSONB)
      let existingIntegration = null;
      const { data: byMemberId4 } = await supabase
        .from("integrations")
        .select("*")
        .eq("type", "bitrix24")
        .eq("config->>member_id", memberId || normalizedDomain)
        .maybeSingle();
      
      if (byMemberId4) {
        existingIntegration = byMemberId4;
      } else {
        const { data: byDomain4 } = await supabase
          .from("integrations")
          .select("*")
          .eq("type", "bitrix24")
          .eq("config->>domain", normalizedDomain)
          .maybeSingle();
        existingIntegration = byDomain4;
      }

      const oauthConfig = {
        member_id: memberId || normalizedDomain,
        domain: normalizedDomain,
        client_id: clientId,
        client_secret: clientSecret,
        oauth_pending: true,
        installed: true,
        installed_at: new Date().toISOString(),
      };

      if (existingIntegration) {
        await supabase
          .from("integrations")
          .update({
            config: { ...existingIntegration.config, ...oauthConfig },
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingIntegration.id);
      } else {
        await supabase
          .from("integrations")
          .insert({
            type: "bitrix24",
            name: `Bitrix24 OAuth - ${normalizedDomain}`,
            config: oauthConfig,
            is_active: true,
          });
      }

      // Generate OAuth authorization URL
      const redirectUri = `${supabaseUrl}/functions/v1/bitrix24-install`;
      const authUrl = `https://${normalizedDomain}/oauth/authorize/?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(normalizedDomain)}`;

      console.log("OAuth auth URL generated:", authUrl);

      return new Response(
        JSON.stringify({
          success: true,
          auth_url: authUrl,
          message: "Redirecionando para autorização OAuth",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ✅ HANDLE OAUTH CALLBACK (authorization code exchange)
    if (body.code || (req.method === "GET" && new URL(req.url).searchParams.has("code"))) {
      const url = new URL(req.url);
      const code = body.code || url.searchParams.get("code");
      const state = body.state || url.searchParams.get("state"); // state contains domain

      console.log("OAuth callback received:", { hasCode: !!code, state });

      if (!code || !state) {
        return new Response(
          JSON.stringify({ error: "Código de autorização ou estado inválido" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const domain = state;

      // Find integration with OAuth credentials (two sequential queries for JSONB)
      let integration = null;
      const { data: byMemberId5 } = await supabase
        .from("integrations")
        .select("*")
        .eq("type", "bitrix24")
        .eq("config->>member_id", domain)
        .maybeSingle();
      
      if (byMemberId5) {
        integration = byMemberId5;
      } else {
        const { data: byDomain5 } = await supabase
          .from("integrations")
          .select("*")
          .eq("type", "bitrix24")
          .eq("config->>domain", domain)
          .maybeSingle();
        integration = byDomain5;
      }

      if (!integration || !integration.config?.client_id || !integration.config?.client_secret) {
        return new Response(
          JSON.stringify({ error: "Integração OAuth não encontrada" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const clientId = integration.config.client_id;
      const clientSecret = integration.config.client_secret;

      // Exchange code for tokens
      const tokenUrl = `https://${domain}/oauth/token/`;
      const tokenResponse = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          client_secret: clientSecret,
          code: code,
        }),
      });

      const tokenData = await tokenResponse.json();
      console.log("OAuth token response:", { hasAccessToken: !!tokenData.access_token, error: tokenData.error });

      if (!tokenData.access_token) {
        return new Response(
          JSON.stringify({ error: "Falha ao obter token de acesso", details: tokenData.error_description || tokenData.error }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Calculate expiration
      const expiresIn = parseInt(tokenData.expires_in || "3600", 10);
      const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      // Update integration with tokens
      const updatedConfig = {
        ...integration.config,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expires_at: tokenExpiresAt,
        member_id: tokenData.member_id || integration.config.member_id,
        client_endpoint: tokenData.client_endpoint || `https://${domain}/rest/`,
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

      // Redirect back to setup page
      const setupUrl = `https://chat.thoth24.com/bitrix24-setup?member_id=${encodeURIComponent(tokenData.member_id || domain)}&oauth=success`;
      
      return new Response(null, {
        status: 302,
        headers: {
          ...corsHeaders,
          "Location": setupUrl,
        },
      });
    }

    // ✅ HANDLE TOKEN VALIDATION
    if (body.action === "validate_token") {
      const token = body.token;
      const memberId = body.member_id;
      const domain = body.domain;

      console.log("Validating token:", token, "for member_id:", memberId, "domain:", domain);

      if (!token) {
        return new Response(
          JSON.stringify({ error: "Token é obrigatório" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Find the token
      const { data: tokenData, error: tokenError } = await supabase
        .from("workspace_tokens")
        .select("*")
        .eq("token", token)
        .eq("token_type", "bitrix24")
        .eq("is_used", false)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

      if (tokenError) {
        console.error("Token query error:", tokenError);
        return new Response(
          JSON.stringify({ error: "Erro ao validar token" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!tokenData) {
        console.log("Token not found or expired");
        return new Response(
          JSON.stringify({ error: "Token inválido, expirado ou já utilizado" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const workspaceId = tokenData.workspace_id;
      console.log("Token valid, workspace_id:", workspaceId);

      // Check if integration already exists (two sequential queries for JSONB)
      let existingIntegration = null;
      const searchMemberId = memberId || domain;
      const searchDomain = domain || memberId;
      
      const { data: byMemberId6 } = await supabase
        .from("integrations")
        .select("*")
        .eq("type", "bitrix24")
        .eq("config->>member_id", searchMemberId)
        .maybeSingle();
      
      if (byMemberId6) {
        existingIntegration = byMemberId6;
      } else {
        const { data: byDomain6 } = await supabase
          .from("integrations")
          .select("*")
          .eq("type", "bitrix24")
          .eq("config->>domain", searchDomain)
          .maybeSingle();
        existingIntegration = byDomain6;
      }

      if (existingIntegration) {
        // Update existing integration with workspace_id
        const { error: updateError } = await supabase
          .from("integrations")
          .update({
            workspace_id: workspaceId,
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingIntegration.id);

        if (updateError) {
          console.error("Error updating integration:", updateError);
          return new Response(
            JSON.stringify({ error: "Erro ao atualizar integração" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        console.log("Updated existing integration with workspace_id");
      } else {
        // Create new integration
        const { error: insertError } = await supabase
          .from("integrations")
          .insert({
            workspace_id: workspaceId,
            type: "bitrix24",
            name: "Bitrix24",
            config: {
              member_id: memberId,
              domain: domain,
              installed: true,
              installed_at: new Date().toISOString(),
              registered: false,
            },
            is_active: true,
          });

        if (insertError) {
          console.error("Error creating integration:", insertError);
          return new Response(
            JSON.stringify({ error: "Erro ao criar integração" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        console.log("Created new integration");
      }

      // Mark token as used ONLY AFTER integration is successfully created/updated
      const { error: tokenUpdateError } = await supabase
        .from("workspace_tokens")
        .update({
          is_used: true,
          used_at: new Date().toISOString(),
          used_by_member_id: memberId || domain,
        })
        .eq("id", tokenData.id);

      if (tokenUpdateError) {
        console.error("Error marking token as used:", tokenUpdateError);
        // Don't fail here - integration was already created successfully
      }

      // Fetch instances from the linked workspace
      const { data: instances } = await supabase
        .from("instances")
        .select("id, name, phone_number, status")
        .eq("workspace_id", workspaceId)
        .eq("status", "connected");

      console.log("Returning instances for workspace:", instances?.length || 0);

      // Get the integration ID for auto_setup
      let integrationIdForSetup = existingIntegration?.id;
      if (!integrationIdForSetup) {
        const { data: newIntegration } = await supabase
          .from("integrations")
          .select("id")
          .eq("type", "bitrix24")
          .eq("workspace_id", workspaceId)
          .maybeSingle();
        integrationIdForSetup = newIntegration?.id;
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "Token validado com sucesso",
          workspace_id: workspaceId,
          instances: instances || [],
          integration_id: integrationIdForSetup, // Return integration_id for auto_setup
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ✅ HANDLE BITRIX24 EVENTS
    const event = body.event?.toUpperCase();
    const auth = body.auth || {};

    console.log("=== BITRIX24 EVENT DEBUG ===");
    console.log("Event:", event);
    console.log("Full body:", JSON.stringify(body, null, 2));
    console.log("Auth object:", JSON.stringify(auth, null, 2));

    // Extract auth data
    const accessToken = auth.access_token;
    const refreshToken = auth.refresh_token;
    const domain = auth.domain;
    const memberId = auth.member_id;
    const clientEndpoint = auth.client_endpoint;
    const applicationToken = body.application_token || auth.application_token;
    const expiresIn = parseInt(auth.expires_in || "3600", 10);

    console.log("Extracted auth data:", {
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!refreshToken,
      domain,
      memberId,
      clientEndpoint,
      hasApplicationToken: !!applicationToken,
      expiresIn,
    });

    if (event === "ONAPPINSTALL") {
      console.log("=== ONAPPINSTALL EVENT ===");
      
      if (!domain || !memberId || !accessToken) {
        console.error("Missing required auth data for ONAPPINSTALL:", {
          hasDomain: !!domain,
          hasMemberId: !!memberId,
          hasAccessToken: !!accessToken,
        });
        return new Response(
          JSON.stringify({ error: "Missing required auth data" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`Installing Bitrix24 app for domain: ${domain}, member_id: ${memberId}`);

      // Calculate token expiration time
      const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      // Check if integration already exists for this member_id
      const { data: existing, error: existingError } = await supabase
        .from("integrations")
        .select("*")
        .eq("type", "bitrix24")
        .filter("config->>member_id", "eq", memberId)
        .maybeSingle();

      if (existingError) {
        console.error("Error checking existing integration:", existingError);
      }

      console.log("Existing integration:", existing ? existing.id : "none");

      const configData = {
        member_id: memberId,
        domain,
        client_endpoint: clientEndpoint || `https://${domain}/rest/`,
        access_token: accessToken,
        refresh_token: refreshToken,
        application_token: applicationToken,
        token_expires_at: tokenExpiresAt,
        installed: true,
        installed_at: new Date().toISOString(),
        registered: false,
        connector_id: null,
        line_id: null,
        instance_id: null,
      };

      if (existing) {
        // Update existing integration (preserve workspace_id if exists)
        const { error: updateError } = await supabase
          .from("integrations")
          .update({
            config: { ...existing.config, ...configData },
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);

        if (updateError) {
          console.error("Error updating integration:", updateError);
        } else {
          console.log(`Updated existing Bitrix24 integration: ${existing.id}`);
        }
      } else {
        // ✅ FIX: Create a new integration record even without workspace_id
        // The workspace will be linked later via token validation
        console.log("Creating new Bitrix24 integration (will be linked to workspace later)");
        
        const { data: newIntegration, error: insertError } = await supabase
          .from("integrations")
          .insert({
            type: "bitrix24",
            name: `Bitrix24 - ${domain}`,
            config: configData,
            is_active: true,
            // workspace_id will be null until token validation
          })
          .select()
          .single();

        if (insertError) {
          console.error("Error creating new integration:", insertError);
          // Return success anyway - Bitrix24 expects 200
        } else {
          console.log(`Created new Bitrix24 integration: ${newIntegration?.id}`);
        }
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "App installed successfully",
          member_id: memberId,
          domain,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (event === "ONAPPUNINSTALL") {
      console.log(`Uninstalling Bitrix24 app for member_id: ${memberId}`);

      if (memberId) {
        // Mark integration as inactive
        const { data: existing } = await supabase
          .from("integrations")
          .select("id, config")
          .eq("type", "bitrix24")
          .filter("config->>member_id", "eq", memberId)
          .maybeSingle();

        if (existing) {
          await supabase
            .from("integrations")
            .update({ 
              is_active: false,
              config: { ...existing.config, uninstalled_at: new Date().toISOString() }
            })
            .eq("id", existing.id);
        }
      }

      return new Response(
        JSON.stringify({ success: true, message: "App uninstalled" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Default response for unhandled events
    console.log("Unhandled Bitrix24 event:", event);
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
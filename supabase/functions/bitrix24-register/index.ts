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
  const expiresAt = new Date(config.token_expires_at);
  const now = new Date();
  const bufferMs = 5 * 60 * 1000; // 5 minutes
  
  if (expiresAt.getTime() - now.getTime() > bufferMs) {
    return config.access_token;
  }

  console.log("Token expired, refreshing...");

  // Token needs refresh
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

  return null;
}

serve(async (req) => {
  console.log("=== BITRIX24-REGISTER REQUEST ===");
  console.log("Method:", req.method);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log("Request body:", JSON.stringify(body));
    
    const { webhook_url, connector_id, instance_id, workspace_id, integration_id, member_id } = body;

    // Validate that we have at least member_id or webhook_url
    if (!member_id && !webhook_url) {
      console.error("No member_id or webhook_url provided");
      return new Response(
        JSON.stringify({ error: "member_id ou webhook_url é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Registering Bitrix24 connector:", { connector_id, workspace_id, member_id, instance_id });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let bitrixApiUrl: string = "";
    let integration: any = null;
    let useWebhookMode = false;

    // Mode 1: Using webhook_url directly (local apps - preferred for local installations)
    if (webhook_url) {
      console.log("=== WEBHOOK MODE (Local App) ===");
      console.log("Using webhook_url:", webhook_url);
      
      // Ensure webhook URL ends with /
      bitrixApiUrl = webhook_url.endsWith("/") ? webhook_url : `${webhook_url}/`;
      useWebhookMode = true;

      // Try to find existing integration by webhook_url or workspace_id
      if (workspace_id) {
        const { data: existingIntegration } = await supabase
          .from("integrations")
          .select("*")
          .eq("type", "bitrix24")
          .eq("workspace_id", workspace_id)
          .maybeSingle();

        if (existingIntegration) {
          integration = existingIntegration;
          console.log("Found integration by workspace_id:", integration.id);
        }
      }
    }
    // Mode 2: Using member_id (OAuth app installation - Marketplace apps)
    else if (member_id) {
      console.log("=== OAUTH MODE (Marketplace App) ===");
      console.log("Looking for integration with member_id:", member_id);
      
      // Try multiple search strategies (same as bitrix24-install)
      let existingIntegration = null;
      
      // Strategy 1: Search by config->>member_id
      console.log("Strategy 1: Searching by config->>member_id...");
      const { data: byMemberId } = await supabase
        .from("integrations")
        .select("*")
        .eq("type", "bitrix24")
        .eq("config->>member_id", member_id)
        .maybeSingle();
      
      if (byMemberId) {
        existingIntegration = byMemberId;
        console.log("Found by member_id:", byMemberId.id);
      }
      
      // Strategy 2: Search by config->>domain
      if (!existingIntegration) {
        console.log("Strategy 2: Searching by config->>domain...");
        const { data: byDomain } = await supabase
          .from("integrations")
          .select("*")
          .eq("type", "bitrix24")
          .eq("config->>domain", member_id)
          .maybeSingle();
        
        if (byDomain) {
          existingIntegration = byDomain;
          console.log("Found by domain:", byDomain.id);
        }
      }
      
      // Strategy 3: Search with LIKE for partial match
      if (!existingIntegration) {
        console.log("Strategy 3: Searching with LIKE pattern...");
        const { data: byLike } = await supabase
          .from("integrations")
          .select("*")
          .eq("type", "bitrix24")
          .or(`config->>member_id.ilike.%${member_id}%,config->>domain.ilike.%${member_id}%`)
          .maybeSingle();
        
        if (byLike) {
          existingIntegration = byLike;
          console.log("Found by LIKE pattern:", byLike.id);
        }
      }

      if (!existingIntegration) {
        console.error("No integration found for member_id:", member_id);
        console.log("Searched: member_id, domain, and LIKE patterns");
        return new Response(
          JSON.stringify({ error: "Integração Bitrix24 não encontrada. Por favor, reinstale o aplicativo." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("Found integration:", existingIntegration.id, "workspace:", existingIntegration.workspace_id);
      console.log("Integration config keys:", Object.keys(existingIntegration.config || {}));
      integration = existingIntegration;

      // Check if this is a local app with webhook_url
      if (integration.config?.webhook_url && integration.config?.is_local_app) {
        console.log("Integration is a local app, switching to webhook mode");
        bitrixApiUrl = integration.config.webhook_url;
        bitrixApiUrl = bitrixApiUrl.endsWith("/") ? bitrixApiUrl : `${bitrixApiUrl}/`;
        useWebhookMode = true;
      } else {
        // OAuth mode - need to refresh token
        const accessToken = await refreshBitrixToken(integration, supabase);
        
        if (!accessToken) {
          // Check if we have a webhook_url as fallback
          if (integration.config?.webhook_url) {
            console.log("OAuth token failed, falling back to webhook_url");
            bitrixApiUrl = integration.config.webhook_url;
            bitrixApiUrl = bitrixApiUrl.endsWith("/") ? bitrixApiUrl : `${bitrixApiUrl}/`;
            useWebhookMode = true;
          } else {
            console.error("Failed to get access token and no webhook fallback for integration:", integration.id);
            return new Response(
              JSON.stringify({ 
                error: "Falha ao obter token de acesso. Para aplicações locais, configure a URL do webhook de saída.",
                needs_webhook: true 
              }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        } else {
          const clientEndpoint = integration.config.client_endpoint || `https://${integration.config.domain}/rest/`;
          bitrixApiUrl = clientEndpoint;
        }
      }
      
      console.log("Using Bitrix API URL:", bitrixApiUrl);
    }

    // Use a FIXED connector_id to avoid duplicates
    const finalConnectorId = connector_id || "thoth_whatsapp";
    console.log("Using fixed connector ID:", finalConnectorId);

    // For webhook mode (local apps), we skip imconnector.register as it requires OAuth app permissions
    // Webhooks are meant for direct API access, not for registering connectors
    if (useWebhookMode) {
      console.log("=== WEBHOOK MODE: Skipping imconnector.register (not supported) ===");
      console.log("Webhooks cannot register connectors - saving configuration only");

      // Just update/save the integration configuration
      const configUpdate = {
        webhook_url: webhook_url,
        connector_id: finalConnectorId,
        instance_id: instance_id || null,
        registered: true, // Mark as configured (not registered in Bitrix24 sense)
        is_local_app: true,
        webhook_configured: true,
      };

      if (integration_id || integration?.id) {
        const idToUpdate = integration_id || integration.id;
        const { data: currentIntegration } = await supabase
          .from("integrations")
          .select("config")
          .eq("id", idToUpdate)
          .single();

        await supabase
          .from("integrations")
          .update({ 
            config: { ...currentIntegration?.config, ...configUpdate }, 
            is_active: true 
          })
          .eq("id", idToUpdate);
      } else if (workspace_id) {
        await supabase.from("integrations").insert({
          workspace_id,
          type: "bitrix24",
          name: "Bitrix24",
          config: configUpdate,
          is_active: true,
        });
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Webhook configurado com sucesso. Mensagens serão enviadas diretamente via API REST.",
          connector_id: finalConnectorId,
          mode: "webhook",
          note: "Para integrações via webhook, o envio de mensagens funciona diretamente pela API crm.* - o imconnector não é utilizado.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // OAuth mode - can register connector in Contact Center
    console.log("=== OAUTH MODE: Registering imconnector for Contact Center ===");

    // Get access token
    const accessToken = integration.config.access_token;
    if (!accessToken) {
      return new Response(
        JSON.stringify({ error: "Token de acesso não encontrado. Reinstale o aplicativo." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 0. First, try to UNREGISTER any existing connector to avoid duplicates
    console.log("Attempting to unregister existing connector first...");
    const unregisterUrl = `${bitrixApiUrl}imconnector.unregister?auth=${accessToken}`;
    try {
      const unregisterResponse = await fetch(unregisterUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ID: finalConnectorId }),
      });
      const unregisterResult = await unregisterResponse.json();
      console.log("imconnector.unregister result:", JSON.stringify(unregisterResult));
    } catch (e) {
      console.log("Unregister failed (connector may not exist):", e);
    }

    // 1. Register connector in Bitrix24 (this makes it appear in Contact Center)
    const registerPayload = {
      ID: finalConnectorId,
      NAME: "Thoth WhatsApp",
      ICON: {
        DATA_IMAGE: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMyNUQ0NjYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMjEgMTEuNWE4LjM4IDguMzggMCAwIDEtLjkgMy44IDguNSA4LjUgMCAwIDEtNy42IDQuNyA4LjM4IDguMzggMCAwIDEtMy44LS45TDMgMjFsMS45LTUuN2E4LjM4IDguMzggMCAwIDEtLjktMy44IDguNSA4LjUgMCAwIDEgNC43LTcuNiA4LjM4IDguMzggMCAwIDEgMy44LS45aC41YTguNDggOC40OCAwIDAgMSA4IDh2LjV6Ij48L3BhdGg+PC9zdmc+",
      },
      PLACEMENT_HANDLER: `${supabaseUrl}/functions/v1/bitrix24-webhook`,
    };

    console.log("Calling imconnector.register with:", JSON.stringify(registerPayload));

    const registerUrl = `${bitrixApiUrl}imconnector.register?auth=${accessToken}`;

    const registerResponse = await fetch(registerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(registerPayload),
    });

    const registerResult = await registerResponse.json();
    console.log("imconnector.register result:", JSON.stringify(registerResult));

    if (registerResult.error && registerResult.error !== "CONNECTOR_ALREADY_EXISTS") {
      console.error("Failed to register connector:", registerResult);
      return new Response(
        JSON.stringify({ 
          error: `Erro ao registrar conector: ${registerResult.error_description || registerResult.error}`,
          hint: "Verifique se o aplicativo tem as permissões: imconnector, imopenlines, im, crm, user"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // NOTE: imconnector.activate is now handled by bitrix24-webhook when user connects Open Channel
    // This allows the correct LINE ID to be used (selected by user in Contact Center)
    console.log("Skipping imconnector.activate - will be called when user connects Open Channel");

    // 2. Bind events to receive messages from Bitrix24 operators
    console.log("Binding events for message handling...");
    const workspaceIdForWebhook = workspace_id || integration?.workspace_id || "default";
    const webhookEndpoint = `${supabaseUrl}/functions/v1/bitrix24-webhook?workspace_id=${workspaceIdForWebhook}&connector_id=${finalConnectorId}`;
    
    const events = [
      "OnImConnectorMessageAdd",      // When operator sends message
      "OnImConnectorDialogStart",     // When dialog starts
      "OnImConnectorDialogFinish",    // When dialog finishes
      "OnImConnectorStatusDelete",    // When connector is removed
    ];

    for (const event of events) {
      const bindUrl = `${bitrixApiUrl}event.bind?auth=${accessToken}`;

      const bindResponse = await fetch(bindUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: event,
          handler: webhookEndpoint,
        }),
      });
      const bindResult = await bindResponse.json();
      console.log(`event.bind ${event} result:`, JSON.stringify(bindResult));
    }

    // 4. Update integration in database with registration details
    const configUpdate = {
      connector_id: finalConnectorId,
      instance_id: instance_id || null,
      registered: true,
      events_url: webhookEndpoint,
      line_id: "1",
    };

    if (integration_id || integration?.id) {
      const idToUpdate = integration_id || integration.id;
      const { data: currentIntegration } = await supabase
        .from("integrations")
        .select("config")
        .eq("id", idToUpdate)
        .single();

      await supabase
        .from("integrations")
        .update({ 
          config: { ...currentIntegration?.config, ...configUpdate }, 
          is_active: true 
        })
        .eq("id", idToUpdate);
    } else if (workspace_id) {
      await supabase.from("integrations").insert({
        workspace_id,
        type: "bitrix24",
        name: "Bitrix24",
        config: configUpdate,
        is_active: true,
      });
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Conector registrado com sucesso no Contact Center!",
        connector_id: finalConnectorId,
        events_url: webhookEndpoint,
        mode: "oauth",
        next_steps: "Vá em Contact Center → + Adicionar → Thoth WhatsApp para configurar a linha",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Bitrix24 register error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

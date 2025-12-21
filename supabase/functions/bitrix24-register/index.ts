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
  console.log("Timestamp:", new Date().toISOString());
  console.log("URL:", req.url);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log("=== REQUEST BODY ===");
    console.log("Request body:", JSON.stringify(body));
    console.log("Action:", body.action);
    console.log("Request type:", req.method);
    
    const { action, webhook_url, connector_id, instance_id, workspace_id, integration_id, member_id, domain } = body;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Action: Clean connectors
    if (action === "clean_connectors") {
      console.log("=== CLEAN CONNECTORS ACTION ===");
      console.log("integration_id:", integration_id);
      console.log("workspace_id:", workspace_id);
      console.log("member_id:", member_id);
      console.log("domain:", domain);
      
      let integration: any = null;

      // Try to find integration by integration_id first
      if (integration_id) {
        const { data } = await supabase
          .from("integrations")
          .select("*")
          .eq("id", integration_id)
          .maybeSingle();
        integration = data;
      }

      // If not found, try by member_id or domain
      if (!integration) {
        const searchId = member_id || domain;
        if (searchId) {
          const { data } = await supabase
            .from("integrations")
            .select("*")
            .eq("type", "bitrix24")
            .or(`config->>member_id.eq.${searchId},config->>domain.eq.${searchId},config->>member_id.ilike.%${searchId}%,config->>domain.ilike.%${searchId}%`)
            .maybeSingle();
          integration = data;
        }
      }

      // If still not found, try by workspace_id
      if (!integration && workspace_id) {
        const { data } = await supabase
          .from("integrations")
          .select("*")
          .eq("type", "bitrix24")
          .eq("workspace_id", workspace_id)
          .maybeSingle();
        integration = data;
      }

      if (!integration) {
        return new Response(
          JSON.stringify({ error: "Integração Bitrix24 não encontrada" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check if integration has OAuth token or webhook_url
      const config = integration.config || {};
      let bitrixApiUrl: string;
      
      if (config.access_token) {
        // Refresh token if needed
        const accessToken = await refreshBitrixToken(integration, supabase);
        if (!accessToken) {
          return new Response(
            JSON.stringify({ error: "Falha ao obter token de acesso" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const clientEndpoint = config.client_endpoint || `https://${config.domain}/rest/`;
        bitrixApiUrl = `${clientEndpoint}`;
        
        // List all connectors
        console.log("Listing connectors (OAuth mode)...");
        const listUrl = `${bitrixApiUrl}imconnector.list?auth=${accessToken}`;
        const listResponse = await fetch(listUrl);
        const listResult = await listResponse.json();
        console.log("imconnector.list result:", JSON.stringify(listResult));

        const removedConnectors: string[] = [];
        
        if (listResult.result) {
          const connectorsToRemove = Object.keys(listResult.result).filter(id => {
            const idLower = id.toLowerCase();
            return idLower.includes("thoth") || idLower.includes("whatsapp");
          });

          console.log("Connectors to remove:", connectorsToRemove);

          for (const connectorId of connectorsToRemove) {
            console.log(`Unregistering connector: ${connectorId}`);
            const unregisterUrl = `${bitrixApiUrl}imconnector.unregister?auth=${accessToken}`;
            try {
              const unregisterResponse = await fetch(unregisterUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ID: connectorId }),
              });
              const unregisterResult = await unregisterResponse.json();
              console.log(`Unregister ${connectorId} result:`, JSON.stringify(unregisterResult));
              
              if (unregisterResult.result || !unregisterResult.error) {
                removedConnectors.push(connectorId);
              }
            } catch (e) {
              console.log(`Failed to unregister ${connectorId}:`, e);
            }
          }
        }

        return new Response(
          JSON.stringify({ 
            success: true, 
            removed_count: removedConnectors.length,
            removed_connectors: removedConnectors,
            message: `${removedConnectors.length} conector(es) removido(s)`,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } else if (config.webhook_url) {
        // Webhook mode
        bitrixApiUrl = config.webhook_url.endsWith("/") ? config.webhook_url : `${config.webhook_url}/`;
        
        console.log("Listing connectors (Webhook mode)...");
        const listUrl = `${bitrixApiUrl}imconnector.list`;
        const listResponse = await fetch(listUrl);
        const listResult = await listResponse.json();
        console.log("imconnector.list result:", JSON.stringify(listResult));

        const removedConnectors: string[] = [];
        
        if (listResult.result) {
          const connectorsToRemove = Object.keys(listResult.result).filter(id => {
            const idLower = id.toLowerCase();
            return idLower.includes("thoth") || idLower.includes("whatsapp");
          });

          console.log("Connectors to remove:", connectorsToRemove);

          for (const connectorId of connectorsToRemove) {
            console.log(`Unregistering connector: ${connectorId}`);
            const unregisterUrl = `${bitrixApiUrl}imconnector.unregister`;
            try {
              const unregisterResponse = await fetch(unregisterUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ID: connectorId }),
              });
              const unregisterResult = await unregisterResponse.json();
              console.log(`Unregister ${connectorId} result:`, JSON.stringify(unregisterResult));
              
              if (unregisterResult.result || !unregisterResult.error) {
                removedConnectors.push(connectorId);
              }
            } catch (e) {
              console.log(`Failed to unregister ${connectorId}:`, e);
            }
          }
        }

        return new Response(
          JSON.stringify({ 
            success: true, 
            removed_count: removedConnectors.length,
            removed_connectors: removedConnectors,
            message: `${removedConnectors.length} conector(es) removido(s)`,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } else {
        return new Response(
          JSON.stringify({ error: "Integração não possui token OAuth nem webhook configurado" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Validate that we have at least member_id or webhook_url
    if (!member_id && !webhook_url) {
      console.error("No member_id or webhook_url provided");
      return new Response(
        JSON.stringify({ error: "member_id ou webhook_url é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Registering Bitrix24 connector:", { connector_id, workspace_id, member_id, instance_id });

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

    // 0. AUTOMATIC CLEANUP: Remove ALL existing Thoth/WhatsApp connectors to avoid duplicates
    console.log("=== AUTOMATIC CONNECTOR CLEANUP ===");
    
    // List all existing connectors
    const listUrl = `${bitrixApiUrl}imconnector.list?auth=${accessToken}`;
    try {
      const listResponse = await fetch(listUrl);
      const listResult = await listResponse.json();
      console.log("imconnector.list result:", JSON.stringify(listResult));
      
      if (listResult.result) {
        // Find all connectors with "thoth" or "whatsapp" in the name
        const connectorsToRemove = Object.keys(listResult.result).filter(id => {
          const idLower = id.toLowerCase();
          return idLower.includes("thoth") || idLower.includes("whatsapp");
        });
        
        console.log("Connectors to remove:", connectorsToRemove);
        
        // Remove each one before registering the new one
        for (const connectorIdToRemove of connectorsToRemove) {
          console.log(`Cleaning up connector: ${connectorIdToRemove}`);
          
          // First deactivate on all lines (0-10)
          for (let line = 0; line <= 10; line++) {
            try {
              await fetch(`${bitrixApiUrl}imconnector.deactivate?auth=${accessToken}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ CONNECTOR: connectorIdToRemove, LINE: line })
              });
            } catch (e) {
              // Ignore deactivation errors
            }
          }
          
          // Then unregister
          try {
            const unregisterResponse = await fetch(`${bitrixApiUrl}imconnector.unregister?auth=${accessToken}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ID: connectorIdToRemove }),
            });
            const unregisterResult = await unregisterResponse.json();
            console.log(`Unregistered ${connectorIdToRemove}:`, JSON.stringify(unregisterResult));
          } catch (e) {
            console.log(`Failed to unregister ${connectorIdToRemove}:`, e);
          }
        }
      }
    } catch (e) {
      console.log("Error listing connectors for cleanup:", e);
    }
    
    // Also clean up duplicate events before binding new ones (both old webhook and events URLs)
    console.log("=== CLEANING DUPLICATE EVENTS ===");
    
    try {
      const eventsListUrl = `${bitrixApiUrl}event.get?auth=${accessToken}`;
      const eventsResponse = await fetch(eventsListUrl);
      const eventsResult = await eventsResponse.json();
      
      if (eventsResult.result) {
        // Clean up events pointing to either old webhook or current events URL
        const eventsToUnbind = eventsResult.result.filter((event: any) => 
          event.handler?.includes("bitrix24-webhook") || event.handler?.includes("bitrix24-events")
        );
        
        console.log(`Found ${eventsToUnbind.length} Thoth events to clean up`);
        
        for (const event of eventsToUnbind) {
          try {
            await fetch(`${bitrixApiUrl}event.unbind?auth=${accessToken}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                event: event.event,
                handler: event.handler
              })
            });
            console.log(`Unbound event: ${event.event}`);
          } catch (e) {
            // Ignore unbind errors
          }
        }
      }
    } catch (e) {
      console.log("Error cleaning up events:", e);
    }
    
    console.log("=== CLEANUP COMPLETE, REGISTERING NEW CONNECTOR ===");

    // 1. Register connector in Bitrix24 (this makes it appear in Contact Center)
    // CRITICAL: Use proper icon format with COLOR, SIZE, POSITION for Marketplace compliance
    const whatsappSvgIcon = "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSIjMjVENDY2Ij48cGF0aCBkPSJNMTcuNDcyIDYuMDA1QzE1Ljc4NCA0LjMxNSAxMy41MTIgMy4zODQgMTEuMTUgMy4zODRjLTQuOTQzIDAtOC45NjYgNC4wMjMtOC45NjYgOC45NjYgMCAxLjU4MS40MTMgMy4xMjcgMS4xOTggNC40ODlMMi40MTYgMjEuNjE2bDUuMjEyLTEuMzY4Yy4yNjEuMTQzIDQuNDcgMi41NzIgOC4wNTEuNjgxIDMuNjYxLTEuOTMzIDUuNzUxLTUuODQ1IDUuNzUxLTEwLjE3IDAtMi4zNjItLjkyLTQuNTg0LTIuNTktNi4yNTR6bS0xMS4yMjMgMTAuNjE0bC0uMDk0LS4wNDlIMy4xNDhsLjI4OS0xLjA1NS0uMTg3LS4yOTdjLS44MTQtMS4yOTQtMS4yNDQtMi43ODUtMS4yNDQtNC4zMTggMC00LjQ3NCAzLjY0LTguMTE0IDguMTE0LTguMTE0IDIuMTY2IDAgNC4yMDEuODQzIDUuNzMzIDIuMzc1IDEuNTMyIDEuNTMyIDIuMzc1IDMuNTY3IDIuMzc1IDUuNzMzIDAgNC40NzQtMy42NCA4LjExNC04LjExNCA4LjExNC0xLjQ3MyAwLTIuOTE5LS40LTQuMTc4LTEuMTUzbC0uMjk5LS4xNzctLjMxMy4wODItMi4xNjEuNTY2LjU1NC0yLjAyOHoiLz48cGF0aCBkPSJNMTUuMjk1IDE0LjY0M2MtLjI2MS0uMTMtMS41NDYtLjc2Mi0xLjc4NS0uODQ5LS4yNDEtLjA4Ny0uNDE1LS4xMzEtLjU4OS4xMy0uMTc0LjI2MS0uNjc2Ljg0OS0uODI4IDEuMDI0LS4xNTIuMTc0LS4zMDQuMTk2LS41NjUuMDY1cy0xLjEwMy0uNDA2LTIuMTAyLTEuMjk3Yy0uNzc2LS42OTItMS4zMDItMS41NDYtMS40NTQtMS44MDctLjE1Mi0uMjYxLS4wMTYtLjQwMi4xMTQtLjUzMi4xMTktLjExNy4yNjEtLjMwNC4zOTEtLjQ1Ni4xMy0uMTUyLjE3NC0uMjYxLjI2MS0uNDM1cy4wNDMtLjMyNi0uMDIyLS40NTZjLS4wNjUtLjEzLS41ODktMS40Mi0uODA2LTEuOTQ2LS4yMTMtLjUxMS0uNDI5LS40NDEtLjU4OS0uNDQ5LS4xNTItLjAwOC0uMzI2LS4wMS0uNS0uMDFzLS40NTYuMDY1LS42OTYuMzI2Yy0uMjQxLjI2LS45MTguODk3LS45MTggMi4xODhzLjk0IDIuNTM0IDEuMDcxIDIuNzA4YzEuMDMzIDEuMzc1IDIuNDcgMi4xNjIgMy41MjYgMi41NjguNDY3LjE4Ljg0MS4yODggMS4xMjkuMzY5LjQ3NC4xMzQuOTA2LjExNSAxLjI0Ny4wNy4zOC0uMDUuMTcxLS4yMDkgMS4xNDQtLjk4LjIzOS0uMTk3LjQ4NC0uMTgzLjgxMi0uMTEuMzI4LjA3NCAxLjMyMi41NTEgMS41NDguNjUxLjIyNi4xLjM3Ny4xNDguNDMzLjIzLjA1Ni4wODMuMDU2LjQ3OS0uMTI5Ljk0MXoiLz48L3N2Zz4=";
    
    const registerPayload = {
      ID: finalConnectorId,
      NAME: "Thoth WhatsApp",
      ICON: {
        DATA_IMAGE: `data:image/svg+xml;base64,${whatsappSvgIcon}`,
        COLOR: "#25D366",
        SIZE: "90%",
        POSITION: "center"
      },
      // Point to dedicated PLACEMENT_HANDLER for Marketplace compliance
      PLACEMENT_HANDLER: `${supabaseUrl}/functions/v1/bitrix24-connector-settings`,
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

    // 2. ACTIVATE connector immediately with default line (LINE: 2)
    // This ensures "Setup concluído" in Bitrix24 Contact Center
    // IMPORTANT: Use LINE 2 as that's where the "Thoth whatsapp" channel is configured
    const defaultLineId = 2; // Default to LINE 2 where "Thoth whatsapp" is configured
    
    console.log("=== ACTIVATING CONNECTOR IMMEDIATELY ===");
    console.log("Using connector ID:", finalConnectorId);
    console.log("Target LINE:", defaultLineId);
    
    // CRITICAL: Use bitrix24-events (PUBLIC) for receiving Bitrix24 events
    // Bitrix24 documentation states event handlers must use clean URLs
    const cleanWebhookUrl = `${supabaseUrl}/functions/v1/bitrix24-events`;
    
    // Call imconnector.activate
    const activateUrl = `${bitrixApiUrl}imconnector.activate?auth=${accessToken}`;
    console.log("Calling imconnector.activate...");
    console.log("  CONNECTOR:", finalConnectorId);
    console.log("  LINE:", defaultLineId);
    console.log("  ACTIVE:", 1);
    
    const activateResponse = await fetch(activateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        CONNECTOR: finalConnectorId,
        LINE: defaultLineId,
        ACTIVE: 1
      })
    });
    const activateResult = await activateResponse.json();
    console.log("imconnector.activate result:", JSON.stringify(activateResult));
    
    // 3. Set connector data with CLEAN URLs (no query params)
    console.log("Setting connector data with clean webhook URL...");
    const dataSetUrl = `${bitrixApiUrl}imconnector.connector.data.set?auth=${accessToken}`;
    
    const dataSetResponse = await fetch(dataSetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        CONNECTOR: finalConnectorId,
        LINE: defaultLineId,
        DATA: {
          id: `${finalConnectorId}_line_${defaultLineId}`,
          url: cleanWebhookUrl,
          url_im: cleanWebhookUrl,
          name: "Thoth WhatsApp"
        }
      })
    });
    const dataSetResult = await dataSetResponse.json();
    console.log("imconnector.connector.data.set result:", JSON.stringify(dataSetResult));

    // 3a. Verify activation via imopenlines.config.list.get
    console.log("=== VERIFYING ACTIVATION STATUS ===");
    const configListUrl = `${bitrixApiUrl}imopenlines.config.list.get?auth=${accessToken}`;
    
    let connectorActive = false;
    try {
      const configListResponse = await fetch(configListUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const configListResult = await configListResponse.json();
      console.log("imopenlines.config.list.get result:", JSON.stringify(configListResult));

      // Find our line in the results
      if (configListResult.result && Array.isArray(configListResult.result)) {
        const ourLine = configListResult.result.find((line: any) => 
          String(line.ID) === String(defaultLineId)
        );
        
        if (ourLine) {
          // Check both ACTIVE field and connector_active field
          // Note: connector_active may be boolean true, string "true", or number 1
          connectorActive = ourLine.ACTIVE === "Y" || 
                           ourLine.connector_active === true || 
                           ourLine.connector_active === "true" ||
                           ourLine.connector_active === 1;
          console.log(`Line ${defaultLineId} verification:`);
          console.log(`  ACTIVE field: ${ourLine.ACTIVE}`);
          console.log(`  connector_active field: ${ourLine.connector_active}`);
          console.log(`  Final status: ${connectorActive ? "ACTIVE" : "INACTIVE"}`);
        } else {
          console.log(`Line ${defaultLineId} not found in config list - may need manual activation`);
        }
      }
    } catch (verifyError) {
      console.error("Error verifying connector status:", verifyError);
    }

    // 4. Bind events to receive messages from Bitrix24 operators
    // CRITICAL: Use CLEAN URL without query parameters
    console.log("Binding events with CLEAN webhook URL:", cleanWebhookUrl);
    
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
          handler: cleanWebhookUrl, // CLEAN URL - no query params
        }),
      });
      const bindResult = await bindResponse.json();
      console.log(`event.bind ${event} result:`, JSON.stringify(bindResult));
    }

    // 5. Update integration in database with registration details
    const activated = !activateResult.error && connectorActive;
    const configUpdate = {
      connector_id: finalConnectorId,
      instance_id: instance_id || null,
      registered: true,
      activated: activated,
      activated_line_id: activated ? defaultLineId : null,
      connector_active: connectorActive,
      events_url: cleanWebhookUrl,
      line_id: String(defaultLineId),
      activation_verified: true,
      last_activation_check: new Date().toISOString(),
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
        message: activated 
          ? "Conector registrado E ATIVADO com sucesso no Contact Center!" 
          : "Conector registrado mas ativação pendente. Use 'Ativar Manualmente' na interface.",
        connector_id: finalConnectorId,
        events_url: cleanWebhookUrl,
        mode: "oauth",
        activated: activated,
        connector_active: connectorActive,
        line_id: defaultLineId,
        activate_result: activateResult,
        data_set_result: dataSetResult,
        status_verification: connectorActive ? "VERIFIED_ACTIVE" : "PENDING_MANUAL_ACTIVATION",
        next_steps: activated 
          ? "O conector está ativo na LINE 2! Teste enviando uma mensagem pelo WhatsApp."
          : "Vá em Contact Center → Thoth WhatsApp → Continuar para finalizar a configuração",
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

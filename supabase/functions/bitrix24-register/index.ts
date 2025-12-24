import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Thoth Ibis Icon SVG (WhatsApp-style green background with ibis bird)
const THOTH_IBIS_ICON_SVG = `data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%2325D366'/%3E%3Ccircle cx='50' cy='45' r='30' fill='none' stroke='white' stroke-width='4'/%3E%3Cpath d='M35 75 L50 90 L50 75' fill='white'/%3E%3Cg fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M50 65 C42 62, 36 52, 38 40 C40 30, 46 26, 52 26 C58 26, 64 32, 64 42 C64 52, 58 62, 50 65'/%3E%3Cpath d='M48 26 C45 22, 38 18, 32 14'/%3E%3Ccircle cx='30' cy='12' r='5'/%3E%3Cpath d='M25 12 C22 16, 18 22, 16 28'/%3E%3Ccircle cx='29' cy='11' r='1.5' fill='white'/%3E%3C/g%3E%3C/svg%3E`;

// Disabled icon (gray version)
const THOTH_IBIS_ICON_DISABLED_SVG = `data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%23999999'/%3E%3Ccircle cx='50' cy='45' r='30' fill='none' stroke='white' stroke-width='4'/%3E%3Cpath d='M35 75 L50 90 L50 75' fill='white'/%3E%3Cg fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M50 65 C42 62, 36 52, 38 40 C40 30, 46 26, 52 26 C58 26, 64 32, 64 42 C64 52, 58 62, 50 65'/%3E%3Cpath d='M48 26 C45 22, 38 18, 32 14'/%3E%3Ccircle cx='30' cy='12' r='5'/%3E%3Cpath d='M25 12 C22 16, 18 22, 16 28'/%3E%3Ccircle cx='29' cy='11' r='1.5' fill='white'/%3E%3C/g%3E%3C/svg%3E`;

// Complete icon objects for imconnector.register API (as in bitrix24-webhook)
const THOTH_CONNECTOR_ICON = {
  DATA_IMAGE: THOTH_IBIS_ICON_SVG,
  COLOR: "#25D366",
  SIZE: "90%",
  POSITION: "center"
};

const THOTH_CONNECTOR_ICON_DISABLED = {
  DATA_IMAGE: THOTH_IBIS_ICON_DISABLED_SVG,
  COLOR: "#999999",
  SIZE: "90%",
  POSITION: "center"
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
  // MARKETPLACE: Use credentials from environment variables, NOT from database
  const clientId = Deno.env.get("BITRIX24_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("BITRIX24_CLIENT_SECRET") || "";
  const refreshUrl = `https://oauth.bitrix.info/oauth/token/?grant_type=refresh_token&client_id=${clientId}&client_secret=${clientSecret}&refresh_token=${config.refresh_token}`;
  
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
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log("Request body:", JSON.stringify(body));
    
    const { action, connector_id, instance_id, workspace_id, integration_id, member_id, domain } = body;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Action: Clean connectors
    if (action === "clean_connectors") {
      console.log("=== CLEAN CONNECTORS ACTION ===");
      
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
            .or(`config->>member_id.eq.${searchId},config->>domain.eq.${searchId}`)
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

      const config = integration.config || {};
      
      if (!config.access_token) {
        return new Response(
          JSON.stringify({ error: "Integração não possui token OAuth configurado" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Refresh token if needed
      const accessToken = await refreshBitrixToken(integration, supabase);
      if (!accessToken) {
        return new Response(
          JSON.stringify({ error: "Falha ao obter token de acesso" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      const clientEndpoint = config.client_endpoint || `https://${config.domain}/rest/`;
      
      // List all connectors
      console.log("Listing connectors...");
      const listUrl = `${clientEndpoint}imconnector.list?auth=${accessToken}`;
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
          const unregisterUrl = `${clientEndpoint}imconnector.unregister?auth=${accessToken}`;
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
    }

    // Validate that we have member_id for OAuth mode
    if (!member_id) {
      console.error("No member_id provided");
      return new Response(
        JSON.stringify({ error: "member_id é obrigatório para registro via Marketplace" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Registering Bitrix24 connector:", { connector_id, workspace_id, member_id, instance_id });

    // Find integration by member_id
    let integration: any = null;
    
    const { data: byMemberId } = await supabase
      .from("integrations")
      .select("*")
      .eq("type", "bitrix24")
      .eq("config->>member_id", member_id)
      .maybeSingle();
    
    if (byMemberId) {
      integration = byMemberId;
    } else {
      const { data: byDomain } = await supabase
        .from("integrations")
        .select("*")
        .eq("type", "bitrix24")
        .eq("config->>domain", member_id)
        .maybeSingle();
      
      if (byDomain) {
        integration = byDomain;
      } else {
        const { data: byLike } = await supabase
          .from("integrations")
          .select("*")
          .eq("type", "bitrix24")
          .or(`config->>member_id.ilike.%${member_id}%,config->>domain.ilike.%${member_id}%`)
          .maybeSingle();
        integration = byLike;
      }
    }

    if (!integration) {
      console.error("No integration found for member_id:", member_id);
      return new Response(
        JSON.stringify({ error: "Integração Bitrix24 não encontrada. Por favor, reinstale o aplicativo." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Found integration:", integration.id);

    // Get access token (OAuth mode)
    const accessToken = await refreshBitrixToken(integration, supabase);
    
    if (!accessToken) {
      console.error("Failed to get access token for integration:", integration.id);
      return new Response(
        JSON.stringify({ 
          error: "Falha ao obter token de acesso. Por favor, reinstale o aplicativo via Marketplace.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const clientEndpoint = integration.config.client_endpoint || `https://${integration.config.domain}/rest/`;

    // Use a FIXED connector_id to avoid duplicates
    const finalConnectorId = connector_id || "thoth_whatsapp";
    console.log("Using fixed connector ID:", finalConnectorId);

    console.log("=== OAUTH MODE: Registering imconnector for Contact Center ===");

    // Register the connector
    const registerUrl = `${clientEndpoint}imconnector.register?auth=${accessToken}`;
    console.log("Calling imconnector.register...");
    
    const registerResponse = await fetch(registerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ID: finalConnectorId,
        NAME: "Thoth WhatsApp",
        ICON: THOTH_CONNECTOR_ICON,
        ICON_DISABLED: THOTH_CONNECTOR_ICON_DISABLED,
        PLACEMENT_HANDLER: `${supabaseUrl}/functions/v1/bitrix24-connector-settings`,
      }),
    });

    const registerResult = await registerResponse.json();
    console.log("imconnector.register result:", JSON.stringify(registerResult));

    // Even if registration fails (e.g., already exists), try to activate
    if (registerResult.error && !registerResult.error.includes("already")) {
      console.log("Registration error (non-duplicate):", registerResult.error);
    }

    // === DETECT AVAILABLE LINES ===
    console.log("=== DETECTING AVAILABLE OPEN LINES ===");
    let availableLines: number[] = [];
    let activatedLineId: number | null = null;
    
    try {
      const linesListUrl = `${clientEndpoint}imopenlines.config.list.get?auth=${accessToken}`;
      const linesResponse = await fetch(linesListUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auth: accessToken }),
      });
      const linesResult = await linesResponse.json();
      console.log("imopenlines.config.list.get result:", JSON.stringify(linesResult));
      
      if (linesResult.result && Array.isArray(linesResult.result)) {
        availableLines = linesResult.result.map((line: any) => parseInt(line.ID, 10)).filter((id: number) => !isNaN(id));
        console.log("Available lines:", availableLines);
      }
    } catch (e) {
      console.error("Error fetching lines:", e);
    }

    // If no lines found, default to [1]
    if (availableLines.length === 0) {
      availableLines = [1];
      console.log("No lines found, defaulting to line 1");
    }

    const eventsUrl = `${supabaseUrl}/functions/v1/bitrix24-events`;

    // Activate and configure connector on ALL available lines
    for (const lineId of availableLines) {
      console.log(`=== Activating connector on line ${lineId} ===`);
      
      // Activate the connector
      const activateUrl = `${clientEndpoint}imconnector.activate?auth=${accessToken}`;
      try {
        const activateResponse = await fetch(activateUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            CONNECTOR: finalConnectorId,
            LINE: lineId,
            ACTIVE: 1,
          }),
        });
        const activateResult = await activateResponse.json();
        console.log(`imconnector.activate line ${lineId} result:`, JSON.stringify(activateResult));
        
        if (!activateResult.error) {
          activatedLineId = lineId;
        }
      } catch (e) {
        console.error(`Error activating on line ${lineId}:`, e);
      }

      // Set connector data with webhook URL
      const dataSetUrl = `${clientEndpoint}imconnector.connector.data.set?auth=${accessToken}`;
      try {
        const dataSetResponse = await fetch(dataSetUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            CONNECTOR: finalConnectorId,
            LINE: lineId,
            DATA: {
              id: `${finalConnectorId}_line_${lineId}`,
              url: eventsUrl,
              url_im: eventsUrl,
              name: "Thoth WhatsApp",
            },
          }),
        });
        const dataSetResult = await dataSetResponse.json();
        console.log(`imconnector.connector.data.set line ${lineId} result:`, JSON.stringify(dataSetResult));
      } catch (e) {
        console.error(`Error setting data on line ${lineId}:`, e);
      }
    }

    // Bind events
    const events = [
      "OnImConnectorMessageAdd",
      "OnImConnectorDialogStart", 
      "OnImConnectorDialogFinish",
    ];

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
        console.log(`Event ${eventName} bound`);
      } catch (e) {
        console.error(`Error binding ${eventName}:`, e);
      }
    }

    // === AUTO-REGISTER AUTOMATION ROBOT ===
    console.log("=== AUTO-REGISTERING AUTOMATION ROBOT ===");
    let robotRegistered = false;
    let robotError: string | null = null;
    let robotScopeMissing = false;
    
    try {
      // Call bizproc.robot.add to register the automation robot
      const robotRegisterUrl = `${clientEndpoint}bizproc.robot.add?auth=${accessToken}`;
      
      const robotPayload = {
        CODE: "thoth_send_whatsapp",
        HANDLER: `${supabaseUrl}/functions/v1/bitrix24-robot-handler`,
        AUTH_USER_ID: 1,
        NAME: "Enviar WhatsApp (Thoth)",
        DESCRIPTION: "Envia mensagem WhatsApp para o contato usando Thoth AI",
        USE_SUBSCRIPTION: "Y",
        PROPERTIES: {
          PhoneNumber: {
            Name: "Telefone",
            Type: "string",
            Required: "Y",
            Default: "{{phone}}",
          },
          Message: {
            Name: "Mensagem",
            Type: "text",
            Required: "Y",
          },
          InstanceId: {
            Name: "ID da Instância WhatsApp",
            Type: "string",
            Required: "N",
            Description: "Deixe vazio para usar a instância padrão",
          },
        },
        RETURN_PROPERTIES: {
          MessageId: {
            Name: "ID da Mensagem",
            Type: "string",
          },
          Status: {
            Name: "Status",
            Type: "string",
          },
        },
      };

      const robotResponse = await fetch(robotRegisterUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(robotPayload),
      });

      const robotResult = await robotResponse.json();
      console.log("bizproc.robot.add result:", JSON.stringify(robotResult));

      if (robotResult.result || (robotResult.error && robotResult.error_description?.includes("already"))) {
        robotRegistered = true;
        console.log("Robot registered successfully or already exists");
      } else if (robotResult.error) {
        robotError = robotResult.error_description || robotResult.error;
        // Check for insufficient_scope error
        if (robotResult.error === "insufficient_scope" || robotError?.toLowerCase().includes("scope")) {
          robotScopeMissing = true;
        }
        console.log("Robot registration error:", robotError);
      }
    } catch (robotErr) {
      console.error("Error registering robot:", robotErr);
      robotError = robotErr instanceof Error ? robotErr.message : "Unknown error";
    }

    // === AUTO-REGISTER SMS PROVIDER ===
    console.log("=== AUTO-REGISTERING SMS PROVIDER ===");
    let smsProviderRegistered = false;
    let smsProviderError: string | null = null;
    let smsProviderScopeMissing = false;
    
    try {
      // Call messageservice.sender.add to register the SMS provider
      const smsRegisterUrl = `${clientEndpoint}messageservice.sender.add?auth=${accessToken}`;
      
      const smsPayload = {
        CODE: "thoth_whatsapp_sms",
        TYPE: "SMS",
        NAME: "Thoth WhatsApp",
        DESCRIPTION: "Envio de mensagens WhatsApp via Thoth.ai",
        HANDLER: `${supabaseUrl}/functions/v1/bitrix24-sms-handler`,
      };

      const smsResponse = await fetch(smsRegisterUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(smsPayload),
      });

      const smsResult = await smsResponse.json();
      console.log("messageservice.sender.add result:", JSON.stringify(smsResult));

      if (smsResult.result || (smsResult.error && (smsResult.error_description?.includes("already") || smsResult.error_description?.includes("exist")))) {
        smsProviderRegistered = true;
        console.log("SMS Provider registered successfully or already exists");
      } else if (smsResult.error) {
        smsProviderError = smsResult.error_description || smsResult.error;
        // Check for insufficient_scope error
        if (smsResult.error === "insufficient_scope" || smsProviderError?.toLowerCase().includes("scope")) {
          smsProviderScopeMissing = true;
        }
        console.log("SMS Provider registration error:", smsProviderError);
      }
    } catch (smsErr) {
      console.error("Error registering SMS Provider:", smsErr);
      smsProviderError = smsErr instanceof Error ? smsErr.message : "Unknown error";
    }

    // Update integration config
    const updatedConfig = {
      ...integration.config,
      connector_id: finalConnectorId,
      instance_id: instance_id || integration.config.instance_id,
      registered: true,
      registered_at: new Date().toISOString(),
      activated: activatedLineId !== null,
      activated_line_id: activatedLineId || availableLines[0] || 1,
      available_lines: availableLines,
      robot_registered: robotRegistered,
      robot_registered_at: robotRegistered ? new Date().toISOString() : null,
      robot_scope_missing: robotScopeMissing,
      robot_scope_error: robotError,
      sms_provider_registered: smsProviderRegistered,
      sms_provider_registered_at: smsProviderRegistered ? new Date().toISOString() : null,
      sms_provider_scope_missing: smsProviderScopeMissing,
      sms_provider_scope_error: smsProviderError,
    };

    await supabase
      .from("integrations")
      .update({
        config: updatedConfig,
        updated_at: new Date().toISOString(),
      })
      .eq("id", integration.id);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Conector, Robot e Provedor SMS registrados automaticamente via Marketplace OAuth",
        connector_id: finalConnectorId,
        registered: !registerResult.error || registerResult.error.includes("already"),
        activated: activatedLineId !== null,
        activated_lines: availableLines,
        robot_registered: robotRegistered,
        robot_error: robotError,
        robot_scope_missing: robotScopeMissing,
        sms_provider_registered: smsProviderRegistered,
        sms_provider_error: smsProviderError,
        sms_provider_scope_missing: smsProviderScopeMissing,
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

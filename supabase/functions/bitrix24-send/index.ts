import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper function to refresh Bitrix24 OAuth token
async function refreshBitrixToken(integration: any, supabase: any): Promise<string | null> {
  const config = integration.config;
  
  if (!config?.refresh_token || !config?.client_id || !config?.client_secret) {
    console.log("No OAuth credentials for refresh");
    return null;
  }

  const now = Date.now();
  const expiresAt = config.token_expires_at ? new Date(config.token_expires_at).getTime() : 0;
  
  // Check if token needs refresh (10 minutes buffer)
  if (expiresAt - now > 10 * 60 * 1000) {
    console.log("Token still valid, no refresh needed");
    return config.access_token;
  }

  console.log("Token expiring soon, refreshing...");

  try {
    const tokenUrl = `https://oauth.bitrix.info/oauth/token/?grant_type=refresh_token&client_id=${config.client_id}&client_secret=${config.client_secret}&refresh_token=${config.refresh_token}`;
    
    const response = await fetch(tokenUrl);
    const data = await response.json();

    if (data.error) {
      console.error("Token refresh error:", data.error);
      await supabase
        .from("integrations")
        .update({
          config: { ...config, token_refresh_failed: true },
          updated_at: new Date().toISOString()
        })
        .eq("id", integration.id);
      return null;
    }

    // Update integration with new tokens
    const newConfig = {
      ...config,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_expires_at: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
      token_refresh_failed: false,
    };

    await supabase
      .from("integrations")
      .update({
        config: newConfig,
        updated_at: new Date().toISOString()
      })
      .eq("id", integration.id);

    console.log("Token refreshed successfully");
    return data.access_token;
  } catch (error) {
    console.error("Error refreshing token:", error);
    return null;
  }
}

// Helper to create or find lead/contact in Bitrix24
async function createOrFindLead(
  apiUrl: string, 
  accessToken: string, 
  contactPhone: string, 
  contactName: string
): Promise<{ lead_id?: string; contact_id?: string; created?: boolean }> {
  try {
    const phoneSearch = contactPhone.replace(/\D/g, "");
    
    console.log("Searching for existing lead with phone:", phoneSearch);
    
    const searchResponse = await fetch(`${apiUrl}crm.lead.list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth: accessToken,
        filter: { "PHONE": phoneSearch },
        select: ["ID", "TITLE", "NAME", "PHONE"]
      })
    });
    
    const searchResult = await searchResponse.json();
    console.log("Lead search result:", JSON.stringify(searchResult));
    
    if (searchResult.result && searchResult.result.length > 0) {
      console.log("Found existing lead:", searchResult.result[0].ID);
      return { lead_id: searchResult.result[0].ID, created: false };
    }
    
    console.log("No existing lead found, creating new lead...");
    
    const createResponse = await fetch(`${apiUrl}crm.lead.add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth: accessToken,
        fields: {
          TITLE: `WhatsApp: ${contactName || phoneSearch}`,
          NAME: contactName || phoneSearch,
          PHONE: [{ VALUE: phoneSearch, VALUE_TYPE: "WORK" }],
          SOURCE_ID: "WEB",
          STATUS_ID: "NEW",
          COMMENTS: `Lead criado automaticamente via WhatsApp Thoth.ai`
        }
      })
    });
    
    const createResult = await createResponse.json();
    console.log("Lead creation result:", JSON.stringify(createResult));
    
    if (createResult.result) {
      return { lead_id: createResult.result.toString(), created: true };
    }
    
    return {};
  } catch (error) {
    console.error("Error creating/finding lead:", error);
    return {};
  }
}

// Helper to add activity to lead
async function addActivityToLead(
  apiUrl: string,
  accessToken: string,
  leadId: string,
  contactPhone: string,
  message: string,
  direction: "incoming" | "outgoing"
) {
  try {
    const response = await fetch(`${apiUrl}crm.activity.add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth: accessToken,
        fields: {
          OWNER_TYPE_ID: 1,
          OWNER_ID: leadId,
          TYPE_ID: 4,
          SUBJECT: direction === "incoming" ? `Mensagem recebida de ${contactPhone}` : `Mensagem enviada para ${contactPhone}`,
          DESCRIPTION: message,
          DIRECTION: direction === "incoming" ? 1 : 2,
          COMPLETED: "Y",
          RESPONSIBLE_ID: 1,
          COMMUNICATIONS: [
            {
              VALUE: contactPhone,
              ENTITY_ID: leadId,
              ENTITY_TYPE_ID: 1,
              TYPE: "PHONE"
            }
          ]
        }
      })
    });

    const result = await response.json();
    console.log("Activity added:", result.result ? "success" : "failed", result.error || "");
    return result.result;
  } catch (error) {
    console.error("Error adding activity:", error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      integration_id,
      workspace_id,
      instance_id,
      contact_phone, 
      contact_name, 
      contact_picture,
      message, 
      message_type,
      message_id,
      create_lead,
      is_first_message,
    } = await req.json();

    console.log("Bitrix24 send - sending message to Bitrix24:", { contact_phone, message, create_lead, instance_id });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get integration config
    let integration;
    if (integration_id) {
      const { data } = await supabase
        .from("integrations")
        .select("*")
        .eq("id", integration_id)
        .single();
      integration = data;
    } else if (workspace_id) {
      const { data } = await supabase
        .from("integrations")
        .select("*")
        .eq("workspace_id", workspace_id)
        .eq("type", "bitrix24")
        .eq("is_active", true)
        .maybeSingle();
      integration = data;
    }

    if (!integration) {
      console.error("No Bitrix24 integration found");
      return new Response(
        JSON.stringify({ error: "No Bitrix24 integration found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const config = integration.config as Record<string, unknown>;
    const connectorId = config?.connector_id as string;

    // Get access token (OAuth mode only)
    const accessToken = await refreshBitrixToken(integration, supabase);
    if (!accessToken) {
      console.error("Failed to get valid OAuth token");
      return new Response(
        JSON.stringify({ error: "OAuth token expired or invalid. Please reconnect Bitrix24 via Marketplace." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const clientEndpoint = config.client_endpoint as string;
    if (!clientEndpoint) {
      return new Response(
        JSON.stringify({ error: "Invalid Bitrix24 configuration - no client endpoint" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiUrl = clientEndpoint.endsWith("/") ? clientEndpoint : `${clientEndpoint}/`;

    // Fetch line_id from bitrix_channel_mappings based on instance
    let lineId = "1";
    
    if (instance_id) {
      const { data: channelMapping } = await supabase
        .from("bitrix_channel_mappings")
        .select("line_id, line_name")
        .eq("integration_id", integration.id)
        .eq("instance_id", instance_id)
        .eq("is_active", true)
        .maybeSingle();
      
      if (channelMapping?.line_id) {
        lineId = channelMapping.line_id.toString();
        console.log(`Using line_id ${lineId} (${channelMapping.line_name}) from channel mapping`);
      } else {
        lineId = (config?.line_id as string) || "1";
        console.log(`No channel mapping found for instance ${instance_id}, using config line_id: ${lineId}`);
      }
    } else {
      lineId = (config?.line_id as string) || "1";
    }

    // Create or find lead if this is first message or explicitly requested
    let leadInfo: { lead_id?: string; contact_id?: string; created?: boolean } = {};
    
    if (create_lead !== false && (is_first_message || create_lead === true)) {
      console.log("Checking/creating lead for contact:", contact_phone);
      leadInfo = await createOrFindLead(apiUrl, accessToken, contact_phone, contact_name || contact_phone);
      console.log("Lead info:", leadInfo);
      
      if (leadInfo.lead_id) {
        await addActivityToLead(apiUrl, accessToken, leadInfo.lead_id, contact_phone, message, "incoming");
      }
    }

    // Send to Open Lines via imconnector if configured
    let imconnectorResult = null;
    if (connectorId) {
      console.log(`Checking connector status on line ${lineId}...`);
      
      const statusResponse = await fetch(`${apiUrl}imconnector.status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: accessToken,
          CONNECTOR: connectorId,
          LINE: parseInt(lineId)
        })
      });
      const statusResult = await statusResponse.json();
      console.log("Connector status result:", JSON.stringify(statusResult));
      
      const isActive = statusResult.result?.active || statusResult.result?.ACTIVE;
      const isConfigured = statusResult.result?.connection || statusResult.result?.CONNECTION;
      
      const eventsCallbackUrl = `${supabaseUrl}/functions/v1/bitrix24-events`;
      
      if (!isActive || !isConfigured) {
        console.log(`Connector not fully active on line ${lineId}, activating...`);
        
        const activateResponse = await fetch(`${apiUrl}imconnector.activate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth: accessToken,
            CONNECTOR: connectorId,
            LINE: parseInt(lineId),
            ACTIVE: 1
          })
        });
        const activateResult = await activateResponse.json();
        console.log("Connector activate result:", JSON.stringify(activateResult));
      }
      
      // Configure connector data
      console.log(`Configuring connector data on line ${lineId} with events URL: ${eventsCallbackUrl}`);
      const configResponse = await fetch(`${apiUrl}imconnector.connector.data.set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: accessToken,
          CONNECTOR: connectorId,
          LINE: parseInt(lineId),
          DATA: {
            id: `${connectorId}_line_${lineId}`,
            url: eventsCallbackUrl,
            url_im: eventsCallbackUrl,
            name: "Thoth WhatsApp",
          }
        })
      });
      const configResult = await configResponse.json();
      console.log("Connector data.set result:", JSON.stringify(configResult));

      // Build message payload for Bitrix24
      const messagePayload = {
        CONNECTOR: connectorId,
        LINE: lineId,
        MESSAGES: [
          {
            user: {
              id: contact_phone,
              name: contact_name || contact_phone,
              picture: contact_picture ? { url: contact_picture } : undefined,
            },
            message: {
              id: message_id || `msg_${Date.now()}`,
              date: Math.floor(Date.now() / 1000),
              text: message,
            },
          },
        ],
      };

      console.log("Sending message via imconnector.send.messages");
      
      const sendResponse = await fetch(`${apiUrl}imconnector.send.messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: accessToken,
          ...messagePayload
        }),
      });

      imconnectorResult = await sendResponse.json();
      console.log("imconnector.send.messages result:", JSON.stringify(imconnectorResult));
    }

    // Update contact metadata with Bitrix24 info
    if (leadInfo.lead_id || imconnectorResult?.result) {
      const { data: contact } = await supabase
        .from("contacts")
        .select("id, metadata")
        .eq("phone_number", contact_phone)
        .eq("instance_id", instance_id)
        .maybeSingle();

      if (contact) {
        const existingMetadata = contact.metadata || {};
        await supabase
          .from("contacts")
          .update({
            metadata: {
              ...existingMetadata,
              bitrix24_user_id: contact_phone,
              bitrix24_session_id: imconnectorResult?.result?.session_id,
              bitrix24_lead_id: leadInfo.lead_id || existingMetadata.bitrix24_lead_id,
              bitrix24_last_sync: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", contact.id);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        lead: leadInfo,
        imconnector: imconnectorResult?.result || null,
        message_sent: !!imconnectorResult?.result,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Bitrix24 send error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

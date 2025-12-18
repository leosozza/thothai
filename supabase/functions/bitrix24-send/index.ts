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
      // Mark token as failed
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
  accessToken: string | null, 
  contactPhone: string, 
  contactName: string,
  isOAuth: boolean
): Promise<{ lead_id?: string; contact_id?: string; created?: boolean }> {
  try {
    // Format phone for search
    const phoneSearch = contactPhone.replace(/\D/g, "");
    
    // First, search for existing lead by phone
    console.log("Searching for existing lead with phone:", phoneSearch);
    
    const searchParams: Record<string, unknown> = {
      filter: {
        "PHONE": phoneSearch
      },
      select: ["ID", "TITLE", "NAME", "PHONE"]
    };
    
    if (isOAuth && accessToken) {
      searchParams.auth = accessToken;
    }
    
    const searchResponse = await fetch(`${apiUrl}crm.lead.list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(searchParams)
    });
    
    const searchResult = await searchResponse.json();
    console.log("Lead search result:", JSON.stringify(searchResult));
    
    if (searchResult.result && searchResult.result.length > 0) {
      console.log("Found existing lead:", searchResult.result[0].ID);
      return { lead_id: searchResult.result[0].ID, created: false };
    }
    
    // If no lead found, create new one
    console.log("No existing lead found, creating new lead...");
    
    const createParams: Record<string, unknown> = {
      fields: {
        TITLE: `WhatsApp: ${contactName || phoneSearch}`,
        NAME: contactName || phoneSearch,
        PHONE: [{ VALUE: phoneSearch, VALUE_TYPE: "WORK" }],
        SOURCE_ID: "WEB", // or create custom source "WHATSAPP"
        STATUS_ID: "NEW",
        COMMENTS: `Lead criado automaticamente via WhatsApp Thoth.ai`
      }
    };
    
    if (isOAuth && accessToken) {
      createParams.auth = accessToken;
    }
    
    const createResponse = await fetch(`${apiUrl}crm.lead.add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createParams)
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

// Helper to add activity (message history) to lead
async function addActivityToLead(
  apiUrl: string,
  accessToken: string | null,
  leadId: string,
  contactPhone: string,
  message: string,
  direction: "incoming" | "outgoing",
  isOAuth: boolean
) {
  try {
    const activityParams: Record<string, unknown> = {
      fields: {
        OWNER_TYPE_ID: 1, // Lead
        OWNER_ID: leadId,
        TYPE_ID: 4, // SMS/Message activity
        SUBJECT: direction === "incoming" ? `Mensagem recebida de ${contactPhone}` : `Mensagem enviada para ${contactPhone}`,
        DESCRIPTION: message,
        DIRECTION: direction === "incoming" ? 1 : 2, // 1 = incoming, 2 = outgoing
        COMPLETED: "Y",
        RESPONSIBLE_ID: 1, // Admin user
        COMMUNICATIONS: [
          {
            VALUE: contactPhone,
            ENTITY_ID: leadId,
            ENTITY_TYPE_ID: 1,
            TYPE: "PHONE"
          }
        ]
      }
    };

    if (isOAuth && accessToken) {
      activityParams.auth = accessToken;
    }

    const response = await fetch(`${apiUrl}crm.activity.add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(activityParams)
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
      contact_phone, 
      contact_name, 
      contact_picture,
      message, 
      message_type,
      message_id,
      create_lead,
      is_first_message,
    } = await req.json();

    console.log("Bitrix24 send - sending message to Bitrix24:", { contact_phone, message, create_lead });

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
    let webhookUrl = config?.webhook_url as string;
    const connectorId = config?.connector_id as string;
    const lineId = config?.line_id as string || "1";
    const isOAuth = !!config?.access_token;
    let accessToken: string | null = null;

    // For OAuth-based integrations, ensure we have a valid access token
    if (config?.access_token) {
      accessToken = await refreshBitrixToken(integration, supabase);
      if (!accessToken) {
        console.error("Failed to get valid OAuth token");
        return new Response(
          JSON.stringify({ error: "OAuth token expired or invalid. Please reconnect Bitrix24." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // Use client_endpoint for OAuth-based calls
      const clientEndpoint = config.client_endpoint as string;
      if (clientEndpoint) {
        webhookUrl = clientEndpoint;
      }
    }

    if (!webhookUrl) {
      console.error("Invalid Bitrix24 configuration - no webhook URL");
      return new Response(
        JSON.stringify({ error: "Invalid Bitrix24 configuration" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Ensure URL ends with /
    const apiUrl = webhookUrl.endsWith("/") ? webhookUrl : `${webhookUrl}/`;

    // Create or find lead if this is first message or explicitly requested
    let leadInfo: { lead_id?: string; contact_id?: string; created?: boolean } = {};
    
    if (create_lead !== false && (is_first_message || create_lead === true)) {
      console.log("Checking/creating lead for contact:", contact_phone);
      leadInfo = await createOrFindLead(apiUrl, accessToken, contact_phone, contact_name || contact_phone, isOAuth);
      console.log("Lead info:", leadInfo);
      
      // Add activity to lead
      if (leadInfo.lead_id) {
        await addActivityToLead(apiUrl, accessToken, leadInfo.lead_id, contact_phone, message, "incoming", isOAuth);
      }
    }

    // Send to Open Lines via imconnector if configured
    let imconnectorResult = null;
    if (connectorId) {
      // Build message payload for Bitrix24
      const messagePayload: Record<string, unknown> = {
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
            chat: {
              id: contact_phone,
            },
          },
        ],
      };

      // Add auth token for OAuth-based calls
      if (isOAuth && accessToken) {
        messagePayload.auth = accessToken;
      }

      console.log("Calling imconnector.send.messages:", JSON.stringify(messagePayload));

      const response = await fetch(`${apiUrl}imconnector.send.messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(messagePayload),
      });

      imconnectorResult = await response.json();
      console.log("imconnector.send.messages result:", JSON.stringify(imconnectorResult));

      if (imconnectorResult.error) {
        // Check for token expiration errors
        if (imconnectorResult.error === "expired_token" || imconnectorResult.error === "invalid_token") {
          return new Response(
            JSON.stringify({ error: "Token OAuth expirado. Reconecte o Bitrix24." }),
            { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        // Don't return error, lead might have been created
        console.error("imconnector error:", imconnectorResult.error);
      }

      // Save session info for conversation to open in Contact Center
      // The result may contain SESSION_ID, CHAT_ID, USER_ID that we need for replies
      const sessionData = imconnectorResult.result || {};
      const sessionId = sessionData.SESSION_ID || sessionData.session_id;
      const chatId = sessionData.CHAT_ID || sessionData.chat_id;
      const bitrixUserId = sessionData.USER_ID || sessionData.user_id;

      console.log("Session data from imconnector:", { sessionId, chatId, bitrixUserId });

      // Update contact metadata with Bitrix24 session info
      if (sessionId || chatId || bitrixUserId) {
        const { data: existingContact } = await supabase
          .from("contacts")
          .select("metadata")
          .eq("phone_number", contact_phone)
          .maybeSingle();

        await supabase
          .from("contacts")
          .update({ 
            metadata: { 
              ...(existingContact?.metadata || {}),
              bitrix24_session_id: sessionId,
              bitrix24_chat_id: chatId,
              bitrix24_user_id: bitrixUserId,
              bitrix24_lead_id: leadInfo.lead_id,
              bitrix24_last_message_at: new Date().toISOString(),
            } 
          })
          .eq("phone_number", contact_phone);

        console.log("Updated contact with session info");
      }
    }

    // Update contact with lead info
    if (leadInfo.lead_id) {
      const { data: existingContact } = await supabase
        .from("contacts")
        .select("metadata")
        .eq("phone_number", contact_phone)
        .maybeSingle();

      await supabase
        .from("contacts")
        .update({ 
          metadata: { 
            ...(existingContact?.metadata || {}),
            bitrix24_lead_id: leadInfo.lead_id,
          } 
        })
        .eq("phone_number", contact_phone);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        imconnector: imconnectorResult?.result,
        lead: leadInfo,
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

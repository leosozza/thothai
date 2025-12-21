import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * BITRIX24-WORKER: Função PRIVADA para processar eventos da fila
 * 
 * Responsabilidades:
 * - Buscar eventos pendentes da tabela bitrix_event_queue
 * - Processar cada evento de forma assíncrona
 * - Atualizar status do evento (done, failed)
 * - Implementar retry com max_attempts
 * 
 * Esta função é chamada pelo bitrix24-events após enfileirar eventos.
 */

/**
 * Clean Bitrix24 BBCode formatting for WhatsApp
 * Converts BBCode tags to WhatsApp-compatible format or removes them
 */
function cleanBBCodeForWhatsApp(text: string): string {
  if (!text) return "";
  
  let cleaned = text;
  
  // Convert formatting tags to WhatsApp format
  cleaned = cleaned.replace(/\[b\](.*?)\[\/b\]/gi, "*$1*");      // Bold: [b]text[/b] -> *text*
  cleaned = cleaned.replace(/\[i\](.*?)\[\/i\]/gi, "_$1_");      // Italic: [i]text[/i] -> _text_
  cleaned = cleaned.replace(/\[s\](.*?)\[\/s\]/gi, "~$1~");      // Strikethrough: [s]text[/s] -> ~text~
  cleaned = cleaned.replace(/\[u\](.*?)\[\/u\]/gi, "$1");        // Underline: remove (no WA equivalent)
  
  // Line breaks
  cleaned = cleaned.replace(/\[br\]/gi, "\n");                    // [br] -> newline
  cleaned = cleaned.replace(/\[br\/\]/gi, "\n");                  // [br/] -> newline
  
  // URLs: [url=link]text[/url] -> text (link)
  cleaned = cleaned.replace(/\[url=([^\]]+)\](.*?)\[\/url\]/gi, "$2 ($1)");
  cleaned = cleaned.replace(/\[url\](.*?)\[\/url\]/gi, "$1");     // [url]link[/url] -> link
  
  // Images: [img]url[/img] -> (imagem)
  cleaned = cleaned.replace(/\[img\](.*?)\[\/img\]/gi, "(imagem: $1)");
  
  // Quotes
  cleaned = cleaned.replace(/\[quote\](.*?)\[\/quote\]/gi, "> $1");
  cleaned = cleaned.replace(/\[quote=([^\]]+)\](.*?)\[\/quote\]/gi, "> $1: $2");
  
  // Code
  cleaned = cleaned.replace(/\[code\](.*?)\[\/code\]/gi, "```$1```");
  
  // Colors, fonts, sizes - just remove the tags
  cleaned = cleaned.replace(/\[color=[^\]]+\](.*?)\[\/color\]/gi, "$1");
  cleaned = cleaned.replace(/\[font=[^\]]+\](.*?)\[\/font\]/gi, "$1");
  cleaned = cleaned.replace(/\[size=[^\]]+\](.*?)\[\/size\]/gi, "$1");
  
  // Lists
  cleaned = cleaned.replace(/\[list\](.*?)\[\/list\]/gi, "$1");
  cleaned = cleaned.replace(/\[\*\]/gi, "• ");
  
  // Remove any remaining unknown BBCode tags
  cleaned = cleaned.replace(/\[[^\]]+\]/g, "");
  
  // Clean up multiple newlines
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  
  // Trim whitespace
  cleaned = cleaned.trim();
  
  return cleaned;
}

// Helper to refresh Bitrix24 OAuth token
async function refreshBitrixToken(integration: any, supabase: any): Promise<string | null> {
  const config = integration.config;
  
  if (!config.access_token) {
    console.log("No access token configured");
    return null;
  }

  // Check token expiration with 10 minute buffer
  if (config.token_expires_at) {
    const expiresAt = new Date(config.token_expires_at);
    const now = new Date();
    const bufferMs = 10 * 60 * 1000;
    
    if (expiresAt.getTime() - now.getTime() > bufferMs) {
      return config.access_token;
    }
  }

  if (!config.refresh_token) {
    return config.access_token;
  }

  // MARKETPLACE: Use credentials from environment variables, NOT from database
  const clientId = Deno.env.get("BITRIX24_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("BITRIX24_CLIENT_SECRET") || "";
  const refreshUrl = `https://oauth.bitrix.info/oauth/token/?grant_type=refresh_token&client_id=${clientId}&client_secret=${clientSecret}&refresh_token=${config.refresh_token}`;
  
  try {
    const response = await fetch(refreshUrl);
    const data = await response.json();

    if (data.error) {
      console.error("OAuth refresh error:", data.error);
      return config.access_token;
    }

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
  console.log("=== BITRIX24-WORKER: ASYNC EVENT PROCESSOR ===");
  console.log("Started at:", new Date().toISOString());

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Parse request body
    let requestBody: any = {};
    try {
      requestBody = await req.json();
    } catch {
      // No body is fine
    }

    const specificEventId = requestBody.event_id;
    let processedCount = 0;
    let maxEventsPerRun = 10; // Process up to 10 events per invocation

    // Fetch pending events
    let query = supabase
      .from("bitrix_event_queue")
      .select("*")
      .in("status", ["pending", "processing"])
      .order("created_at", { ascending: true })
      .limit(maxEventsPerRun);

    // If specific event ID provided, prioritize it
    if (specificEventId) {
      const { data: specificEvent } = await supabase
        .from("bitrix_event_queue")
        .select("*")
        .eq("id", specificEventId)
        .single();

      if (specificEvent && specificEvent.status === "pending") {
        await processEvent(specificEvent, supabase, supabaseUrl, supabaseServiceKey);
        processedCount++;
      }
    }

    // Process pending events
    const { data: events, error: fetchError } = await query;

    if (fetchError) {
      console.error("Error fetching events:", fetchError);
      return new Response(JSON.stringify({ 
        error: "Failed to fetch events",
        details: fetchError.message 
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    console.log(`Found ${events?.length || 0} pending events`);

    for (const event of events || []) {
      // Skip if already processed in this run
      if (event.id === specificEventId) continue;
      
      await processEvent(event, supabase, supabaseUrl, supabaseServiceKey);
      processedCount++;
    }

    console.log(`Processed ${processedCount} events`);

    return new Response(JSON.stringify({ 
      processed: processedCount,
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Worker error:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Unknown error"
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

/**
 * Process a single event from the queue
 */
async function processEvent(
  event: any, 
  supabase: any, 
  supabaseUrl: string, 
  supabaseServiceKey: string
) {
  console.log(`=== Processing event: ${event.id} (${event.event_type}) ===`);
  console.log("Attempts:", event.attempts);

  // Mark as processing
  await supabase
    .from("bitrix_event_queue")
    .update({ 
      status: "processing", 
      attempts: event.attempts + 1,
      updated_at: new Date().toISOString()
    })
    .eq("id", event.id);

  try {
    const payload = event.payload;

    switch (event.event_type) {
      case "ONIMCONNECTORMESSAGEADD":
        await processOperatorMessage(payload, supabase, supabaseUrl, supabaseServiceKey);
        break;

      case "ONIMCONNECTORMESSAGERECEIVE":
        await processClientConnectorMessage(payload, supabase, supabaseUrl, supabaseServiceKey);
        break;

      case "ONIMBOTMESSAGEADD":
        await processBotMessage(payload, supabase, supabaseUrl, supabaseServiceKey);
        break;

      case "ONIMBOTJOINOPEN":
        await processBotJoinOpen(payload, supabase, supabaseUrl, supabaseServiceKey);
        break;

      case "PLACEMENT":
        await processPlacement(payload, supabase, supabaseUrl);
        break;

      case "ONAPPTEST":
        console.log("ONAPPTEST received - test event from Bitrix24");
        break;

      case "ADMIN_REBIND_EVENTS":
        await processAdminRebindEvents(payload, supabase, supabaseUrl, supabaseServiceKey);
        break;

      case "ADMIN_REBIND_PLACEMENTS":
        await processAdminRebindPlacements(payload, supabase, supabaseUrl);
        break;

      default:
        console.log(`Unknown event type: ${event.event_type}`);
    }

    // Mark as done
    await supabase
      .from("bitrix_event_queue")
      .update({ 
        status: "done", 
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("id", event.id);

    console.log(`Event ${event.id} processed successfully`);

  } catch (error) {
    console.error(`Error processing event ${event.id}:`, error);

    const newStatus = event.attempts + 1 >= (event.max_attempts || 3) ? "failed" : "pending";
    
    await supabase
      .from("bitrix_event_queue")
      .update({ 
        status: newStatus,
        last_error: error instanceof Error ? error.message : "Unknown error",
        updated_at: new Date().toISOString()
      })
      .eq("id", event.id);

    if (newStatus === "failed") {
      console.log(`Event ${event.id} marked as FAILED after ${event.attempts + 1} attempts`);
    } else {
      console.log(`Event ${event.id} will be retried (attempt ${event.attempts + 1})`);
    }
  }
}

/**
 * Process ONIMCONNECTORMESSAGEADD - Operator sends message to WhatsApp
 */
async function processOperatorMessage(
  payload: any, 
  supabase: any, 
  supabaseUrl: string, 
  supabaseServiceKey: string
) {
  console.log("=== PROCESSING OPERATOR MESSAGE ===");
  console.log("Payload:", JSON.stringify(payload, null, 2));

  const messages = payload.data?.MESSAGES || [];
  const firstMessage = messages[0] || payload.data;
  
  if (!firstMessage) {
    console.log("No message data");
    return;
  }

  const recipientId = firstMessage.user?.id || firstMessage.im?.user_id;
  const recipientChatId = firstMessage.chat?.id || firstMessage.im?.chat_id;
  const messageText = firstMessage.message?.text || firstMessage.text || "";
  const line = firstMessage.line || payload.data?.LINE;

  console.log("Operator sending:", { recipientId, recipientChatId, messageText: messageText.substring(0, 50), line });

  if (!messageText) {
    console.log("Empty message text");
    return;
  }

  // Find instance from channel mapping
  let instanceId: string | null = null;
  let workspaceId: string | null = null;

  if (line) {
    const { data: mapping } = await supabase
      .from("bitrix_channel_mappings")
      .select("instance_id, workspace_id")
      .eq("line_id", line)
      .eq("is_active", true)
      .maybeSingle();

    if (mapping) {
      instanceId = mapping.instance_id;
      workspaceId = mapping.workspace_id;
      console.log("Found mapping for line:", line);
    }
  }

  if (!instanceId) {
    // Fallback to integration config
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("type", "bitrix24")
      .eq("is_active", true)
      .maybeSingle();

    if (integration?.config?.instance_id) {
      instanceId = integration.config.instance_id;
      workspaceId = integration.workspace_id;
    }
  }

  if (!instanceId) {
    console.error("No instance_id found");
    return;
  }

  // Find contact
  const cleanRecipientId = recipientId?.toString().replace(/\D/g, "");
  let contact = null;

  // Strategy 1: Exact phone match
  if (cleanRecipientId) {
    const { data } = await supabase
      .from("contacts")
      .select("*")
      .eq("instance_id", instanceId)
      .eq("phone_number", cleanRecipientId)
      .maybeSingle();
    contact = data;
  }

  // Strategy 2: Phone suffix match
  if (!contact && cleanRecipientId && cleanRecipientId.length >= 8) {
    const { data } = await supabase
      .from("contacts")
      .select("*")
      .eq("instance_id", instanceId)
      .ilike("phone_number", `%${cleanRecipientId.slice(-10)}`)
      .maybeSingle();
    contact = data;
  }

  // Strategy 3: Metadata bitrix24_user_id
  if (!contact && recipientId) {
    const { data } = await supabase
      .from("contacts")
      .select("*")
      .eq("instance_id", instanceId)
      .contains("metadata", { bitrix24_user_id: recipientId.toString() })
      .maybeSingle();
    contact = data;
  }

  // Strategy 4: Metadata bitrix24_chat_id
  if (!contact && recipientChatId) {
    const { data } = await supabase
      .from("contacts")
      .select("*")
      .eq("instance_id", instanceId)
      .contains("metadata", { bitrix24_chat_id: recipientChatId.toString() })
      .maybeSingle();
    contact = data;
  }

  // Strategy 5: Extract phone from chat_id (format: wa_5515996045202)
  if (!contact && recipientChatId && recipientChatId.toString().startsWith("wa_")) {
    const phoneFromChatId = recipientChatId.toString().replace("wa_", "");
    console.log("Trying phone from chat_id:", phoneFromChatId);
    
    // Exact match
    const { data: exactMatch } = await supabase
      .from("contacts")
      .select("*")
      .eq("instance_id", instanceId)
      .eq("phone_number", phoneFromChatId)
      .maybeSingle();
    
    if (exactMatch) {
      contact = exactMatch;
    } else {
      // Suffix match (last 10 digits)
      const { data: suffixMatch } = await supabase
        .from("contacts")
        .select("*")
        .eq("instance_id", instanceId)
        .ilike("phone_number", `%${phoneFromChatId.slice(-10)}`)
        .maybeSingle();
      contact = suffixMatch;
    }
  }

  if (!contact) {
    console.error("Contact not found:", { recipientId, recipientChatId });
    return;
  }

  console.log("Found contact:", contact.id, contact.phone_number);

  // Get conversation
  let conversationId = null;
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("contact_id", contact.id)
    .eq("instance_id", instanceId)
    .in("status", ["open", "pending"])
    .order("created_at", { ascending: false })
    .maybeSingle();

  if (conversation) {
    conversationId = conversation.id;
  }

  // Clean BBCode formatting before sending to WhatsApp
  const cleanedMessage = cleanBBCodeForWhatsApp(messageText);
  console.log("Original message:", messageText);
  console.log("Cleaned message:", cleanedMessage);

  // Send to WhatsApp
  console.log("Sending to WhatsApp...");
  const sendResponse = await fetch(`${supabaseUrl}/functions/v1/wapi-send-message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${supabaseServiceKey}`,
    },
    body: JSON.stringify({
      instance_id: instanceId,
      phone_number: contact.phone_number,
      message: cleanedMessage,
      message_type: "text",
      conversation_id: conversationId,
      contact_id: contact.id,
      workspace_id: workspaceId,
      internal_call: true,
    }),
  });

  const sendResult = await sendResponse.json();
  console.log("WhatsApp send result:", sendResult.error ? "ERROR" : "SUCCESS");

  if (sendResult.error) {
    throw new Error(`WhatsApp send failed: ${sendResult.error}`);
  }

  // Send delivery status to Bitrix24
  try {
    const messageId = firstMessage.message?.id || firstMessage.im?.message_id;
    if (messageId && line) {
      const { data: integrationData } = await supabase
        .from("integrations")
        .select("*")
        .eq("type", "bitrix24")
        .eq("is_active", true)
        .maybeSingle();

      if (integrationData?.config?.access_token) {
        const bitrixAccessToken = await refreshBitrixToken(integrationData, supabase);
        // IMPORTANT: Use config.domain for REST API calls, NOT client_endpoint (which is oauth.bitrix.info)
        const bitrixEndpoint = integrationData.config.domain ? `https://${integrationData.config.domain}/rest/` : integrationData.config.client_endpoint;
        const bitrixConnectorId = integrationData.config.connector_id || "thoth_whatsapp";

        await fetch(`${bitrixEndpoint}imconnector.send.status.delivery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth: bitrixAccessToken,
            CONNECTOR: bitrixConnectorId,
            LINE: line,
            MESSAGES: [{
              im: { chat_id: recipientChatId, message_id: messageId },
              message: { id: [sendResult.messageId || sendResult.id || `wa_${Date.now()}`] },
              chat: { id: recipientChatId }
            }]
          })
        });
        console.log("Delivery status sent to Bitrix24");
      }
    }
  } catch (deliveryError) {
    console.error("Error sending delivery status:", deliveryError);
  }

  // Save message if conversation exists
  if (conversationId && !sendResult.message) {
    await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        contact_id: contact.id,
        instance_id: instanceId,
        content: messageText,
        direction: "outgoing",
        is_from_bot: false,
        message_type: "text",
        status: "sent",
        metadata: { source: "bitrix24_operator" }
      });
  }

  // Update conversation timestamp
  if (conversationId) {
    await supabase
      .from("conversations")
      .update({ 
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("id", conversationId);
  }

  console.log("Operator message processed successfully");
}

/**
 * Process ONIMCONNECTORMESSAGERECEIVE - Client message via connector
 */
async function processClientConnectorMessage(
  payload: any, 
  supabase: any, 
  supabaseUrl: string, 
  supabaseServiceKey: string
) {
  console.log("=== PROCESSING CLIENT CONNECTOR MESSAGE ===");
  // This event is less common - typically WhatsApp messages come via wapi-webhook
  // But we handle it for completeness
  console.log("Payload:", JSON.stringify(payload, null, 2));
  
  // Implementation would be similar to processOperatorMessage but for incoming
  // For now, just log
  console.log("ONIMCONNECTORMESSAGERECEIVE handled (logging only)");
}

/**
 * Process ONIMBOTMESSAGEADD - User sends message to bot
 * This triggers AI processing and sends response back
 */
async function processBotMessage(
  payload: any, 
  supabase: any, 
  supabaseUrl: string, 
  supabaseServiceKey: string
) {
  console.log("=== PROCESSING BOT MESSAGE ===");
  console.log("Payload:", JSON.stringify(payload, null, 2));
  
  const data = payload.data || payload;
  
  // Extract message data from Bitrix24 bot event
  const messageText = data.PARAMS?.MESSAGE || data.MESSAGE || data.message || "";
  const dialogId = data.PARAMS?.DIALOG_ID || data.DIALOG_ID || data.dialog_id || "";
  const fromUserId = data.PARAMS?.FROM_USER_ID || data.FROM_USER_ID || data.from_user_id || "";
  const botId = data.PARAMS?.BOT_ID || data.BOT_ID || data.bot_id || "";
  const memberId = payload.auth?.member_id || payload.member_id || "";
  const domain = payload.auth?.domain || payload.DOMAIN || "";
  
  console.log("Bot message details:", { messageText: messageText.substring(0, 50), dialogId, fromUserId, botId, memberId });

  if (!messageText || messageText.trim() === "") {
    console.log("Empty message, skipping");
    return;
  }

  // Find integration by member_id or domain
  let integration = null;
  
  if (memberId) {
    const { data: intData } = await supabase
      .from("integrations")
      .select("*")
      .eq("type", "bitrix24")
      .eq("config->>member_id", memberId)
      .eq("is_active", true)
      .maybeSingle();
    integration = intData;
  }
  
  if (!integration && domain) {
    const { data: intData } = await supabase
      .from("integrations")
      .select("*")
      .eq("type", "bitrix24")
      .ilike("config->>domain", `%${domain}%`)
      .eq("is_active", true)
      .maybeSingle();
    integration = intData;
  }

  if (!integration) {
    console.error("No integration found for bot message");
    return;
  }

  const config = integration.config || {};
  
  // Check if bot AI is enabled
  if (!config.bot_enabled) {
    console.log("Bot AI is disabled for this integration");
    return;
  }

  console.log("Integration found:", integration.id);

  // Find or create contact for this Bitrix24 user
  const workspaceId = integration.workspace_id;
  const instanceId = config.instance_id;
  
  if (!instanceId) {
    console.error("No instance_id configured for bot");
    return;
  }

  // Use dialogId or fromUserId as unique identifier
  const contactIdentifier = dialogId || `bitrix_user_${fromUserId}`;
  
  // Find existing contact by metadata
  let contact = null;
  const { data: existingContact } = await supabase
    .from("contacts")
    .select("*")
    .eq("instance_id", instanceId)
    .contains("metadata", { bitrix24_dialog_id: dialogId })
    .maybeSingle();
  
  if (existingContact) {
    contact = existingContact;
  } else {
    // Create new contact for this Bitrix24 user
    const { data: newContact, error: contactError } = await supabase
      .from("contacts")
      .insert({
        instance_id: instanceId,
        phone_number: `bitrix_${fromUserId}`,
        name: `Usuário Bitrix #${fromUserId}`,
        metadata: {
          source: "bitrix24_bot",
          bitrix24_user_id: fromUserId,
          bitrix24_dialog_id: dialogId,
        }
      })
      .select()
      .single();
    
    if (contactError) {
      console.error("Error creating contact:", contactError);
      return;
    }
    contact = newContact;
    console.log("Created new contact:", contact.id);
  }

  // Find or create conversation
  let conversation = null;
  const { data: existingConversation } = await supabase
    .from("conversations")
    .select("*")
    .eq("contact_id", contact.id)
    .eq("instance_id", instanceId)
    .in("status", ["open", "pending"])
    .order("created_at", { ascending: false })
    .maybeSingle();

  if (existingConversation) {
    conversation = existingConversation;
  } else {
    const { data: newConversation, error: convError } = await supabase
      .from("conversations")
      .insert({
        contact_id: contact.id,
        instance_id: instanceId,
        status: "open",
        attendance_mode: "ai",
      })
      .select()
      .single();
    
    if (convError) {
      console.error("Error creating conversation:", convError);
      return;
    }
    conversation = newConversation;
    console.log("Created new conversation:", conversation.id);
  }

  // Save incoming message
  await supabase
    .from("messages")
    .insert({
      conversation_id: conversation.id,
      contact_id: contact.id,
      instance_id: instanceId,
      content: messageText,
      direction: "incoming",
      is_from_bot: false,
      message_type: "text",
      status: "received",
      metadata: { source: "bitrix24_bot", dialog_id: dialogId }
    });

  // Call AI processing
  console.log("Calling ai-process-bitrix24 for bot message...");
  
  try {
    const aiResponse = await fetch(`${supabaseUrl}/functions/v1/ai-process-bitrix24`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({
        conversation_id: conversation.id,
        contact_id: contact.id,
        content: messageText,
        workspace_id: workspaceId,
        integration_id: integration.id,
        instance_id: instanceId,
        bitrix24_bot_id: botId || config.bot_id,
        bitrix24_dialog_id: dialogId,
        message_type: "bot"
      })
    });

    const aiResult = await aiResponse.json();
    console.log("AI processing result:", aiResult.success ? "Success" : aiResult.error);

    if (!aiResponse.ok) {
      console.error("AI processing failed:", aiResult);
    }
  } catch (aiError) {
    console.error("Error calling AI processing:", aiError);
  }

  console.log("Bot message processed successfully");
}

/**
 * Process ONIMBOTJOINOPEN - User started conversation with bot
 * Send welcome message when user opens chat with the bot
 */
async function processBotJoinOpen(
  payload: any, 
  supabase: any, 
  supabaseUrl: string, 
  supabaseServiceKey: string
) {
  console.log("=== PROCESSING BOT JOIN OPEN ===");
  console.log("Payload:", JSON.stringify(payload, null, 2));
  
  const data = payload.data || payload;
  
  const dialogId = data.PARAMS?.DIALOG_ID || data.DIALOG_ID || data.dialog_id || "";
  const botId = data.PARAMS?.BOT_ID || data.BOT_ID || data.bot_id || "";
  const userId = data.PARAMS?.USER_ID || data.USER_ID || data.user_id || "";
  const memberId = payload.auth?.member_id || payload.member_id || "";
  const domain = payload.auth?.domain || payload.DOMAIN || "";
  
  console.log("Bot join details:", { dialogId, botId, userId, memberId });

  // Find integration
  let integration = null;
  
  if (memberId) {
    const { data: intData } = await supabase
      .from("integrations")
      .select("*")
      .eq("type", "bitrix24")
      .eq("config->>member_id", memberId)
      .eq("is_active", true)
      .maybeSingle();
    integration = intData;
  }
  
  if (!integration && domain) {
    const { data: intData } = await supabase
      .from("integrations")
      .select("*")
      .eq("type", "bitrix24")
      .ilike("config->>domain", `%${domain}%`)
      .eq("is_active", true)
      .maybeSingle();
    integration = intData;
  }

  if (!integration) {
    console.log("No integration found for bot join");
    return;
  }

  const config = integration.config || {};
  
  // Check if bot is enabled and has welcome message
  if (!config.bot_enabled) {
    console.log("Bot AI is disabled");
    return;
  }

  // Get welcome message from persona or config
  let welcomeMessage = config.bot_welcome_message || "";
  
  // If no custom welcome message, try to get from persona
  if (!welcomeMessage && config.bot_persona_id) {
    const { data: persona } = await supabase
      .from("personas")
      .select("welcome_message")
      .eq("id", config.bot_persona_id)
      .single();
    
    if (persona?.welcome_message) {
      welcomeMessage = persona.welcome_message;
    }
  }

  // Default welcome message if none configured
  if (!welcomeMessage) {
    welcomeMessage = "Olá! 👋 Sou o assistente virtual. Como posso ajudá-lo hoje?";
  }

  // Get access token
  const accessToken = await refreshBitrixToken(integration, supabase);
  if (!accessToken) {
    console.error("No access token available");
    return;
  }

  // Send welcome message via imbot.message.add
  const clientEndpoint = config.domain ? `https://${config.domain}/rest/` : config.client_endpoint;
  const effectiveBotId = botId || config.bot_id;

  if (!effectiveBotId) {
    console.error("No bot_id available");
    return;
  }

  const messagePayload = {
    auth: accessToken,
    BOT_ID: effectiveBotId,
    DIALOG_ID: dialogId,
    MESSAGE: welcomeMessage,
  };

  console.log("Sending welcome message:", JSON.stringify(messagePayload, null, 2));

  try {
    const response = await fetch(`${clientEndpoint}imbot.message.add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messagePayload)
    });

    const result = await response.json();
    console.log("Welcome message result:", JSON.stringify(result, null, 2));

    if (result.error) {
      console.error("Error sending welcome message:", result.error);
    } else {
      console.log("Welcome message sent successfully");
    }
  } catch (error) {
    console.error("Error sending welcome message:", error);
  }
}

/**
 * Process PLACEMENT - Connector settings page opened
 */
async function processPlacement(
  payload: any, 
  supabase: any, 
  supabaseUrl: string
) {
  console.log("=== PROCESSING PLACEMENT ===");
  console.log("PLACEMENT:", payload.PLACEMENT);
  
  // Get auth info
  const authId = payload.AUTH_ID || payload.auth?.access_token;
  const domain = payload.auth?.domain || payload.DOMAIN;
  const memberId = payload.auth?.member_id || payload.member_id;

  // Parse PLACEMENT_OPTIONS
  let options: any = {};
  if (typeof payload.PLACEMENT_OPTIONS === "string") {
    try {
      options = JSON.parse(payload.PLACEMENT_OPTIONS);
    } catch {
      try {
        options = JSON.parse(decodeURIComponent(payload.PLACEMENT_OPTIONS));
      } catch {
        options = {};
      }
    }
  } else if (payload.PLACEMENT_OPTIONS) {
    options = payload.PLACEMENT_OPTIONS;
  }

  const lineId = options.LINE || 1;
  const activeStatus = options.ACTIVE_STATUS ?? 1;
  const connectorId = options.CONNECTOR || "thoth_whatsapp";

  console.log("Placement options:", { lineId, activeStatus, connectorId });

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

  if (!integration) {
    console.log("No integration found for placement");
    return;
  }

  const webhookUrl = `${supabaseUrl}/functions/v1/bitrix24-events`;
  const config = integration.config || {};
  const accessToken = authId || config.access_token;
  // IMPORTANT: Use config.domain for REST API calls, NOT client_endpoint (which is oauth.bitrix.info)
  const apiUrl = domain ? `https://${domain}/rest/` : `https://${config.domain}/rest/`;

  // Activate connector
  if (payload.PLACEMENT === "SETTING_CONNECTOR" || lineId > 0) {
    try {
      // Activate
      await fetch(`${apiUrl}imconnector.activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: accessToken,
          CONNECTOR: connectorId,
          LINE: lineId,
          ACTIVE: activeStatus
        })
      });

      // Set connector data
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
              url: webhookUrl,
              url_im: webhookUrl,
              name: "Thoth WhatsApp"
            }
          })
        });
      }

      // Update integration config
      await supabase
        .from("integrations")
        .update({
          config: {
            ...config,
            connector_id: connectorId,
            line_id: lineId,
            activated_line_id: lineId,
            last_placement_call: new Date().toISOString()
          },
          updated_at: new Date().toISOString()
        })
        .eq("id", integration.id);

      console.log("Connector activated via placement");
    } catch (error) {
      console.error("Error in placement activation:", error);
    }
  }

  console.log("Placement processed");
}

/**
 * Process ADMIN_REBIND_EVENTS - Migrate events to new URL
 */
async function processAdminRebindEvents(
  payload: any, 
  supabase: any, 
  supabaseUrl: string,
  supabaseServiceKey: string
) {
  console.log("=== PROCESSING ADMIN REBIND EVENTS ===");
  console.log("Payload:", JSON.stringify(payload, null, 2));

  const integrationId = payload.integration_id;
  if (!integrationId) {
    throw new Error("integration_id is required");
  }

  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", integrationId)
    .single();

  if (integrationError || !integration) {
    throw new Error(`Integration not found: ${integrationError?.message || "unknown"}`);
  }

  const config = integration.config;
  const accessToken = await refreshBitrixToken(integration, supabase);
  
  if (!accessToken) {
    throw new Error("No access token available");
  }

  // IMPORTANT: Use config.domain for REST API calls, NOT client_endpoint (which is oauth.bitrix.info)
  const clientEndpoint = config.domain ? `https://${config.domain}/rest/` : config.client_endpoint;
  const oldWebhookUrl = `${supabaseUrl}/functions/v1/bitrix24-webhook`;
  const newEventsUrl = `${supabaseUrl}/functions/v1/bitrix24-events`;

  console.log("Old URL:", oldWebhookUrl);
  console.log("New URL:", newEventsUrl);

  const results = {
    unbound: 0,
    bound: 0,
    errors: [] as string[]
  };

  // 1. Get current events
  const eventsResponse = await fetch(`${clientEndpoint}event.get`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ auth: accessToken })
  });
  const eventsResult = await eventsResponse.json();
  const currentEvents = eventsResult.result || [];

  console.log(`Found ${currentEvents.length} total events`);

  // 2. Find events to migrate (bound to old webhook URL)
  const eventsToMigrate = currentEvents.filter((e: any) => 
    e.handler && e.handler.includes("/bitrix24-webhook")
  );

  console.log(`Found ${eventsToMigrate.length} events to migrate`);

  // 3. Events that need migration
  const eventNames = [
    "OnImConnectorMessageAdd",
    "OnImConnectorDialogStart",
    "OnImConnectorDialogFinish",
    "OnImConnectorStatusDelete",
  ];

  // 4. Unbind old and bind new
  for (const event of eventsToMigrate) {
    // Unbind from old URL
    try {
      await fetch(`${clientEndpoint}event.unbind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: accessToken,
          event: event.event,
          handler: event.handler
        })
      });
      results.unbound++;
      console.log(`Unbound: ${event.event}`);
    } catch (e) {
      results.errors.push(`Unbind ${event.event}: ${e}`);
    }
  }

  // 5. Bind all required events to new URL
  for (const eventName of eventNames) {
    try {
      const bindResponse = await fetch(`${clientEndpoint}event.bind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: accessToken,
          event: eventName,
          handler: newEventsUrl
        })
      });
      const bindResult = await bindResponse.json();
      
      if (!bindResult.error || bindResult.error === "HANDLER_ALREADY_BINDED") {
        results.bound++;
        console.log(`Bound: ${eventName}`);
      }
    } catch (e) {
      results.errors.push(`Bind ${eventName}: ${e}`);
    }
  }

  // 6. Update connector data
  const connectorId = config.connector_id || "thoth_whatsapp";
  const lineId = config.line_id || config.activated_line_id || 2;

  try {
    await fetch(`${clientEndpoint}imconnector.connector.data.set`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth: accessToken,
        CONNECTOR: connectorId,
        LINE: lineId,
        DATA: {
          id: `${connectorId}_line_${lineId}`,
          url: newEventsUrl,
          url_im: newEventsUrl,
          name: "Thoth WhatsApp"
        }
      })
    });
    console.log("Connector data updated");
  } catch (e) {
    results.errors.push(`Connector data: ${e}`);
  }

  // 7. Update integration config
  await supabase
    .from("integrations")
    .update({
      config: {
        ...config,
        events_url: newEventsUrl,
        events_migrated_at: new Date().toISOString()
      },
      updated_at: new Date().toISOString()
    })
    .eq("id", integration.id);

  console.log("=== REBIND COMPLETE ===");
  console.log(`Unbound: ${results.unbound}, Bound: ${results.bound}, Errors: ${results.errors.length}`);
}

/**
 * Process ADMIN_REBIND_PLACEMENTS - Update placements to use new bitrix24-app page
 */
async function processAdminRebindPlacements(
  payload: any,
  supabase: any,
  supabaseUrl: string
) {
  console.log("=== PROCESSING ADMIN REBIND PLACEMENTS ===");
  
  const integrationId = payload.integration_id;
  
  if (!integrationId) {
    throw new Error("Missing integration_id in payload");
  }

  // 1. Get integration
  const { data: integration, error: intError } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", integrationId)
    .single();

  if (intError || !integration) {
    throw new Error(`Integration not found: ${integrationId}`);
  }

  const config = integration.config;
  const domain = config.domain;
  const accessToken = config.access_token;
  // IMPORTANT: Use config.domain for REST API calls, NOT client_endpoint (which is oauth.bitrix.info)
  const clientEndpoint = config.domain ? `https://${config.domain}/rest/` : config.client_endpoint;

  if (!accessToken) {
    throw new Error("No access token configured");
  }

  console.log("Rebinding placements for:", domain);

  const results = {
    unbound: 0,
    bound: 0,
    errors: [] as string[]
  };

  // New app URL
  const newAppUrl = "https://chat.thoth24.com/bitrix24-app";

  // 2. Unbind old REST_APP placement
  try {
    await fetch(`${clientEndpoint}placement.unbind`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth: accessToken,
        PLACEMENT: "REST_APP"
      })
    });
    results.unbound++;
    console.log("Unbound: REST_APP");
  } catch (e) {
    results.errors.push(`Unbind REST_APP: ${e}`);
  }

  // 3. Bind new REST_APP placement
  try {
    const bindResponse = await fetch(`${clientEndpoint}placement.bind`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth: accessToken,
        PLACEMENT: "REST_APP",
        HANDLER: newAppUrl,
        TITLE: "Thoth WhatsApp"
      })
    });
    const bindResult = await bindResponse.json();
    console.log("Bind REST_APP result:", bindResult);
    
    if (!bindResult.error || bindResult.error === "HANDLER_ALREADY_BINDED") {
      results.bound++;
      console.log("Bound: REST_APP to", newAppUrl);
    } else {
      results.errors.push(`Bind REST_APP: ${bindResult.error}`);
    }
  } catch (e) {
    results.errors.push(`Bind REST_APP: ${e}`);
  }

  // 4. Re-bind SETTING_CONNECTOR to ensure it's correct
  try {
    await fetch(`${clientEndpoint}placement.unbind`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth: accessToken,
        PLACEMENT: "SETTING_CONNECTOR"
      })
    });
    console.log("Unbound: SETTING_CONNECTOR");
  } catch (e) {
    console.log("Unbind SETTING_CONNECTOR error (may not exist):", e);
  }

  const connectorSettingsUrl = `${supabaseUrl}/functions/v1/bitrix24-connector-settings`;
  try {
    const bindResponse = await fetch(`${clientEndpoint}placement.bind`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth: accessToken,
        PLACEMENT: "SETTING_CONNECTOR",
        HANDLER: connectorSettingsUrl,
        TITLE: "Thoth WhatsApp Settings"
      })
    });
    const bindResult = await bindResponse.json();
    console.log("Bind SETTING_CONNECTOR result:", bindResult);
    
    if (!bindResult.error || bindResult.error === "HANDLER_ALREADY_BINDED") {
      results.bound++;
      console.log("Bound: SETTING_CONNECTOR to", connectorSettingsUrl);
    }
  } catch (e) {
    results.errors.push(`Bind SETTING_CONNECTOR: ${e}`);
  }

  // 5. Update integration config
  await supabase
    .from("integrations")
    .update({
      config: {
        ...config,
        app_url: newAppUrl,
        placements_migrated_at: new Date().toISOString()
      },
      updated_at: new Date().toISOString()
    })
    .eq("id", integration.id);

  console.log("=== REBIND PLACEMENTS COMPLETE ===");
  console.log(`Unbound: ${results.unbound}, Bound: ${results.bound}, Errors: ${results.errors.length}`);
  
  if (results.errors.length > 0) {
    console.log("Errors:", results.errors);
  }
}

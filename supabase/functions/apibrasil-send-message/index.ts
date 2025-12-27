import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Base URL da APIBrasil Evolution
const APIBRASIL_BASE_URL = "https://gateway.apibrasil.io/api/v2/evolution";

// Interfaces para botões (formato Evolution API via APIBrasil)
interface EvolutionButton {
  type: "reply" | "copy" | "url" | "call" | "pix";
  displayText: string;
  id?: string;
  copyCode?: string;
  url?: string;
  phoneNumber?: string;
  // PIX fields
  currency?: string;
  name?: string;
  keyType?: string;
  key?: string;
}

interface InteractiveListRow {
  rowId: string;
  title: string;
  description?: string;
}

interface InteractiveListSection {
  title: string;
  rows: InteractiveListRow[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const body = await req.json();
    console.log("APIBrasil Send Message request:", JSON.stringify(body).substring(0, 500));

    // Normalize parameter names
    const instanceId = body.instance_id || body.instanceId;
    const contactId = body.contact_id || body.contactId;
    const conversationId = body.conversation_id || body.conversationId;
    const messageContent = body.message || body.content || body.text;
    const messageType = body.message_type || body.messageType || "text";
    const mediaUrl = body.media_url || body.mediaUrl;
    const mediaBase64 = body.media_base64 || body.mediaBase64;
    const audioUrl = body.audio_url || body.audioUrl;
    const audioBase64 = body.audio_base64 || body.audioBase64;
    const fileName = body.file_name || body.fileName;
    const caption = body.caption;
    const mimeType = body.mime_type || body.mimeType;
    const isInternal = body.internal === true || body.internal_call === true;

    // Interactive message fields
    const buttons = body.buttons as EvolutionButton[] | undefined;
    const listSections = body.list_sections || body.listSections as InteractiveListSection[] | undefined;
    const listButtonText = body.list_button_text || body.listButtonText || "Ver opções";
    const footer = body.footer;
    const title = body.title;
    const thumbnailUrl = body.thumbnail_url || body.thumbnailUrl;

    // Location fields
    const latitude = body.latitude;
    const longitude = body.longitude;
    const locationName = body.location_name || body.locationName;
    const locationAddress = body.location_address || body.locationAddress;

    // Contact fields
    const contacts = body.contacts;

    // Poll fields
    const pollName = body.poll_name || body.pollName;
    const pollOptions = body.poll_options || body.pollOptions;
    const pollSelectableCount = body.poll_selectable_count || body.pollSelectableCount || 1;

    // Phone number direct
    const phoneNumber = body.phone_number || body.phoneNumber;

    if (!instanceId || (!contactId && !phoneNumber)) {
      return new Response(JSON.stringify({ 
        error: "Missing required parameters: instance_id, contact_id/phone_number" 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let supabase;
    
    if (isInternal) {
      supabase = createClient(supabaseUrl, supabaseServiceKey);
    } else {
      // Authenticate user
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });

      const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
      if (authError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      supabase = createClient(supabaseUrl, supabaseServiceKey);
    }

    // Get instance with credentials
    const { data: instance, error: instanceError } = await supabase
      .from("instances")
      .select("*")
      .eq("id", instanceId)
      .single();

    if (instanceError || !instance) {
      return new Response(JSON.stringify({ error: "Instância não encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (instance.status !== "connected") {
      return new Response(JSON.stringify({ error: "Instância não está conectada" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate APIBrasil credentials (apenas 2 campos agora)
    const credentials = {
      deviceToken: instance.apibrasil_device_token,
      bearerToken: instance.apibrasil_bearer_token,
    };

    if (!credentials.deviceToken || !credentials.bearerToken) {
      return new Response(JSON.stringify({ 
        error: "Credenciais APIBrasil não configuradas" 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Headers corretos conforme documentação
    const apiHeaders = {
      "Content-Type": "application/json",
      "DeviceToken": credentials.deviceToken,
      "Authorization": `Bearer ${credentials.bearerToken}`,
    };

    // Get recipient phone number
    let recipientPhone = phoneNumber;
    let contact = null;

    if (contactId && !recipientPhone) {
      const { data: contactData } = await supabase
        .from("contacts")
        .select("*")
        .eq("id", contactId)
        .single();

      if (!contactData) {
        return new Response(JSON.stringify({ error: "Contato não encontrado" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      contact = contactData;
      recipientPhone = contactData.phone_number;
    }

    // Format phone number (remove non-digits)
    recipientPhone = recipientPhone.replace(/\D/g, "");
    console.log("Sending to:", recipientPhone, "type:", messageType);

    let endpoint = "";
    let requestBody: Record<string, unknown> = {};

    // Construir request baseado no tipo de mensagem (formato Evolution API)
    switch (messageType) {
      case "text":
        // Check for interactive buttons
        if (buttons && buttons.length > 0) {
          endpoint = "/message/sendButtons";
          requestBody = {
            number: recipientPhone,
            title: title || "",
            description: messageContent || "",
            footer: footer || "",
            thumbnailUrl: thumbnailUrl,
            buttons: buttons.map(b => {
              const btn: Record<string, unknown> = {
                type: b.type,
                displayText: b.displayText,
              };
              if (b.type === "reply" && b.id) btn.id = b.id;
              if (b.type === "copy" && b.copyCode) btn.copyCode = b.copyCode;
              if (b.type === "url" && b.url) btn.url = b.url;
              if (b.type === "call" && b.phoneNumber) btn.phoneNumber = b.phoneNumber;
              if (b.type === "pix") {
                btn.currency = b.currency || "BRL";
                btn.name = b.name;
                btn.keyType = b.keyType;
                btn.key = b.key;
              }
              return btn;
            }),
          };
        } else if (listSections && listSections.length > 0) {
          // Interactive list - não suportado diretamente
          endpoint = "/message/sendText";
          requestBody = {
            number: recipientPhone,
            text: messageContent,
            options: { delay: 1, presence: "composing" },
          };
        } else {
          // Simple text message
          endpoint = "/message/sendText";
          requestBody = {
            number: recipientPhone,
            text: messageContent,
            options: { delay: 1, presence: "composing" },
          };
        }
        break;

      case "image":
        endpoint = "/message/sendMedia";
        requestBody = {
          number: recipientPhone,
          mediatype: "image",
          mimetype: mimeType || "image/jpeg",
          caption: caption || messageContent || "",
          media: mediaUrl || mediaBase64,
          fileName: fileName || "image.jpg",
        };
        break;

      case "audio":
      case "ptt":
        // Áudio narrado (WhatsApp Audio)
        endpoint = "/message/sendWhatsAppAudio";
        requestBody = {
          number: recipientPhone,
          audio: audioUrl || audioBase64 || mediaUrl || mediaBase64,
        };
        break;

      case "video":
        endpoint = "/message/sendMedia";
        requestBody = {
          number: recipientPhone,
          mediatype: "video",
          mimetype: mimeType || "video/mp4",
          caption: caption || messageContent || "",
          media: mediaUrl || mediaBase64,
          fileName: fileName || "video.mp4",
        };
        break;

      case "document":
        endpoint = "/message/sendMedia";
        requestBody = {
          number: recipientPhone,
          mediatype: "document",
          mimetype: mimeType || "application/pdf",
          caption: caption || messageContent || "",
          media: mediaUrl || mediaBase64,
          fileName: fileName || "document.pdf",
        };
        break;

      case "sticker":
        endpoint = "/message/sendSticker";
        requestBody = {
          number: recipientPhone,
          sticker: mediaUrl || mediaBase64,
        };
        break;

      case "location":
        endpoint = "/message/sendLocation";
        requestBody = {
          number: recipientPhone,
          name: locationName || "Localização",
          address: locationAddress || "",
          latitude: latitude,
          longitude: longitude,
        };
        break;

      case "contact":
        endpoint = "/message/sendContact";
        requestBody = {
          number: recipientPhone,
          options: { delay: 1, presence: "composing" },
          contactMessage: contacts || [],
        };
        break;

      case "poll":
        endpoint = "/message/sendPoll";
        requestBody = {
          number: recipientPhone,
          options: { delay: 1, presence: "composing" },
          name: pollName || messageContent,
          selectableCount: pollSelectableCount,
          values: pollOptions || [],
        };
        break;

      case "buttons":
        endpoint = "/message/sendButtons";
        requestBody = {
          number: recipientPhone,
          title: title || "",
          description: messageContent || "",
          footer: footer || "",
          thumbnailUrl: thumbnailUrl,
          buttons: (buttons || []).map(b => {
            const btn: Record<string, unknown> = {
              type: b.type || "reply",
              displayText: b.displayText,
            };
            if (b.id) btn.id = b.id;
            if (b.copyCode) btn.copyCode = b.copyCode;
            if (b.url) btn.url = b.url;
            if (b.phoneNumber) btn.phoneNumber = b.phoneNumber;
            return btn;
          }),
        };
        break;

      case "reaction":
        endpoint = "/message/sendReaction";
        requestBody = {
          number: recipientPhone,
          // reaction needs key.id of message to react to
          ...body.reaction_data,
        };
        break;

      default:
        endpoint = "/message/sendText";
        requestBody = {
          number: recipientPhone,
          text: messageContent || "",
          options: { delay: 1, presence: "composing" },
        };
    }

    console.log("APIBrasil API request:", endpoint, JSON.stringify(requestBody).substring(0, 500));

    const apiResponse = await fetch(`${APIBRASIL_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify(requestBody),
    });

    const responseText = await apiResponse.text();
    console.log("APIBrasil API response:", apiResponse.status, responseText.substring(0, 500));

    if (!apiResponse.ok) {
      console.error("APIBrasil API error:", responseText);
      return new Response(JSON.stringify({ 
        error: `Erro ao enviar mensagem: ${responseText}` 
      }), {
        status: apiResponse.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { raw: responseText };
    }

    // Get or create conversation if we have contact
    let convId = conversationId;
    if (!convId && contactId) {
      const { data: conv } = await supabase
        .from("conversations")
        .select("id")
        .eq("instance_id", instanceId)
        .eq("contact_id", contactId)
        .maybeSingle();
      
      convId = conv?.id;
    }

    // Extract message ID from response
    const waMessageId = responseData?.key?.id || 
                        responseData?.messageId ||
                        responseData?.id ||
                        `apibrasil_${Date.now()}`;

    // Save message to database
    if (convId && contactId) {
      await supabase.from("messages").insert({
        instance_id: instanceId,
        contact_id: contactId,
        conversation_id: convId,
        whatsapp_message_id: waMessageId,
        direction: "outgoing",
        message_type: buttons ? "interactive" : messageType,
        content: messageContent || caption || `[${messageType}]`,
        media_url: mediaUrl,
        status: "sent",
        is_from_bot: body.is_from_bot ?? true,
        metadata: { 
          source: body.source || "apibrasil",
          has_buttons: !!buttons,
          has_poll: messageType === "poll",
          apibrasil_response: responseData
        }
      });

      // Update conversation
      await supabase.from("conversations").update({
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq("id", convId);
    }

    return new Response(JSON.stringify({ 
      success: true,
      message_id: waMessageId,
      response: responseData
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("APIBrasil Send Message error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

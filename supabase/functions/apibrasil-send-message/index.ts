import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APIBRASIL_BASE_URL = "https://gateway.apibrasil.io/api/v2";

interface InteractiveButton {
  id: string;
  title: string;
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
    const audioBase64 = body.audio_base64 || body.audioBase64;
    const fileName = body.file_name || body.fileName;
    const caption = body.caption;
    const isInternal = body.internal === true || body.internal_call === true;

    // Interactive message fields
    const buttons = body.buttons as InteractiveButton[] | undefined;
    const listSections = body.list_sections || body.listSections as InteractiveListSection[] | undefined;
    const listButtonText = body.list_button_text || body.listButtonText || "Ver opções";
    const footer = body.footer;
    const title = body.title;

    // SMS fields
    const isSms = body.is_sms === true || messageType === "sms";
    const phoneNumber = body.phone_number || body.phoneNumber;

    if (!instanceId || (!contactId && !phoneNumber) || !messageContent) {
      return new Response(JSON.stringify({ 
        error: "Missing required parameters: instance_id, contact_id/phone_number, message" 
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

    // Validate APIBrasil credentials
    const credentials = {
      secretKey: instance.apibrasil_secret_key,
      deviceToken: instance.apibrasil_device_token,
      publicToken: instance.apibrasil_public_token,
      bearerToken: instance.apibrasil_bearer_token,
    };

    if (!credentials.secretKey || !credentials.deviceToken || !credentials.publicToken || !credentials.bearerToken) {
      return new Response(JSON.stringify({ 
        error: "Credenciais APIBrasil não configuradas" 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiHeaders = {
      "Content-Type": "application/json",
      "SecretKey": credentials.secretKey,
      "DeviceToken": credentials.deviceToken,
      "PublicToken": credentials.publicToken,
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

    // Format phone number
    recipientPhone = recipientPhone.replace(/\D/g, "");
    console.log("Sending to:", recipientPhone, "type:", messageType);

    let endpoint = "";
    let requestBody: any = {};
    let apiResponse;

    // Handle SMS separately
    if (isSms) {
      endpoint = "/sms/send";
      requestBody = {
        number: recipientPhone,
        message: messageContent,
      };
    } else {
      // WhatsApp messages
      switch (messageType) {
        case "text":
          // Check if we have interactive buttons
          if (buttons && buttons.length > 0) {
            endpoint = "/whatsapp/sendButtons";
            requestBody = {
              number: recipientPhone,
              title: title || "",
              message: messageContent,
              footer: footer || "",
              buttons: buttons.map(b => ({
                buttonId: b.id,
                buttonText: { displayText: b.title },
                type: 1,
              })),
            };
          } else if (listSections && listSections.length > 0) {
            // Interactive list
            endpoint = "/whatsapp/sendList";
            requestBody = {
              number: recipientPhone,
              title: title || "",
              description: messageContent,
              buttonText: listButtonText,
            footer: footer || "",
            sections: listSections.map((s: InteractiveListSection) => ({
              title: s.title,
              rows: s.rows.map((r: InteractiveListRow) => ({
                rowId: r.rowId,
                title: r.title,
                description: r.description || "",
              })),
            })),
          };
        } else {
            // Simple text message
            endpoint = "/whatsapp/sendText";
            requestBody = {
              number: recipientPhone,
              message: messageContent,
            };
          }
          break;

        case "image":
          endpoint = "/whatsapp/sendImage";
          requestBody = {
            number: recipientPhone,
            image: mediaUrl || mediaBase64,
            caption: caption || messageContent,
          };
          break;

        case "audio":
        case "ptt":
          endpoint = "/whatsapp/sendAudio";
          requestBody = {
            number: recipientPhone,
            audio: mediaUrl || mediaBase64 || audioBase64,
            ptt: true, // Send as voice message (PTT)
          };
          break;

        case "video":
          endpoint = "/whatsapp/sendVideo";
          requestBody = {
            number: recipientPhone,
            video: mediaUrl || mediaBase64,
            caption: caption || messageContent,
          };
          break;

        case "document":
          endpoint = "/whatsapp/sendFile";
          requestBody = {
            number: recipientPhone,
            file: mediaUrl || mediaBase64,
            fileName: fileName || "document",
            caption: caption || messageContent,
          };
          break;

        case "buttons":
          endpoint = "/whatsapp/sendButtons";
          requestBody = {
            number: recipientPhone,
            title: title || "",
            message: messageContent,
            footer: footer || "",
            buttons: (buttons || []).map(b => ({
              buttonId: b.id,
              buttonText: { displayText: b.title },
              type: 1,
            })),
          };
          break;

        case "list":
          endpoint = "/whatsapp/sendList";
          requestBody = {
            number: recipientPhone,
            title: title || "",
            description: messageContent,
            buttonText: listButtonText,
            footer: footer || "",
            sections: (listSections || []).map((s: InteractiveListSection) => ({
              title: s.title,
              rows: s.rows.map((r: InteractiveListRow) => ({
                rowId: r.rowId,
                title: r.title,
                description: r.description || "",
              })),
            })),
          };
          break;

        default:
          endpoint = "/whatsapp/sendText";
          requestBody = {
            number: recipientPhone,
            message: messageContent,
          };
      }
    }

    console.log("APIBrasil API request:", endpoint, JSON.stringify(requestBody).substring(0, 300));

    apiResponse = await fetch(`${APIBRASIL_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify(requestBody),
    });

    const responseText = await apiResponse.text();
    console.log("APIBrasil API response:", apiResponse.status, responseText.substring(0, 300));

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

    // Save message to database
    const waMessageId = responseData.key?.id || 
                        responseData.messageId ||
                        responseData.id ||
                        `apibrasil_${Date.now()}`;

    if (convId && contactId) {
      await supabase.from("messages").insert({
        instance_id: instanceId,
        contact_id: contactId,
        conversation_id: convId,
        whatsapp_message_id: waMessageId,
        direction: "outgoing",
        message_type: isSms ? "sms" : (buttons || listSections ? "interactive" : messageType),
        content: messageContent,
        media_url: mediaUrl,
        status: "sent",
        is_from_bot: body.is_from_bot ?? true,
        metadata: { 
          source: body.source || "apibrasil",
          is_sms: isSms,
          has_buttons: !!buttons,
          has_list: !!listSections,
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

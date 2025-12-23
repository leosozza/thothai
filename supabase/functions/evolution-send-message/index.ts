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
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const body = await req.json();
    console.log("Evolution Send Message request:", JSON.stringify(body));

    // Normalize parameter names
    const instanceId = body.instance_id || body.instanceId;
    const contactId = body.contact_id || body.contactId;
    const conversationId = body.conversation_id || body.conversationId;
    const messageContent = body.message || body.content || body.text;
    const messageType = body.message_type || body.messageType || "text";
    const mediaUrl = body.media_url || body.mediaUrl;
    const mediaBase64 = body.media_base64 || body.mediaBase64;
    const fileName = body.file_name || body.fileName;
    const caption = body.caption;
    const isInternal = body.internal === true;

    if (!instanceId || !contactId || !messageContent) {
      return new Response(JSON.stringify({ 
        error: "Missing required parameters: instance_id, contact_id, message" 
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

    // Get instance
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

    const evolutionInstanceName = instance.evolution_instance_name;
    if (!evolutionInstanceName) {
      return new Response(JSON.stringify({ 
        error: "Instância não configurada para Evolution API" 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get Evolution config
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("workspace_id", instance.workspace_id)
      .eq("type", "evolution")
      .eq("is_active", true)
      .single();

    if (!integration) {
      return new Response(JSON.stringify({ 
        error: "Configuração da Evolution API não encontrada" 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const config = integration.config as { server_url?: string; api_key?: string };
    const evolutionServerUrl = config?.server_url?.replace(/\/$/, "");
    const evolutionApiKey = config?.api_key;

    if (!evolutionServerUrl || !evolutionApiKey) {
      return new Response(JSON.stringify({ 
        error: "Configuração da Evolution API incompleta" 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get contact
    const { data: contact } = await supabase
      .from("contacts")
      .select("*")
      .eq("id", contactId)
      .single();

    if (!contact) {
      return new Response(JSON.stringify({ error: "Contato não encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Format phone number (add @s.whatsapp.net if needed)
    let phoneNumber = contact.phone_number.replace(/\D/g, "");
    if (!phoneNumber.includes("@")) {
      phoneNumber = `${phoneNumber}@s.whatsapp.net`;
    }

    console.log("Sending to:", phoneNumber, "via Evolution instance:", evolutionInstanceName);

    let endpoint = "";
    let requestBody: any = {};
    let evolutionResponse;

    switch (messageType) {
      case "text":
        endpoint = `/message/sendText/${evolutionInstanceName}`;
        requestBody = {
          number: phoneNumber,
          text: messageContent,
        };
        break;

      case "image":
        endpoint = `/message/sendMedia/${evolutionInstanceName}`;
        requestBody = {
          number: phoneNumber,
          mediatype: "image",
          caption: caption || messageContent,
          media: mediaUrl || mediaBase64,
        };
        break;

      case "audio":
      case "ptt":
        endpoint = `/message/sendWhatsAppAudio/${evolutionInstanceName}`;
        requestBody = {
          number: phoneNumber,
          audio: mediaUrl || mediaBase64,
        };
        break;

      case "video":
        endpoint = `/message/sendMedia/${evolutionInstanceName}`;
        requestBody = {
          number: phoneNumber,
          mediatype: "video",
          caption: caption || messageContent,
          media: mediaUrl || mediaBase64,
        };
        break;

      case "document":
        endpoint = `/message/sendMedia/${evolutionInstanceName}`;
        requestBody = {
          number: phoneNumber,
          mediatype: "document",
          caption: caption || messageContent,
          media: mediaUrl || mediaBase64,
          fileName: fileName || "document",
        };
        break;

      default:
        endpoint = `/message/sendText/${evolutionInstanceName}`;
        requestBody = {
          number: phoneNumber,
          text: messageContent,
        };
    }

    console.log("Evolution API request:", endpoint, JSON.stringify(requestBody));

    evolutionResponse = await fetch(`${evolutionServerUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": evolutionApiKey,
      },
      body: JSON.stringify(requestBody),
    });

    const responseText = await evolutionResponse.text();
    console.log("Evolution API response:", evolutionResponse.status, responseText);

    if (!evolutionResponse.ok) {
      console.error("Evolution API error:", responseText);
      return new Response(JSON.stringify({ 
        error: `Erro ao enviar mensagem: ${responseText}` 
      }), {
        status: evolutionResponse.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { raw: responseText };
    }

    // Get or create conversation
    let convId = conversationId;
    if (!convId) {
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
                        `evo_${Date.now()}`;

    if (convId) {
      await supabase.from("messages").insert({
        instance_id: instanceId,
        contact_id: contactId,
        conversation_id: convId,
        whatsapp_message_id: waMessageId,
        direction: "outgoing",
        message_type: messageType,
        content: messageContent,
        media_url: mediaUrl,
        status: "sent",
        is_from_bot: body.is_from_bot ?? true,
        metadata: { 
          source: body.source || "evolution_api",
          evolution_response: responseData
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
    console.error("Evolution Send Message error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

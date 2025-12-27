import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  console.log("=== BITRIX24-ROBOT-HANDLER ===");
  console.log("Method:", req.method);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Bitrix24 sends data as form-urlencoded
    let data: Record<string, any> = {};
    
    const contentType = req.headers.get("content-type") || "";
    
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      for (const [key, value] of formData.entries()) {
        data[key] = value;
      }
    } else if (contentType.includes("application/json")) {
      data = await req.json();
    } else {
      // Try to parse as form data anyway
      try {
        const text = await req.text();
        const params = new URLSearchParams(text);
        for (const [key, value] of params.entries()) {
          data[key] = value;
        }
      } catch {
        data = {};
      }
    }

    console.log("Robot handler received:", JSON.stringify(data));
    console.log("Data keys:", Object.keys(data));

    // Extract properties from Bitrix24 robot call
    // Bitrix24 sends properties as properties[KEY] format in URL-encoded data
    // Try multiple extraction methods
    
    let phoneNumber = "";
    let message = "";
    let instanceId = "";
    
    // Method 1: Check if properties is an object
    if (data.properties && typeof data.properties === 'object') {
      phoneNumber = data.properties.PhoneNumber || data.properties.phone_number || "";
      message = data.properties.Message || data.properties.message || "";
      instanceId = data.properties.InstanceId || data.properties.instance_id || "";
    }
    
    // Method 2: Check bracket notation (how Bitrix24 actually sends it)
    if (!phoneNumber) {
      phoneNumber = 
        data["properties[PhoneNumber]"] || 
        data["properties[phone_number]"] || 
        data["properties[PHONE_NUMBER]"] ||
        data["PROPERTIES[PhoneNumber]"] ||
        "";
    }
    
    if (!message) {
      message = 
        data["properties[Message]"] || 
        data["properties[message]"] || 
        data["properties[MESSAGE]"] ||
        data["PROPERTIES[Message]"] ||
        "";
    }
    
    if (!instanceId) {
      instanceId = 
        data["properties[InstanceId]"] || 
        data["properties[instance_id]"] || 
        data["properties[INSTANCE_ID]"] ||
        data["PROPERTIES[InstanceId]"] ||
        "";
    }

    // Extract document and auth info
    const documentId = 
      data["document_id[2]"] || 
      data.document_id || 
      data.DOCUMENT_ID || 
      "";
    const eventToken = data.event_token || data.EVENT_TOKEN || "";
    
    // Auth can come as auth[key] format
    const memberId = 
      data["auth[member_id]"] || 
      data.member_id || 
      data.MEMBER_ID ||
      "";
    const domain = 
      data["auth[domain]"] || 
      data.domain || 
      data.DOMAIN ||
      "";

    console.log("Parsed parameters:", { 
      phoneNumber: phoneNumber || "(empty)", 
      messageLength: message?.length || 0, 
      messagePreview: message?.substring(0, 50) || "(empty)",
      instanceId: instanceId || "(empty)", 
      documentId, 
      memberId,
      domain
    });

    if (!phoneNumber) {
      console.error("Phone number is required");
      return new Response(
        JSON.stringify({ 
          result: { 
            Status: "error",
            Error: "Número de telefone é obrigatório",
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!message) {
      console.error("Message is required");
      return new Response(
        JSON.stringify({ 
          result: { 
            Status: "error",
            Error: "Mensagem é obrigatória",
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find integration by member_id or domain
    let integration: any = null;

    if (memberId) {
      const { data: byMemberId } = await supabase
        .from("integrations")
        .select("*")
        .eq("type", "bitrix24")
        .eq("config->>member_id", memberId)
        .maybeSingle();
      integration = byMemberId;
    }

    if (!integration && domain) {
      const { data: byDomain } = await supabase
        .from("integrations")
        .select("*")
        .eq("type", "bitrix24")
        .ilike("config->>domain", `%${domain}%`)
        .maybeSingle();
      integration = byDomain;
    }

    if (!integration) {
      console.error("Integration not found for member_id:", memberId, "domain:", domain);
      return new Response(
        JSON.stringify({ 
          result: { 
            Status: "error",
            Error: "Integração Bitrix24 não encontrada",
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Found integration:", integration.id);

    // Get the WhatsApp instance to use
    const targetInstanceId = instanceId || integration.config?.instance_id;
    
    if (!targetInstanceId) {
      console.error("No WhatsApp instance configured");
      return new Response(
        JSON.stringify({ 
          result: { 
            Status: "error",
            Error: "Nenhuma instância WhatsApp configurada",
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get instance details
    const { data: instance } = await supabase
      .from("instances")
      .select("*")
      .eq("id", targetInstanceId)
      .single();

    if (!instance) {
      console.error("Instance not found:", targetInstanceId);
      return new Response(
        JSON.stringify({ 
          result: { 
            Status: "error",
            Error: "Instância WhatsApp não encontrada",
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Clean phone number
    const cleanPhone = phoneNumber.replace(/\D/g, "");
    console.log("Sending message to:", cleanPhone, "via instance:", instance.name);

    // Find or create contact
    let contact: any = null;
    const { data: existingContact } = await supabase
      .from("contacts")
      .select("*")
      .eq("instance_id", targetInstanceId)
      .eq("phone_number", cleanPhone)
      .maybeSingle();

    if (existingContact) {
      contact = existingContact;
    } else {
      // Create new contact
      const { data: newContact, error: contactError } = await supabase
        .from("contacts")
        .insert({
          instance_id: targetInstanceId,
          phone_number: cleanPhone,
          name: `Contato ${cleanPhone}`,
        })
        .select()
        .single();

      if (contactError) {
        console.error("Error creating contact:", contactError);
      } else {
        contact = newContact;
      }
    }

    // Find or create conversation
    let conversationId: string | null = null;
    
    if (contact) {
      const { data: existingConv } = await supabase
        .from("conversations")
        .select("id")
        .eq("contact_id", contact.id)
        .eq("instance_id", targetInstanceId)
        .maybeSingle();

      if (existingConv) {
        conversationId = existingConv.id;
      } else {
        const { data: newConv, error: convError } = await supabase
          .from("conversations")
          .insert({
            contact_id: contact.id,
            instance_id: targetInstanceId,
            status: "open",
          })
          .select("id")
          .single();

        if (!convError && newConv) {
          conversationId = newConv.id;
        }
      }
    }

    // Send message via appropriate provider
    const providerType = instance.provider_type || "wapi";
    let sendFunctionName = "wapi-send-message";
    
    if (providerType === "evolution") {
      sendFunctionName = "evolution-send-message";
    } else if (providerType === "gupshup") {
      sendFunctionName = "gupshup-send-message";
    }

    console.log("Calling send function:", sendFunctionName);

    const sendResponse = await fetch(`${supabaseUrl}/functions/v1/${sendFunctionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({
        instance_id: targetInstanceId,
        phone: cleanPhone,
        message: message,
        contact_id: contact?.id,
        conversation_id: conversationId,
      }),
    });

    const sendResult = await sendResponse.json();
    console.log("Send result:", JSON.stringify(sendResult));

    if (sendResult.success || sendResult.message_id) {
      // Save message to database
      if (contact && conversationId) {
        await supabase.from("messages").insert({
          instance_id: targetInstanceId,
          contact_id: contact.id,
          conversation_id: conversationId,
          content: message,
          direction: "outgoing",
          is_from_bot: true,
          status: "sent",
          message_type: "text",
          metadata: {
            source: "bitrix24_robot",
            document_id: documentId,
          },
        });
      }

      return new Response(
        JSON.stringify({ 
          result: { 
            MessageId: sendResult.message_id || "sent",
            Status: "success",
            Error: "",
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      return new Response(
        JSON.stringify({ 
          result: { 
            MessageId: "",
            Status: "error",
            Error: sendResult.error || "Falha ao enviar mensagem",
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

  } catch (error) {
    console.error("Error in bitrix24-robot-handler:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ 
        result: { 
          Status: "error",
          Error: errorMessage,
        }
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

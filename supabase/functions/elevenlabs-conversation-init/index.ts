import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InitiationRequest {
  caller_id?: string;
  agent_id?: string;
  called_number?: string;
  call_sid?: string;
}

interface DynamicVariables {
  customer_name: string;
  customer_phone: string;
  has_previous_contact: boolean;
  bitrix_contact_id: string | null;
  last_interaction: string | null;
  persona_name: string;
  workspace_name: string | null;
}

// Normalize phone number for comparison
function normalizePhone(phone: string): string {
  if (!phone) return "";
  // Remove all non-numeric characters
  const digits = phone.replace(/\D/g, "");
  // Return last 10-11 digits for comparison
  return digits.slice(-11);
}

// Format phone for display
function formatPhoneDisplay(phone: string): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const payload: InitiationRequest = await req.json();
    console.log("Conversation init webhook received:", JSON.stringify(payload));

    const { caller_id, agent_id, called_number, call_sid } = payload;

    if (!agent_id) {
      console.error("Missing agent_id in request");
      return new Response(JSON.stringify({ 
        type: "conversation_initiation_client_data",
        dynamic_variables: {
          customer_name: "Cliente",
          customer_phone: caller_id || "",
          has_previous_contact: false,
          bitrix_contact_id: null,
          persona_name: "Assistente"
        }
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Find persona by ElevenLabs agent_id
    const { data: persona, error: personaError } = await supabase
      .from("personas")
      .select(`
        id,
        name,
        welcome_message,
        system_prompt,
        workspace_id
      `)
      .eq("elevenlabs_agent_id", agent_id)
      .single();

    // Get workspace name if persona found
    let workspaceName: string | null = null;
    if (persona?.workspace_id) {
      const { data: workspace } = await supabase
        .from("workspaces")
        .select("name")
        .eq("id", persona.workspace_id)
        .single();
      workspaceName = workspace?.name || null;
    }

    if (personaError) {
      console.log("Persona not found for agent:", agent_id, personaError);
    }

    // 2. Find contact by phone number if caller_id provided
    let contact = null;
    let lastConversation = null;

    if (caller_id) {
      const normalizedPhone = normalizePhone(caller_id);
      const lastDigits = normalizedPhone.slice(-9);

      console.log("Searching contact with phone:", normalizedPhone, "last digits:", lastDigits);

      // Search for contact
      const { data: contacts, error: contactError } = await supabase
        .from("contacts")
        .select("*")
        .or(`phone_number.ilike.%${lastDigits}`)
        .limit(5);

      if (contactError) {
        console.error("Error searching contact:", contactError);
      } else if (contacts && contacts.length > 0) {
        // Find best match
        contact = contacts.find(c => 
          normalizePhone(c.phone_number) === normalizedPhone
        ) || contacts[0];
        
        console.log("Contact found:", contact.id, contact.name || contact.push_name);

        // Get last conversation for this contact
        const { data: convData } = await supabase
          .from("conversations")
          .select("last_message_at")
          .eq("contact_id", contact.id)
          .order("last_message_at", { ascending: false })
          .limit(1)
          .single();

        if (convData) {
          lastConversation = convData;
        }
      }
    }

    // 3. Build dynamic variables
    const dynamicVariables: DynamicVariables = {
      customer_name: contact?.name || contact?.push_name || "Cliente",
      customer_phone: formatPhoneDisplay(caller_id || ""),
      has_previous_contact: !!contact,
      bitrix_contact_id: contact?.metadata?.bitrix24_contact_id || null,
      last_interaction: lastConversation?.last_message_at || null,
      persona_name: persona?.name || "Assistente",
      workspace_name: workspaceName,
    };

    console.log("Dynamic variables:", JSON.stringify(dynamicVariables));

    // 4. Build conversation config override (optional)
    let conversationConfigOverride: Record<string, unknown> | undefined;

    // Personalize first message if persona has welcome_message with placeholders
    if (persona?.welcome_message) {
      let personalizedMessage = persona.welcome_message
        .replace(/\{\{customer_name\}\}/gi, dynamicVariables.customer_name)
        .replace(/\{\{persona_name\}\}/gi, dynamicVariables.persona_name);

      // Only override if message was personalized
      if (personalizedMessage !== persona.welcome_message || dynamicVariables.has_previous_contact) {
        conversationConfigOverride = {
          agent: {
            first_message: personalizedMessage
          }
        };
      }
    }

    // 5. Return conversation initiation data
    const response = {
      type: "conversation_initiation_client_data",
      dynamic_variables: dynamicVariables,
      ...(conversationConfigOverride && { conversation_config_override: conversationConfigOverride })
    };

    console.log("Returning initiation data:", JSON.stringify(response));

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in conversation init webhook:", error);
    
    // Return default values on error
    return new Response(JSON.stringify({
      type: "conversation_initiation_client_data",
      dynamic_variables: {
        customer_name: "Cliente",
        customer_phone: "",
        has_previous_contact: false,
        bitrix_contact_id: null,
        persona_name: "Assistente"
      }
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

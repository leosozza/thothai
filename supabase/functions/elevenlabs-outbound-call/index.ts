import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface OutboundCallRequest {
  to_number: string;
  persona_id?: string;
  agent_id?: string;
  telephony_number_id: string;
  workspace_id: string;
  contact_id?: string;
  contact_name?: string;
  dynamic_variables?: Record<string, any>;
  first_message?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    if (!ELEVENLABS_API_KEY) {
      throw new Error("ELEVENLABS_API_KEY not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: OutboundCallRequest = await req.json();
    console.log("Outbound call request:", JSON.stringify(body));

    const {
      to_number,
      persona_id,
      agent_id: directAgentId,
      telephony_number_id,
      workspace_id,
      contact_id,
      contact_name,
      dynamic_variables,
      first_message,
    } = body;

    // Validate required fields
    if (!to_number) {
      return new Response(
        JSON.stringify({ error: "to_number is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!telephony_number_id) {
      return new Response(
        JSON.stringify({ error: "telephony_number_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!workspace_id) {
      return new Response(
        JSON.stringify({ error: "workspace_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get telephony number configuration with provider
    const { data: telephonyNumber, error: telephonyError } = await supabase
      .from("telephony_numbers")
      .select(`
        *,
        provider:telephony_providers(*)
      `)
      .eq("id", telephony_number_id)
      .single();

    if (telephonyError || !telephonyNumber) {
      console.error("Telephony number not found:", telephonyError);
      return new Response(
        JSON.stringify({ error: "Telephony number not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get agent ID - either from persona, telephony number, or direct parameter
    let agentId = directAgentId;

    if (!agentId && persona_id) {
      const { data: persona, error: personaError } = await supabase
        .from("personas")
        .select("elevenlabs_agent_id, name")
        .eq("id", persona_id)
        .single();

      if (personaError || !persona?.elevenlabs_agent_id) {
        console.error("Persona not found or no agent ID:", personaError);
        return new Response(
          JSON.stringify({ error: "Persona has no ElevenLabs agent configured" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      agentId = persona.elevenlabs_agent_id;
    }

    // Fallback to telephony number's agent ID
    if (!agentId && telephonyNumber.elevenlabs_agent_id) {
      agentId = telephonyNumber.elevenlabs_agent_id;
    }

    if (!agentId) {
      return new Response(
        JSON.stringify({ error: "No ElevenLabs agent ID configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const provider = telephonyNumber.provider;
    const providerType = provider?.provider_type;
    
    console.log("Provider type:", providerType);

    // Build the ElevenLabs API payload based on provider type
    let elevenlabsPayload: Record<string, any>;
    let apiEndpoint: string;

    if (providerType === "twilio") {
      // For Twilio, check if we have an ElevenLabs phone ID (registered number)
      if (telephonyNumber.elevenlabs_phone_id) {
        // Use the generic phone call endpoint with the registered ElevenLabs phone ID
        console.log("Using registered ElevenLabs phone ID:", telephonyNumber.elevenlabs_phone_id);
        apiEndpoint = "https://api.elevenlabs.io/v1/convai/conversation/phone_call";
        elevenlabsPayload = {
          agent_id: agentId,
          agent_phone_number_id: telephonyNumber.elevenlabs_phone_id,
          to_number: to_number.startsWith("+") ? to_number : `+${to_number}`,
        };
      } else {
        // Fallback: use Twilio-specific endpoint with credentials
        const config = provider.config as { account_sid?: string; auth_token?: string };
        
        if (!config.account_sid || !config.auth_token) {
          return new Response(
            JSON.stringify({ error: "Twilio credentials not configured" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        console.log("Using Twilio direct integration");
        apiEndpoint = "https://api.elevenlabs.io/v1/convai/twilio/outbound_call";
        elevenlabsPayload = {
          agent_id: agentId,
          twilio_account_sid: config.account_sid,
          twilio_auth_token: config.auth_token,
          twilio_phone_number: telephonyNumber.phone_number,
          to_phone_number: to_number.startsWith("+") ? to_number : `+${to_number}`,
        };
      }
    } else {
      // For other providers (SIP, etc.), use the generic phone number endpoint
      // This requires the number to be registered with ElevenLabs first
      if (!telephonyNumber.provider_number_id?.startsWith("PN")) {
        return new Response(
          JSON.stringify({ 
            error: "Número não registrado no ElevenLabs. Configure o SIP forwarding primeiro.",
            details: "Para chamadas outbound com provedores não-Twilio, registre o número no ElevenLabs."
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      apiEndpoint = "https://api.elevenlabs.io/v1/convai/conversation/phone_call";
      elevenlabsPayload = {
        agent_id: agentId,
        agent_phone_number_id: telephonyNumber.provider_number_id,
        to_number: to_number.startsWith("+") ? to_number : `+${to_number}`,
      };
    }

    // Add optional fields
    if (first_message) {
      elevenlabsPayload.first_message = first_message;
    }

    if (dynamic_variables && Object.keys(dynamic_variables).length > 0) {
      elevenlabsPayload.dynamic_variables = dynamic_variables;
    }

    console.log("Calling ElevenLabs API:", apiEndpoint);
    console.log("Payload:", JSON.stringify(elevenlabsPayload));

    // Call ElevenLabs outbound call API
    const elevenlabsResponse = await fetch(apiEndpoint, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(elevenlabsPayload),
    });

    const responseText = await elevenlabsResponse.text();
    console.log("ElevenLabs response status:", elevenlabsResponse.status);
    console.log("ElevenLabs response:", responseText);

    if (!elevenlabsResponse.ok) {
      return new Response(
        JSON.stringify({ 
          error: "ElevenLabs API error", 
          details: responseText,
          status: elevenlabsResponse.status 
        }),
        { status: elevenlabsResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const elevenlabsData = JSON.parse(responseText);

    // Create a call record in the database
    const { data: callRecord, error: callError } = await supabase
      .from("calls")
      .insert({
        workspace_id,
        persona_id: persona_id || telephonyNumber.persona_id,
        phone_number: to_number,
        caller_name: contact_name,
        direction: "outbound",
        status: "initiated",
        elevenlabs_agent_id: agentId,
        elevenlabs_conversation_id: elevenlabsData.conversation_id,
        started_at: new Date().toISOString(),
        metadata: {
          contact_id,
          telephony_number_id,
          call_sid: elevenlabsData.callSid,
          dynamic_variables,
        },
      })
      .select()
      .single();

    if (callError) {
      console.error("Error creating call record:", callError);
      // Don't fail the request, just log the error
    }

    return new Response(
      JSON.stringify({
        success: true,
        conversation_id: elevenlabsData.conversation_id,
        call_sid: elevenlabsData.callSid,
        call_id: callRecord?.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("Error in elevenlabs-outbound-call:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

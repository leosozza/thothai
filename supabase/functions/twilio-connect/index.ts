import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TwilioConnectRequest {
  action: "connect" | "list_numbers" | "disconnect" | "configure_sip";
  provider_id?: string;
  workspace_id: string;
  account_sid?: string;
  auth_token?: string;
  phone_number?: string;
  elevenlabs_agent_id?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body: TwilioConnectRequest = await req.json();
    const { action, provider_id, workspace_id, account_sid, auth_token } = body;

    console.log(`[Twilio] Action: ${action}, Workspace: ${workspace_id}`);

    switch (action) {
      case "connect": {
        if (!account_sid || !auth_token) {
          return new Response(
            JSON.stringify({ success: false, error: "Account SID e Auth Token são obrigatórios" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
          );
        }

        // Validate credentials with Twilio API
        const authHeader = btoa(`${account_sid}:${auth_token}`);
        const twilioResponse = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${account_sid}.json`,
          {
            headers: { "Authorization": `Basic ${authHeader}` },
          }
        );

        if (!twilioResponse.ok) {
          console.error("[Twilio] Auth failed:", await twilioResponse.text());
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: "Credenciais Twilio inválidas. Verifique Account SID e Auth Token." 
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
          );
        }

        const accountInfo = await twilioResponse.json();
        console.log("[Twilio] Account:", accountInfo.friendly_name);

        // Save or update provider
        const { data: existingProvider } = await supabaseClient
          .from("telephony_providers")
          .select("id")
          .eq("workspace_id", workspace_id)
          .eq("provider_type", "twilio")
          .single();

        let providerId: string;

        if (existingProvider) {
          const { error } = await supabaseClient
            .from("telephony_providers")
            .update({
              config: { account_sid, auth_token, account_name: accountInfo.friendly_name },
              is_active: true,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existingProvider.id);

          if (error) throw error;
          providerId = existingProvider.id;
        } else {
          const { data: newProvider, error } = await supabaseClient
            .from("telephony_providers")
            .insert({
              workspace_id,
              provider_type: "twilio",
              name: "Twilio",
              config: { account_sid, auth_token, account_name: accountInfo.friendly_name },
              is_active: true,
            })
            .select("id")
            .single();

          if (error) throw error;
          providerId = newProvider.id;
        }

        // Fetch phone numbers
        const numbersResponse = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${account_sid}/IncomingPhoneNumbers.json`,
          { headers: { "Authorization": `Basic ${authHeader}` } }
        );

        if (numbersResponse.ok) {
          const numbersData = await numbersResponse.json();
          const phoneNumbers = numbersData.incoming_phone_numbers || [];

          // Save numbers to database
          for (const num of phoneNumbers) {
            const { data: existingNumber } = await supabaseClient
              .from("telephony_numbers")
              .select("id")
              .eq("provider_id", providerId)
              .eq("phone_number", num.phone_number)
              .single();

            if (!existingNumber) {
              await supabaseClient.from("telephony_numbers").insert({
                provider_id: providerId,
                workspace_id,
                phone_number: num.phone_number,
                friendly_name: num.friendly_name || num.phone_number,
                provider_number_id: num.sid,
                capabilities: {
                  voice: num.capabilities?.voice || false,
                  sms: num.capabilities?.sms || false,
                },
              });
            }
          }

          console.log(`[Twilio] Imported ${phoneNumbers.length} phone numbers`);
        }

        return new Response(
          JSON.stringify({ 
            success: true, 
            message: "Twilio conectado com sucesso!",
            provider_id: providerId,
            account_name: accountInfo.friendly_name,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "list_numbers": {
        if (!provider_id) {
          return new Response(
            JSON.stringify({ success: false, error: "Provider ID é obrigatório" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
          );
        }

        const { data: provider } = await supabaseClient
          .from("telephony_providers")
          .select("config")
          .eq("id", provider_id)
          .single();

        if (!provider) {
          return new Response(
            JSON.stringify({ success: false, error: "Provedor não encontrado" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
          );
        }

        const config = provider.config as { account_sid?: string; auth_token?: string };
        const authHeader = btoa(`${config.account_sid}:${config.auth_token}`);

        const numbersResponse = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${config.account_sid}/IncomingPhoneNumbers.json`,
          { headers: { "Authorization": `Basic ${authHeader}` } }
        );

        if (!numbersResponse.ok) {
          return new Response(
            JSON.stringify({ success: false, error: "Erro ao buscar números do Twilio" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
          );
        }

        const numbersData = await numbersResponse.json();

        return new Response(
          JSON.stringify({ success: true, numbers: numbersData.incoming_phone_numbers || [] }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "configure_sip": {
        // Configure Twilio number to forward to ElevenLabs SIP endpoint
        const { phone_number, elevenlabs_agent_id } = body;
        
        if (!provider_id || !phone_number || !elevenlabs_agent_id) {
          return new Response(
            JSON.stringify({ success: false, error: "Provider ID, Phone Number e Agent ID são obrigatórios" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
          );
        }

        const { data: provider } = await supabaseClient
          .from("telephony_providers")
          .select("config")
          .eq("id", provider_id)
          .single();

        if (!provider) {
          return new Response(
            JSON.stringify({ success: false, error: "Provedor não encontrado" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
          );
        }

        const config = provider.config as { account_sid?: string; auth_token?: string };
        const authHeader = btoa(`${config.account_sid}:${config.auth_token}`);

        // Get the number SID
        const { data: numberRecord } = await supabaseClient
          .from("telephony_numbers")
          .select("provider_number_id")
          .eq("provider_id", provider_id)
          .eq("phone_number", phone_number)
          .single();

        if (!numberRecord?.provider_number_id) {
          return new Response(
            JSON.stringify({ success: false, error: "Número não encontrado" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
          );
        }

        // Configure the number to use SIP forwarding to ElevenLabs
        // Note: This is a simplified example - actual implementation depends on ElevenLabs SIP configuration
        const sipEndpoint = `sip:${elevenlabs_agent_id}@sip.elevenlabs.io`;

        const updateResponse = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${config.account_sid}/IncomingPhoneNumbers/${numberRecord.provider_number_id}.json`,
          {
            method: "POST",
            headers: {
              "Authorization": `Basic ${authHeader}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              VoiceUrl: sipEndpoint,
              VoiceMethod: "POST",
            }),
          }
        );

        if (!updateResponse.ok) {
          const errorText = await updateResponse.text();
          console.error("[Twilio] SIP config failed:", errorText);
          return new Response(
            JSON.stringify({ success: false, error: "Erro ao configurar SIP" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
          );
        }

        return new Response(
          JSON.stringify({ success: true, message: "SIP configurado com sucesso!" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "disconnect": {
        if (!provider_id) {
          return new Response(
            JSON.stringify({ success: false, error: "Provider ID é obrigatório" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
          );
        }

        const { error } = await supabaseClient
          .from("telephony_providers")
          .delete()
          .eq("id", provider_id);

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, message: "Twilio desconectado" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: `Ação desconhecida: ${action}` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
    }
  } catch (error: unknown) {
    console.error("[Twilio] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

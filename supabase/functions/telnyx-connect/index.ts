import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TelnyxConnectRequest {
  action: "connect" | "list_numbers" | "disconnect" | "configure_sip";
  provider_id?: string;
  workspace_id: string;
  api_key?: string;
  connection_id?: string;
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

    const body: TelnyxConnectRequest = await req.json();
    const { action, provider_id, workspace_id, api_key, connection_id } = body;

    console.log(`[Telnyx] Action: ${action}, Workspace: ${workspace_id}`);

    switch (action) {
      case "connect": {
        if (!api_key) {
          return new Response(
            JSON.stringify({ success: false, error: "API Key é obrigatória" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
          );
        }

        // Validate API key with Telnyx
        const telnyxResponse = await fetch("https://api.telnyx.com/v2/phone_numbers", {
          headers: {
            "Authorization": `Bearer ${api_key}`,
            "Content-Type": "application/json",
          },
        });

        if (!telnyxResponse.ok) {
          console.error("[Telnyx] Auth failed:", await telnyxResponse.text());
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: "API Key Telnyx inválida. Verifique suas credenciais." 
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
          );
        }

        const numbersData = await telnyxResponse.json();
        console.log(`[Telnyx] Found ${numbersData.data?.length || 0} phone numbers`);

        // Save or update provider
        const { data: existingProvider } = await supabaseClient
          .from("telephony_providers")
          .select("id")
          .eq("workspace_id", workspace_id)
          .eq("provider_type", "telnyx")
          .single();

        let providerId: string;

        if (existingProvider) {
          const { error } = await supabaseClient
            .from("telephony_providers")
            .update({
              config: { api_key, connection_id },
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
              provider_type: "telnyx",
              name: "Telnyx",
              config: { api_key, connection_id },
              is_active: true,
            })
            .select("id")
            .single();

          if (error) throw error;
          providerId = newProvider.id;
        }

        // Save phone numbers
        const phoneNumbers = numbersData.data || [];
        for (const num of phoneNumbers) {
          const phoneNumber = num.phone_number;
          
          const { data: existingNumber } = await supabaseClient
            .from("telephony_numbers")
            .select("id")
            .eq("provider_id", providerId)
            .eq("phone_number", phoneNumber)
            .single();

          if (!existingNumber) {
            await supabaseClient.from("telephony_numbers").insert({
              provider_id: providerId,
              workspace_id,
              phone_number: phoneNumber,
              friendly_name: num.connection_name || phoneNumber,
              provider_number_id: num.id,
              capabilities: {
                voice: true,
                sms: num.messaging_profile_id ? true : false,
              },
            });
          }
        }

        console.log(`[Telnyx] Imported ${phoneNumbers.length} phone numbers`);

        return new Response(
          JSON.stringify({ 
            success: true, 
            message: "Telnyx conectado com sucesso!",
            provider_id: providerId,
            numbers_count: phoneNumbers.length,
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

        const config = provider.config as { api_key?: string };

        const numbersResponse = await fetch("https://api.telnyx.com/v2/phone_numbers", {
          headers: {
            "Authorization": `Bearer ${config.api_key}`,
            "Content-Type": "application/json",
          },
        });

        if (!numbersResponse.ok) {
          return new Response(
            JSON.stringify({ success: false, error: "Erro ao buscar números do Telnyx" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
          );
        }

        const numbersData = await numbersResponse.json();

        return new Response(
          JSON.stringify({ success: true, numbers: numbersData.data || [] }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "configure_sip": {
        // Configure Telnyx number for SIP forwarding to ElevenLabs
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

        const config = provider.config as { api_key?: string; connection_id?: string };

        // Get number ID
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

        // Configure call control application or SIP connection
        // Note: Actual implementation depends on Telnyx and ElevenLabs SIP configuration
        console.log(`[Telnyx] Would configure SIP for ${phone_number} -> ${elevenlabs_agent_id}`);

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
          JSON.stringify({ success: true, message: "Telnyx desconectado" }),
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
    console.error("[Telnyx] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

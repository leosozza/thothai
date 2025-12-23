import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RegisterPhoneRequest {
  action: "register" | "import_from_provider" | "register_sip";
  workspace_id: string;
  provider_id?: string;
  phone_number?: string;
  agent_id?: string;
  friendly_name?: string;
  // SIP specific fields
  sip_account?: string;
  sip_password?: string;
  sip_server?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    if (!ELEVENLABS_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: "ELEVENLABS_API_KEY não configurada" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body: RegisterPhoneRequest = await req.json();
    const { action, workspace_id, provider_id, phone_number, agent_id, friendly_name } = body;

    console.log(`[ElevenLabs Phone] Action: ${action}, Workspace: ${workspace_id}`);

switch (action) {
      case "import_from_provider": {
        if (!provider_id) {
          return new Response(
            JSON.stringify({ success: false, error: "provider_id é obrigatório" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
          );
        }

        // Get provider config
        const { data: provider, error: providerError } = await supabaseClient
          .from("telephony_providers")
          .select("*")
          .eq("id", provider_id)
          .single();

        if (providerError || !provider) {
          return new Response(
            JSON.stringify({ success: false, error: "Provedor não encontrado" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
          );
        }

        const config = provider.config as { 
          api_token?: string; 
          instance_key?: string; 
          instance_info?: any;
          phone_number?: string;
          sip_account?: string;
          sip_password?: string;
          sip_server?: string;
        };

        let phoneFromProvider: string | null = null;

        // For SIP providers (falefacil, twilio, telnyx), use config phone_number directly
        if (provider.provider_type === "falefacil" && config.phone_number) {
          phoneFromProvider = config.phone_number;
          console.log(`[ElevenLabs Phone] Using phone from Fale Fácil config: ${phoneFromProvider}`);
        }

        // For WaVoIP, fetch from API (endpoint/method may vary between deployments)
        let wavoipFetched = false;
        let wavoipLastError:
          | { url: string; method: string; status: number; body: string }
          | null = null;

        if (provider.provider_type === "wavoip" && config.api_token && config.instance_key) {
          console.log(`[ElevenLabs Phone] Fetching WaVoIP instance info...`);

          const baseUrl = "https://api.wavoip.com";
          const candidates = [
            { url: `${baseUrl}/v1/instance/info`, method: "POST" },
            { url: `${baseUrl}/v1/instance/info`, method: "GET" },
            { url: `${baseUrl}/v1/instance/info/${config.instance_key}`, method: "GET" },
            { url: `${baseUrl}/v1/instance/info/${config.instance_key}`, method: "POST" },
          ] as const;

          for (const c of candidates) {
            const res = await fetch(c.url, {
              method: c.method,
              headers: {
                Authorization: `Bearer ${config.api_token}`,
                "X-Instance-Key": config.instance_key,
                "Content-Type": "application/json",
              },
              body: c.method === "POST" ? "{}" : undefined,
            });

            const text = await res.text();

            if (!res.ok) {
              wavoipLastError = {
                url: c.url,
                method: c.method,
                status: res.status,
                body: text.slice(0, 500),
              };
              continue;
            }

            wavoipFetched = true;

            let instanceInfo: any = null;
            try {
              instanceInfo = JSON.parse(text);
            } catch {
              wavoipLastError = {
                url: c.url,
                method: c.method,
                status: res.status,
                body: text.slice(0, 500),
              };
              continue;
            }

            console.log(
              `[ElevenLabs Phone] WaVoIP response (from ${c.method} ${c.url}):`,
              JSON.stringify(instanceInfo)
            );

            // Try different field names that WaVoIP might use
            phoneFromProvider =
              instanceInfo.phone_number ||
              instanceInfo.phoneNumber ||
              instanceInfo.phone ||
              instanceInfo.wid ||
              instanceInfo.jid ||
              instanceInfo.me?.user ||
              instanceInfo.me?.id ||
              instanceInfo.instance?.wid ||
              null;

            // If wid/jid format (e.g., "5511999999999@s.whatsapp.net"), extract number
            if (phoneFromProvider && phoneFromProvider.includes("@")) {
              phoneFromProvider = phoneFromProvider.split("@")[0];
            }

            console.log(`[ElevenLabs Phone] Extracted phone: ${phoneFromProvider}`);
            break;
          }

          if (!wavoipFetched && wavoipLastError) {
            console.error(
              `[ElevenLabs Phone] WaVoIP API error (last attempt):`,
              JSON.stringify(wavoipLastError)
            );
          }
        }

        // Check stored instance_info as fallback
        if (!phoneFromProvider && config.instance_info) {
          phoneFromProvider =
            config.instance_info.phone_number ||
            config.instance_info.wid ||
            config.instance_info.jid ||
            null;

          if (phoneFromProvider && phoneFromProvider.includes("@")) {
            phoneFromProvider = phoneFromProvider.split("@")[0];
          }
        }

        if (!phoneFromProvider) {
          // If we couldn't even fetch instance info from WaVoIP, return a more accurate error
          if (provider.provider_type === "wavoip" && !wavoipFetched && wavoipLastError && !config.instance_info) {
            return new Response(
              JSON.stringify({
                success: false,
                error:
                  `Falha ao consultar WaVoIP (${wavoipLastError.status}). ` +
                  `O endpoint pode estar diferente do esperado. Última tentativa: ${wavoipLastError.method} ${wavoipLastError.url}`,
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
            );
          }

          return new Response(
            JSON.stringify({
              success: false,
              error: "Nenhum número encontrado. Verifique se o provedor está conectado com um número ativo.",
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
          );
        }

        // Normalize phone number (remove non-digits, ensure starts with +)
        let normalizedPhone = phoneFromProvider.toString().replace(/\D/g, "");
        if (!normalizedPhone.startsWith("+")) {
          normalizedPhone = "+" + normalizedPhone;
        }

        console.log(`[ElevenLabs Phone] Importing phone: ${normalizedPhone} from provider: ${provider.provider_type}`);

        // Check if number already exists
        const { data: existingNumber } = await supabaseClient
          .from("telephony_numbers")
          .select("id")
          .eq("workspace_id", workspace_id)
          .eq("phone_number", normalizedPhone)
          .single();

        if (existingNumber) {
          return new Response(
            JSON.stringify({ 
              success: true, 
              message: "Número já cadastrado",
              number_id: existingNumber.id,
              phone_number: normalizedPhone,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Create the telephony number record
        const { data: newNumber, error: insertError } = await supabaseClient
          .from("telephony_numbers")
          .insert({
            workspace_id,
            provider_id,
            phone_number: normalizedPhone,
            friendly_name: `${provider.name} - ${normalizedPhone}`,
            capabilities: { 
              voice: true, 
              sms: false, 
              whatsapp: provider.provider_type === "wavoip",
              sip: provider.provider_type === "falefacil" || provider.provider_type === "twilio" || provider.provider_type === "telnyx",
            },
            is_active: true,
          })
          .select("id")
          .single();

        if (insertError) {
          console.error("[ElevenLabs Phone] Error creating number:", insertError);
          throw insertError;
        }

        console.log(`[ElevenLabs Phone] Created telephony number: ${newNumber.id}`);

        return new Response(
          JSON.stringify({ 
            success: true, 
            message: "Número importado com sucesso!",
            number_id: newNumber.id,
            phone_number: normalizedPhone,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "register_sip": {
        // Register a phone number with ElevenLabs using SIP Trunk
        const { sip_account, sip_password, sip_server, phone_number: sipPhoneNumber, agent_id: sipAgentId } = body;

        if (!sipPhoneNumber || !sip_account || !sip_password || !sip_server) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: "phone_number, sip_account, sip_password e sip_server são obrigatórios" 
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
          );
        }

        // Normalize phone number
        let normalizedPhone = sipPhoneNumber.replace(/\D/g, "");
        if (!normalizedPhone.startsWith("+")) {
          normalizedPhone = "+" + normalizedPhone;
        }

        // Build SIP URI
        const sipUri = `sip:${sip_account}@${sip_server}`;

        console.log(`[ElevenLabs Phone] Registering SIP number: ${normalizedPhone}, URI: ${sipUri}`);

        // Register with ElevenLabs via SIP Trunk
        const elevenLabsResponse = await fetch("https://api.elevenlabs.io/v1/convai/phone-numbers", {
          method: "POST",
          headers: {
            "xi-api-key": ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            provider: "sip_trunk",
            phone_number: normalizedPhone,
            sip_trunk_uri: sipUri,
            sip_trunk_authentication: {
              username: sip_account,
              password: sip_password,
            },
            ...(sipAgentId && { agent_id: sipAgentId }),
          }),
        });

        const elevenLabsText = await elevenLabsResponse.text();
        console.log(`[ElevenLabs Phone] ElevenLabs SIP registration response: ${elevenLabsResponse.status}`, elevenLabsText);

        let elevenLabsData: any = null;
        try {
          elevenLabsData = JSON.parse(elevenLabsText);
        } catch {
          // Not JSON, could be error
        }

        if (!elevenLabsResponse.ok) {
          const errorMsg = elevenLabsData?.detail?.message || 
                          elevenLabsData?.message || 
                          elevenLabsData?.error ||
                          `ElevenLabs error: ${elevenLabsResponse.status}`;
          return new Response(
            JSON.stringify({ success: false, error: errorMsg }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
          );
        }

        const elevenLabsPhoneId = elevenLabsData?.phone_number_id || elevenLabsData?.id;

        return new Response(
          JSON.stringify({ 
            success: true, 
            message: "Número SIP registrado no ElevenLabs com sucesso!",
            phone_number: normalizedPhone,
            sip_uri: sipUri,
            elevenlabs_phone_id: elevenLabsPhoneId,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "register": {
        if (!phone_number || !agent_id) {
          return new Response(
            JSON.stringify({ success: false, error: "phone_number e agent_id são obrigatórios" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
          );
        }

        // Register phone number with ElevenLabs
        // Note: ElevenLabs phone number registration is typically done via their dashboard
        // or through their Twilio/SIP integration. The API endpoint for registering
        // external phone numbers may require specific provider configuration.
        
        console.log(`[ElevenLabs Phone] Registering ${phone_number} with agent ${agent_id}`);

        // For now, we'll update the telephony_numbers table with the agent_id
        // The actual ElevenLabs registration happens when using Twilio/Telnyx as providers
        
        // Find the number in our database
        const { data: existingNumber, error: findError } = await supabaseClient
          .from("telephony_numbers")
          .select("id")
          .eq("workspace_id", workspace_id)
          .eq("phone_number", phone_number)
          .single();

        if (findError || !existingNumber) {
          return new Response(
            JSON.stringify({ success: false, error: "Número não encontrado no sistema" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
          );
        }

        // Update with the agent ID
        const { error: updateError } = await supabaseClient
          .from("telephony_numbers")
          .update({
            elevenlabs_agent_id: agent_id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingNumber.id);

        if (updateError) throw updateError;

        return new Response(
          JSON.stringify({ 
            success: true, 
            message: "Número vinculado ao agente ElevenLabs!",
            number_id: existingNumber.id,
          }),
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
    console.error("[ElevenLabs Phone] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

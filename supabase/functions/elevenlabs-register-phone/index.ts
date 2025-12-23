import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RegisterPhoneRequest {
  action: "register" | "import_from_provider";
  workspace_id: string;
  provider_id?: string;
  phone_number?: string;
  agent_id?: string;
  friendly_name?: string;
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

        const config = provider.config as { api_token?: string; instance_key?: string; instance_info?: any };
        
        let phoneFromProvider: string | null = null;

        // For WaVoIP, fetch from API
        if (provider.provider_type === "wavoip" && config.api_token && config.instance_key) {
          console.log(`[ElevenLabs Phone] Fetching WaVoIP instance info...`);
          
          const wavoipResponse = await fetch("https://api.wavoip.com/v1/instance/info", {
            headers: {
              "Authorization": `Bearer ${config.api_token}`,
              "X-Instance-Key": config.instance_key,
            },
          });
          
          if (wavoipResponse.ok) {
            const instanceInfo = await wavoipResponse.json();
            console.log(`[ElevenLabs Phone] WaVoIP response:`, JSON.stringify(instanceInfo));
            
            // Try different field names that WaVoIP might use
            phoneFromProvider = instanceInfo.phone_number 
              || instanceInfo.phoneNumber 
              || instanceInfo.phone 
              || instanceInfo.wid 
              || instanceInfo.jid
              || instanceInfo.me?.user
              || instanceInfo.me?.id
              || instanceInfo.instance?.wid
              || null;
            
            // If wid/jid format (e.g., "5511999999999@s.whatsapp.net"), extract number
            if (phoneFromProvider && phoneFromProvider.includes("@")) {
              phoneFromProvider = phoneFromProvider.split("@")[0];
            }
            
            console.log(`[ElevenLabs Phone] Extracted phone: ${phoneFromProvider}`);
          } else {
            const errorText = await wavoipResponse.text();
            console.error(`[ElevenLabs Phone] WaVoIP API error:`, errorText);
          }
        }

        // Check stored instance_info as fallback
        if (!phoneFromProvider && config.instance_info) {
          phoneFromProvider = config.instance_info.phone_number 
            || config.instance_info.wid 
            || config.instance_info.jid
            || null;
            
          if (phoneFromProvider && phoneFromProvider.includes("@")) {
            phoneFromProvider = phoneFromProvider.split("@")[0];
          }
        }

        if (!phoneFromProvider) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: "Nenhum número encontrado. Verifique se a instância WaVoIP está conectada com um número ativo." 
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
            capabilities: { voice: true, sms: false, whatsapp: provider.provider_type === "wavoip" },
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

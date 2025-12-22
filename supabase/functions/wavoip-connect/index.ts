import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface WaVoIPConnectRequest {
  action: "connect" | "list_numbers" | "disconnect";
  provider_id?: string;
  workspace_id: string;
  api_token?: string;
  instance_key?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body: WaVoIPConnectRequest = await req.json();
    const { action, provider_id, workspace_id, api_token, instance_key } = body;

    console.log(`[WaVoIP] Action: ${action}, Workspace: ${workspace_id}`);

    switch (action) {
      case "connect": {
        if (!api_token || !instance_key) {
          return new Response(
            JSON.stringify({ success: false, error: "API Token e Instance Key são obrigatórios" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
          );
        }

        // Validate connection with WaVoIP API
        const wavoipResponse = await fetch("https://api.wavoip.com/v1/instance/info", {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${api_token}`,
            "X-Instance-Key": instance_key,
          },
        });

        if (!wavoipResponse.ok) {
          const errorText = await wavoipResponse.text();
          console.error("[WaVoIP] Connection failed:", errorText);
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: "Falha na conexão com WaVoIP. Verifique suas credenciais." 
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
          );
        }

        const instanceInfo = await wavoipResponse.json();
        console.log("[WaVoIP] Instance info:", instanceInfo);

        // Get the phone number from the instance
        const phoneNumber = instanceInfo.phone_number || instanceInfo.wid || null;

        // Save or update provider
        const { data: existingProvider } = await supabaseClient
          .from("telephony_providers")
          .select("id")
          .eq("workspace_id", workspace_id)
          .eq("provider_type", "wavoip")
          .single();

        let providerId: string;

        if (existingProvider) {
          // Update existing
          const { error } = await supabaseClient
            .from("telephony_providers")
            .update({
              config: { api_token, instance_key, instance_info: instanceInfo },
              is_active: true,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existingProvider.id);

          if (error) throw error;
          providerId = existingProvider.id;
        } else {
          // Create new
          const { data: newProvider, error } = await supabaseClient
            .from("telephony_providers")
            .insert({
              workspace_id,
              provider_type: "wavoip",
              name: "WaVoIP",
              config: { api_token, instance_key, instance_info: instanceInfo },
              is_active: true,
            })
            .select("id")
            .single();

          if (error) throw error;
          providerId = newProvider.id;
        }

        // If we have a phone number, add it to telephony_numbers
        if (phoneNumber) {
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
              friendly_name: `WhatsApp ${phoneNumber}`,
              capabilities: { voice: true, sms: false, whatsapp: true },
            });
          }
        }

        return new Response(
          JSON.stringify({ 
            success: true, 
            message: "WaVoIP conectado com sucesso!",
            provider_id: providerId,
            phone_number: phoneNumber,
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

        // Get provider config
        const { data: provider, error: providerError } = await supabaseClient
          .from("telephony_providers")
          .select("config")
          .eq("id", provider_id)
          .single();

        if (providerError || !provider) {
          return new Response(
            JSON.stringify({ success: false, error: "Provedor não encontrado" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
          );
        }

        const config = provider.config as { api_token?: string; instance_key?: string };

        // Fetch numbers from WaVoIP
        const numbersResponse = await fetch("https://api.wavoip.com/v1/instance/info", {
          headers: {
            "Authorization": `Bearer ${config.api_token || ""}`,
            "X-Instance-Key": config.instance_key || "",
          },
        });

        if (!numbersResponse.ok) {
          return new Response(
            JSON.stringify({ success: false, error: "Erro ao buscar números do WaVoIP" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
          );
        }

        const instanceInfo = await numbersResponse.json();
        const numbers = instanceInfo.phone_number ? [{ phone_number: instanceInfo.phone_number }] : [];

        return new Response(
          JSON.stringify({ success: true, numbers }),
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

        // Delete provider (numbers will cascade delete)
        const { error } = await supabaseClient
          .from("telephony_providers")
          .delete()
          .eq("id", provider_id);

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, message: "WaVoIP desconectado" }),
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
    console.error("[WaVoIP] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

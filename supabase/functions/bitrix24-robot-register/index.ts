import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper to refresh Bitrix24 OAuth token
async function refreshBitrixToken(integration: any, supabase: any): Promise<string | null> {
  const config = integration.config;
  
  const expiresAt = new Date(config.token_expires_at);
  const now = new Date();
  const bufferMs = 5 * 60 * 1000;
  
  if (expiresAt.getTime() - now.getTime() > bufferMs) {
    return config.access_token;
  }

  console.log("Token expired, refreshing...");

  const clientId = Deno.env.get("BITRIX24_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("BITRIX24_CLIENT_SECRET") || "";
  const refreshUrl = `https://oauth.bitrix.info/oauth/token/?grant_type=refresh_token&client_id=${clientId}&client_secret=${clientSecret}&refresh_token=${config.refresh_token}`;
  
  try {
    const response = await fetch(refreshUrl);
    const data = await response.json();

    if (data.access_token) {
      const newExpiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
      
      await supabase
        .from("integrations")
        .update({
          config: {
            ...config,
            access_token: data.access_token,
            refresh_token: data.refresh_token || config.refresh_token,
            token_expires_at: newExpiresAt,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", integration.id);

      console.log("Token refreshed successfully");
      return data.access_token;
    }
  } catch (error) {
    console.error("Error refreshing token:", error);
  }

  return null;
}

serve(async (req) => {
  console.log("=== BITRIX24-ROBOT-REGISTER ===");
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { integration_id, action } = body;

    if (!integration_id) {
      return new Response(
        JSON.stringify({ error: "integration_id é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get integration
    const { data: integration, error: integrationError } = await supabase
      .from("integrations")
      .select("*")
      .eq("id", integration_id)
      .eq("type", "bitrix24")
      .single();

    if (integrationError || !integration) {
      return new Response(
        JSON.stringify({ error: "Integração Bitrix24 não encontrada" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accessToken = await refreshBitrixToken(integration, supabase);
    if (!accessToken) {
      return new Response(
        JSON.stringify({ error: "Falha ao obter token de acesso" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const config = integration.config || {};
    const clientEndpoint = config.client_endpoint || `https://${config.domain}/rest/`;
    const handlerUrl = `${supabaseUrl}/functions/v1/bitrix24-robot-handler`;

    if (action === "unregister") {
      // Unregister robot
      console.log("Unregistering WhatsApp robot...");
      
      const unregisterUrl = `${clientEndpoint}bizproc.robot.delete?auth=${accessToken}`;
      const unregisterResponse = await fetch(unregisterUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ CODE: "thoth_send_whatsapp" }),
      });
      
      const unregisterResult = await unregisterResponse.json();
      console.log("bizproc.robot.delete result:", JSON.stringify(unregisterResult));

      // Update config
      await supabase
        .from("integrations")
        .update({
          config: {
            ...config,
            robot_registered: false,
            robot_unregistered_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", integration.id);

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Robot removido com sucesso",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Register the WhatsApp robot
    console.log("Registering WhatsApp robot...");
    
    const robotData = {
      CODE: "thoth_send_whatsapp",
      HANDLER: handlerUrl,
      AUTH_USER_ID: 1,
      NAME: {
        pt: "Enviar WhatsApp (Thoth)",
        en: "Send WhatsApp (Thoth)",
        es: "Enviar WhatsApp (Thoth)",
      },
      DESCRIPTION: {
        pt: "Envia uma mensagem via WhatsApp usando Thoth",
        en: "Send a message via WhatsApp using Thoth",
        es: "Envía un mensaje vía WhatsApp usando Thoth",
      },
      USE_PLACEMENT: "N",
      PLACEMENT_HANDLER: "",
      USE_SUBSCRIPTION: "N",
      PROPERTIES: {
        PhoneNumber: {
          Name: {
            pt: "Número do Telefone",
            en: "Phone Number",
            es: "Número de Teléfono",
          },
          Description: {
            pt: "Número do telefone com código do país (ex: 5511999999999)",
            en: "Phone number with country code (e.g., 5511999999999)",
            es: "Número de teléfono con código de país (ej: 5511999999999)",
          },
          Type: "string",
          Required: "Y",
          Options: null,
          Default: "{=Document:PHONE}",
        },
        Message: {
          Name: {
            pt: "Mensagem",
            en: "Message",
            es: "Mensaje",
          },
          Description: {
            pt: "Texto da mensagem a ser enviada",
            en: "Message text to be sent",
            es: "Texto del mensaje a enviar",
          },
          Type: "text",
          Required: "Y",
          Options: null,
          Default: "",
        },
        InstanceId: {
          Name: {
            pt: "ID da Instância WhatsApp",
            en: "WhatsApp Instance ID",
            es: "ID de Instancia WhatsApp",
          },
          Description: {
            pt: "Deixe vazio para usar a instância padrão",
            en: "Leave empty to use default instance",
            es: "Deja vacío para usar la instancia predeterminada",
          },
          Type: "string",
          Required: "N",
          Options: null,
          Default: config.instance_id || "",
        },
      },
      RETURN_PROPERTIES: {
        MessageId: {
          Name: {
            pt: "ID da Mensagem",
            en: "Message ID",
            es: "ID del Mensaje",
          },
          Type: "string",
        },
        Status: {
          Name: {
            pt: "Status",
            en: "Status",
            es: "Estado",
          },
          Type: "string",
        },
        Error: {
          Name: {
            pt: "Erro",
            en: "Error",
            es: "Error",
          },
          Type: "string",
        },
      },
    };

    const registerUrl = `${clientEndpoint}bizproc.robot.add?auth=${accessToken}`;
    console.log("Calling bizproc.robot.add...");
    
    const registerResponse = await fetch(registerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(robotData),
    });

    const registerResult = await registerResponse.json();
    console.log("bizproc.robot.add result:", JSON.stringify(registerResult));

    const isSuccess = registerResult.result === true || 
                      (registerResult.error && registerResult.error_description?.includes("already"));

    // Update integration config with robot status
    await supabase
      .from("integrations")
      .update({
        config: {
          ...config,
          robot_registered: isSuccess,
          robot_code: "thoth_send_whatsapp",
          robot_registered_at: isSuccess ? new Date().toISOString() : null,
          robot_error: isSuccess ? null : registerResult.error_description,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", integration.id);

    if (isSuccess) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Robot registrado com sucesso! Agora você pode usar 'Enviar WhatsApp (Thoth)' nas automações.",
          robot_code: "thoth_send_whatsapp",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: registerResult.error_description || registerResult.error || "Erro desconhecido",
          details: registerResult,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

  } catch (error) {
    console.error("Error in bitrix24-robot-register:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

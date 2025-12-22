import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TransferRule {
  id: string;
  destination_type: "phone" | "sip_uri";
  destination: string;
  condition: string;
  transfer_type: "conference" | "sip_refer" | "warm";
  priority: number;
  is_active: boolean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const elevenlabsApiKey = Deno.env.get("ELEVENLABS_API_KEY");

  if (!elevenlabsApiKey) {
    return new Response(
      JSON.stringify({ error: "ELEVENLABS_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { persona_id, agent_id } = await req.json();

    if (!persona_id || !agent_id) {
      return new Response(
        JSON.stringify({ error: "persona_id and agent_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Configuring transfer rules for persona ${persona_id}, agent ${agent_id}`);

    // Fetch active transfer rules for this persona
    const { data: rules, error: rulesError } = await supabase
      .from("telephony_transfer_rules")
      .select("*")
      .or(`persona_id.eq.${persona_id},persona_id.is.null`)
      .eq("is_active", true)
      .order("priority", { ascending: false });

    if (rulesError) {
      console.error("Error fetching rules:", rulesError);
      throw rulesError;
    }

    console.log(`Found ${rules?.length || 0} active transfer rules`);

    if (!rules || rules.length === 0) {
      // No rules, disable transfer tool on agent
      console.log("No active rules, removing transfer configuration");
      
      const response = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agent_id}`, {
        method: "PATCH",
        headers: {
          "xi-api-key": elevenlabsApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_config: {
            agent: {
              tools: [] // Remove transfer tools
            }
          }
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("ElevenLabs API error:", response.status, errorText);
        throw new Error(`ElevenLabs API error: ${response.status}`);
      }

      return new Response(
        JSON.stringify({ success: true, message: "Transfer rules removed from agent" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build transfer_to_number tool configuration
    const transferDestinations = rules.map((rule: TransferRule) => {
      const destination: any = {
        condition: rule.condition,
      };

      if (rule.destination_type === "phone") {
        destination.transfer_destination = {
          type: "phone",
          phone_number: rule.destination,
        };
      } else {
        destination.transfer_destination = {
          type: "sip_uri",
          sip_uri: rule.destination,
        };
      }

      // Map transfer type
      switch (rule.transfer_type) {
        case "conference":
          destination.transfer_type = "conference";
          break;
        case "sip_refer":
          destination.transfer_type = "sip_refer";
          break;
        case "warm":
          destination.transfer_type = "warm";
          break;
      }

      return destination;
    });

    // Build the tools configuration for ElevenLabs
    const toolsConfig = [
      {
        type: "transfer_to_number",
        transfer_to_number: {
          destinations: transferDestinations,
          // Prompt the agent about when to use transfers
          system_prompt_extension: `
Você tem a capacidade de transferir chamadas para atendentes humanos quando necessário.
Condições de transferência disponíveis:
${rules.map((r: TransferRule, i: number) => `${i + 1}. ${r.condition}`).join("\n")}

Quando uma dessas condições for atendida, utilize a ferramenta de transferência apropriada.
Antes de transferir, informe o cliente que você irá conectá-lo com um atendente.
          `.trim(),
        },
      },
    ];

    console.log("Updating ElevenLabs agent with transfer config:", JSON.stringify(toolsConfig, null, 2));

    // Update the ElevenLabs agent
    const response = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agent_id}`, {
      method: "PATCH",
      headers: {
        "xi-api-key": elevenlabsApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversation_config: {
          agent: {
            tools: toolsConfig,
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("ElevenLabs API error:", response.status, errorText);
      throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log("ElevenLabs agent updated successfully:", result.agent_id);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Transfer rules configured successfully",
        rules_count: rules.length,
        agent_id: result.agent_id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error configuring transfer rules:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

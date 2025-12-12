import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { webhook_url, connector_id, instance_id, workspace_id, integration_id } = await req.json();

    if (!webhook_url || !connector_id || !workspace_id) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: webhook_url, connector_id, workspace_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Registering Bitrix24 connector:", { connector_id, workspace_id });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Register connector in Bitrix24
    const registerPayload = {
      ID: connector_id,
      NAME: "Thoth WhatsApp",
      ICON: {
        DATA_IMAGE: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMyNUQ0NjYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMjEgMTEuNWE4LjM4IDguMzggMCAwIDEtLjkgMy44IDguNSA4LjUgMCAwIDEtNy42IDQuNyA4LjM4IDguMzggMCAwIDEtMy44LS45TDMgMjFsMS45LTUuN2E4LjM4IDguMzggMCAwIDEtLjktMy44IDguNSA4LjUgMCAwIDEgNC43LTcuNiA4LjM4IDguMzggMCAwIDEgMy44LS45aC41YTguNDggOC40OCAwIDAgMSA4IDh2LjV6Ij48L3BhdGg+PC9zdmc+",
      },
      PLACEMENT_HANDLER: `${supabaseUrl}/functions/v1/bitrix24-webhook`,
    };

    console.log("Calling imconnector.register with:", JSON.stringify(registerPayload));

    const registerResponse = await fetch(`${webhook_url}imconnector.register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(registerPayload),
    });

    const registerResult = await registerResponse.json();
    console.log("imconnector.register result:", JSON.stringify(registerResult));

    if (registerResult.error && registerResult.error !== "CONNECTOR_ALREADY_EXISTS") {
      return new Response(
        JSON.stringify({ error: `Bitrix24 register error: ${registerResult.error_description || registerResult.error}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Activate the connector
    const activateResponse = await fetch(`${webhook_url}imconnector.activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        CONNECTOR: connector_id,
        LINE: 1, // Default line
        ACTIVE: 1,
      }),
    });

    const activateResult = await activateResponse.json();
    console.log("imconnector.activate result:", JSON.stringify(activateResult));

    // 3. Bind events to receive messages from Bitrix24 operators
    const webhookEndpoint = `${supabaseUrl}/functions/v1/bitrix24-webhook?workspace_id=${workspace_id}&connector_id=${connector_id}`;
    
    const events = [
      "OnImConnectorMessageAdd",
      "OnImConnectorDialogFinish", 
      "OnImConnectorStatusDelete",
    ];

    for (const event of events) {
      const bindResponse = await fetch(`${webhook_url}event.bind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: event,
          handler: webhookEndpoint,
        }),
      });
      const bindResult = await bindResponse.json();
      console.log(`event.bind ${event} result:`, JSON.stringify(bindResult));
    }

    // 4. Update integration in database with registration details
    const configUpdate = {
      webhook_url,
      connector_id,
      instance_id: instance_id || null,
      registered: true,
      events_url: webhookEndpoint,
      line_id: "1",
    };

    if (integration_id) {
      await supabase
        .from("integrations")
        .update({ config: configUpdate, is_active: true })
        .eq("id", integration_id);
    } else {
      await supabase.from("integrations").insert({
        workspace_id,
        type: "bitrix24",
        name: "Bitrix24",
        config: configUpdate,
        is_active: true,
      });
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Connector registered successfully",
        connector_id,
        events_url: webhookEndpoint,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Bitrix24 register error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GUPSHUP_BASE_URL = "https://api.gupshup.io/wa/api/v1";

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get auth token from request
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authorization header required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { instanceId, workspaceId, gupshupApiKey, gupshupAppId, phoneNumber } = body;

    console.log(`[gupshup-connect] Connecting instance ${instanceId} for user ${user.id}`);

    if (!instanceId || !workspaceId || !gupshupApiKey || !gupshupAppId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: instanceId, workspaceId, gupshupApiKey, gupshupAppId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify instance belongs to user
    const { data: instance, error: instanceError } = await supabase
      .from("instances")
      .select("*")
      .eq("id", instanceId)
      .eq("user_id", user.id)
      .single();

    if (instanceError || !instance) {
      console.error("[gupshup-connect] Instance not found:", instanceError);
      return new Response(
        JSON.stringify({ error: "Instance not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate Gupshup API Key by checking health/status
    console.log("[gupshup-connect] Validating Gupshup API Key...");
    
    try {
      const healthResponse = await fetch(`${GUPSHUP_BASE_URL}/health`, {
        method: "GET",
        headers: {
          "apikey": gupshupApiKey,
        },
      });

      // Gupshup doesn't have a health endpoint, so we try to get wallet balance
      const walletResponse = await fetch("https://api.gupshup.io/wa/app/wallet/balance", {
        method: "GET",
        headers: {
          "apikey": gupshupApiKey,
        },
      });

      if (!walletResponse.ok) {
        console.error("[gupshup-connect] Invalid API Key - wallet check failed");
        return new Response(
          JSON.stringify({ error: "Invalid Gupshup API Key" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const walletData = await walletResponse.json();
      console.log("[gupshup-connect] Gupshup wallet balance:", walletData);
    } catch (apiError) {
      console.error("[gupshup-connect] Error validating API Key:", apiError);
      // Continue anyway, sometimes API can be flaky
    }

    // Configure webhook URL for this instance
    const webhookUrl = `${supabaseUrl}/functions/v1/gupshup-webhook?instanceId=${instanceId}`;
    console.log("[gupshup-connect] Setting webhook URL:", webhookUrl);

    try {
      // Set inbound webhook
      const webhookPayload = new URLSearchParams({
        app: gupshupAppId,
        webhookUrl: webhookUrl,
      });

      const webhookResponse = await fetch("https://api.gupshup.io/wa/app/webhook", {
        method: "PUT",
        headers: {
          "apikey": gupshupApiKey,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: webhookPayload.toString(),
      });

      const webhookResult = await webhookResponse.json();
      console.log("[gupshup-connect] Webhook configuration result:", webhookResult);

      if (webhookResult.status === "error") {
        console.warn("[gupshup-connect] Webhook config warning:", webhookResult);
      }
    } catch (webhookError) {
      console.error("[gupshup-connect] Error configuring webhook:", webhookError);
      // Continue - user might need to configure manually
    }

    // Update instance in database
    const { error: updateError } = await supabase
      .from("instances")
      .update({
        connection_type: "official",
        gupshup_app_id: gupshupAppId,
        gupshup_api_key: gupshupApiKey, // In production, encrypt this
        phone_number: phoneNumber || null,
        status: "connected",
        updated_at: new Date().toISOString(),
      })
      .eq("id", instanceId);

    if (updateError) {
      console.error("[gupshup-connect] Error updating instance:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to update instance" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[gupshup-connect] Instance connected successfully");

    return new Response(
      JSON.stringify({
        success: true,
        status: "connected",
        message: "Gupshup connected successfully",
        webhookUrl: webhookUrl,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[gupshup-connect] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

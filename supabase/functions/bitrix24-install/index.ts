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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ✅ HANDLE GET REQUESTS FIRST (before trying to parse body)
    if (req.method === "GET") {
      const url = new URL(req.url);
      
      // Enhanced logging for debugging
      console.log("=== GET REQUEST DEBUG ===");
      console.log("Full URL:", req.url);
      console.log("Search params string:", url.searchParams.toString());
      
      const queryMemberId = url.searchParams.get("member_id");
      const queryDomain = url.searchParams.get("domain") || url.searchParams.get("DOMAIN");
      const includeInstances = url.searchParams.get("include_instances") === "true";

      console.log("Parsed - member_id:", queryMemberId, "domain:", queryDomain, "include_instances:", includeInstances);

      const searchValue = queryMemberId || queryDomain;

      if (searchValue) {
        // Try to find integration by member_id or domain
        const { data: integration } = await supabase
          .from("integrations")
          .select("*")
          .eq("type", "bitrix24")
          .or(`config->>member_id.eq.${searchValue},config->>domain.eq.${searchValue}`)
          .maybeSingle();

        let instances: any[] = [];
        
        // ALWAYS fetch connected instances for first-time setup (when no integration exists)
        // OR when include_instances is explicitly requested
        const shouldFetchInstances = includeInstances || !integration;
        
        if (shouldFetchInstances) {
          // Get instances from the workspace associated with this integration
          if (integration?.workspace_id) {
            const { data: workspaceInstances } = await supabase
              .from("instances")
              .select("id, name, phone_number, status")
              .eq("workspace_id", integration.workspace_id)
              .eq("status", "connected");
            
            instances = workspaceInstances || [];
            console.log("Found workspace instances:", instances.length);
          } else {
            // If no integration found, get ALL connected instances
            // This is critical for first-time setup
            console.log("No integration found - fetching all connected instances for first-time setup");
            const { data: allInstances, error: instancesError } = await supabase
              .from("instances")
              .select("id, name, phone_number, status")
              .eq("status", "connected")
              .limit(50);
            
            if (instancesError) {
              console.error("Error fetching instances:", instancesError);
            }
            
            instances = allInstances || [];
            console.log("Found all connected instances:", instances.length, JSON.stringify(instances));
          }
        }

        if (integration) {
          console.log("Integration found:", integration.id);
          return new Response(
            JSON.stringify({
              found: true,
              domain: integration.config?.domain,
              registered: integration.config?.registered || false,
              instance_id: integration.config?.instance_id,
              is_active: integration.is_active,
              workspace_id: integration.workspace_id,
              instances: instances, // Always return instances when we fetched them
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Integration not found - ALWAYS return instances for first-time setup
        console.log("Integration not found, returning instances for setup:", instances.length);
        return new Response(
          JSON.stringify({ 
            found: false,
            instances: instances, // Always include instances for first-time setup
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ found: false, message: "No member_id or domain provided" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ✅ ONLY PARSE BODY FOR POST REQUESTS
    const contentType = req.headers.get("content-type") || "";
    let body: Record<string, any> = {};

    if (contentType.includes("application/json")) {
      body = await req.json();
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      for (const [key, value] of formData.entries()) {
        // Handle nested auth object from Bitrix24
        if (key.startsWith("auth[")) {
          const authKey = key.replace("auth[", "").replace("]", "");
          if (!body.auth) body.auth = {};
          body.auth[authKey] = value;
        } else {
          body[key] = value;
        }
      }
    }

    console.log("Bitrix24 install event received:", JSON.stringify(body));

    const event = body.event?.toUpperCase();
    const auth = body.auth || {};

    // Extract auth data
    const accessToken = auth.access_token;
    const refreshToken = auth.refresh_token;
    const domain = auth.domain;
    const memberId = auth.member_id;
    const clientEndpoint = auth.client_endpoint;
    const applicationToken = body.application_token || auth.application_token;
    const expiresIn = parseInt(auth.expires_in || "3600", 10);

    if (event === "ONAPPINSTALL") {
      if (!domain || !memberId || !accessToken) {
        console.error("Missing required auth data for ONAPPINSTALL");
        return new Response(
          JSON.stringify({ error: "Missing required auth data" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`Installing Bitrix24 app for domain: ${domain}, member_id: ${memberId}`);

      // Calculate token expiration time
      const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      // Check if integration already exists for this member_id
      const { data: existing } = await supabase
        .from("integrations")
        .select("*")
        .eq("type", "bitrix24")
        .filter("config->>member_id", "eq", memberId)
        .maybeSingle();

      const configData = {
        member_id: memberId,
        domain,
        client_endpoint: clientEndpoint || `https://${domain}/rest/`,
        access_token: accessToken,
        refresh_token: refreshToken,
        application_token: applicationToken,
        token_expires_at: tokenExpiresAt,
        installed: true,
        installed_at: new Date().toISOString(),
        registered: false,
        connector_id: null,
        line_id: null,
        instance_id: null,
      };

      if (existing) {
        // Update existing integration
        await supabase
          .from("integrations")
          .update({
            config: { ...existing.config, ...configData },
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);

        console.log(`Updated existing Bitrix24 integration: ${existing.id}`);
      } else {
        // We need a workspace_id - for now, we'll create a placeholder
        // The actual workspace association will happen when the user configures in the iframe
        console.log("New Bitrix24 installation - will be associated with workspace during setup");
        
        // Store temporarily without workspace - this requires handling in the setup page
        // For now, we'll return success and expect the iframe to complete the setup
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "App installed successfully",
          member_id: memberId,
          domain,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (event === "ONAPPUNINSTALL") {
      console.log(`Uninstalling Bitrix24 app for member_id: ${memberId}`);

      if (memberId) {
        // Mark integration as inactive
        const { data: existing } = await supabase
          .from("integrations")
          .select("id, config")
          .eq("type", "bitrix24")
          .filter("config->>member_id", "eq", memberId)
          .maybeSingle();

        if (existing) {
          await supabase
            .from("integrations")
            .update({ 
              is_active: false,
              config: { ...existing.config, uninstalled_at: new Date().toISOString() }
            })
            .eq("id", existing.id);
        }
      }

      return new Response(
        JSON.stringify({ success: true, message: "App uninstalled" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Default response for unhandled events
    console.log("Unhandled Bitrix24 event:", event);
    return new Response(
      JSON.stringify({ success: true, message: "Event received" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Bitrix24 install error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

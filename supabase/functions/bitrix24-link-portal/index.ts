import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Token de autorização necessário" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Usuário não autenticado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { domain, workspace_id } = body;

    console.log(`[bitrix24-link-portal] Linking domain: ${domain} to workspace: ${workspace_id}`);

    if (!domain) {
      return new Response(
        JSON.stringify({ error: "Domínio do portal Bitrix24 é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!workspace_id) {
      return new Response(
        JSON.stringify({ error: "ID do workspace é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify user is member of workspace
    const { data: membership, error: memberError } = await supabase
      .from("workspace_members")
      .select("id, role")
      .eq("workspace_id", workspace_id)
      .eq("user_id", user.id)
      .single();

    if (memberError || !membership) {
      return new Response(
        JSON.stringify({ error: "Você não tem permissão para este workspace" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalize domain (remove protocol and trailing slash)
    const normalizedDomain = domain
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, "")
      .toLowerCase();

    console.log(`[bitrix24-link-portal] Normalized domain: ${normalizedDomain}`);

    // Search for integration by domain in config
    const { data: integrations, error: searchError } = await supabase
      .from("integrations")
      .select("*")
      .eq("type", "bitrix24");

    if (searchError) {
      console.error("[bitrix24-link-portal] Search error:", searchError);
      return new Response(
        JSON.stringify({ error: "Erro ao buscar integrações" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find integration matching the domain
    let foundIntegration = null;
    for (const integration of integrations || []) {
      const config = integration.config as Record<string, unknown> | null;
      if (config) {
        const integrationDomain = (config.domain as string || "")
          .replace(/^https?:\/\//, "")
          .replace(/\/+$/, "")
          .toLowerCase();
        
        if (integrationDomain === normalizedDomain) {
          foundIntegration = integration;
          break;
        }
      }
    }

    if (!foundIntegration) {
      console.log(`[bitrix24-link-portal] No integration found for domain: ${normalizedDomain}`);
      return new Response(
        JSON.stringify({ 
          error: "Nenhuma integração Bitrix24 encontrada para este domínio. Instale o app Thoth AI no seu portal Bitrix24 primeiro." 
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if already linked to another workspace
    if (foundIntegration.workspace_id && foundIntegration.workspace_id !== workspace_id) {
      console.log(`[bitrix24-link-portal] Integration already linked to workspace: ${foundIntegration.workspace_id}`);
      return new Response(
        JSON.stringify({ 
          error: "Este portal já está vinculado a outra conta. Entre em contato com o suporte." 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update integration with workspace_id
    const { error: updateError } = await supabase
      .from("integrations")
      .update({
        workspace_id: workspace_id,
        updated_at: new Date().toISOString()
      })
      .eq("id", foundIntegration.id);

    if (updateError) {
      console.error("[bitrix24-link-portal] Update error:", updateError);
      return new Response(
        JSON.stringify({ error: "Erro ao vincular integração" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[bitrix24-link-portal] Successfully linked integration ${foundIntegration.id} to workspace ${workspace_id}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Portal Bitrix24 vinculado com sucesso!",
        integration_id: foundIntegration.id,
        domain: normalizedDomain
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("[bitrix24-link-portal] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Erro interno do servidor";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  action: string;
  member_id: string;
  data?: any;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: RequestBody = await req.json();
    const { action, member_id, data } = body;

    if (!member_id) {
      return new Response(
        JSON.stringify({ error: "member_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[bitrix24-data] Action: ${action}, member_id: ${member_id}`);

    // Validate member_id and get workspace_id
    // Try to find by member_id first, then fallback to domain
    let integration = null;
    
    const { data: integrationByMemberId } = await supabase
      .from("integrations")
      .select("id, workspace_id, is_active, config")
      .eq("type", "bitrix24")
      .eq("is_active", true)
      .filter("config->member_id", "eq", member_id)
      .single();

    if (integrationByMemberId) {
      integration = integrationByMemberId;
      console.log(`[bitrix24-data] Found integration by member_id: ${member_id}`);
    } else {
      // Fallback: try to find by domain (in case frontend passed domain instead of member_id)
      console.log(`[bitrix24-data] member_id not found, trying domain lookup: ${member_id}`);
      const { data: integrationByDomain } = await supabase
        .from("integrations")
        .select("id, workspace_id, is_active, config")
        .eq("type", "bitrix24")
        .eq("is_active", true)
        .filter("config->domain", "eq", member_id)
        .single();

      if (integrationByDomain) {
        integration = integrationByDomain;
        console.log(`[bitrix24-data] Found integration by domain: ${member_id}`);
      }
    }

    if (!integration) {
      console.log(`[bitrix24-data] Integration not found for member_id/domain: ${member_id}`);
      return new Response(
        JSON.stringify({ error: "Integration not found", data: null }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const workspaceId = integration.workspace_id;
    
    if (!workspaceId) {
      return new Response(
        JSON.stringify({ error: "Workspace not linked", data: null }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[bitrix24-data] Found workspace_id: ${workspaceId}`);

    let result: any = null;

    switch (action) {
      // ============ INSTANCES ============
      case "get_instances": {
        const { data: instances, error } = await supabase
          .from("instances")
          .select("*")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false });

        if (error) throw error;
        result = instances;
        break;
      }

      case "create_instance": {
        // Get workspace owner for user_id
        const { data: workspace } = await supabase
          .from("workspaces")
          .select("owner_id")
          .eq("id", workspaceId)
          .single();

        if (!workspace?.owner_id) {
          throw new Error("Workspace owner not found");
        }

        const { data: instance, error } = await supabase
          .from("instances")
          .insert({
            name: data.name,
            workspace_id: workspaceId,
            user_id: workspace.owner_id,
            connection_type: data.connection_type || "waba",
            status: "disconnected",
            ...(data.connection_type === "oficial" && {
              gupshup_api_key: data.gupshup_api_key,
              gupshup_app_id: data.gupshup_app_id,
            })
          })
          .select()
          .single();

        if (error) throw error;
        result = instance;
        break;
      }

      case "delete_instance": {
        const { error } = await supabase
          .from("instances")
          .delete()
          .eq("id", data.id)
          .eq("workspace_id", workspaceId);

        if (error) throw error;
        result = { success: true };
        break;
      }

      // ============ PERSONAS ============
      case "get_personas": {
        const { data: personas, error } = await supabase
          .from("personas")
          .select("*")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false });

        if (error) throw error;
        result = personas;
        break;
      }

      case "create_persona": {
        const { data: persona, error } = await supabase
          .from("personas")
          .insert({
            name: data.name,
            description: data.description,
            system_prompt: data.system_prompt || "Você é um assistente prestativo.",
            welcome_message: data.welcome_message,
            fallback_message: data.fallback_message,
            temperature: data.temperature || 0.7,
            workspace_id: workspaceId,
            is_active: true
          })
          .select()
          .single();

        if (error) throw error;
        result = persona;
        break;
      }

      case "update_persona": {
        const { data: persona, error } = await supabase
          .from("personas")
          .update({
            name: data.name,
            description: data.description,
            system_prompt: data.system_prompt,
            welcome_message: data.welcome_message,
            fallback_message: data.fallback_message,
            temperature: data.temperature,
            is_active: data.is_active,
            is_default: data.is_default
          })
          .eq("id", data.id)
          .eq("workspace_id", workspaceId)
          .select()
          .single();

        if (error) throw error;
        result = persona;
        break;
      }

      case "delete_persona": {
        const { error } = await supabase
          .from("personas")
          .delete()
          .eq("id", data.id)
          .eq("workspace_id", workspaceId);

        if (error) throw error;
        result = { success: true };
        break;
      }

      case "set_default_persona": {
        // First, unset all defaults
        await supabase
          .from("personas")
          .update({ is_default: false })
          .eq("workspace_id", workspaceId);

        // Then set the new default
        const { data: persona, error } = await supabase
          .from("personas")
          .update({ is_default: true })
          .eq("id", data.id)
          .eq("workspace_id", workspaceId)
          .select()
          .single();

        if (error) throw error;
        result = persona;
        break;
      }

      // ============ KNOWLEDGE DOCUMENTS ============
      case "get_documents": {
        const { data: documents, error } = await supabase
          .from("knowledge_documents")
          .select("*")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false });

        if (error) throw error;
        result = documents;
        break;
      }

      case "create_document": {
        const { data: document, error } = await supabase
          .from("knowledge_documents")
          .insert({
            title: data.title,
            content: data.content,
            source_type: data.source_type || "manual",
            workspace_id: workspaceId,
            status: "completed"
          })
          .select()
          .single();

        if (error) throw error;
        result = document;
        break;
      }

      case "delete_document": {
        const { error } = await supabase
          .from("knowledge_documents")
          .delete()
          .eq("id", data.id)
          .eq("workspace_id", workspaceId);

        if (error) throw error;
        result = { success: true };
        break;
      }

      // ============ FLOWS ============
      case "get_flows": {
        const { data: flows, error } = await supabase
          .from("flows")
          .select("*")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false });

        if (error) throw error;
        result = flows;
        break;
      }

      case "create_flow": {
        const { data: flow, error } = await supabase
          .from("flows")
          .insert({
            name: data.name,
            description: data.description,
            trigger_type: data.trigger_type || "keyword",
            trigger_value: data.trigger_value,
            workspace_id: workspaceId,
            is_active: true,
            nodes: data.nodes || [],
            edges: data.edges || []
          })
          .select()
          .single();

        if (error) throw error;
        result = flow;
        break;
      }

      case "update_flow": {
        const { data: flow, error } = await supabase
          .from("flows")
          .update({
            name: data.name,
            description: data.description,
            trigger_type: data.trigger_type,
            trigger_value: data.trigger_value,
            is_active: data.is_active,
            nodes: data.nodes,
            edges: data.edges
          })
          .eq("id", data.id)
          .eq("workspace_id", workspaceId)
          .select()
          .single();

        if (error) throw error;
        result = flow;
        break;
      }

      case "delete_flow": {
        const { error } = await supabase
          .from("flows")
          .delete()
          .eq("id", data.id)
          .eq("workspace_id", workspaceId);

        if (error) throw error;
        result = { success: true };
        break;
      }

      // ============ BOT PUBLISHING ============
      case "publish_persona_bot": {
        console.log(`[bitrix24-data] Publishing persona ${data.persona_id} as bot`);
        
        // Call bitrix24-bot-register to register the persona as a bot
        const response = await fetch(`${supabaseUrl}/functions/v1/bitrix24-bot-register`, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`
          },
          body: JSON.stringify({
            action: "register_persona",
            workspace_id: workspaceId,
            persona_id: data.persona_id
          })
        });

        const botResult = await response.json();
        
        if (!response.ok || botResult.error) {
          throw new Error(botResult.error || `Failed to register bot: HTTP ${response.status}`);
        }

        console.log(`[bitrix24-data] Bot registered:`, botResult);
        result = botResult;
        break;
      }

      case "unpublish_persona_bot": {
        console.log(`[bitrix24-data] Unpublishing persona ${data.persona_id} as bot`);
        
        // Call bitrix24-bot-register to unregister the persona as a bot
        const response = await fetch(`${supabaseUrl}/functions/v1/bitrix24-bot-register`, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`
          },
          body: JSON.stringify({
            action: "unregister_persona",
            workspace_id: workspaceId,
            persona_id: data.persona_id
          })
        });

        const botResult = await response.json();
        
        if (!response.ok || botResult.error) {
          throw new Error(botResult.error || `Failed to unregister bot: HTTP ${response.status}`);
        }

        console.log(`[bitrix24-data] Bot unregistered:`, botResult);
        result = botResult;
        break;
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    console.log(`[bitrix24-data] Action ${action} completed successfully`);

    return new Response(
      JSON.stringify({ data: result, error: null }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("[bitrix24-data] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message, data: null }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

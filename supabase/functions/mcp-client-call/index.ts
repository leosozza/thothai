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
    const { mcp_connection_id, tool_name, arguments: toolArgs } = await req.json();

    if (!mcp_connection_id || !tool_name) {
      throw new Error("mcp_connection_id e tool_name são obrigatórios");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch connection details
    const { data: connection, error } = await supabase
      .from("mcp_connections")
      .select("*")
      .eq("id", mcp_connection_id)
      .single();

    if (error || !connection) {
      throw new Error("Conexão MCP não encontrada");
    }

    if (!connection.is_active) {
      throw new Error("Conexão MCP está desativada");
    }

    // Build auth headers
    let authHeaders: Record<string, string> = {};
    if (connection.auth_type === "bearer" && connection.auth_config?.token) {
      authHeaders["Authorization"] = `Bearer ${connection.auth_config.token}`;
    } else if (connection.auth_type === "api_key" && connection.auth_config?.api_key) {
      const headerName = connection.auth_config.header_name || "X-API-Key";
      authHeaders[headerName] = connection.auth_config.api_key;
    }

    console.log(`[MCP Call] Calling ${tool_name} on ${connection.mcp_url}`);
    console.log(`[MCP Call] Arguments:`, JSON.stringify(toolArgs));

    // Initialize connection first
    const initResponse = await fetch(connection.mcp_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          clientInfo: { name: "thoth-mcp-client", version: "1.0.0" },
        },
      }),
    });

    if (!initResponse.ok) {
      throw new Error(`Falha na inicialização: ${initResponse.status}`);
    }

    // Send initialized notification
    await fetch(connection.mcp_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });

    // Call the tool
    const callResponse = await fetch(connection.mcp_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: tool_name,
          arguments: toolArgs || {},
        },
      }),
    });

    if (!callResponse.ok) {
      const errorText = await callResponse.text();
      console.error(`[MCP Call] Tool call failed: ${callResponse.status} - ${errorText}`);
      throw new Error(`Falha ao executar ferramenta: ${callResponse.status}`);
    }

    const result = await callResponse.json();
    console.log(`[MCP Call] Result:`, JSON.stringify(result));

    if (result.error) {
      throw new Error(result.error.message || "Erro na execução da ferramenta");
    }

    return new Response(JSON.stringify({
      success: true,
      result: result.result,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[MCP Call] Error:", error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : "Erro desconhecido",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

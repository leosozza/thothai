import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface MCPDiscoverResponse {
  tools: MCPTool[];
  serverInfo?: {
    name: string;
    version: string;
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { mcp_connection_id, mcp_url, auth_type, auth_config } = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let targetUrl = mcp_url;
    let authHeaders: Record<string, string> = {};

    // If mcp_connection_id provided, fetch from database
    if (mcp_connection_id) {
      const { data: connection, error } = await supabase
        .from("mcp_connections")
        .select("*")
        .eq("id", mcp_connection_id)
        .single();

      if (error || !connection) {
        throw new Error("Conexão MCP não encontrada");
      }

      targetUrl = connection.mcp_url;
      
      // Build auth headers based on auth_type
      if (connection.auth_type === "bearer" && connection.auth_config?.token) {
        authHeaders["Authorization"] = `Bearer ${connection.auth_config.token}`;
      } else if (connection.auth_type === "api_key" && connection.auth_config?.api_key) {
        const headerName = connection.auth_config.header_name || "X-API-Key";
        authHeaders[headerName] = connection.auth_config.api_key;
      }
    } else if (auth_type && auth_config) {
      // Use provided auth directly
      if (auth_type === "bearer" && auth_config.token) {
        authHeaders["Authorization"] = `Bearer ${auth_config.token}`;
      } else if (auth_type === "api_key" && auth_config.api_key) {
        const headerName = auth_config.header_name || "X-API-Key";
        authHeaders[headerName] = auth_config.api_key;
      }
    }

    console.log(`[MCP Discover] Connecting to: ${targetUrl}`);

    // MCP uses JSON-RPC over HTTP
    // First, initialize the connection
    const initResponse = await fetch(targetUrl, {
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
          capabilities: {
            tools: {},
          },
          clientInfo: {
            name: "thoth-mcp-client",
            version: "1.0.0",
          },
        },
      }),
    });

    if (!initResponse.ok) {
      const errorText = await initResponse.text();
      console.error(`[MCP Discover] Init failed: ${initResponse.status} - ${errorText}`);
      throw new Error(`Falha ao conectar ao MCP: ${initResponse.status}`);
    }

    const initResult = await initResponse.json();
    console.log(`[MCP Discover] Init result:`, JSON.stringify(initResult));

    // Send initialized notification
    await fetch(targetUrl, {
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

    // Now list the available tools
    const toolsResponse = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    });

    if (!toolsResponse.ok) {
      const errorText = await toolsResponse.text();
      console.error(`[MCP Discover] Tools list failed: ${toolsResponse.status} - ${errorText}`);
      throw new Error(`Falha ao listar ferramentas: ${toolsResponse.status}`);
    }

    const toolsResult = await toolsResponse.json();
    console.log(`[MCP Discover] Tools result:`, JSON.stringify(toolsResult));

    const tools: MCPTool[] = toolsResult.result?.tools || [];

    // If mcp_connection_id provided, update the cached tools
    if (mcp_connection_id) {
      await supabase
        .from("mcp_connections")
        .update({
          available_tools: tools,
          last_sync_at: new Date().toISOString(),
        })
        .eq("id", mcp_connection_id);
    }

    const response: MCPDiscoverResponse = {
      tools,
      serverInfo: initResult.result?.serverInfo,
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[MCP Discover] Error:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Erro desconhecido",
        tools: [],
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

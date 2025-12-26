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

// Fetch with timeout to prevent hanging
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = 30000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Timeout: O servidor MCP demorou demais para responder");
    }
    throw error;
  }
}

// Result from parsing SSE response
interface ParsedSSEResult {
  data: unknown;
  sessionId?: string;
}

// Helper function to parse SSE response - handles multiple formats
async function parseSSEResponse(response: Response): Promise<ParsedSSEResult> {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  
  // Check for session ID in headers (Mcp-Session-Id or similar)
  const sessionId = response.headers.get("mcp-session-id") || 
                    response.headers.get("x-session-id") ||
                    response.headers.get("session-id");

  console.log(`[MCP Discover] Content-Type: ${contentType}`);
  console.log(`[MCP Discover] Session-ID from headers: ${sessionId}`);
  console.log(`[MCP Discover] Raw response (first 1000 chars): ${text.substring(0, 1000)}`);

  // If it's plain JSON, parse directly
  if (contentType.includes("application/json")) {
    try {
      return { data: JSON.parse(text), sessionId: sessionId || undefined };
    } catch (e) {
      console.error(`[MCP Discover] Failed to parse JSON: ${e}`);
      throw new Error("Falha ao parsear resposta JSON");
    }
  }

  // Parse SSE format: "event: message\ndata: {...}\n\n" or just "data: {...}\n"
  const lines = text.split("\n");
  let lastValidJson: unknown = null;
  let extractedSessionId = sessionId;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and event lines
    if (!trimmed || trimmed.startsWith("event:")) {
      continue;
    }

    // Extract data from "data: {...}" format
    if (trimmed.startsWith("data:")) {
      const jsonStr = trimmed.substring(5).trim();

      // Skip [DONE] markers
      if (!jsonStr || jsonStr === "[DONE]") {
        continue;
      }

      try {
        lastValidJson = JSON.parse(jsonStr);
        // Check if the response contains a session ID
        if (lastValidJson && typeof lastValidJson === "object") {
          const obj = lastValidJson as Record<string, unknown>;
          // Some servers return session in the result
          if (obj.sessionId) {
            extractedSessionId = obj.sessionId as string;
          }
          if (obj.result && typeof obj.result === "object") {
            const result = obj.result as Record<string, unknown>;
            if (result.sessionId) {
              extractedSessionId = result.sessionId as string;
            }
          }
          // If we found a valid result, return it immediately
          if (obj.result !== undefined || obj.error !== undefined) {
            return { data: lastValidJson, sessionId: extractedSessionId || undefined };
          }
        }
      } catch (e) {
        console.warn(`[MCP Discover] Failed to parse SSE data line: ${jsonStr.substring(0, 100)}`);
      }
    }
  }

  // Return last valid JSON if found
  if (lastValidJson !== null) {
    return { data: lastValidJson, sessionId: extractedSessionId || undefined };
  }

  // Fallback: try to parse the entire text as JSON
  try {
    return { data: JSON.parse(text), sessionId: extractedSessionId || undefined };
  } catch (e) {
    console.error(`[MCP Discover] Failed to parse response: ${text.substring(0, 500)}`);
    throw new Error(`Formato de resposta não suportado: ${text.substring(0, 200)}`);
  }
}

// Log to bitrix_debug_logs for debugging
// deno-lint-ignore no-explicit-any
async function logToDebug(
  supabase: any,
  level: string,
  message: string,
  details: Record<string, unknown>
) {
  try {
    await supabase.from("bitrix_debug_logs").insert({
      function_name: "mcp-client-discover",
      level,
      message,
      details,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[MCP Discover] Failed to log to debug:", e);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { mcp_connection_id, mcp_url, auth_type, auth_config } = await req.json();

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
    await logToDebug(supabase, "info", "Starting MCP discovery", { targetUrl });

    // MCP uses JSON-RPC over HTTP
    // Bitrix24 MCP requires BOTH application/json AND text/event-stream
    const requestHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      ...authHeaders,
    };

    // First, initialize the connection WITHOUT session ID
    // The server will issue one in the response headers
    console.log(`[MCP Discover] Sending initialize request...`);
    const initResponse = await fetchWithTimeout(
      targetUrl,
      {
        method: "POST",
        headers: requestHeaders,
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
      },
      30000
    );

    if (!initResponse.ok) {
      const errorText = await initResponse.text();
      console.error(`[MCP Discover] Init failed: ${initResponse.status} - ${errorText}`);
      await logToDebug(supabase, "error", "Init request failed", {
        status: initResponse.status,
        errorText,
      });
      throw new Error(`Falha ao conectar ao MCP: ${initResponse.status} - ${errorText}`);
    }

    const initParsed = await parseSSEResponse(initResponse);
    const sessionId = initParsed.sessionId;
    console.log(`[MCP Discover] Init result:`, JSON.stringify(initParsed.data));
    console.log(`[MCP Discover] Session ID from server: ${sessionId}`);
    await logToDebug(supabase, "info", "Init successful", {
      initResult: initParsed.data,
      sessionId,
    });

    // Headers for subsequent requests (include session id if server provided one)
    const sessionHeaders: Record<string, string> = {
      ...requestHeaders,
    };
    if (sessionId) {
      sessionHeaders["mcp-session-id"] = sessionId;
    }

    // Send initialized notification
    console.log(`[MCP Discover] Sending initialized notification...`);
    await fetchWithTimeout(
      targetUrl,
      {
        method: "POST",
        headers: sessionHeaders,
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
      },
      10000
    );

    // Now list the available tools
    console.log(`[MCP Discover] Requesting tools list...`);
    const toolsResponse = await fetchWithTimeout(
      targetUrl,
      {
        method: "POST",
        headers: sessionHeaders,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        }),
      },
      30000
    );

    if (!toolsResponse.ok) {
      const errorText = await toolsResponse.text();
      console.error(`[MCP Discover] Tools list failed: ${toolsResponse.status} - ${errorText}`);
      await logToDebug(supabase, "error", "Tools list failed", {
        status: toolsResponse.status,
        errorText,
      });
      throw new Error(`Falha ao listar ferramentas: ${toolsResponse.status}`);
    }

    const toolsResult = (await parseSSEResponse(toolsResponse)) as {
      result?: { tools?: MCPTool[] };
      error?: { message: string };
    };
    console.log(`[MCP Discover] Tools result:`, JSON.stringify(toolsResult));

    if (toolsResult.error) {
      throw new Error(toolsResult.error.message || "Erro ao listar ferramentas");
    }

    const tools: MCPTool[] = toolsResult.result?.tools || [];
    console.log(`[MCP Discover] Discovered ${tools.length} tools`);
    await logToDebug(supabase, "info", "Discovery complete", {
      toolCount: tools.length,
      tools: tools.map((t) => t.name),
    });

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

    const initResultTyped = initParsed.data as {
      result?: { serverInfo?: { name: string; version: string } };
    };
    const response: MCPDiscoverResponse = {
      tools,
      serverInfo: initResultTyped.result?.serverInfo,
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[MCP Discover] Error:", error);
    await logToDebug(supabase, "error", "Discovery failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });

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

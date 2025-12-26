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

interface ParsedSSEResult {
  data: unknown;
  sessionId?: string;
}

async function parseSSEResponse(response: Response): Promise<ParsedSSEResult> {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();

  const sessionId =
    response.headers.get("Mcp-Session-Id") ||
    response.headers.get("mcp-session-id") ||
    response.headers.get("x-session-id") ||
    response.headers.get("session-id");

  console.log(`[MCP Discover] Content-Type: ${contentType}`);
  console.log(`[MCP Discover] Session-ID from headers: ${sessionId}`);
  console.log(
    `[MCP Discover] Raw response (first 1000 chars): ${text.substring(0, 1000)}`
  );

  if (contentType.includes("application/json")) {
    try {
      return { data: JSON.parse(text), sessionId: sessionId || undefined };
    } catch (e) {
      console.error(`[MCP Discover] Failed to parse JSON: ${e}`);
      throw new Error("Falha ao parsear resposta JSON");
    }
  }

  const lines = text.split("\n");
  let lastValidJson: unknown = null;
  let extractedSessionId = sessionId;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("event:")) {
      continue;
    }

    if (trimmed.startsWith("data:")) {
      const jsonStr = trimmed.substring(5).trim();

      if (!jsonStr || jsonStr === "[DONE]") {
        continue;
      }

      try {
        lastValidJson = JSON.parse(jsonStr);
        if (lastValidJson && typeof lastValidJson === "object") {
          const obj = lastValidJson as Record<string, unknown>;
          if (obj.sessionId) {
            extractedSessionId = obj.sessionId as string;
          }
          if (obj.result && typeof obj.result === "object") {
            const result = obj.result as Record<string, unknown>;
            if (result.sessionId) {
              extractedSessionId = result.sessionId as string;
            }
          }
          if (obj.result !== undefined || obj.error !== undefined) {
            return { data: lastValidJson, sessionId: extractedSessionId || undefined };
          }
        }
      } catch (_e) {
        console.warn(
          `[MCP Discover] Failed to parse SSE data line: ${jsonStr.substring(0, 100)}`
        );
      }
    }
  }

  if (lastValidJson !== null) {
    return { data: lastValidJson, sessionId: extractedSessionId || undefined };
  }

  try {
    return { data: JSON.parse(text), sessionId: extractedSessionId || undefined };
  } catch (_e) {
    console.error(`[MCP Discover] Failed to parse response: ${text.substring(0, 500)}`);
    throw new Error(`Formato de resposta não suportado: ${text.substring(0, 200)}`);
  }
}

function buildSessionHeaders(
  baseHeaders: Record<string, string>,
  sessionId?: string
): Record<string, string> {
  const headers: Record<string, string> = { ...baseHeaders };
  if (sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
    headers["mcp-session-id"] = sessionId;
  }
  return headers;
}

async function initializeMcpSession(
  targetUrl: string,
  requestHeaders: Record<string, string>
): Promise<{ initData: unknown; sessionId?: string; sessionHeaders: Record<string, string> }> {
  const initBody = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      clientInfo: { name: "thoth-mcp-client", version: "1.0.0" },
    },
  };

  const doInit = (headers: Record<string, string>) =>
    fetchWithTimeout(
      targetUrl,
      {
        method: "POST",
        headers,
        body: JSON.stringify(initBody),
      },
      30000
    );

  // Attempt 1: initialize without session ID
  let initResponse = await doInit(requestHeaders);
  if (initResponse.ok) {
    const parsed = await parseSSEResponse(initResponse);
    const sessionId = parsed.sessionId;
    return {
      initData: parsed.data,
      sessionId,
      sessionHeaders: buildSessionHeaders(requestHeaders, sessionId),
    };
  }

  const errorText = await initResponse.text();
  console.error(`[MCP Discover] Init failed: ${initResponse.status} - ${errorText}`);

  // Some servers require a client-provided session id even for initialize.
  if (initResponse.status === 400 && /session id/i.test(errorText)) {
    const clientSessionId = crypto.randomUUID().replaceAll("-", "");
    console.log(
      `[MCP Discover] Retrying initialize with client session id: ${clientSessionId}`
    );

    const retryHeaders = buildSessionHeaders(requestHeaders, clientSessionId);
    initResponse = await doInit(retryHeaders);

    if (!initResponse.ok) {
      const retryErrorText = await initResponse.text();
      console.error(
        `[MCP Discover] Init retry failed: ${initResponse.status} - ${retryErrorText}`
      );
      throw new Error(
        `Falha ao conectar ao MCP: ${initResponse.status} - ${retryErrorText}`
      );
    }

    const parsed = await parseSSEResponse(initResponse);
    const sessionId = parsed.sessionId || clientSessionId;
    return {
      initData: parsed.data,
      sessionId,
      sessionHeaders: buildSessionHeaders(requestHeaders, sessionId),
    };
  }

  throw new Error(`Falha ao conectar ao MCP: ${initResponse.status} - ${errorText}`);
}

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

      if (connection.auth_type === "bearer" && connection.auth_config?.token) {
        authHeaders["Authorization"] = `Bearer ${connection.auth_config.token}`;
      } else if (connection.auth_type === "api_key" && connection.auth_config?.api_key) {
        const headerName = connection.auth_config.header_name || "X-API-Key";
        authHeaders[headerName] = connection.auth_config.api_key;
      }
    } else if (auth_type && auth_config) {
      if (auth_type === "bearer" && auth_config.token) {
        authHeaders["Authorization"] = `Bearer ${auth_config.token}`;
      } else if (auth_type === "api_key" && auth_config.api_key) {
        const headerName = auth_config.header_name || "X-API-Key";
        authHeaders[headerName] = auth_config.api_key;
      }
    }

    console.log(`[MCP Discover] Connecting to: ${targetUrl}`);
    await logToDebug(supabase, "info", "Starting MCP discovery", { targetUrl });

    const requestHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...authHeaders,
    };

    console.log(`[MCP Discover] Sending initialize request...`);
    const { initData, sessionId, sessionHeaders } = await initializeMcpSession(
      targetUrl,
      requestHeaders
    );

    console.log(`[MCP Discover] Session ID: ${sessionId || "(none)"}`);
    await logToDebug(supabase, "info", "Init successful", { initData, sessionId });

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

    const toolsParsed = await parseSSEResponse(toolsResponse);
    const toolsResult = toolsParsed.data as {
      result?: { tools?: MCPTool[] };
      error?: { message: string };
    };

    if (toolsResult.error) {
      throw new Error(toolsResult.error.message || "Erro ao listar ferramentas");
    }

    const tools: MCPTool[] = toolsResult.result?.tools || [];

    if (mcp_connection_id) {
      await supabase
        .from("mcp_connections")
        .update({
          available_tools: tools,
          last_sync_at: new Date().toISOString(),
        })
        .eq("id", mcp_connection_id);
    }

    const initResultTyped = initData as {
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

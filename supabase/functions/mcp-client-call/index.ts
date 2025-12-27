import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

  console.log(`[MCP Call] Content-Type: ${contentType}`);
  console.log(`[MCP Call] Session-ID from headers: ${sessionId}`);
  console.log(`[MCP Call] Raw response (first 500 chars): ${text.substring(0, 500)}`);

  if (contentType.includes("application/json")) {
    try {
      return { data: JSON.parse(text), sessionId: sessionId || undefined };
    } catch (e) {
      console.error(`[MCP Call] Failed to parse JSON: ${e}`);
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
        console.warn(`[MCP Call] Failed to parse SSE data line: ${jsonStr.substring(0, 100)}`);
      }
    }
  }

  if (lastValidJson !== null) {
    return { data: lastValidJson, sessionId: extractedSessionId || undefined };
  }

  try {
    return { data: JSON.parse(text), sessionId: extractedSessionId || undefined };
  } catch (_e) {
    console.error(`[MCP Call] Failed to parse response: ${text.substring(0, 500)}`);
    throw new Error(`Formato de resposta não suportado: ${text.substring(0, 200)}`);
  }
}

function buildSessionHeaders(
  baseHeaders: Record<string, string>,
  sessionId: string
): Record<string, string> {
  return {
    ...baseHeaders,
    "Mcp-Session-Id": sessionId,
    "mcp-session-id": sessionId,
  };
}

async function initializeMcpSession(
  targetUrl: string,
  requestHeaders: Record<string, string>
): Promise<{ sessionId: string; sessionHeaders: Record<string, string> }> {
  // ALWAYS generate a client session ID upfront
  const clientSessionId = crypto.randomUUID().replaceAll("-", "");
  console.log(`[MCP Call] Using client-generated session ID: ${clientSessionId}`);

  const sessionHeaders = buildSessionHeaders(requestHeaders, clientSessionId);

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

  console.log(`[MCP Call] Sending initialize with session ID...`);

  const initResponse = await fetchWithTimeout(
    targetUrl,
    {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify(initBody),
    },
    30000
  );

  if (!initResponse.ok) {
    const errorText = await initResponse.text();
    console.error(`[MCP Call] Init failed: ${initResponse.status} - ${errorText}`);
    throw new Error(`Falha na inicialização: ${initResponse.status} - ${errorText}`);
  }

  const parsed = await parseSSEResponse(initResponse);
  // Prefer server-provided session ID if available
  const finalSessionId = parsed.sessionId || clientSessionId;
  console.log(`[MCP Call] Final session ID: ${finalSessionId}`);

  return {
    sessionId: finalSessionId,
    sessionHeaders: buildSessionHeaders(requestHeaders, finalSessionId),
  };
}

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

    let authHeaders: Record<string, string> = {};
    if (connection.auth_type === "bearer" && connection.auth_config?.token) {
      authHeaders["Authorization"] = `Bearer ${connection.auth_config.token}`;
    } else if (connection.auth_type === "api_key" && connection.auth_config?.api_key) {
      const headerName = connection.auth_config.header_name || "X-API-Key";
      authHeaders[headerName] = connection.auth_config.api_key;
    }

    console.log(`[MCP Call] Calling ${tool_name} on ${connection.mcp_url}`);
    console.log(`[MCP Call] Arguments:`, JSON.stringify(toolArgs));

    const requestHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...authHeaders,
    };

    const { sessionId, sessionHeaders } = await initializeMcpSession(
      connection.mcp_url,
      requestHeaders
    );
    console.log(`[MCP Call] Session established: ${sessionId}`);

    // Send initialized notification
    await fetchWithTimeout(
      connection.mcp_url,
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

    // Call the tool
    const callResponse = await fetchWithTimeout(
      connection.mcp_url,
      {
        method: "POST",
        headers: sessionHeaders,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: tool_name,
            arguments: toolArgs || {},
          },
        }),
      },
      60000
    );

    if (!callResponse.ok) {
      const errorText = await callResponse.text();
      console.error(`[MCP Call] Tool call failed: ${callResponse.status} - ${errorText}`);
      throw new Error(`Falha ao executar ferramenta: ${callResponse.status}`);
    }

    const callParsed = await parseSSEResponse(callResponse);
    const callResult = callParsed.data as {
      result?: unknown;
      error?: { message: string };
    };

    if (callResult.error) {
      throw new Error(callResult.error.message || "Erro na execução da ferramenta");
    }

    return new Response(
      JSON.stringify({
        success: true,
        result: callResult.result,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
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

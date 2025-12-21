import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * BITRIX24-DEBUG-LOGGER
 * 
 * Central logging service for all Bitrix24 edge functions.
 * 
 * Actions:
 * - log: Write a log entry
 * - query: Query logs with filters
 * - clear: Clear logs (admin only)
 */

interface LogEntry {
  function_name: string;
  integration_id?: string;
  workspace_id?: string;
  level: 'debug' | 'info' | 'warn' | 'error' | 'api_call' | 'api_response';
  category?: string;
  message: string;
  details?: Record<string, unknown>;
  request_id?: string;
  http_method?: string;
  http_path?: string;
  http_status?: number;
  duration_ms?: number;
}

interface QueryFilters {
  function_name?: string;
  level?: string;
  category?: string;
  request_id?: string;
  integration_id?: string;
  workspace_id?: string;
  from_timestamp?: string;
  to_timestamp?: string;
  limit?: number;
  offset?: number;
}

// Helper to generate unique request ID
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json();
    const action = body.action;

    switch (action) {
      case "log": {
        // Write a single log entry
        const entry: LogEntry = body.entry;
        
        if (!entry || !entry.function_name || !entry.message) {
          return new Response(
            JSON.stringify({ error: "Missing required fields: function_name, message" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { error } = await supabase
          .from("bitrix_debug_logs")
          .insert({
            function_name: entry.function_name,
            integration_id: entry.integration_id || null,
            workspace_id: entry.workspace_id || null,
            level: entry.level || 'info',
            category: entry.category || null,
            message: entry.message,
            details: entry.details || {},
            request_id: entry.request_id || generateRequestId(),
            http_method: entry.http_method || null,
            http_path: entry.http_path || null,
            http_status: entry.http_status || null,
            duration_ms: entry.duration_ms || null,
          });

        if (error) {
          console.error("Error inserting log:", error);
          return new Response(
            JSON.stringify({ error: "Failed to insert log", details: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "log_batch": {
        // Write multiple log entries at once
        const entries: LogEntry[] = body.entries;
        
        if (!entries || !Array.isArray(entries) || entries.length === 0) {
          return new Response(
            JSON.stringify({ error: "Missing or empty entries array" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const requestId = body.request_id || generateRequestId();

        const records = entries.map(entry => ({
          function_name: entry.function_name,
          integration_id: entry.integration_id || null,
          workspace_id: entry.workspace_id || null,
          level: entry.level || 'info',
          category: entry.category || null,
          message: entry.message,
          details: entry.details || {},
          request_id: entry.request_id || requestId,
          http_method: entry.http_method || null,
          http_path: entry.http_path || null,
          http_status: entry.http_status || null,
          duration_ms: entry.duration_ms || null,
        }));

        const { error } = await supabase
          .from("bitrix_debug_logs")
          .insert(records);

        if (error) {
          console.error("Error inserting batch logs:", error);
          return new Response(
            JSON.stringify({ error: "Failed to insert logs", details: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, count: records.length, request_id: requestId }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "query": {
        // Query logs with filters
        const filters: QueryFilters = body.filters || {};
        const limit = Math.min(filters.limit || 100, 500);
        const offset = filters.offset || 0;

        let query = supabase
          .from("bitrix_debug_logs")
          .select("*")
          .order("timestamp", { ascending: false })
          .limit(limit)
          .range(offset, offset + limit - 1);

        // Apply filters
        if (filters.function_name) {
          query = query.eq("function_name", filters.function_name);
        }
        if (filters.level) {
          query = query.eq("level", filters.level);
        }
        if (filters.category) {
          query = query.eq("category", filters.category);
        }
        if (filters.request_id) {
          query = query.eq("request_id", filters.request_id);
        }
        if (filters.integration_id) {
          query = query.eq("integration_id", filters.integration_id);
        }
        if (filters.workspace_id) {
          query = query.eq("workspace_id", filters.workspace_id);
        }
        if (filters.from_timestamp) {
          query = query.gte("timestamp", filters.from_timestamp);
        }
        if (filters.to_timestamp) {
          query = query.lte("timestamp", filters.to_timestamp);
        }

        const { data, error, count } = await query;

        if (error) {
          console.error("Error querying logs:", error);
          return new Response(
            JSON.stringify({ error: "Failed to query logs", details: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ 
            logs: data || [], 
            count: data?.length || 0,
            hasMore: (data?.length || 0) === limit
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "stats": {
        // Get log statistics
        const filters: QueryFilters = body.filters || {};
        
        // Get counts by level
        let baseQuery = supabase.from("bitrix_debug_logs").select("level", { count: 'exact' });
        
        if (filters.workspace_id) {
          baseQuery = baseQuery.eq("workspace_id", filters.workspace_id);
        }
        if (filters.from_timestamp) {
          baseQuery = baseQuery.gte("timestamp", filters.from_timestamp);
        }

        // Get recent errors
        const { data: recentErrors } = await supabase
          .from("bitrix_debug_logs")
          .select("*")
          .eq("level", "error")
          .order("timestamp", { ascending: false })
          .limit(5);

        // Get function counts
        const { data: allLogs } = await supabase
          .from("bitrix_debug_logs")
          .select("function_name, level")
          .order("timestamp", { ascending: false })
          .limit(1000);

        const functionCounts: Record<string, number> = {};
        const levelCounts: Record<string, number> = { debug: 0, info: 0, warn: 0, error: 0, api_call: 0, api_response: 0 };
        
        allLogs?.forEach(log => {
          functionCounts[log.function_name] = (functionCounts[log.function_name] || 0) + 1;
          levelCounts[log.level] = (levelCounts[log.level] || 0) + 1;
        });

        return new Response(
          JSON.stringify({ 
            stats: {
              total: allLogs?.length || 0,
              byLevel: levelCounts,
              byFunction: functionCounts,
              recentErrors: recentErrors || []
            }
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "clear": {
        // Clear old logs (keep last 24 hours by default)
        const hours = body.hours || 24;
        const cutoffDate = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

        const { error, count } = await supabase
          .from("bitrix_debug_logs")
          .delete()
          .lt("timestamp", cutoffDate);

        if (error) {
          console.error("Error clearing logs:", error);
          return new Response(
            JSON.stringify({ error: "Failed to clear logs", details: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, deleted: count, cutoff: cutoffDate }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "clear_all": {
        // Clear ALL logs for a workspace
        const workspaceId = body.workspace_id;
        
        if (!workspaceId) {
          return new Response(
            JSON.stringify({ error: "workspace_id required for clear_all" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { error, count } = await supabase
          .from("bitrix_debug_logs")
          .delete()
          .eq("workspace_id", workspaceId);

        if (error) {
          console.error("Error clearing all logs:", error);
          return new Response(
            JSON.stringify({ error: "Failed to clear logs", details: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, deleted: count }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: "Unknown action. Valid actions: log, log_batch, query, stats, clear, clear_all" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (error) {
    console.error("Error in bitrix24-debug-logger:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

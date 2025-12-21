import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Parse PHP-style form data (e.g., data[MESSAGES][0][text]=hello)
function parsePhpStyleFormData(formDataString: string): Record<string, any> {
  const result: Record<string, any> = {};
  const params = new URLSearchParams(formDataString);
  
  for (const [key, value] of params.entries()) {
    const keys = key.match(/[^\[\]]+/g);
    if (!keys) continue;
    
    let current = result;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      const nextKey = keys[i + 1];
      const isNextNumeric = /^\d+$/.test(nextKey);
      
      if (!(k in current)) {
        current[k] = isNextNumeric ? [] : {};
      }
      current = current[k];
    }
    
    const lastKey = keys[keys.length - 1];
    current[lastKey] = value;
  }
  
  return result;
}

/**
 * BITRIX24-EVENTS: Função PÚBLICA para receber eventos do Bitrix24
 * 
 * Responsabilidades:
 * - Receber TODOS os eventos do Bitrix24 (ONIMCONNECTOR*, ONIMBOT*, PLACEMENT)
 * - Fazer ACK rápido (< 200ms)
 * - Enfileirar eventos na tabela bitrix_event_queue
 * - Retornar "successfully" imediatamente
 * 
 * Esta função NÃO processa os eventos, apenas enfileira para processamento assíncrono.
 */
serve(async (req) => {
  console.log("=== BITRIX24-EVENTS: FAST ACK HANDLER ===");
  console.log("Method:", req.method);
  console.log("Received at:", new Date().toISOString());

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Parse payload (form-urlencoded or JSON)
    let payload: Record<string, any> = {};
    const contentType = req.headers.get("content-type") || "";
    const bodyText = await req.text();

    if (contentType.includes("application/x-www-form-urlencoded")) {
      payload = parsePhpStyleFormData(bodyText);
    } else if (contentType.includes("application/json")) {
      try {
        payload = JSON.parse(bodyText);
      } catch {
        payload = { raw: bodyText };
      }
    } else if (bodyText) {
      // Try JSON first, then form-urlencoded
      try {
        payload = JSON.parse(bodyText);
      } catch {
        payload = parsePhpStyleFormData(bodyText);
      }
    }

    console.log("Parsed payload keys:", Object.keys(payload));
    
    const event = (payload.event || "").toUpperCase();
    console.log("Event type:", event || "NO_EVENT");

    // Events that need async processing - ENQUEUE these
    const asyncEvents = [
      "ONIMCONNECTORMESSAGEADD",      // Operator sends message → WhatsApp
      "ONIMCONNECTORMESSAGERECEIVE",  // Client message received via connector
      "ONIMBOTMESSAGEADD",            // Bot message event
      "ONIMBOTJOINOPEN",              // User started conversation with bot
      "ONIMBOTMESSAGEDELETE",         // Message deleted
      "ONIMBOTMESSAGEUPDATE",         // Message updated
      "ONAPPTEST",                    // Test event for diagnostics
    ];

    // PLACEMENT calls - Handle synchronously (need immediate UI response)
    if (payload.PLACEMENT || payload.PLACEMENT_OPTIONS) {
      console.log("=== PLACEMENT CALL - Sync handling ===");
      console.log("PLACEMENT:", payload.PLACEMENT);
      
      // Enqueue for processing but return immediately
      await supabase.from("bitrix_event_queue").insert({
        event_type: "PLACEMENT",
        payload: payload,
        status: "pending"
      });
      
      // Trigger async worker
      triggerWorker(supabaseUrl, supabaseServiceKey);
      
      // CRITICAL: Return "successfully" for Bitrix24
      return new Response("successfully", {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" }
      });
    }

    // Bitrix24 Events - Fast ACK + Enqueue
    if (event && asyncEvents.includes(event)) {
      console.log(`=== ENQUEUING EVENT: ${event} ===`);
      
      // Quick insert to queue
      const { data: insertedEvent, error: insertError } = await supabase
        .from("bitrix_event_queue")
        .insert({
          event_type: event,
          payload: payload,
          status: "pending"
        })
        .select("id")
        .single();

      if (insertError) {
        console.error("Error enqueuing event:", insertError);
        // Still return success to Bitrix24 - don't let DB errors affect ACK
      } else {
        console.log("Event enqueued with ID:", insertedEvent?.id);
        
        // Trigger async worker (fire and forget)
        triggerWorker(supabaseUrl, supabaseServiceKey, insertedEvent?.id);
      }

      // CRITICAL: Fast ACK to Bitrix24 (< 200ms)
      return new Response("successfully", {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" }
      });
    }

    // Health check / unknown events
    if (!event) {
      console.log("No event type - health check or unknown request");
      return new Response(JSON.stringify({ 
        status: "ok", 
        message: "bitrix24-events handler ready",
        timestamp: new Date().toISOString()
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Unknown event - log and ACK anyway
    console.log(`Unknown event type: ${event} - ACKing anyway`);
    return new Response("successfully", {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" }
    });

  } catch (error) {
    console.error("Error in bitrix24-events:", error);
    // CRITICAL: Even on error, return success to Bitrix24
    // We don't want Bitrix24 to retry and flood us
    return new Response("successfully", {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" }
    });
  }
});

/**
 * Trigger the worker function asynchronously (fire and forget)
 * Uses EdgeRuntime.waitUntil to not block the response
 */
function triggerWorker(supabaseUrl: string, supabaseServiceKey: string, eventId?: string) {
  const workerUrl = `${supabaseUrl}/functions/v1/bitrix24-worker`;
  
  console.log("=== TRIGGERING WORKER ===");
  console.log("Worker URL:", workerUrl);
  console.log("Event ID:", eventId);
  console.log("Service key available:", !!supabaseServiceKey);
  
  const workerPromise = fetch(workerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${supabaseServiceKey}`,
    },
    body: JSON.stringify({ 
      event_id: eventId,
      triggered_at: new Date().toISOString(),
      source: "bitrix24-events"
    })
  }).then(async (res) => {
    const responseText = await res.text();
    console.log("Worker response status:", res.status);
    console.log("Worker response body:", responseText.substring(0, 500));
    return res;
  }).catch(err => {
    console.error("Error triggering worker:", err.message || err);
  });

  // Use EdgeRuntime.waitUntil if available (Deno Deploy / Supabase Edge)
  // This ensures the promise runs to completion even after response is sent
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
    console.log("Using EdgeRuntime.waitUntil for background processing");
    EdgeRuntime.waitUntil(workerPromise);
  } else {
    console.log("EdgeRuntime.waitUntil not available, worker will run inline");
    // Fallback: don't await, just let it run
    // The promise will continue executing after response is sent
  }
}

// Declare EdgeRuntime for TypeScript (Supabase Edge Functions)
declare const EdgeRuntime: {
  waitUntil?: (promise: Promise<any>) => void;
} | undefined;

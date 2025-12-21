import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  // Allow iframe embedding from Bitrix24 domains
  "Content-Security-Policy": "frame-ancestors 'self' *.bitrix24.com *.bitrix24.ru *.bitrix24.eu *.bitrix24.ua *.bitrix24.by *.bitrix24.kz *.bitrix24.fr *.bitrix24.de *.bitrix24.es *.bitrix24.it *.bitrix24.pl *.bitrix24.tr *.bitrix24.br *.bitrix24.mx *.bitrix24.com.br",
};

// Generate unique request ID for tracking
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

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
  const requestId = generateRequestId();
  const startTime = Date.now();
  
  // ============ COMPREHENSIVE LOGGING ============
  console.log("==========================================================");
  console.log("=== BITRIX24-EVENTS: INCOMING REQUEST ===");
  console.log("Request ID:", requestId);
  console.log("Timestamp:", new Date().toISOString());
  console.log("Method:", req.method);
  console.log("URL:", req.url);
  
  // Log essential headers
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });
  console.log("Content-Type:", headers["content-type"] || "none");
  console.log("User-Agent:", headers["user-agent"] || "none");
  console.log("Origin:", headers["origin"] || "none");
  console.log("Referer:", headers["referer"] || "none");
  console.log("X-Forwarded-For:", headers["x-forwarded-for"] || "none");

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    console.log(">>> CORS preflight request - returning 200");
    return new Response(null, { headers: corsHeaders });
  }

  // Handle GET requests (health check / verification)
  if (req.method === "GET") {
    console.log(">>> GET request - returning health check");
    return new Response(JSON.stringify({ 
      status: "ok", 
      message: "bitrix24-events handler is active and ready to receive events",
      request_id: requestId,
      timestamp: new Date().toISOString(),
      info: "POST Bitrix24 events to this endpoint"
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Parse payload (form-urlencoded or JSON)
    let payload: Record<string, any> = {};
    const contentType = headers["content-type"] || "";
    const bodyText = await req.text();
    
    // Log raw body (first 2000 chars for debugging)
    console.log("=== RAW BODY (first 2000 chars) ===");
    console.log(bodyText.substring(0, 2000));
    console.log("Body length:", bodyText.length);

    if (contentType.includes("application/x-www-form-urlencoded")) {
      console.log(">>> Parsing as form-urlencoded");
      payload = parsePhpStyleFormData(bodyText);
    } else if (contentType.includes("application/json")) {
      console.log(">>> Parsing as JSON");
      try {
        payload = JSON.parse(bodyText);
      } catch {
        console.log(">>> JSON parse failed, storing as raw");
        payload = { raw: bodyText };
      }
    } else if (bodyText) {
      // Try JSON first, then form-urlencoded
      console.log(">>> Unknown content type, trying JSON first");
      try {
        payload = JSON.parse(bodyText);
      } catch {
        console.log(">>> JSON failed, trying form-urlencoded");
        payload = parsePhpStyleFormData(bodyText);
      }
    }

    console.log("=== PARSED PAYLOAD ===");
    console.log("Payload keys:", Object.keys(payload));
    console.log("Full payload (first 3000 chars):", JSON.stringify(payload).substring(0, 3000));
    
    const event = (payload.event || payload.EVENT || "").toUpperCase();
    console.log("Event type:", event || "NO_EVENT");
    console.log("PLACEMENT:", payload.PLACEMENT || "none");
    console.log("PLACEMENT_OPTIONS:", payload.PLACEMENT_OPTIONS || "none");
    console.log("member_id:", payload.auth?.member_id || payload.member_id || "none");
    console.log("domain:", payload.auth?.domain || payload.DOMAIN || "none");

    // Events that need async processing - ENQUEUE these
    const asyncEvents = [
      "ONIMCONNECTORMESSAGEADD",      // Operator sends message → WhatsApp
      "ONIMCONNECTORMESSAGERECEIVE",  // Client message received via connector
      "ONIMCONNECTORDIALOGSTART",     // Dialog started
      "ONIMCONNECTORDIALOGFINISH",    // Dialog finished
      "ONIMCONNECTORSTATUSDELETE",    // Connector status deleted
      "ONIMCONNECTORSTATUSCHANGE",    // Connector status changed
      "ONIMBOTMESSAGEADD",            // Bot message event
      "ONIMBOTJOINOPEN",              // User started conversation with bot
      "ONIMBOTMESSAGEDELETE",         // Message deleted
      "ONIMBOTMESSAGEUPDATE",         // Message updated
      "ONAPPTEST",                    // Test event for diagnostics
      "ONAPPINSTALL",                 // App installed
      "ONAPPUPDATE",                  // App updated
    ];

    // PLACEMENT calls - Handle synchronously (need immediate UI response)
    if (payload.PLACEMENT || payload.PLACEMENT_OPTIONS) {
      console.log("=== PLACEMENT CALL DETECTED ===");
      console.log("PLACEMENT:", payload.PLACEMENT);
      console.log("PLACEMENT_OPTIONS:", payload.PLACEMENT_OPTIONS);
      
      // Enqueue for processing but return immediately
      const { data: insertedPlacement, error: placementError } = await supabase
        .from("bitrix_event_queue")
        .insert({
          event_type: "PLACEMENT",
          payload: payload,
          status: "pending"
        })
        .select("id")
        .single();
      
      if (placementError) {
        console.error("Error enqueuing PLACEMENT:", placementError);
      } else {
        console.log("PLACEMENT enqueued with ID:", insertedPlacement?.id);
        // Trigger async worker
        triggerWorker(supabaseUrl, supabaseServiceKey, insertedPlacement?.id);
      }
      
      const duration = Date.now() - startTime;
      console.log(`>>> Returning 'successfully' for PLACEMENT (${duration}ms)`);
      console.log("==========================================================");
      
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

      const duration = Date.now() - startTime;
      console.log(`>>> Returning 'successfully' for ${event} (${duration}ms)`);
      console.log("==========================================================");

      // CRITICAL: Fast ACK to Bitrix24 (< 200ms)
      return new Response("successfully", {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" }
      });
    }

    // Handle unknown events - still enqueue for investigation
    if (event) {
      console.log(`=== UNKNOWN EVENT: ${event} - Enqueuing for investigation ===`);
      
      const { error: unknownError } = await supabase
        .from("bitrix_event_queue")
        .insert({
          event_type: `UNKNOWN_${event}`,
          payload: payload,
          status: "pending"
        });
      
      if (unknownError) {
        console.error("Error enqueuing unknown event:", unknownError);
      }
      
      const duration = Date.now() - startTime;
      console.log(`>>> Returning 'successfully' for unknown event ${event} (${duration}ms)`);
      console.log("==========================================================");
      
      return new Response("successfully", {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" }
      });
    }

    // No event type - could be health check, webhook verification, or unknown request
    // Log everything for debugging
    console.log("=== NO EVENT TYPE - Logging for investigation ===");
    
    // Store in queue for debugging if there's any meaningful payload
    if (bodyText && bodyText.length > 2) {
      const { error: noEventError } = await supabase
        .from("bitrix_event_queue")
        .insert({
          event_type: "DEBUG_NO_EVENT",
          payload: { 
            raw_body: bodyText.substring(0, 10000),
            parsed: payload,
            headers: headers,
            url: req.url,
            method: req.method
          },
          status: "pending"
        });
      
      if (noEventError) {
        console.error("Error logging no-event request:", noEventError);
      } else {
        console.log("No-event request logged for debugging");
      }
    }

    const duration = Date.now() - startTime;
    console.log(`>>> Returning health check response (${duration}ms)`);
    console.log("==========================================================");
    
    return new Response(JSON.stringify({ 
      status: "ok", 
      message: "bitrix24-events handler ready",
      request_id: requestId,
      timestamp: new Date().toISOString(),
      note: "No event type detected in this request"
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("=== ERROR in bitrix24-events ===");
    console.error("Error:", error);
    console.error(`Duration: ${duration}ms`);
    console.log("==========================================================");
    
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
    console.log("Worker response (first 500 chars):", responseText.substring(0, 500));
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
  }
}

// Declare EdgeRuntime for TypeScript (Supabase Edge Functions)
declare const EdgeRuntime: {
  waitUntil?: (promise: Promise<any>) => void;
} | undefined;

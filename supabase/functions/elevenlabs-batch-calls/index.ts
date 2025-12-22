import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface BatchCallRequest {
  action: "create_batch" | "get_batch_status" | "cancel_batch" | "list_batches" | "import_recipients" | "start_batch";
  workspace_id: string;
  batch_id?: string;
  
  // For create_batch
  name?: string;
  description?: string;
  persona_id?: string;
  telephony_number_id?: string;
  scheduled_time?: string | null;
  recipients?: Array<{
    phone_number: string;
    name?: string;
    dynamic_variables?: Record<string, any>;
    first_message?: string;
  }>;
}

interface ElevenLabsRecipient {
  phone_number: string;
  prompt_variables?: Record<string, any>;
  first_message?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!ELEVENLABS_API_KEY) {
      throw new Error("ELEVENLABS_API_KEY not configured");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const body: BatchCallRequest = await req.json();
    const { action, workspace_id, batch_id } = body;

    console.log(`[elevenlabs-batch-calls] Action: ${action}, Workspace: ${workspace_id}`);

    switch (action) {
      case "list_batches": {
        const { data, error } = await supabase
          .from("batch_calls")
          .select(`
            *,
            persona:personas(id, name, avatar_url, elevenlabs_agent_id),
            telephony_number:telephony_numbers(id, phone_number, friendly_name)
          `)
          .eq("workspace_id", workspace_id)
          .order("created_at", { ascending: false });

        if (error) throw error;

        return new Response(JSON.stringify({ success: true, batches: data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "create_batch": {
        const { name, description, persona_id, telephony_number_id, scheduled_time, recipients } = body;

        if (!name || !persona_id || !telephony_number_id) {
          throw new Error("name, persona_id, and telephony_number_id are required");
        }

        // Create batch record
        const { data: batch, error: batchError } = await supabase
          .from("batch_calls")
          .insert({
            workspace_id,
            name,
            description,
            persona_id,
            telephony_number_id,
            scheduled_time: scheduled_time || null,
            total_recipients: recipients?.length || 0,
            status: "draft",
          })
          .select()
          .single();

        if (batchError) throw batchError;

        // Insert recipients if provided
        if (recipients && recipients.length > 0) {
          const recipientRecords = recipients.map((r) => ({
            batch_id: batch.id,
            phone_number: r.phone_number,
            name: r.name || null,
            dynamic_variables: r.dynamic_variables || {},
            first_message_override: r.first_message || null,
            status: "pending",
          }));

          const { error: recipientsError } = await supabase
            .from("batch_call_recipients")
            .insert(recipientRecords);

          if (recipientsError) throw recipientsError;
        }

        console.log(`[elevenlabs-batch-calls] Batch created: ${batch.id}`);

        return new Response(JSON.stringify({ success: true, batch }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "import_recipients": {
        if (!batch_id) throw new Error("batch_id is required");

        const { recipients } = body;
        if (!recipients || recipients.length === 0) {
          throw new Error("recipients array is required");
        }

        const recipientRecords = recipients.map((r) => ({
          batch_id,
          phone_number: r.phone_number,
          name: r.name || null,
          dynamic_variables: r.dynamic_variables || {},
          first_message_override: r.first_message || null,
          status: "pending",
        }));

        const { error: recipientsError } = await supabase
          .from("batch_call_recipients")
          .insert(recipientRecords);

        if (recipientsError) throw recipientsError;

        // Update total count
        const { count } = await supabase
          .from("batch_call_recipients")
          .select("*", { count: "exact", head: true })
          .eq("batch_id", batch_id);

        await supabase
          .from("batch_calls")
          .update({ total_recipients: count || 0 })
          .eq("id", batch_id);

        return new Response(JSON.stringify({ success: true, imported: recipients.length }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "start_batch": {
        if (!batch_id) throw new Error("batch_id is required");

        // Get batch with persona and telephony number
        const { data: batch, error: batchError } = await supabase
          .from("batch_calls")
          .select(`
            *,
            persona:personas(id, name, elevenlabs_agent_id),
            telephony_number:telephony_numbers(id, phone_number, provider_number_id)
          `)
          .eq("id", batch_id)
          .single();

        if (batchError) throw batchError;

        if (!batch.persona?.elevenlabs_agent_id) {
          throw new Error("Persona does not have an ElevenLabs agent configured");
        }

        // Get all pending recipients
        const { data: recipients, error: recipientsError } = await supabase
          .from("batch_call_recipients")
          .select("*")
          .eq("batch_id", batch_id)
          .eq("status", "pending");

        if (recipientsError) throw recipientsError;

        if (!recipients || recipients.length === 0) {
          throw new Error("No pending recipients found");
        }

        // Prepare ElevenLabs batch call request
        const elevenLabsRecipients: ElevenLabsRecipient[] = recipients.map((r) => ({
          phone_number: r.phone_number,
          prompt_variables: r.dynamic_variables || {},
          first_message: r.first_message_override || undefined,
        }));

        // Call ElevenLabs Batch Calling API
        const response = await fetch("https://api.elevenlabs.io/v1/convai/batch-calling", {
          method: "POST",
          headers: {
            "xi-api-key": ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            agent_id: batch.persona.elevenlabs_agent_id,
            recipients: elevenLabsRecipients,
            outbound_number: batch.telephony_number?.phone_number,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[elevenlabs-batch-calls] ElevenLabs API error: ${errorText}`);
          throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
        }

        const elevenLabsResult = await response.json();
        console.log(`[elevenlabs-batch-calls] ElevenLabs batch created:`, elevenLabsResult);

        // Update batch with ElevenLabs batch ID
        await supabase
          .from("batch_calls")
          .update({
            elevenlabs_batch_id: elevenLabsResult.batch_id || elevenLabsResult.id,
            status: "in_progress",
            started_at: new Date().toISOString(),
          })
          .eq("id", batch_id);

        // Update recipients status
        await supabase
          .from("batch_call_recipients")
          .update({ status: "in_progress" })
          .eq("batch_id", batch_id)
          .eq("status", "pending");

        return new Response(JSON.stringify({ 
          success: true, 
          elevenlabs_batch_id: elevenLabsResult.batch_id || elevenLabsResult.id,
          recipients_count: recipients.length 
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "get_batch_status": {
        if (!batch_id) throw new Error("batch_id is required");

        // Get batch from database
        const { data: batch, error: batchError } = await supabase
          .from("batch_calls")
          .select(`
            *,
            persona:personas(id, name, avatar_url),
            telephony_number:telephony_numbers(id, phone_number, friendly_name)
          `)
          .eq("id", batch_id)
          .single();

        if (batchError) throw batchError;

        // Get recipients
        const { data: recipients, error: recipientsError } = await supabase
          .from("batch_call_recipients")
          .select("*")
          .eq("batch_id", batch_id)
          .order("created_at", { ascending: true });

        if (recipientsError) throw recipientsError;

        // If batch has ElevenLabs ID, fetch status from API
        let elevenLabsStatus = null;
        if (batch.elevenlabs_batch_id) {
          try {
            const response = await fetch(
              `https://api.elevenlabs.io/v1/convai/batch-calling/${batch.elevenlabs_batch_id}`,
              {
                headers: {
                  "xi-api-key": ELEVENLABS_API_KEY,
                },
              }
            );

            if (response.ok) {
              elevenLabsStatus = await response.json();
              console.log(`[elevenlabs-batch-calls] ElevenLabs status:`, elevenLabsStatus);

              // Update local stats based on ElevenLabs status
              if (elevenLabsStatus.status) {
                const newStatus = elevenLabsStatus.status === "completed" ? "completed" : 
                                  elevenLabsStatus.status === "failed" ? "failed" : 
                                  batch.status;
                
                await supabase
                  .from("batch_calls")
                  .update({
                    status: newStatus,
                    calls_completed: elevenLabsStatus.completed_count || batch.calls_completed,
                    calls_failed: elevenLabsStatus.failed_count || batch.calls_failed,
                    calls_dispatched: elevenLabsStatus.dispatched_count || batch.calls_dispatched,
                    completed_at: newStatus === "completed" ? new Date().toISOString() : null,
                  })
                  .eq("id", batch_id);
              }
            }
          } catch (error) {
            console.error(`[elevenlabs-batch-calls] Error fetching ElevenLabs status:`, error);
          }
        }

        return new Response(JSON.stringify({ 
          success: true, 
          batch, 
          recipients,
          elevenlabs_status: elevenLabsStatus 
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "cancel_batch": {
        if (!batch_id) throw new Error("batch_id is required");

        // Get batch
        const { data: batch, error: batchError } = await supabase
          .from("batch_calls")
          .select("*")
          .eq("id", batch_id)
          .single();

        if (batchError) throw batchError;

        // Cancel in ElevenLabs if active
        if (batch.elevenlabs_batch_id && batch.status === "in_progress") {
          try {
            await fetch(
              `https://api.elevenlabs.io/v1/convai/batch-calling/${batch.elevenlabs_batch_id}`,
              {
                method: "DELETE",
                headers: {
                  "xi-api-key": ELEVENLABS_API_KEY,
                },
              }
            );
          } catch (error) {
            console.error(`[elevenlabs-batch-calls] Error cancelling in ElevenLabs:`, error);
          }
        }

        // Update local status
        await supabase
          .from("batch_calls")
          .update({
            status: "cancelled",
            completed_at: new Date().toISOString(),
          })
          .eq("id", batch_id);

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[elevenlabs-batch-calls] Error:", errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode, decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ElevenLabsWebhookPayload {
  type: string;
  conversation_id: string;
  agent_id: string;
  data?: {
    transcript?: string;
    summary?: string;
    sentiment?: string;
    call_duration_secs?: number;
    call_successful?: boolean;
    metadata?: Record<string, any>;
    messages?: Array<{
      role: string;
      message: string;
      timestamp?: number;
    }>;
    // Transfer data
    transfer_destination?: {
      type: "phone" | "sip_uri";
      phone_number?: string;
      sip_uri?: string;
    };
    transfer_type?: "conference" | "sip_refer" | "warm";
    transfer_reason?: string;
    // Audio data
    recording_url?: string;
    audio_base64?: string;
    audio_format?: string;
  };
  call_details?: {
    phone_number?: string;
    caller_id?: string;
    direction?: string;
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Get raw body for signature validation
    const rawBody = await req.text();
    
    // Validate webhook signature if secret is configured
    const webhookSecret = Deno.env.get("ELEVENLABS_WEBHOOK_SECRET");
    if (webhookSecret) {
      const signature = req.headers.get("X-ElevenLabs-Signature") || 
                        req.headers.get("x-elevenlabs-signature");
      
      if (!signature) {
        console.error("Missing webhook signature header");
        return new Response(JSON.stringify({ error: "Missing signature" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Calculate expected HMAC-SHA256 signature
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(webhookSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const signatureBuffer = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(rawBody)
      );
      const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");

      if (signature !== expectedSignature) {
        console.error("Invalid webhook signature - request rejected");
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.log("Webhook signature validated successfully");
    }

    // Parse the body from raw text
    const payload: ElevenLabsWebhookPayload = JSON.parse(rawBody);
    console.log("ElevenLabs webhook received:", payload.type, payload.conversation_id);

    const { type, conversation_id, agent_id, data, call_details } = payload;

    switch (type) {
      case "call.started": {
        // Find workspace by agent_id (stored in personas.elevenlabs_agent_id)
        const { data: personas } = await supabase
          .from("personas")
          .select("id, workspace_id, name")
          .eq("elevenlabs_agent_id", agent_id)
          .eq("is_active", true)
          .limit(1);

        const persona = personas?.[0];
        const workspaceId = persona?.workspace_id;

        if (!workspaceId) {
          console.error("No workspace found for agent:", agent_id);
          return new Response(JSON.stringify({ error: "Workspace not found" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Create call record
        const { data: call, error: callError } = await supabase
          .from("calls")
          .insert({
            workspace_id: workspaceId,
            persona_id: persona?.id,
            elevenlabs_conversation_id: conversation_id,
            elevenlabs_agent_id: agent_id,
            phone_number: call_details?.phone_number,
            caller_name: call_details?.caller_id,
            direction: call_details?.direction || "inbound",
            status: "active",
            started_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (callError) {
          console.error("Error creating call:", callError);
          throw callError;
        }

        console.log("Call started:", call.id);

        // Create initial event
        await supabase.from("call_events").insert({
          call_id: call.id,
          event_type: "call_started",
          role: "system",
          content: "Chamada iniciada",
        });

        return new Response(JSON.stringify({ success: true, call_id: call.id }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "transcript": {
        // Find the call by conversation_id
        const { data: call } = await supabase
          .from("calls")
          .select("id")
          .eq("elevenlabs_conversation_id", conversation_id)
          .single();

        if (!call) {
          console.error("Call not found for conversation:", conversation_id);
          return new Response(JSON.stringify({ error: "Call not found" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Store transcript events
        if (data?.messages) {
          const events = data.messages.map((msg) => ({
            call_id: call.id,
            event_type: "transcript",
            role: msg.role === "user" ? "user" : "assistant",
            content: msg.message,
            timestamp: msg.timestamp ? new Date(msg.timestamp).toISOString() : new Date().toISOString(),
          }));

          await supabase.from("call_events").insert(events);
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "call.ended": {
        // Find the call
        const { data: call } = await supabase
          .from("calls")
          .select("id, workspace_id")
          .eq("elevenlabs_conversation_id", conversation_id)
          .single();

        if (!call) {
          console.error("Call not found for conversation:", conversation_id);
          return new Response(JSON.stringify({ error: "Call not found" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Update call with final data
        const { error: updateError } = await supabase
          .from("calls")
          .update({
            status: data?.call_successful ? "completed" : "failed",
            ended_at: new Date().toISOString(),
            duration_seconds: data?.call_duration_secs,
            transcript: data?.transcript,
            summary: data?.summary,
            sentiment: data?.sentiment,
          })
          .eq("id", call.id);

        if (updateError) {
          console.error("Error updating call:", updateError);
          throw updateError;
        }

        // Create end event
        await supabase.from("call_events").insert({
          call_id: call.id,
          event_type: "call_ended",
          role: "system",
          content: `Chamada encerrada - ${data?.call_successful ? "Sucesso" : "Falha"}`,
          metadata: {
            duration_seconds: data?.call_duration_secs,
            sentiment: data?.sentiment,
          },
        });

        // Try to create Bitrix24 activity
        await createBitrixActivity(supabase, call.id, call.workspace_id, data);

        console.log("Call ended:", call.id);

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "post_call_audio": {
        console.log("Processing post_call_audio event for conversation:", conversation_id);

        // Find the call
        const { data: call } = await supabase
          .from("calls")
          .select("id, workspace_id, phone_number, bitrix_activity_id")
          .eq("elevenlabs_conversation_id", conversation_id)
          .single();

        if (!call) {
          console.error("Call not found for conversation:", conversation_id);
          return new Response(JSON.stringify({ error: "Call not found" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        let recordingUrl: string | null = null;

        // If ElevenLabs provides a recording URL directly, use it
        if (data?.recording_url) {
          recordingUrl = data.recording_url;
          console.log("Using provided recording URL:", recordingUrl);
        }
        // If base64 audio is provided, upload to storage
        else if (data?.audio_base64) {
          try {
            console.log("Uploading audio to storage...");
            
            // Decode base64 audio
            const audioBytes = base64Decode(data.audio_base64);
            const audioFormat = data.audio_format || "mp3";
            const fileName = `${call.id}.${audioFormat}`;
            
            // Upload to Supabase Storage
            const { data: uploadData, error: uploadError } = await supabase.storage
              .from("call-recordings")
              .upload(fileName, audioBytes, {
                contentType: `audio/${audioFormat}`,
                upsert: true,
              });

            if (uploadError) {
              console.error("Error uploading audio:", uploadError);
              throw uploadError;
            }

            // Get public URL
            const { data: publicUrlData } = supabase.storage
              .from("call-recordings")
              .getPublicUrl(fileName);

            recordingUrl = publicUrlData.publicUrl;
            console.log("Audio uploaded successfully:", recordingUrl);
          } catch (uploadErr) {
            console.error("Failed to upload audio:", uploadErr);
          }
        }

        // Update call with recording URL
        if (recordingUrl) {
          const { error: updateError } = await supabase
            .from("calls")
            .update({ recording_url: recordingUrl })
            .eq("id", call.id);

          if (updateError) {
            console.error("Error updating call with recording URL:", updateError);
          }

          // Create event for recording
          await supabase.from("call_events").insert({
            call_id: call.id,
            event_type: "recording_available",
            role: "system",
            content: "Gravação da chamada disponível",
            metadata: { recording_url: recordingUrl },
          });

          // Send recording to Bitrix24
          await attachRecordingToBitrix(supabase, call, recordingUrl);
        }

        return new Response(JSON.stringify({ success: true, recording_url: recordingUrl }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "human_takeover":
      case "transfer": {
        // Find the call with workspace info
        const { data: call } = await supabase
          .from("calls")
          .select("id, workspace_id, phone_number, summary, transcript")
          .eq("elevenlabs_conversation_id", conversation_id)
          .single();

        if (call) {
          const transferDestination = data?.transfer_destination;
          const transferType = data?.transfer_type || "conference";
          const transferReason = data?.transfer_reason || "Solicitação de atendente humano";

          await supabase
            .from("calls")
            .update({
              human_takeover: true,
              human_takeover_at: new Date().toISOString(),
              metadata: {
                transfer_destination: transferDestination,
                transfer_type: transferType,
                transfer_reason: transferReason,
              },
            })
            .eq("id", call.id);

          await supabase.from("call_events").insert({
            call_id: call.id,
            event_type: "human_takeover",
            role: "system",
            content: `Chamada transferida: ${transferReason}`,
            metadata: {
              destination: transferDestination,
              transfer_type: transferType,
            },
          });

          // Register transfer in Bitrix24 if configured
          await registerBitrixTransfer(supabase, call, transferDestination, transferReason);
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      default:
        console.log("Unknown event type:", type);
        return new Response(JSON.stringify({ received: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
  } catch (error) {
    console.error("Error processing webhook:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

async function createBitrixActivity(
  supabase: any,
  callId: string,
  workspaceId: string,
  callData: any
) {
  try {
    // Check if Bitrix24 integration is configured
    const { data: integration } = await supabase
      .from("integrations")
      .select("id, config")
      .eq("workspace_id", workspaceId)
      .eq("type", "bitrix24")
      .eq("is_active", true)
      .single();

    if (!integration?.config?.access_token || !integration?.config?.domain) {
      console.log("No active Bitrix24 integration for workspace:", workspaceId);
      return;
    }

    // Get call details
    const { data: call } = await supabase
      .from("calls")
      .select("*")
      .eq("id", callId)
      .single();

    if (!call) return;

    const { domain, access_token } = integration.config;

    // Register external call in Bitrix24 telephony
    const registerData = {
      PHONE_NUMBER: call.phone_number || "Desconhecido",
      TYPE: call.direction === "inbound" ? 2 : 1, // 1 = outgoing, 2 = incoming
      LINE_NUMBER: "ThothAI",
      SHOW: 0, // Don't show call card
      CRM_CREATE: 1, // Create contact/lead if not exists
    };

    console.log("Registering call in Bitrix24 telephony:", registerData);

    const registerResponse = await fetch(
      `https://${domain}/rest/telephony.externalcall.register?auth=${access_token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registerData),
      }
    );

    const registerResult = await registerResponse.json();
    console.log("Bitrix24 register result:", registerResult);

    if (registerResult.result?.CALL_ID) {
      const bitrixCallId = registerResult.result.CALL_ID;

      // Finish the call with summary
      const finishData = {
        CALL_ID: bitrixCallId,
        USER_ID: 1, // Default user
        DURATION: callData?.call_duration_secs || 0,
        STATUS_CODE: callData?.call_successful ? 200 : 304, // 200 = success, 304 = missed
        ADD_TO_CHAT: 0,
      };

      console.log("Finishing call in Bitrix24:", finishData);

      const finishResponse = await fetch(
        `https://${domain}/rest/telephony.externalcall.finish?auth=${access_token}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(finishData),
        }
      );

      const finishResult = await finishResponse.json();
      console.log("Bitrix24 finish result:", finishResult);

      // Attach transcription if available
      if (callData?.transcript) {
        const transcriptionData = {
          CALL_ID: bitrixCallId,
          MESSAGES: [
            {
              SIDE: "Client",
              START_TIME: 0,
              STOP_TIME: callData?.call_duration_secs || 0,
              MESSAGE: `[Resumo IA]\n${callData?.summary || "Sem resumo"}\n\n[Sentimento: ${callData?.sentiment || "Neutro"}]\n\n[Transcrição]\n${callData.transcript}`,
            },
          ],
        };

        await fetch(
          `https://${domain}/rest/telephony.externalCall.attachTranscription?auth=${access_token}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(transcriptionData),
          }
        );
        console.log("Transcription attached to Bitrix24 call");
      }

      // Update call with Bitrix activity ID
      await supabase
        .from("calls")
        .update({ bitrix_activity_id: bitrixCallId })
        .eq("id", callId);

      console.log("Bitrix24 call activity created:", bitrixCallId);
    } else {
      console.error("Error registering Bitrix24 call:", registerResult);
    }
  } catch (error) {
    console.error("Error creating Bitrix24 activity:", error);
  }
}

// Attach recording to Bitrix24 call
async function attachRecordingToBitrix(
  supabase: any,
  call: any,
  recordingUrl: string
) {
  try {
    if (!call.workspace_id) return;

    // Check if Bitrix24 integration is configured
    const { data: integration } = await supabase
      .from("integrations")
      .select("id, config")
      .eq("workspace_id", call.workspace_id)
      .eq("type", "bitrix24")
      .eq("is_active", true)
      .single();

    if (!integration?.config?.access_token || !integration?.config?.domain) {
      console.log("No active Bitrix24 integration for recording attachment");
      return;
    }

    const { domain, access_token } = integration.config;
    const bitrixCallId = call.bitrix_activity_id;

    if (!bitrixCallId) {
      console.log("No Bitrix24 call ID found, skipping recording attachment");
      return;
    }

    // Attach recording to the call
    const attachData = {
      CALL_ID: bitrixCallId,
      FILENAME: `call_${call.id}.mp3`,
      RECORD_URL: recordingUrl,
    };

    console.log("Attaching recording to Bitrix24:", attachData);

    const attachResponse = await fetch(
      `https://${domain}/rest/telephony.externalCall.attachRecord?auth=${access_token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attachData),
      }
    );

    const attachResult = await attachResponse.json();
    
    if (attachResult.result) {
      console.log("Recording attached to Bitrix24 successfully");
    } else {
      console.error("Error attaching recording to Bitrix24:", attachResult);
    }
  } catch (error) {
    console.error("Error attaching recording to Bitrix24:", error);
  }
}

// Register transfer in Bitrix24 telephony
async function registerBitrixTransfer(
  supabase: any,
  call: any,
  transferDestination: any,
  transferReason: string
) {
  try {
    if (!call.workspace_id) return;

    // Check if Bitrix24 integration is configured
    const { data: integration } = await supabase
      .from("integrations")
      .select("id, config")
      .eq("workspace_id", call.workspace_id)
      .eq("type", "bitrix24")
      .eq("is_active", true)
      .single();

    if (!integration?.config?.access_token || !integration?.config?.domain) {
      console.log("No active Bitrix24 integration for transfer registration");
      return;
    }

    const { domain, access_token } = integration.config;

    // Register the external call start in Bitrix24
    // This shows a call card to the operator receiving the transfer
    const registerData = {
      PHONE_NUMBER: call.phone_number || "Desconhecido",
      TYPE: 2, // Incoming
      LINE_NUMBER: "ThothAI",
      SHOW: 1, // Show call card
      CRM_CREATE: 1, // Create contact/lead if not exists
    };

    console.log("Registering transfer in Bitrix24:", registerData);

    const registerResponse = await fetch(
      `https://${domain}/rest/telephony.externalcall.register?auth=${access_token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registerData),
      }
    );

    const registerResult = await registerResponse.json();

    if (registerResult.result?.CALL_ID) {
      console.log("Bitrix24 external call registered:", registerResult.result.CALL_ID);

      // Attach transcription if available
      if (call.transcript) {
        await fetch(
          `https://${domain}/rest/telephony.externalCall.attachTranscription?auth=${access_token}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              CALL_ID: registerResult.result.CALL_ID,
              MESSAGES: [
                {
                  SIDE: "Client",
                  TEXT: `[Resumo da IA] ${transferReason}\n\n${call.summary || ""}\n\n[Transcrição]\n${call.transcript}`,
                },
              ],
            }),
          }
        );
        console.log("Transcription attached to Bitrix24 call");
      }
    } else {
      console.error("Error registering Bitrix24 external call:", registerResult);
    }
  } catch (error) {
    console.error("Error registering Bitrix24 transfer:", error);
  }
}

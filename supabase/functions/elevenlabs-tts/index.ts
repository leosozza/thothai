import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Popular ElevenLabs voices
const VOICES = {
  alloy: "EXAVITQu4vr4xnSDxMaL", // Sarah - female
  roger: "CwhRBWXzGAHq8TQ4Fs17", // Roger - male
  charlie: "IKne3meq5aSn9XLyUdCD", // Charlie - male
  matilda: "XrExE9yKIg1WjnnlVkGX", // Matilda - female
  brian: "nPczCjzI2devNBz1zQrb", // Brian - male
  jessica: "cgSgspJ2msm6clMCkdW9", // Jessica - female
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    if (!ELEVENLABS_API_KEY) {
      throw new Error("ELEVENLABS_API_KEY is not configured");
    }

    const { text, voice = "matilda", model = "eleven_multilingual_v2" } = await req.json();

    if (!text) {
      throw new Error("Text is required");
    }

    // Get voice ID
    const voiceId = VOICES[voice as keyof typeof VOICES] || voice;
    
    console.log("Generating speech for:", text.substring(0, 50), "... with voice:", voice);

    // Call ElevenLabs Text-to-Speech API
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: model,
        output_format: "mp3_44100_128",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.5,
          use_speaker_boost: true,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("ElevenLabs TTS error:", response.status, errorText);
      throw new Error(`ElevenLabs API error: ${response.status}`);
    }

    const audioBuffer = await response.arrayBuffer();
    const base64Audio = base64Encode(audioBuffer);

    console.log("Audio generated, size:", audioBuffer.byteLength, "bytes");

    return new Response(JSON.stringify({
      success: true,
      audio_base64: base64Audio,
      content_type: "audio/mpeg",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Error in elevenlabs-tts:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    const contentType = req.headers.get("content-type") || "";
    let audioBlob: Blob;
    let languageCode = "por"; // Portuguese default

    if (contentType.includes("multipart/form-data")) {
      // Handle form data with audio file
      const formData = await req.formData();
      const audioFile = formData.get("audio") as File;
      const lang = formData.get("language_code") as string;
      
      if (!audioFile) {
        throw new Error("No audio file provided");
      }
      
      audioBlob = audioFile;
      if (lang) languageCode = lang;
    } else {
      // Handle JSON with base64 audio or URL
      const { audio_base64, audio_url, language_code } = await req.json();
      
      if (language_code) languageCode = language_code;

      if (audio_base64) {
        // Convert base64 to blob
        const binaryString = atob(audio_base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        audioBlob = new Blob([bytes], { type: "audio/ogg" });
      } else if (audio_url) {
        // Fetch audio from URL
        const audioResponse = await fetch(audio_url);
        if (!audioResponse.ok) {
          throw new Error("Failed to fetch audio from URL");
        }
        audioBlob = await audioResponse.blob();
      } else {
        throw new Error("No audio data provided (audio_base64, audio_url, or form file required)");
      }
    }

    console.log("Transcribing audio, size:", audioBlob.size, "bytes, language:", languageCode);

    // Prepare form data for ElevenLabs API
    const apiFormData = new FormData();
    apiFormData.append("file", audioBlob, "audio.ogg");
    apiFormData.append("model_id", "scribe_v1");
    apiFormData.append("language_code", languageCode);
    apiFormData.append("tag_audio_events", "false");
    apiFormData.append("diarize", "false");

    // Call ElevenLabs Speech-to-Text API
    const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
      },
      body: apiFormData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("ElevenLabs STT error:", response.status, errorText);
      throw new Error(`ElevenLabs API error: ${response.status}`);
    }

    const result = await response.json();
    console.log("Transcription result:", result.text?.substring(0, 100));

    return new Response(JSON.stringify({
      success: true,
      text: result.text,
      words: result.words,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Error in elevenlabs-stt:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  labels?: {
    accent?: string;
    description?: string;
    age?: string;
    gender?: string;
    use_case?: string;
    language?: string;
  };
  preview_url?: string;
  category?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { workspace_id } = await req.json();

    if (!workspace_id) {
      return new Response(
        JSON.stringify({ error: "workspace_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Try to get ElevenLabs API key from multiple sources

    // 1. Check integrations table (legacy)
    const { data: integration } = await supabase
      .from("integrations")
      .select("config")
      .eq("workspace_id", workspace_id)
      .eq("type", "elevenlabs")
      .eq("is_active", true)
      .single();

    let apiKey: string | null = null;

    if (integration?.config) {
      const config = integration.config as Record<string, unknown>;
      apiKey = config.api_key as string || null;
    }

    // 2. If not found, check workspace_voice_credentials
    if (!apiKey) {
      // First get the ElevenLabs provider ID
      const { data: provider } = await supabase
        .from("voice_providers")
        .select("id")
        .eq("slug", "elevenlabs")
        .single();

      if (provider) {
        const { data: credential } = await supabase
          .from("workspace_voice_credentials")
          .select("api_key_encrypted")
          .eq("workspace_id", workspace_id)
          .eq("provider_id", provider.id)
          .eq("is_active", true)
          .single();

        if (credential?.api_key_encrypted) {
          // In a real scenario, you'd decrypt this. For now, assume it's stored plain.
          apiKey = credential.api_key_encrypted;
        }
      }
    }

    // 3. Fallback to global ElevenLabs API key from secrets
    if (!apiKey) {
      apiKey = Deno.env.get("ELEVENLABS_API_KEY") || null;
    }

    if (!apiKey) {
      return new Response(
        JSON.stringify({ 
          error: "ElevenLabs API key not configured",
          voices: [] 
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch voices from ElevenLabs API
    console.log("Fetching voices from ElevenLabs API...");
    
    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      method: "GET",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("ElevenLabs API error:", response.status, errorText);
      return new Response(
        JSON.stringify({ 
          error: `ElevenLabs API error: ${response.status}`,
          voices: [] 
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const voices: ElevenLabsVoice[] = data.voices || [];

    console.log(`Fetched ${voices.length} voices from ElevenLabs`);

    // Transform to a simpler format with language info
    const transformedVoices = voices.map((voice) => ({
      id: voice.voice_id,
      name: voice.name,
      gender: voice.labels?.gender || null,
      language: voice.labels?.language || voice.labels?.accent || null,
      accent: voice.labels?.accent || null,
      age: voice.labels?.age || null,
      use_case: voice.labels?.use_case || null,
      description: voice.labels?.description || null,
      preview_url: voice.preview_url || null,
      category: voice.category || "premade",
    }));

    // Get unique languages for filtering
    const languages = [...new Set(
      transformedVoices
        .map(v => v.language)
        .filter(Boolean)
    )].sort();

    return new Response(
      JSON.stringify({ 
        voices: transformedVoices,
        languages,
        total: transformedVoices.length
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in elevenlabs-list-voices:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage, voices: [] }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

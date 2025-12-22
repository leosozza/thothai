import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AIGatewayRequest {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  provider_slug?: string;
  workspace_id?: string;
  persona_id?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

interface ProviderConfig {
  base_url: string;
  auth_header: string;
  auth_prefix: string;
  slug: string;
  name: string;
}

/**
 * Format messages for Anthropic API (different format)
 */
function formatForAnthropic(messages: Array<{ role: string; content: string }>) {
  const systemMessage = messages.find(m => m.role === "system");
  const otherMessages = messages.filter(m => m.role !== "system");
  
  return {
    system: systemMessage?.content || "",
    messages: otherMessages.map(m => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    })),
  };
}

/**
 * Call AI provider with appropriate formatting
 */
async function callProvider(
  provider: ProviderConfig,
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  model: string,
  temperature: number,
  maxTokens: number
): Promise<{ content: string; usage: any }> {
  
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  
  // Set auth header based on provider config
  if (provider.auth_prefix) {
    headers[provider.auth_header] = `${provider.auth_prefix} ${apiKey}`;
  } else {
    headers[provider.auth_header] = apiKey;
  }

  let body: any;
  let url = provider.base_url;

  // Special handling for Anthropic (different API format)
  if (provider.slug === "anthropic") {
    const formatted = formatForAnthropic(messages);
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model,
      system: formatted.system,
      messages: formatted.messages,
      max_tokens: maxTokens,
      temperature,
    };
  } 
  // Google AI (uses key as query param)
  else if (provider.slug === "google") {
    url = `${provider.base_url}?key=${apiKey}`;
    delete headers[provider.auth_header];
    body = {
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
    };
  }
  // Standard OpenAI-compatible format
  else {
    body = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    };
  }

  console.log(`[ai-gateway] Calling ${provider.name} with model ${model}`);
  
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[ai-gateway] ${provider.name} error:`, response.status, errorText);
    throw new Error(`${provider.name} API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  // Handle different response formats
  let content: string;
  let usage: any = {};

  if (provider.slug === "anthropic") {
    content = data.content?.[0]?.text || "";
    usage = {
      prompt_tokens: data.usage?.input_tokens || 0,
      completion_tokens: data.usage?.output_tokens || 0,
      total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    };
  } else {
    content = data.choices?.[0]?.message?.content || "";
    usage = data.usage || {};
  }

  return { content, usage };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const request: AIGatewayRequest = await req.json();
    const {
      messages,
      model: requestedModel,
      provider_slug: requestedProvider,
      workspace_id,
      persona_id,
      temperature = 0.7,
      max_tokens = 1024,
    } = request;

    if (!messages || messages.length === 0) {
      throw new Error("Messages are required");
    }

    // Determine provider and model from persona if persona_id is provided
    let providerSlug = requestedProvider || "lovable";
    let model = requestedModel || "google/gemini-2.5-flash";
    let useNativeCredits = true;
    let systemPrompt: string | null = null;
    let personaTemperature = temperature;

    if (persona_id) {
      const { data: persona } = await supabase
        .from("personas")
        .select("*, ai_providers(slug, name, base_url, auth_header, auth_prefix)")
        .eq("id", persona_id)
        .single();

      if (persona) {
        if (persona.ai_model) {
          model = persona.ai_model;
        }
        if (persona.ai_providers) {
          providerSlug = persona.ai_providers.slug;
        }
        if (persona.temperature) {
          personaTemperature = persona.temperature;
        }
        if (persona.system_prompt) {
          systemPrompt = persona.system_prompt;
        }
        useNativeCredits = persona.use_native_credits ?? true;
      }
    }

    // Inject system prompt if provided
    const finalMessages = systemPrompt 
      ? [{ role: "system", content: systemPrompt }, ...messages.filter(m => m.role !== "system")]
      : messages;

    console.log(`[ai-gateway] Provider: ${providerSlug}, Model: ${model}, UseNative: ${useNativeCredits}`);

    // Get provider configuration
    const { data: provider, error: providerError } = await supabase
      .from("ai_providers")
      .select("*")
      .eq("slug", providerSlug)
      .eq("is_active", true)
      .single();

    if (providerError || !provider) {
      throw new Error(`Provider '${providerSlug}' not found or inactive`);
    }

    let apiKey: string;
    let providerConfig: ProviderConfig = {
      base_url: provider.base_url,
      auth_header: provider.auth_header || "Authorization",
      auth_prefix: provider.auth_prefix || "Bearer",
      slug: provider.slug,
      name: provider.name,
    };

    // If using native (Lovable AI) or native credits
    if (provider.is_native || (useNativeCredits && providerSlug === "lovable")) {
      apiKey = Deno.env.get("LOVABLE_API_KEY")!;
      if (!apiKey) {
        throw new Error("LOVABLE_API_KEY is not configured");
      }
      console.log("[ai-gateway] Using Lovable AI native credits");
    } else {
      // Get workspace credentials
      if (!workspace_id) {
        throw new Error("workspace_id is required when using custom API keys");
      }

      const { data: credentials, error: credError } = await supabase
        .from("workspace_ai_credentials")
        .select("api_key_encrypted")
        .eq("workspace_id", workspace_id)
        .eq("provider_id", provider.id)
        .eq("is_active", true)
        .single();

      if (credError || !credentials) {
        throw new Error(`No API key configured for ${provider.name}. Please add your API key in Settings → AI Providers.`);
      }

      apiKey = credentials.api_key_encrypted; // In production, decrypt this
      console.log(`[ai-gateway] Using workspace API key for ${provider.name}`);

      // Update last_used_at
      await supabase
        .from("workspace_ai_credentials")
        .update({ last_used_at: new Date().toISOString() })
        .eq("workspace_id", workspace_id)
        .eq("provider_id", provider.id);
    }

    // Call the AI provider
    const { content, usage } = await callProvider(
      providerConfig,
      apiKey,
      finalMessages,
      model,
      personaTemperature,
      max_tokens
    );

    const responseTime = Date.now() - startTime;

    // Log usage for credit tracking (future)
    if (workspace_id && usage.total_tokens) {
      console.log(`[ai-gateway] Tokens used: ${usage.total_tokens} for workspace ${workspace_id}`);
      
      // Future: Record credit transaction
      // await supabase.from("credit_transactions").insert({
      //   workspace_id,
      //   amount: -calculateCost(usage.total_tokens, model),
      //   transaction_type: "usage",
      //   ai_provider: providerSlug,
      //   ai_model: model,
      //   tokens_used: usage.total_tokens,
      // });
    }

    console.log(`[ai-gateway] Response in ${responseTime}ms, tokens: ${usage.total_tokens || 0}`);

    return new Response(JSON.stringify({
      success: true,
      content,
      provider: providerSlug,
      model,
      metrics: {
        response_time_ms: responseTime,
        prompt_tokens: usage.prompt_tokens || 0,
        completion_tokens: usage.completion_tokens || 0,
        total_tokens: usage.total_tokens || 0,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("[ai-gateway] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    
    // Determine status code
    let status = 500;
    if (message.includes("Rate limit") || message.includes("429")) {
      status = 429;
    } else if (message.includes("Payment") || message.includes("402")) {
      status = 402;
    } else if (message.includes("not found") || message.includes("not configured")) {
      status = 400;
    }

    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

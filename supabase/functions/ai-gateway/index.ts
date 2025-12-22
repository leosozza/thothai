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

interface NativeModelConfig {
  name: string;
  tier: string;
  token_cost_multiplier: number;
  provider_source: string;
}

// Configuration for platform-managed providers (ThothAI native models)
const PLATFORM_PROVIDER_CONFIG: Record<string, {
  url: string;
  envKey: string;
  authHeader: string;
  authPrefix: string;
  extraHeaders?: Record<string, string>;
}> = {
  openrouter: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    envKey: "OPENROUTER_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer",
    extraHeaders: {
      "HTTP-Referer": "https://thoth24.com",
      "X-Title": "Thoth24 AI Platform",
    },
  },
  lovable: {
    url: "https://ai.gateway.lovable.dev/v1/chat/completions",
    envKey: "LOVABLE_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer",
  },
  deepseek: {
    url: "https://api.deepseek.com/v1/chat/completions",
    envKey: "DEEPSEEK_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer",
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    envKey: "ANTHROPIC_API_KEY",
    authHeader: "x-api-key",
    authPrefix: "",
    extraHeaders: {
      "anthropic-version": "2023-06-01",
    },
  },
  // Fallback for legacy providers - route through OpenRouter
  groq: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    envKey: "OPENROUTER_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer",
    extraHeaders: {
      "HTTP-Referer": "https://thoth24.com",
      "X-Title": "Thoth24 AI Platform",
    },
  },
  "google-free": {
    url: "https://openrouter.ai/api/v1/chat/completions",
    envKey: "OPENROUTER_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer",
    extraHeaders: {
      "HTTP-Referer": "https://thoth24.com",
      "X-Title": "Thoth24 AI Platform",
    },
  },
};

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
  providerSource: string,
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  model: string,
  temperature: number,
  maxTokens: number,
  customProvider?: ProviderConfig
): Promise<{ content: string; usage: any }> {
  
  const platformConfig = PLATFORM_PROVIDER_CONFIG[providerSource];
  const isAnthropic = providerSource === "anthropic" || customProvider?.slug === "anthropic";
  
  let url: string;
  let headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Use platform config or custom provider config
  if (platformConfig && !customProvider) {
    url = platformConfig.url;
    if (platformConfig.authPrefix) {
      headers[platformConfig.authHeader] = `${platformConfig.authPrefix} ${apiKey}`;
    } else {
      headers[platformConfig.authHeader] = apiKey;
    }
    if (platformConfig.extraHeaders) {
      headers = { ...headers, ...platformConfig.extraHeaders };
    }
  } else if (customProvider) {
    url = customProvider.base_url;
    if (customProvider.auth_prefix) {
      headers[customProvider.auth_header] = `${customProvider.auth_prefix} ${apiKey}`;
    } else {
      headers[customProvider.auth_header] = apiKey;
    }
  } else {
    throw new Error(`Unknown provider source: ${providerSource}`);
  }

  let body: any;

  // Special handling for Anthropic (different API format)
  if (isAnthropic) {
    const formatted = formatForAnthropic(messages);
    body = {
      model,
      system: formatted.system,
      messages: formatted.messages,
      max_tokens: maxTokens,
      temperature,
    };
  } else {
    // Standard OpenAI-compatible format (OpenRouter, Lovable, DeepSeek)
    body = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    };
  }

  console.log(`[ai-gateway] Calling ${providerSource} with model ${model} at ${url}`);
  
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[ai-gateway] ${providerSource} error:`, response.status, errorText);
    throw new Error(`${providerSource} API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  // Handle different response formats
  let content: string;
  let usage: any = {};

  if (isAnthropic) {
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
    let providerSource = "lovable"; // Default to Lovable

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

    // Get native model config for token cost calculation and provider routing
    let nativeModelConfig: NativeModelConfig | null = null;
    if (useNativeCredits) {
      const { data: nativeModel } = await supabase
        .from("native_ai_models")
        .select("name, tier, token_cost_multiplier, provider_source")
        .eq("name", model)
        .eq("is_active", true)
        .single();
      
      if (nativeModel) {
        nativeModelConfig = nativeModel as NativeModelConfig;
        providerSource = nativeModel.provider_source;
        console.log(`[ai-gateway] Native model: ${nativeModel.name}, tier: ${nativeModel.tier}, provider_source: ${providerSource}, multiplier: ${nativeModel.token_cost_multiplier}`);
      }
    }

    let apiKey: string;
    let customProviderConfig: ProviderConfig | undefined;

    // Route based on native credits vs custom API key
    if (useNativeCredits) {
      // Using ThothAI native credits - get platform API key based on provider_source
      const platformConfig = PLATFORM_PROVIDER_CONFIG[providerSource];
      
      if (!platformConfig) {
        console.warn(`[ai-gateway] Unknown provider_source: ${providerSource}, falling back to lovable`);
        providerSource = "lovable";
      }
      
      const finalConfig = PLATFORM_PROVIDER_CONFIG[providerSource];
      apiKey = Deno.env.get(finalConfig.envKey)!;
      
      if (!apiKey) {
        throw new Error(`Platform API key ${finalConfig.envKey} is not configured`);
      }
      
      console.log(`[ai-gateway] Using ThothAI native credits via ${providerSource}`);
    } else {
      // Using workspace's own API key
      if (!workspace_id) {
        throw new Error("workspace_id is required when using custom API keys");
      }

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

      customProviderConfig = {
        base_url: provider.base_url,
        auth_header: provider.auth_header || "Authorization",
        auth_prefix: provider.auth_prefix || "Bearer",
        slug: provider.slug,
        name: provider.name,
      };

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
      providerSource = provider.slug;
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
      providerSource,
      apiKey,
      finalMessages,
      model,
      personaTemperature,
      max_tokens,
      customProviderConfig
    );

    const responseTime = Date.now() - startTime;

    // Calculate and record credit usage for native models
    if (workspace_id && useNativeCredits && usage.total_tokens) {
      const multiplier = nativeModelConfig?.token_cost_multiplier || 2.0; // default to professional
      const tokensToDebit = Math.ceil(usage.total_tokens * multiplier);
      
      console.log(`[ai-gateway] Tokens used: ${usage.total_tokens}, multiplier: ${multiplier}, debiting: ${tokensToDebit}`);
      
      // Record credit transaction
      const { error: txError } = await supabase.from("credit_transactions").insert({
        workspace_id,
        amount: -tokensToDebit,
        transaction_type: "usage",
        description: `AI: ${model} (${nativeModelConfig?.tier || 'professional'})`,
        ai_provider: providerSource,
        ai_model: model,
        tokens_used: usage.total_tokens,
      });

      if (txError) {
        console.error("[ai-gateway] Error recording credit transaction:", txError);
      }

      // Update workspace credits balance
      const { data: currentCredits } = await supabase
        .from("workspace_credits")
        .select("balance")
        .eq("workspace_id", workspace_id)
        .single();

      if (currentCredits) {
        await supabase
          .from("workspace_credits")
          .update({ 
            balance: (currentCredits.balance || 0) - tokensToDebit,
            updated_at: new Date().toISOString()
          })
          .eq("workspace_id", workspace_id);
      }
    }

    console.log(`[ai-gateway] Response in ${responseTime}ms, tokens: ${usage.total_tokens || 0}`);

    return new Response(JSON.stringify({
      success: true,
      content,
      provider: providerSource,
      model,
      metrics: {
        response_time_ms: responseTime,
        prompt_tokens: usage.prompt_tokens || 0,
        completion_tokens: usage.completion_tokens || 0,
        total_tokens: usage.total_tokens || 0,
        tokens_debited: useNativeCredits ? Math.ceil((usage.total_tokens || 0) * (nativeModelConfig?.token_cost_multiplier || 2.0)) : 0,
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

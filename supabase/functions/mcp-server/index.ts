import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Tools exposed by this MCP server
const AVAILABLE_TOOLS = {
  send_whatsapp_message: {
    name: "send_whatsapp_message",
    description: "Envia uma mensagem WhatsApp para um contato",
    inputSchema: {
      type: "object",
      properties: {
        phone_number: { type: "string", description: "Número de telefone com código do país (ex: 5511999999999)" },
        message: { type: "string", description: "Conteúdo da mensagem" },
        instance_id: { type: "string", description: "ID da instância WhatsApp (opcional)" },
      },
      required: ["phone_number", "message"],
    },
  },
  list_contacts: {
    name: "list_contacts",
    description: "Lista os contatos do workspace",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Limite de resultados (padrão: 50)" },
        search: { type: "string", description: "Termo de busca por nome ou telefone" },
      },
    },
  },
  search_contacts: {
    name: "search_contacts",
    description: "Busca contatos por nome ou telefone",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Termo de busca" },
      },
      required: ["query"],
    },
  },
  get_conversation_history: {
    name: "get_conversation_history",
    description: "Obtém o histórico de conversa com um contato",
    inputSchema: {
      type: "object",
      properties: {
        contact_id: { type: "string", description: "ID do contato" },
        limit: { type: "number", description: "Limite de mensagens (padrão: 20)" },
      },
      required: ["contact_id"],
    },
  },
  ask_persona: {
    name: "ask_persona",
    description: "Faz uma pergunta a uma persona específica e obtém a resposta da IA",
    inputSchema: {
      type: "object",
      properties: {
        persona_id: { type: "string", description: "ID da persona" },
        question: { type: "string", description: "Pergunta para a IA" },
      },
      required: ["persona_id", "question"],
    },
  },
  search_knowledge_base: {
    name: "search_knowledge_base",
    description: "Busca informações na base de conhecimento",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Termo de busca" },
        limit: { type: "number", description: "Limite de resultados (padrão: 5)" },
      },
      required: ["query"],
    },
  },
};

async function validateApiKey(apiKey: string, supabase: any): Promise<{ valid: boolean; workspaceId?: string }> {
  const { data, error } = await supabase
    .from("mcp_server_config")
    .select("workspace_id, is_enabled, api_key")
    .eq("api_key", apiKey)
    .eq("is_enabled", true)
    .single();

  if (error || !data) {
    return { valid: false };
  }

  return { valid: true, workspaceId: data.workspace_id };
}

async function executeTool(
  toolName: string, 
  args: Record<string, unknown>, 
  workspaceId: string,
  supabase: any
): Promise<unknown> {
  console.log(`[MCP Server] Executing tool: ${toolName}`, args);

  switch (toolName) {
    case "send_whatsapp_message": {
      const { phone_number, message, instance_id } = args as { 
        phone_number: string; 
        message: string; 
        instance_id?: string;
      };

      // Get an instance for this workspace
      let query = supabase
        .from("instances")
        .select("id, phone_number, status")
        .eq("workspace_id", workspaceId)
        .eq("status", "connected");

      if (instance_id) {
        query = query.eq("id", instance_id);
      }

      const { data: instances, error: instanceError } = await query.limit(1);
      
      if (instanceError || !instances?.length) {
        throw new Error("Nenhuma instância WhatsApp conectada");
      }

      const instance = instances[0];

      // Get or create contact
      let { data: contact } = await supabase
        .from("contacts")
        .select("id")
        .eq("instance_id", instance.id)
        .eq("phone_number", phone_number)
        .single();

      if (!contact) {
        const { data: newContact, error: contactError } = await supabase
          .from("contacts")
          .insert({
            instance_id: instance.id,
            phone_number,
            name: phone_number,
          })
          .select("id")
          .single();

        if (contactError) throw new Error("Erro ao criar contato");
        contact = newContact;
      }

      // Get or create conversation
      let { data: conversation } = await supabase
        .from("conversations")
        .select("id")
        .eq("instance_id", instance.id)
        .eq("contact_id", contact.id)
        .single();

      if (!conversation) {
        const { data: newConv, error: convError } = await supabase
          .from("conversations")
          .insert({
            instance_id: instance.id,
            contact_id: contact.id,
            status: "open",
          })
          .select("id")
          .single();

        if (convError) throw new Error("Erro ao criar conversa");
        conversation = newConv;
      }

      // Call wapi-send-message function
      const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wapi-send-message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          instance_id: instance.id,
          contact_id: contact.id,
          conversation_id: conversation.id,
          message,
          message_type: "text",
        }),
      });

      if (!response.ok) {
        throw new Error("Falha ao enviar mensagem");
      }

      return { success: true, message: "Mensagem enviada com sucesso" };
    }

    case "list_contacts": {
      const { limit = 50, search } = args as { limit?: number; search?: string };

      // Get instances for this workspace
      const { data: instances } = await supabase
        .from("instances")
        .select("id")
        .eq("workspace_id", workspaceId);

      if (!instances?.length) {
        return { contacts: [] };
      }

      const instanceIds = instances.map((i: any) => i.id);

      let query = supabase
        .from("contacts")
        .select("id, name, phone_number, push_name")
        .in("instance_id", instanceIds)
        .limit(limit);

      if (search) {
        query = query.or(`name.ilike.%${search}%,phone_number.ilike.%${search}%`);
      }

      const { data: contacts, error } = await query;

      if (error) throw new Error("Erro ao buscar contatos");

      return { contacts: contacts || [] };
    }

    case "search_contacts": {
      const { query } = args as { query: string };

      const { data: instances } = await supabase
        .from("instances")
        .select("id")
        .eq("workspace_id", workspaceId);

      if (!instances?.length) {
        return { contacts: [] };
      }

      const instanceIds = instances.map((i: any) => i.id);

      const { data: contacts } = await supabase
        .from("contacts")
        .select("id, name, phone_number, push_name")
        .in("instance_id", instanceIds)
        .or(`name.ilike.%${query}%,phone_number.ilike.%${query}%`)
        .limit(20);

      return { contacts: contacts || [] };
    }

    case "get_conversation_history": {
      const { contact_id, limit = 20 } = args as { contact_id: string; limit?: number };

      const { data: messages, error } = await supabase
        .from("messages")
        .select("id, content, direction, created_at, message_type, is_from_bot")
        .eq("contact_id", contact_id)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw new Error("Erro ao buscar histórico");

      return { messages: (messages || []).reverse() };
    }

    case "ask_persona": {
      const { persona_id, question } = args as { persona_id: string; question: string };

      // Get persona
      const { data: persona, error: personaError } = await supabase
        .from("personas")
        .select("*")
        .eq("id", persona_id)
        .eq("workspace_id", workspaceId)
        .single();

      if (personaError || !persona) {
        throw new Error("Persona não encontrada");
      }

      // Call AI gateway
      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
        },
        body: JSON.stringify({
          model: persona.ai_model || "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: persona.system_prompt },
            { role: "user", content: question },
          ],
          temperature: persona.temperature || 0.7,
        }),
      });

      if (!aiResponse.ok) {
        throw new Error("Erro ao consultar IA");
      }

      const aiResult = await aiResponse.json();
      const answer = aiResult.choices?.[0]?.message?.content || "Sem resposta";

      return { answer, persona_name: persona.name };
    }

    case "search_knowledge_base": {
      const { query, limit = 5 } = args as { query: string; limit?: number };

      // Get knowledge documents
      const { data: docs } = await supabase
        .from("knowledge_documents")
        .select("id, title")
        .eq("workspace_id", workspaceId)
        .eq("status", "completed");

      if (!docs?.length) {
        return { results: [] };
      }

      const docIds = docs.map((d: any) => d.id);

      // Search in chunks
      const { data: chunks } = await supabase
        .from("knowledge_chunks")
        .select("content, document_id")
        .in("document_id", docIds)
        .limit(100);

      if (!chunks?.length) {
        return { results: [] };
      }

      // Simple keyword matching
      const queryWords = query.toLowerCase().split(/\s+/);
      const scoredChunks = chunks.map((chunk: any) => {
        const content = chunk.content.toLowerCase();
        let score = 0;
        for (const word of queryWords) {
          if (content.includes(word)) score++;
        }
        return { ...chunk, score };
      });

      const topChunks = scoredChunks
        .filter((c: any) => c.score > 0)
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, limit);

      return {
        results: topChunks.map((c: any) => ({
          content: c.content.substring(0, 500),
          document_id: c.document_id,
        })),
      };
    }

    default:
      throw new Error(`Ferramenta desconhecida: ${toolName}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();
    const { jsonrpc, id, method, params } = body;

    console.log(`[MCP Server] Request: ${method}`, JSON.stringify(params));

    // Validate API key from Authorization header
    const authHeader = req.headers.get("Authorization") || "";
    const apiKey = authHeader.replace("Bearer ", "");
    
    // For initialize, we validate API key
    // For other methods, we need the workspace context
    let workspaceId: string | undefined;

    if (method !== "initialize" && method !== "notifications/initialized") {
      const validation = await validateApiKey(apiKey, supabase);
      if (!validation.valid) {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code: -32001, message: "API key inválida ou servidor desabilitado" },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      workspaceId = validation.workspaceId;
    }

    // Handle JSON-RPC methods
    switch (method) {
      case "initialize": {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: {
                tools: { listChanged: true },
              },
              serverInfo: {
                name: "thoth-mcp-server",
                version: "1.0.0",
              },
            },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "notifications/initialized": {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      case "tools/list": {
        // Get allowed tools from config
        let allowedToolNames = Object.keys(AVAILABLE_TOOLS);
        
        if (workspaceId) {
          const { data: config } = await supabase
            .from("mcp_server_config")
            .select("allowed_tools")
            .eq("workspace_id", workspaceId)
            .single();

          if (config?.allowed_tools) {
            allowedToolNames = config.allowed_tools;
          }
        }

        const tools = allowedToolNames
          .filter(name => AVAILABLE_TOOLS[name as keyof typeof AVAILABLE_TOOLS])
          .map(name => AVAILABLE_TOOLS[name as keyof typeof AVAILABLE_TOOLS]);

        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: { tools },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "tools/call": {
        const { name: toolName, arguments: toolArgs } = params;

        if (!workspaceId) {
          throw new Error("Workspace não identificado");
        }

        const result = await executeTool(toolName, toolArgs || {}, workspaceId, supabase);

        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result, null, 2),
                },
              ],
            },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Método não suportado: ${method}` },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (error) {
    console.error("[MCP Server] Error:", error);
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { 
          code: -32000, 
          message: error instanceof Error ? error.message : "Erro interno" 
        },
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

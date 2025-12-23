import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FUNCTION_VERSION = "2025-12-23-v3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    label: string;
    nodeType?: string;
    message?: string;
    prompt?: string;
    condition?: string;
    delay?: number;
    action?: string;
    department?: string;
    transferMessage?: string;
  };
}

interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

interface Flow {
  id: string;
  name: string;
  trigger_type: string;
  trigger_value: string | null;
  intent_triggers: string[] | null;
  nodes: FlowNode[];
  edges: FlowEdge[];
  is_active: boolean;
  workspace_id: string;
}

/**
 * Detect intent using AI for smart flow matching
 */
async function detectIntent(
  content: string,
  conversationHistory: string,
  apiKey: string
): Promise<string | null> {
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: `Você é um classificador de intenções. Analise a conversa e responda APENAS com uma das categorias abaixo:
- agendamento (marcar horário, agendar, reservar, consulta)
- suporte (problema, erro, ajuda, não funciona, reclamação)
- vendas (comprar, preço, valor, orçamento, proposta)
- informacao (dúvida, como funciona, horário, endereço)
- saudacao (oi, olá, bom dia, boa tarde)
- cancelamento (cancelar, desmarcar, desistir)
- outro

Responda APENAS a categoria, sem explicação.`
          },
          {
            role: "user",
            content: `Histórico da conversa:\n${conversationHistory}\n\nÚltima mensagem: ${content}`
          }
        ],
        temperature: 0.1,
        max_tokens: 50,
      }),
    });

    if (!response.ok) {
      console.error("Intent detection failed:", response.status);
      return null;
    }

    const data = await response.json();
    const intent = data.choices?.[0]?.message?.content?.trim().toLowerCase();
    console.log("Detected intent:", intent);
    return intent || null;
  } catch (error) {
    console.error("Error detecting intent:", error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      message_id, 
      conversation_id, 
      instance_id, 
      contact_id, 
      content, 
      workspace_id,
      is_first_message = false,
      original_message_type = "text"
    } = await req.json();

    console.log(`=== FLOW ENGINE (${FUNCTION_VERSION}) ===`);
    console.log("Input:", { message_id, content: content?.substring(0, 50), is_first_message, workspace_id });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check conversation attendance mode first
    const { data: conversation } = await supabase
      .from("conversations")
      .select("attendance_mode, bot_state")
      .eq("id", conversation_id)
      .single();

    if (conversation?.attendance_mode === "human") {
      console.log("Conversation in human mode, skipping flow engine");
      return new Response(JSON.stringify({ 
        skipped: true, 
        reason: "Conversation in human mode" 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch active flows for this workspace
    const { data: flows, error: flowsError } = await supabase
      .from("flows")
      .select("*")
      .eq("workspace_id", workspace_id)
      .eq("is_active", true);

    if (flowsError) {
      console.error("Error fetching flows:", flowsError);
      throw new Error("Failed to fetch flows");
    }

    if (!flows || flows.length === 0) {
      console.log("No active flows found, falling back to AI");
      return await callAIProcessor(supabaseUrl, supabaseKey, {
        message_id, conversation_id, instance_id, contact_id, content, workspace_id, original_message_type
      });
    }

    // Get conversation history for intent detection
    const { data: historyMessages } = await supabase
      .from("messages")
      .select("content, direction")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: false })
      .limit(5);

    const conversationHistory = historyMessages
      ?.reverse()
      .map(m => `${m.direction === "incoming" ? "Cliente" : "Bot"}: ${m.content}`)
      .join("\n") || "";

    // Find matching flow based on trigger
    let matchedFlow: Flow | null = null;
    let matchReason = "";

    // Priority 1: first_message trigger
    if (is_first_message) {
      const firstMsgFlow = flows.find((f: any) => f.trigger_type === "first_message");
      if (firstMsgFlow) {
        matchedFlow = firstMsgFlow as Flow;
        matchReason = "first_message trigger";
      }
    }

    // Priority 2: keyword trigger
    if (!matchedFlow && content) {
      for (const flow of flows) {
        if (flow.trigger_type === "keyword" && flow.trigger_value) {
          const keywords = flow.trigger_value.split(",").map((k: string) => k.trim().toLowerCase());
          const messageContent = content.toLowerCase();
          
          if (keywords.some((keyword: string) => messageContent.includes(keyword))) {
            matchedFlow = flow as Flow;
            matchReason = `keyword match: ${flow.trigger_value}`;
            break;
          }
        }
      }
    }

    // Priority 3: Intent-based trigger (AI detection)
    if (!matchedFlow && LOVABLE_API_KEY && content) {
      // Find flows with intent_triggers
      const intentFlows = flows.filter((f: any) => f.intent_triggers && f.intent_triggers.length > 0);
      
      if (intentFlows.length > 0) {
        const detectedIntent = await detectIntent(content, conversationHistory, LOVABLE_API_KEY);
        
        if (detectedIntent) {
          for (const flow of intentFlows) {
            const triggers = (flow.intent_triggers || []) as string[];
            if (triggers.some(t => t.toLowerCase() === detectedIntent)) {
              matchedFlow = flow as Flow;
              matchReason = `intent: ${detectedIntent}`;
              
              // Save detected intent to conversation state
              await supabase
                .from("conversations")
                .update({ 
                  bot_state: { 
                    ...conversation?.bot_state,
                    detected_intent: detectedIntent,
                    intent_detected_at: new Date().toISOString()
                  }
                })
                .eq("id", conversation_id);
              
              break;
            }
          }
        }
      }
    }

    // Priority 4: all_messages trigger (catch-all)
    if (!matchedFlow) {
      const allMsgFlow = flows.find((f: any) => f.trigger_type === "all_messages");
      if (allMsgFlow) {
        matchedFlow = allMsgFlow as Flow;
        matchReason = "all_messages trigger";
      }
    }

    if (!matchedFlow) {
      console.log("No flow matched, falling back to AI");
      return await callAIProcessor(supabaseUrl, supabaseKey, {
        message_id, conversation_id, instance_id, contact_id, content, workspace_id, original_message_type
      });
    }

    // Execute the matched flow
    console.log("Executing flow:", matchedFlow.name, "reason:", matchReason);
    
    const nodes = (matchedFlow.nodes || []) as FlowNode[];
    const edges = (matchedFlow.edges || []) as FlowEdge[];

    if (nodes.length === 0) {
      console.log("Flow has no nodes, falling back to AI");
      return await callAIProcessor(supabaseUrl, supabaseKey, {
        message_id, conversation_id, instance_id, contact_id, content, workspace_id, original_message_type
      });
    }

    // Update conversation bot_state with current flow
    await supabase
      .from("conversations")
      .update({ 
        bot_state: { 
          ...conversation?.bot_state,
          current_flow_id: matchedFlow.id,
          current_flow_name: matchedFlow.name,
          flow_started_at: new Date().toISOString()
        }
      })
      .eq("id", conversation_id);

    // Find the trigger node (start node)
    const triggerNode = nodes.find(n => n.data.nodeType === "trigger");
    
    // Get the first node after trigger
    const startNodeId = triggerNode?.id || nodes[0]?.id;
    const firstEdge = edges.find(e => e.source === startNodeId);
    const firstNodeId = firstEdge?.target || (nodes.length > 1 ? nodes[1]?.id : null);

    if (!firstNodeId) {
      console.log("No nodes to execute after trigger");
      return new Response(JSON.stringify({ success: true, message: "Flow executed (no actions)" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Execute nodes sequentially
    let currentNodeId: string | null = firstNodeId;
    const executedNodes: string[] = [];
    const maxNodes = 20; // Prevent infinite loops

    while (currentNodeId && executedNodes.length < maxNodes) {
      const currentNode = nodes.find(n => n.id === currentNodeId);
      if (!currentNode) break;

      executedNodes.push(currentNodeId);
      console.log("Executing node:", currentNode.data.nodeType, currentNode.data.label);

      const nodeType = currentNode.data.nodeType;

      switch (nodeType) {
        case "message":
          if (currentNode.data.message) {
            await sendMessage(supabaseUrl, supabaseKey, {
              instance_id, contact_id, conversation_id,
              message: currentNode.data.message
            });
          }
          break;

        case "ai_response":
          await callAIProcessor(supabaseUrl, supabaseKey, {
            message_id, conversation_id, instance_id, contact_id, content, workspace_id, original_message_type
          });
          break;

        case "delay":
          const delayMs = (currentNode.data.delay || 1) * 1000;
          await new Promise(resolve => setTimeout(resolve, Math.min(delayMs, 10000)));
          break;

        case "condition":
          const condition = currentNode.data.condition?.toLowerCase() || "";
          const messageContent = content?.toLowerCase() || "";
          
          const conditionEdges = edges.filter(e => e.source === currentNodeId);
          
          let conditionMet = false;
          if (condition.includes("contains:")) {
            const keyword = condition.replace("contains:", "").trim();
            conditionMet = messageContent.includes(keyword);
          } else if (condition.includes("equals:")) {
            const value = condition.replace("equals:", "").trim();
            conditionMet = messageContent === value;
          } else {
            conditionMet = true;
          }

          const nextEdge = conditionEdges.find(e => 
            (conditionMet && e.sourceHandle === "yes") ||
            (!conditionMet && e.sourceHandle === "no")
          ) || conditionEdges[0];

          currentNodeId = nextEdge?.target || null;
          continue;

        case "action":
          console.log("Executing action:", currentNode.data.action);
          break;

        case "transfer_to_human":
          console.log("Transferring to human");
          await supabase
            .from("conversations")
            .update({ 
              attendance_mode: "human",
              status: "waiting_human",
              bot_state: {
                ...conversation?.bot_state,
                transferred_at: new Date().toISOString(),
                transfer_reason: "flow_transfer"
              }
            })
            .eq("id", conversation_id);
          
          if (currentNode.data.transferMessage) {
            await sendMessage(supabaseUrl, supabaseKey, {
              instance_id, contact_id, conversation_id,
              message: currentNode.data.transferMessage
            });
          } else {
            await sendMessage(supabaseUrl, supabaseKey, {
              instance_id, contact_id, conversation_id,
              message: "Estou transferindo você para um atendente humano. Por favor, aguarde um momento..."
            });
          }
          currentNodeId = null;
          continue;

        case "transfer_to_ai":
          console.log("Transferring back to AI");
          await supabase
            .from("conversations")
            .update({ 
              attendance_mode: "ai",
              assigned_to: null,
              status: "open"
            })
            .eq("id", conversation_id);
          
          if (currentNode.data.transferMessage) {
            await sendMessage(supabaseUrl, supabaseKey, {
              instance_id, contact_id, conversation_id,
              message: currentNode.data.transferMessage
            });
          }
          break;

        case "assign_department":
          const department = currentNode.data.department;
          console.log("Assigning to department:", department);
          await supabase
            .from("conversations")
            .update({ 
              department,
              attendance_mode: "human",
              status: "waiting_human"
            })
            .eq("id", conversation_id);
          break;

        default:
          console.log("Unknown node type:", nodeType);
      }

      // Find next node
      const nextEdge = edges.find(e => e.source === currentNodeId);
      currentNodeId = nextEdge?.target || null;
    }

    // Clear current flow from conversation state when done
    await supabase
      .from("conversations")
      .update({ 
        bot_state: { 
          ...conversation?.bot_state,
          current_flow_id: null,
          current_flow_name: null,
          last_flow_completed: matchedFlow.name,
          flow_completed_at: new Date().toISOString()
        }
      })
      .eq("id", conversation_id);

    console.log("Flow execution completed. Executed nodes:", executedNodes.length);

    return new Response(JSON.stringify({ 
      success: true, 
      flow: matchedFlow.name,
      match_reason: matchReason,
      executedNodes: executedNodes.length 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Error in flow-engine:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function callAIProcessor(supabaseUrl: string, supabaseKey: string, params: any) {
  const response = await fetch(`${supabaseUrl}/functions/v1/ai-process-message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify(params),
  });

  const result = await response.json();
  return new Response(JSON.stringify(result), {
    status: response.status,
    headers: { 
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Content-Type": "application/json" 
    },
  });
}

async function sendMessage(supabaseUrl: string, supabaseKey: string, params: {
  instance_id: string;
  contact_id: string;
  conversation_id: string;
  message: string;
}) {
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: contact } = await supabase
    .from("contacts")
    .select("phone_number")
    .eq("id", params.contact_id)
    .single();

  if (!contact) {
    console.error("Contact not found for message send");
    return;
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/wapi-send-message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({
      instance_id: params.instance_id,
      phone_number: contact.phone_number,
      message: params.message,
      conversation_id: params.conversation_id,
      contact_id: params.contact_id,
    }),
  });

  if (!response.ok) {
    console.error("Failed to send flow message:", await response.text());
  }
}

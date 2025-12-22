import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  nodes: FlowNode[];
  edges: FlowEdge[];
  is_active: boolean;
  workspace_id: string;
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

    console.log("Flow Engine called:", { message_id, content, is_first_message, workspace_id });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

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

    // Find matching flow based on trigger
    let matchedFlow: Flow | null = null;

    for (const flow of flows) {
      const triggerType = flow.trigger_type;
      const triggerValue = flow.trigger_value?.toLowerCase();

      if (triggerType === "first_message" && is_first_message) {
        matchedFlow = flow as Flow;
        console.log("Matched first_message trigger:", flow.name);
        break;
      }

      if (triggerType === "keyword" && triggerValue && content) {
        const keywords = triggerValue.split(",").map((k: string) => k.trim().toLowerCase());
        const messageContent = content.toLowerCase();
        
        if (keywords.some((keyword: string) => messageContent.includes(keyword))) {
          matchedFlow = flow as Flow;
          console.log("Matched keyword trigger:", flow.name, "keyword matched");
          break;
        }
      }

      if (triggerType === "all_messages") {
        matchedFlow = flow as Flow;
        console.log("Matched all_messages trigger:", flow.name);
        break;
      }
    }

    if (!matchedFlow) {
      console.log("No flow matched, falling back to AI");
      return await callAIProcessor(supabaseUrl, supabaseKey, {
        message_id, conversation_id, instance_id, contact_id, content, workspace_id
      });
    }

    // Execute the matched flow
    console.log("Executing flow:", matchedFlow.name);
    
    const nodes = (matchedFlow.nodes || []) as FlowNode[];
    const edges = (matchedFlow.edges || []) as FlowEdge[];

    if (nodes.length === 0) {
      console.log("Flow has no nodes, falling back to AI");
      return await callAIProcessor(supabaseUrl, supabaseKey, {
        message_id, conversation_id, instance_id, contact_id, content, workspace_id
      });
    }

    // Find the trigger node (start node)
    const triggerNode = nodes.find(n => n.data.nodeType === "trigger");
    if (!triggerNode) {
      console.log("No trigger node found, starting from first node");
    }

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
          // Send a fixed message
          if (currentNode.data.message) {
            await sendMessage(supabaseUrl, supabaseKey, {
              instance_id, contact_id, conversation_id,
              message: currentNode.data.message
            });
          }
          break;

        case "ai_response":
          // Call AI processor
          await callAIProcessor(supabaseUrl, supabaseKey, {
            message_id, conversation_id, instance_id, contact_id, content, workspace_id
          });
          break;

        case "delay":
          // Wait for specified time (in seconds)
          const delayMs = (currentNode.data.delay || 1) * 1000;
          await new Promise(resolve => setTimeout(resolve, Math.min(delayMs, 10000))); // Max 10s
          break;

        case "condition":
          // Evaluate condition and choose path
          const condition = currentNode.data.condition?.toLowerCase() || "";
          const messageContent = content?.toLowerCase() || "";
          
          // Find edges from this node
          const conditionEdges = edges.filter(e => e.source === currentNodeId);
          
          // Simple condition evaluation
          let conditionMet = false;
          if (condition.includes("contains:")) {
            const keyword = condition.replace("contains:", "").trim();
            conditionMet = messageContent.includes(keyword);
          } else if (condition.includes("equals:")) {
            const value = condition.replace("equals:", "").trim();
            conditionMet = messageContent === value;
          } else {
            conditionMet = true; // Default to true if condition is empty
          }

          // Choose the appropriate edge based on condition
          const nextEdge = conditionEdges.find(e => 
            (conditionMet && e.sourceHandle === "yes") ||
            (!conditionMet && e.sourceHandle === "no")
          ) || conditionEdges[0];

          currentNodeId = nextEdge?.target || null;
          continue; // Skip the normal edge finding below

        case "action":
          // Execute custom action
          console.log("Executing action:", currentNode.data.action);
          break;

        case "transfer_to_human":
          // Transfer conversation to human
          console.log("Transferring to human");
          await supabase
            .from("conversations")
            .update({ 
              attendance_mode: "human",
              status: "waiting_human"
            })
            .eq("id", conversation_id);
          
          // Send transfer message if configured
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
          // Stop flow execution after transfer
          currentNodeId = null;
          continue;

        case "transfer_to_ai":
          // Transfer conversation back to AI
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
          // Assign to specific department
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

    console.log("Flow execution completed. Executed nodes:", executedNodes.length);

    return new Response(JSON.stringify({ 
      success: true, 
      flow: matchedFlow.name,
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

  // Get contact phone number
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

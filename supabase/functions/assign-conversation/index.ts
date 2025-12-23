import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AssignRequest {
  conversation_id: string;
  operator_id?: string; // If not provided, auto-assign
  workspace_id: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: AssignRequest = await req.json();
    const { conversation_id, operator_id, workspace_id } = body;

    if (!conversation_id || !workspace_id) {
      return new Response(
        JSON.stringify({ error: 'conversation_id and workspace_id are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let targetOperatorId = operator_id;

    // If no operator specified, find available operator (round-robin)
    if (!targetOperatorId) {
      console.log('Auto-assigning operator for workspace:', workspace_id);

      // Get all active, online operators in this workspace
      const { data: operators, error: opError } = await supabase
        .from('operators')
        .select('id, max_concurrent_conversations')
        .eq('workspace_id', workspace_id)
        .eq('is_active', true)
        .eq('is_online', true);

      if (opError) {
        console.error('Error fetching operators:', opError);
        throw opError;
      }

      if (!operators || operators.length === 0) {
        console.log('No available operators found');
        return new Response(
          JSON.stringify({ 
            error: 'No available operators', 
            assigned: false 
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Count current conversations per operator
      const operatorCounts = await Promise.all(
        operators.map(async (op) => {
          const { count } = await supabase
            .from('conversations')
            .select('*', { count: 'exact', head: true })
            .eq('assigned_operator_id', op.id)
            .eq('status', 'open');

          return {
            ...op,
            current_count: count || 0,
          };
        })
      );

      // Find operator with least conversations that hasn't hit max
      const availableOperators = operatorCounts.filter(
        op => op.current_count < op.max_concurrent_conversations
      );

      if (availableOperators.length === 0) {
        console.log('All operators at capacity');
        return new Response(
          JSON.stringify({ 
            error: 'All operators at capacity', 
            assigned: false 
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Pick operator with fewest conversations
      availableOperators.sort((a, b) => a.current_count - b.current_count);
      targetOperatorId = availableOperators[0].id;

      console.log('Selected operator:', targetOperatorId, 'with', availableOperators[0].current_count, 'conversations');
    }

    // Assign the conversation
    const { error: updateError } = await supabase
      .from('conversations')
      .update({
        assigned_operator_id: targetOperatorId,
        attendance_mode: 'human',
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation_id);

    if (updateError) {
      console.error('Error assigning conversation:', updateError);
      throw updateError;
    }

    // Get operator info for response
    const { data: operator } = await supabase
      .from('operators')
      .select('id, display_name, user_id')
      .eq('id', targetOperatorId)
      .single();

    console.log('Conversation assigned successfully:', {
      conversation_id,
      operator_id: targetOperatorId,
      operator_name: operator?.display_name,
    });

    return new Response(
      JSON.stringify({
        success: true,
        assigned: true,
        operator_id: targetOperatorId,
        operator_name: operator?.display_name,
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in assign-conversation:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plug, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface MCPConnection {
  id: string;
  name: string;
  description: string | null;
  available_tools: MCPTool[];
  is_active: boolean;
}

interface MCPTool {
  name: string;
  description: string;
}

interface MCPSelectorProps {
  workspaceId: string;
  personaId?: string;
  selectedMcpIds: string[];
  onSelectionChange: (mcpIds: string[]) => void;
}

export function MCPSelector({ 
  workspaceId, 
  personaId, 
  selectedMcpIds, 
  onSelectionChange 
}: MCPSelectorProps) {
  const [connections, setConnections] = useState<MCPConnection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchConnections();
  }, [workspaceId]);

  useEffect(() => {
    if (personaId) {
      fetchPersonaMcps();
    }
  }, [personaId]);

  const fetchConnections = async () => {
    try {
      const { data, error } = await supabase
        .from("mcp_connections")
        .select("id, name, description, available_tools, is_active")
        .eq("workspace_id", workspaceId)
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      
      setConnections((data || []).map(conn => ({
        ...conn,
        available_tools: (conn.available_tools as unknown as MCPTool[]) || [],
      })));
    } catch (error) {
      console.error("Error fetching MCP connections:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPersonaMcps = async () => {
    if (!personaId) return;
    
    try {
      const { data, error } = await supabase
        .from("persona_mcp_connections")
        .select("mcp_connection_id")
        .eq("persona_id", personaId);

      if (error) throw error;
      
      if (data) {
        onSelectionChange(data.map(d => d.mcp_connection_id));
      }
    } catch (error) {
      console.error("Error fetching persona MCPs:", error);
    }
  };

  const handleToggle = (mcpId: string, checked: boolean) => {
    if (checked) {
      onSelectionChange([...selectedMcpIds, mcpId]);
    } else {
      onSelectionChange(selectedMcpIds.filter(id => id !== mcpId));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (connections.length === 0) {
    return (
      <div className="text-center py-4 text-muted-foreground">
        <Plug className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">Nenhuma conexão MCP disponível</p>
        <p className="text-xs">Configure conexões MCP em Integrações</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Label className="flex items-center gap-2">
        <Plug className="h-4 w-4" />
        MCPs Disponíveis
      </Label>
      <p className="text-sm text-muted-foreground">
        Selecione quais MCPs esta persona pode utilizar para acessar ferramentas externas
      </p>

      <div className="space-y-2 border rounded-lg p-3">
        {connections.map((conn) => (
          <div key={conn.id} className="space-y-2">
            <div className="flex items-start space-x-3">
              <Checkbox
                id={`mcp-${conn.id}`}
                checked={selectedMcpIds.includes(conn.id)}
                onCheckedChange={(checked) => handleToggle(conn.id, !!checked)}
              />
              <div className="grid gap-1 leading-none flex-1">
                <label
                  htmlFor={`mcp-${conn.id}`}
                  className="text-sm font-medium cursor-pointer flex items-center gap-2"
                >
                  {conn.name}
                  <Badge variant="secondary" className="text-xs">
                    {conn.available_tools.length} ferramentas
                  </Badge>
                </label>
                {conn.description && (
                  <p className="text-xs text-muted-foreground">
                    {conn.description}
                  </p>
                )}
              </div>
            </div>

            {conn.available_tools.length > 0 && selectedMcpIds.includes(conn.id) && (
              <Accordion type="single" collapsible className="w-full ml-6">
                <AccordionItem value="tools" className="border-0">
                  <AccordionTrigger className="py-1 text-xs text-muted-foreground hover:no-underline">
                    <div className="flex items-center gap-1">
                      <Wrench className="h-3 w-3" />
                      Ver ferramentas disponíveis
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-1 pt-1">
                      {conn.available_tools.map((tool) => (
                        <div key={tool.name} className="text-xs pl-4 py-0.5">
                          <span className="font-mono text-primary">{tool.name}</span>
                          {tool.description && (
                            <span className="text-muted-foreground"> - {tool.description}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}
          </div>
        ))}
      </div>

      {selectedMcpIds.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {selectedMcpIds.length} MCP(s) selecionado(s) - A IA poderá usar as ferramentas destes MCPs durante as conversas
        </p>
      )}
    </div>
  );
}

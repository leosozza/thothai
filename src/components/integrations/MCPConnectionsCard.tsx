import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { 
  Plus, 
  Plug, 
  RefreshCw, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  Loader2,
  Wrench,
  ExternalLink,
} from "lucide-react";

interface MCPConnection {
  id: string;
  name: string;
  description: string | null;
  mcp_url: string;
  transport_type: string;
  auth_type: string;
  auth_config: Record<string, unknown> | null;
  available_tools: MCPTool[];
  is_active: boolean;
  last_sync_at: string | null;
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

interface MCPConnectionsCardProps {
  workspaceId: string;
}

export function MCPConnectionsCard({ workspaceId }: MCPConnectionsCardProps) {
  const [connections, setConnections] = useState<MCPConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [discoveringId, setDiscoveringId] = useState<string | null>(null);

  // Form states
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [transportType, setTransportType] = useState("http");
  const [authType, setAuthType] = useState("none");
  const [authToken, setAuthToken] = useState("");
  const [authApiKey, setAuthApiKey] = useState("");
  const [authHeaderName, setAuthHeaderName] = useState("X-API-Key");

  useEffect(() => {
    fetchConnections();
  }, [workspaceId]);

  const fetchConnections = async () => {
    try {
      const { data, error } = await supabase
        .from("mcp_connections")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      
      setConnections((data || []).map(conn => ({
        ...conn,
        available_tools: (conn.available_tools as unknown as MCPTool[]) || [],
        auth_config: conn.auth_config as Record<string, unknown> | null,
      })));
    } catch (error) {
      console.error("Error fetching MCP connections:", error);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setName("");
    setDescription("");
    setMcpUrl("");
    setTransportType("http");
    setAuthType("none");
    setAuthToken("");
    setAuthApiKey("");
    setAuthHeaderName("X-API-Key");
  };

  const handleSave = async () => {
    if (!name.trim() || !mcpUrl.trim()) {
      toast.error("Nome e URL são obrigatórios");
      return;
    }

    setSaving(true);
    try {
      let authConfig: Record<string, unknown> = {};
      if (authType === "bearer") {
        authConfig = { token: authToken };
      } else if (authType === "api_key") {
        authConfig = { api_key: authApiKey, header_name: authHeaderName };
      }

      const { error } = await supabase
        .from("mcp_connections")
        .insert([{
          workspace_id: workspaceId,
          name: name.trim(),
          description: description.trim() || null,
          mcp_url: mcpUrl.trim(),
          transport_type: transportType,
          auth_type: authType,
          auth_config: authConfig,
        }]);

      if (error) throw error;

      toast.success("Conexão MCP criada!");
      setDialogOpen(false);
      resetForm();
      fetchConnections();
    } catch (error) {
      console.error("Error saving MCP connection:", error);
      toast.error("Erro ao salvar conexão");
    } finally {
      setSaving(false);
    }
  };

  const handleDiscover = async (connectionId: string) => {
    setDiscoveringId(connectionId);
    try {
      const { data, error } = await supabase.functions.invoke("mcp-client-discover", {
        body: { mcp_connection_id: connectionId },
      });

      if (error) throw error;

      if (data.error) {
        throw new Error(data.error);
      }

      const toolCount = data.tools?.length || 0;
      toast.success(`${toolCount} ferramenta(s) descoberta(s)!`);
      fetchConnections();
    } catch (error) {
      console.error("Error discovering tools:", error);
      toast.error(error instanceof Error ? error.message : "Erro ao descobrir ferramentas");
    } finally {
      setDiscoveringId(null);
    }
  };

  const handleToggleActive = async (connectionId: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from("mcp_connections")
        .update({ is_active: isActive })
        .eq("id", connectionId);

      if (error) throw error;
      
      toast.success(isActive ? "Conexão ativada" : "Conexão desativada");
      fetchConnections();
    } catch (error) {
      console.error("Error toggling connection:", error);
      toast.error("Erro ao alterar status");
    }
  };

  const handleDelete = async (connectionId: string) => {
    try {
      const { error } = await supabase
        .from("mcp_connections")
        .delete()
        .eq("id", connectionId);

      if (error) throw error;
      
      toast.success("Conexão removida");
      fetchConnections();
    } catch (error) {
      console.error("Error deleting connection:", error);
      toast.error("Erro ao remover conexão");
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Plug className="h-5 w-5 text-primary" />
              Conexões MCP
            </CardTitle>
            <CardDescription>
              Conecte-se a servidores MCP externos para estender as capacidades da IA
            </CardDescription>
          </div>
          <Button onClick={() => setDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Nova Conexão
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : connections.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Plug className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Nenhuma conexão MCP configurada</p>
            <p className="text-sm">Conecte-se a servidores MCP como n8n, outras aplicações, etc.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {connections.map((conn) => (
              <div
                key={conn.id}
                className="border rounded-lg p-4 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${conn.is_active ? "bg-green-500" : "bg-gray-400"}`} />
                    <div>
                      <h4 className="font-medium">{conn.name}</h4>
                      {conn.description && (
                        <p className="text-sm text-muted-foreground">{conn.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={conn.is_active}
                      onCheckedChange={(checked) => handleToggleActive(conn.id, checked)}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(conn.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ExternalLink className="h-3 w-3" />
                  <span className="truncate">{conn.mcp_url}</span>
                  <Badge variant="outline" className="ml-auto">
                    {conn.transport_type.toUpperCase()}
                  </Badge>
                  <Badge variant="secondary">
                    {conn.auth_type === "none" ? "Sem auth" : conn.auth_type}
                  </Badge>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDiscover(conn.id)}
                    disabled={discoveringId === conn.id}
                    className="gap-2"
                  >
                    {discoveringId === conn.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    Descobrir Ferramentas
                  </Button>
                  {conn.last_sync_at && (
                    <span className="text-xs text-muted-foreground">
                      Última sync: {new Date(conn.last_sync_at).toLocaleString("pt-BR")}
                    </span>
                  )}
                </div>

                {conn.available_tools.length > 0 && (
                  <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="tools" className="border-0">
                      <AccordionTrigger className="py-2 text-sm">
                        <div className="flex items-center gap-2">
                          <Wrench className="h-4 w-4" />
                          {conn.available_tools.length} ferramenta(s) disponível(is)
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2 pl-6">
                          {conn.available_tools.map((tool) => (
                            <div key={tool.name} className="text-sm">
                              <span className="font-mono text-primary">{tool.name}</span>
                              {tool.description && (
                                <p className="text-muted-foreground">{tool.description}</p>
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
        )}
      </CardContent>

      {/* New Connection Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nova Conexão MCP</DialogTitle>
            <DialogDescription>
              Configure uma conexão com um servidor MCP externo
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: n8n Production, App Financeira"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Descrição</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descreva a finalidade desta conexão"
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mcp_url">URL do Servidor MCP *</Label>
              <Input
                id="mcp_url"
                value={mcpUrl}
                onChange={(e) => setMcpUrl(e.target.value)}
                placeholder="https://seu-servidor.com/mcp"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Transporte</Label>
                <Select value={transportType} onValueChange={setTransportType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="http">HTTP</SelectItem>
                    <SelectItem value="sse">SSE</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Autenticação</Label>
                <Select value={authType} onValueChange={setAuthType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhuma</SelectItem>
                    <SelectItem value="bearer">Bearer Token</SelectItem>
                    <SelectItem value="api_key">API Key</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {authType === "bearer" && (
              <div className="space-y-2">
                <Label htmlFor="auth_token">Token</Label>
                <Input
                  id="auth_token"
                  type="password"
                  value={authToken}
                  onChange={(e) => setAuthToken(e.target.value)}
                  placeholder="Seu token de autenticação"
                />
              </div>
            )}

            {authType === "api_key" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="auth_api_key">API Key</Label>
                  <Input
                    id="auth_api_key"
                    type="password"
                    value={authApiKey}
                    onChange={(e) => setAuthApiKey(e.target.value)}
                    placeholder="Sua API key"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="auth_header">Nome do Header</Label>
                  <Input
                    id="auth_header"
                    value={authHeaderName}
                    onChange={(e) => setAuthHeaderName(e.target.value)}
                    placeholder="X-API-Key"
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Salvando...
                </>
              ) : (
                "Criar Conexão"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

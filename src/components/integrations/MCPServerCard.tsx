import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { 
  Server, 
  Copy, 
  RefreshCw, 
  Loader2,
  CheckCircle2,
  Key,
  Shield,
} from "lucide-react";

interface MCPServerConfig {
  id: string;
  workspace_id: string;
  is_enabled: boolean;
  api_key: string | null;
  allowed_tools: string[];
  rate_limit: number;
}

interface MCPServerCardProps {
  workspaceId: string;
}

const AVAILABLE_TOOLS = [
  { id: "send_whatsapp_message", name: "Enviar Mensagem WhatsApp", description: "Permite enviar mensagens via WhatsApp" },
  { id: "list_contacts", name: "Listar Contatos", description: "Lista os contatos do workspace" },
  { id: "search_contacts", name: "Buscar Contatos", description: "Busca contatos por nome ou telefone" },
  { id: "get_conversation_history", name: "Histórico de Conversa", description: "Obtém histórico de mensagens" },
  { id: "ask_persona", name: "Perguntar à Persona", description: "Faz perguntas a uma persona de IA" },
  { id: "search_knowledge_base", name: "Buscar Base de Conhecimento", description: "Busca na base de conhecimento" },
];

export function MCPServerCard({ workspaceId }: MCPServerCardProps) {
  const [config, setConfig] = useState<MCPServerConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingKey, setGeneratingKey] = useState(false);

  // Form states
  const [isEnabled, setIsEnabled] = useState(false);
  const [allowedTools, setAllowedTools] = useState<string[]>(AVAILABLE_TOOLS.map(t => t.id));
  const [rateLimit, setRateLimit] = useState(100);

  useEffect(() => {
    fetchConfig();
  }, [workspaceId]);

  const fetchConfig = async () => {
    try {
      const { data, error } = await supabase
        .from("mcp_server_config")
        .select("*")
        .eq("workspace_id", workspaceId)
        .maybeSingle();

      if (error) throw error;
      
      if (data) {
        setConfig({
          ...data,
          allowed_tools: (data.allowed_tools as string[]) || AVAILABLE_TOOLS.map(t => t.id),
        });
        setIsEnabled(data.is_enabled);
        setAllowedTools((data.allowed_tools as string[]) || AVAILABLE_TOOLS.map(t => t.id));
        setRateLimit(data.rate_limit || 100);
      }
    } catch (error) {
      console.error("Error fetching MCP server config:", error);
    } finally {
      setLoading(false);
    }
  };

  const generateApiKey = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let key = "mcp_";
    for (let i = 0; i < 32; i++) {
      key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
  };

  const handleGenerateKey = async () => {
    setGeneratingKey(true);
    try {
      const newKey = generateApiKey();

      if (config) {
        const { error } = await supabase
          .from("mcp_server_config")
          .update({ api_key: newKey })
          .eq("id", config.id);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("mcp_server_config")
          .insert({
            workspace_id: workspaceId,
            api_key: newKey,
            is_enabled: false,
            allowed_tools: AVAILABLE_TOOLS.map(t => t.id),
          })
          .select()
          .single();

        if (error) throw error;
        setConfig({
          ...data,
          allowed_tools: data.allowed_tools as string[],
        });
      }

      toast.success("Nova API key gerada!");
      fetchConfig();
    } catch (error) {
      console.error("Error generating API key:", error);
      toast.error("Erro ao gerar API key");
    } finally {
      setGeneratingKey(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (config) {
        const { error } = await supabase
          .from("mcp_server_config")
          .update({
            is_enabled: isEnabled,
            allowed_tools: allowedTools,
            rate_limit: rateLimit,
          })
          .eq("id", config.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("mcp_server_config")
          .insert({
            workspace_id: workspaceId,
            is_enabled: isEnabled,
            allowed_tools: allowedTools,
            rate_limit: rateLimit,
          });

        if (error) throw error;
      }

      toast.success("Configuração salva!");
      fetchConfig();
    } catch (error) {
      console.error("Error saving config:", error);
      toast.error("Erro ao salvar configuração");
    } finally {
      setSaving(false);
    }
  };

  const handleCopyUrl = () => {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mcp-server`;
    navigator.clipboard.writeText(url);
    toast.success("URL copiada!");
  };

  const handleCopyApiKey = () => {
    if (config?.api_key) {
      navigator.clipboard.writeText(config.api_key);
      toast.success("API key copiada!");
    }
  };

  const handleToolToggle = (toolId: string, checked: boolean) => {
    if (checked) {
      setAllowedTools([...allowedTools, toolId]);
    } else {
      setAllowedTools(allowedTools.filter(t => t !== toolId));
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const mcpUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mcp-server`;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5 text-primary" />
              Servidor MCP Thoth
            </CardTitle>
            <CardDescription>
              Exponha sua aplicação como um servidor MCP para que outras aplicações possam se conectar
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {isEnabled ? "Ativo" : "Desativado"}
            </span>
            <Switch
              checked={isEnabled}
              onCheckedChange={setIsEnabled}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Server URL */}
        <div className="space-y-2">
          <Label>URL do Servidor MCP</Label>
          <div className="flex items-center gap-2">
            <Input
              value={mcpUrl}
              readOnly
              className="font-mono text-sm"
            />
            <Button variant="outline" size="icon" onClick={handleCopyUrl}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Use esta URL para conectar outras aplicações ao seu servidor MCP
          </p>
        </div>

        {/* API Key */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Key className="h-4 w-4" />
            API Key
          </Label>
          <div className="flex items-center gap-2">
            <Input
              value={config?.api_key || "Nenhuma chave gerada"}
              readOnly
              type={config?.api_key ? "password" : "text"}
              className="font-mono text-sm"
            />
            {config?.api_key && (
              <Button variant="outline" size="icon" onClick={handleCopyApiKey}>
                <Copy className="h-4 w-4" />
              </Button>
            )}
            <Button 
              variant="outline" 
              onClick={handleGenerateKey}
              disabled={generatingKey}
            >
              {generatingKey ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Esta chave será usada para autenticar requisições ao seu servidor MCP
          </p>
        </div>

        {/* Rate Limit */}
        <div className="space-y-2">
          <Label htmlFor="rate_limit">Limite de Requisições (por minuto)</Label>
          <Input
            id="rate_limit"
            type="number"
            value={rateLimit}
            onChange={(e) => setRateLimit(parseInt(e.target.value) || 100)}
            min={1}
            max={1000}
          />
        </div>

        {/* Allowed Tools */}
        <div className="space-y-3">
          <Label className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Ferramentas Expostas
          </Label>
          <p className="text-sm text-muted-foreground">
            Selecione quais ferramentas serão disponibilizadas via MCP
          </p>
          <div className="grid gap-3">
            {AVAILABLE_TOOLS.map((tool) => (
              <div key={tool.id} className="flex items-start space-x-3">
                <Checkbox
                  id={tool.id}
                  checked={allowedTools.includes(tool.id)}
                  onCheckedChange={(checked) => handleToolToggle(tool.id, !!checked)}
                />
                <div className="grid gap-1 leading-none">
                  <label
                    htmlFor={tool.id}
                    className="text-sm font-medium cursor-pointer"
                  >
                    {tool.name}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {tool.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Status */}
        {isEnabled && config?.api_key && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <div className="text-sm text-green-700 dark:text-green-300">
              Servidor MCP ativo e pronto para receber conexões
            </div>
          </div>
        )}

        {/* Save Button */}
        <Button onClick={handleSave} disabled={saving} className="w-full">
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Salvando...
            </>
          ) : (
            "Salvar Configuração"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

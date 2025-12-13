import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  MessageSquare,
  Zap,
  Webhook,
  Key,
  ExternalLink,
  Loader2,
  Settings,
  AlertCircle,
  Building2,
  CheckCircle2,
  XCircle,
  Copy,
  Star,
  ChevronRight,
  Users,
  RefreshCw,
  ArrowLeftRight,
} from "lucide-react";

interface Integration {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown> | null;
  is_active: boolean;
  last_sync_at: string | null;
}

interface Instance {
  id: string;
  name: string;
  phone_number: string | null;
  status: string;
}

const integrationTypes = [
  {
    type: "wapi",
    name: "W-API",
    description: "Conecte ao WhatsApp Business via W-API para enviar e receber mensagens.",
    icon: MessageSquare,
    color: "bg-green-500",
    fields: [
      { key: "api_key", label: "API Key", type: "password", placeholder: "Sua chave da W-API" },
      { key: "instance_id", label: "Instance ID", type: "text", placeholder: "ID da instância W-API" },
    ],
    docs: "https://w-api.io/docs",
  },
  {
    type: "openai",
    name: "OpenAI",
    description: "Use modelos GPT para respostas avançadas de IA.",
    icon: Zap,
    color: "bg-purple-500",
    fields: [
      { key: "api_key", label: "API Key", type: "password", placeholder: "sk-..." },
    ],
    docs: "https://platform.openai.com/docs",
  },
  {
    type: "elevenlabs",
    name: "ElevenLabs",
    description: "Text-to-Speech para respostas em áudio com vozes naturais.",
    icon: MessageSquare,
    color: "bg-blue-500",
    fields: [
      { key: "api_key", label: "API Key", type: "password", placeholder: "Sua chave ElevenLabs" },
      { key: "voice_id", label: "Voice ID", type: "text", placeholder: "ID da voz padrão" },
    ],
    docs: "https://elevenlabs.io/docs",
  },
  {
    type: "webhook",
    name: "Webhook",
    description: "Envie eventos para URLs externas via webhooks.",
    icon: Webhook,
    color: "bg-orange-500",
    fields: [
      { key: "url", label: "Webhook URL", type: "text", placeholder: "https://..." },
      { key: "secret", label: "Secret (opcional)", type: "password", placeholder: "Chave secreta" },
    ],
    docs: null,
  },
  {
    type: "n8n",
    name: "n8n",
    description: "Integre com workflows do n8n para automações avançadas.",
    icon: Zap,
    color: "bg-red-500",
    fields: [
      { key: "webhook_url", label: "Webhook URL", type: "text", placeholder: "URL do webhook n8n" },
    ],
    docs: "https://docs.n8n.io",
  },
];

// Bitrix24 App URLs
const BITRIX24_HANDLER_URL = "https://ybqwwipwimnkonnebbys.supabase.co/functions/v1/bitrix24-install";
const BITRIX24_INITIAL_INSTALL_URL = typeof window !== "undefined" 
  ? `${window.location.origin}/bitrix24-setup`
  : "https://seu-dominio.lovable.app/bitrix24-setup";

export default function Integrations() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<typeof integrationTypes[0] | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const { workspace } = useWorkspace();

  // Bitrix24 specific states
  const [bitrixWebhookUrl, setBitrixWebhookUrl] = useState("");
  const [bitrixConnectorId, setBitrixConnectorId] = useState("thoth_whatsapp");
  const [bitrixInstanceId, setBitrixInstanceId] = useState("");
  const [registeringBitrix, setRegisteringBitrix] = useState(false);
  const [bitrixConfigMode, setBitrixConfigMode] = useState<"webhook" | "app">("app");
  const [syncingContacts, setSyncingContacts] = useState(false);
  const [syncDirection, setSyncDirection] = useState<"both" | "to_bitrix" | "from_bitrix">("both");

  useEffect(() => {
    if (workspace) {
      fetchIntegrations();
      fetchInstances();
    }
  }, [workspace]);

  const fetchIntegrations = async () => {
    try {
      const { data, error } = await supabase
        .from("integrations")
        .select("*")
        .eq("workspace_id", workspace?.id);

      if (error) throw error;
      
      const mappedData: Integration[] = (data || []).map((item) => ({
        id: item.id,
        type: item.type,
        name: item.name,
        config: item.config as Record<string, unknown> | null,
        is_active: item.is_active,
        last_sync_at: item.last_sync_at,
      }));
      
      setIntegrations(mappedData);

      // Load Bitrix24 config if exists
      const bitrixIntegration = mappedData.find((i) => i.type === "bitrix24");
      if (bitrixIntegration?.config) {
        setBitrixWebhookUrl((bitrixIntegration.config.webhook_url as string) || "");
        setBitrixConnectorId((bitrixIntegration.config.connector_id as string) || "thoth_whatsapp");
        setBitrixInstanceId((bitrixIntegration.config.instance_id as string) || "");
        // If has member_id, it was installed via internal app
        if (bitrixIntegration.config.member_id) {
          setBitrixConfigMode("app");
        }
      }
    } catch (error) {
      console.error("Error fetching integrations:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchInstances = async () => {
    try {
      const { data, error } = await supabase
        .from("instances")
        .select("id, name, phone_number, status")
        .eq("workspace_id", workspace?.id);

      if (error) throw error;
      setInstances(data || []);
    } catch (error) {
      console.error("Error fetching instances:", error);
    }
  };

  const handleOpenConfig = (type: typeof integrationTypes[0]) => {
    setSelectedType(type);
    const existing = integrations.find((i) => i.type === type.type);
    if (existing && existing.config) {
      setFormData(existing.config as Record<string, string>);
    } else {
      setFormData({});
    }
    setDialogOpen(true);
  };

  const handleSaveIntegration = async () => {
    if (!selectedType) return;

    setSaving(true);
    try {
      const existing = integrations.find((i) => i.type === selectedType.type);

      if (existing) {
        const { error } = await supabase
          .from("integrations")
          .update({
            config: formData,
            is_active: true,
          })
          .eq("id", existing.id);

        if (error) throw error;
      } else {
        const { error } = await supabase.from("integrations").insert({
          workspace_id: workspace?.id,
          type: selectedType.type,
          name: selectedType.name,
          config: formData,
          is_active: true,
        });

        if (error) throw error;
      }

      toast.success("Integração salva!");
      setDialogOpen(false);
      fetchIntegrations();
    } catch (error) {
      console.error("Error saving integration:", error);
      toast.error("Erro ao salvar integração");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleIntegration = async (integration: Integration) => {
    try {
      const { error } = await supabase
        .from("integrations")
        .update({ is_active: !integration.is_active })
        .eq("id", integration.id);

      if (error) throw error;
      toast.success(integration.is_active ? "Integração desativada" : "Integração ativada");
      fetchIntegrations();
    } catch (error) {
      console.error("Error toggling integration:", error);
      toast.error("Erro ao alterar status");
    }
  };

  const getIntegrationStatus = (type: string) => {
    return integrations.find((i) => i.type === type);
  };

  const handleRegisterBitrix24 = async () => {
    if (!bitrixWebhookUrl || !bitrixConnectorId) {
      toast.error("Preencha a URL do Webhook e o ID do Conector");
      return;
    }

    setRegisteringBitrix(true);
    try {
      const existingBitrix = integrations.find((i) => i.type === "bitrix24");

      const response = await supabase.functions.invoke("bitrix24-register", {
        body: {
          webhook_url: bitrixWebhookUrl,
          connector_id: bitrixConnectorId,
          instance_id: bitrixInstanceId || null,
          workspace_id: workspace?.id,
          integration_id: existingBitrix?.id || null,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || "Erro ao registrar conector");
      }

      toast.success("Conector Bitrix24 registrado com sucesso!");
      fetchIntegrations();
    } catch (error) {
      console.error("Error registering Bitrix24:", error);
      toast.error(error instanceof Error ? error.message : "Erro ao registrar conector");
    } finally {
      setRegisteringBitrix(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado!`);
  };

  const handleSyncContacts = async () => {
    if (!workspace?.id) {
      toast.error("Workspace não encontrado");
      return;
    }

    const bitrix = integrations.find((i) => i.type === "bitrix24");
    if (!bitrix || !bitrix.is_active) {
      toast.error("Integração Bitrix24 não está ativa");
      return;
    }

    setSyncingContacts(true);
    try {
      const response = await supabase.functions.invoke("bitrix24-sync-contacts", {
        body: {
          workspace_id: workspace.id,
          instance_id: bitrixInstanceId || (bitrix.config?.instance_id as string) || null,
          direction: syncDirection,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || "Erro ao sincronizar contatos");
      }

      const stats = response.data?.stats;
      if (stats) {
        toast.success(
          `Sincronização concluída: ${stats.synced_from_bitrix} importados, ${stats.synced_to_bitrix} exportados, ${stats.updated} atualizados`
        );
      } else {
        toast.success("Contatos sincronizados com sucesso!");
      }
    } catch (error) {
      console.error("Error syncing contacts:", error);
      toast.error(error instanceof Error ? error.message : "Erro ao sincronizar contatos");
    } finally {
      setSyncingContacts(false);
    }
  };

  const bitrixIntegration = getIntegrationStatus("bitrix24");
  const bitrixConfig = bitrixIntegration?.config || {};

  return (
    <AppLayout title="Integrações">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Settings className="h-7 w-7 text-primary" />
            Integrações
          </h2>
          <p className="text-muted-foreground">
            Conecte serviços externos para expandir as funcionalidades do thoth.AI
          </p>
        </div>

        <Tabs defaultValue="wapi">
          <TabsList>
            <TabsTrigger value="wapi" className="gap-2">
              <MessageSquare className="h-4 w-4" />
              W-API
            </TabsTrigger>
            <TabsTrigger value="crm" className="gap-2">
              <Building2 className="h-4 w-4" />
              CRM
            </TabsTrigger>
            <TabsTrigger value="ai" className="gap-2">
              <Zap className="h-4 w-4" />
              IA & Voz
            </TabsTrigger>
            <TabsTrigger value="webhooks" className="gap-2">
              <Webhook className="h-4 w-4" />
              Webhooks
            </TabsTrigger>
          </TabsList>

          <TabsContent value="wapi" className="mt-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-xl bg-green-500/10 flex items-center justify-center">
                      <MessageSquare className="h-6 w-6 text-green-500" />
                    </div>
                    <div>
                      <CardTitle>W-API</CardTitle>
                      <CardDescription>
                        Integração oficial para WhatsApp Business API
                      </CardDescription>
                    </div>
                  </div>
                  {getIntegrationStatus("wapi") ? (
                    <Badge variant="outline" className="gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-green-500" />
                      Conectado
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Não configurado</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">Como funciona a integração W-API:</p>
                      <ol className="list-decimal list-inside text-muted-foreground mt-2 space-y-1">
                        <li>Crie uma conta em <a href="https://w-api.io" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">w-api.io</a></li>
                        <li>Assine o plano PRO (R$ 29,90/número)</li>
                        <li>Crie uma instância e copie a API Key</li>
                        <li>Cole a API Key abaixo para conectar</li>
                      </ol>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={() => handleOpenConfig(integrationTypes.find((t) => t.type === "wapi")!)}
                  >
                    <Key className="h-4 w-4 mr-2" />
                    {getIntegrationStatus("wapi") ? "Atualizar Configuração" : "Configurar W-API"}
                  </Button>
                  <Button variant="outline" asChild>
                    <a href="https://w-api.io/docs" target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Documentação
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Bitrix24 CRM Tab */}
          <TabsContent value="crm" className="mt-6 space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-xl bg-sky-500/10 flex items-center justify-center">
                      <Building2 className="h-6 w-6 text-sky-500" />
                    </div>
                    <div>
                      <CardTitle>Bitrix24 Open Channels</CardTitle>
                      <CardDescription>
                        Conecte o WhatsApp diretamente ao seu Bitrix24 CRM
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {bitrixIntegration && (
                      <Switch
                        checked={bitrixIntegration.is_active}
                        onCheckedChange={() => handleToggleIntegration(bitrixIntegration)}
                      />
                    )}
                    {bitrixIntegration?.is_active && bitrixConfig.registered ? (
                      <Badge variant="outline" className="gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-green-500" />
                        Conectado
                      </Badge>
                    ) : bitrixIntegration ? (
                      <Badge variant="secondary">Inativo</Badge>
                    ) : (
                      <Badge variant="secondary">Não configurado</Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Config Mode Tabs */}
                <div className="flex gap-2">
                  <Button
                    variant={bitrixConfigMode === "app" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setBitrixConfigMode("app")}
                    className="gap-2"
                  >
                    <Star className="h-4 w-4" />
                    App Interno (Recomendado)
                  </Button>
                  <Button
                    variant={bitrixConfigMode === "webhook" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setBitrixConfigMode("webhook")}
                  >
                    Webhook Manual
                  </Button>
                </div>

                {/* App Interno Mode */}
                {bitrixConfigMode === "app" && (
                  <div className="space-y-6">
                    {/* Benefits */}
                    <div className="bg-sky-500/5 border border-sky-500/20 rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        <Star className="h-5 w-5 text-sky-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium text-sky-600 dark:text-sky-400">Vantagens do App Interno</p>
                          <ul className="text-sm text-muted-foreground mt-1 space-y-1">
                            <li>✓ Detecção automática do domínio Bitrix24</li>
                            <li>✓ Tokens OAuth gerenciados automaticamente</li>
                            <li>✓ Renovação automática de credenciais</li>
                            <li>✓ Não precisa copiar URLs manualmente</li>
                          </ul>
                        </div>
                      </div>
                    </div>

                    {/* Step-by-step Instructions */}
                    <Accordion type="single" collapsible defaultValue="step1">
                      <AccordionItem value="step1">
                        <AccordionTrigger className="text-sm">
                          <div className="flex items-center gap-3">
                            <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">1</div>
                            Criar Aplicativo Local no Bitrix24
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="text-sm text-muted-foreground pl-9">
                          <ol className="list-decimal list-inside space-y-2">
                            <li>Acesse seu Bitrix24</li>
                            <li>Vá em <strong>Aplicativos</strong> → <strong>Marketplace</strong></li>
                            <li>Clique em <strong>Aplicativos Locais</strong> (menu à esquerda)</li>
                            <li>Clique em <strong>Adicionar</strong></li>
                            <li>Selecione <strong>"Aplicativo do servidor"</strong></li>
                          </ol>
                        </AccordionContent>
                      </AccordionItem>

                      <AccordionItem value="step2">
                        <AccordionTrigger className="text-sm">
                          <div className="flex items-center gap-3">
                            <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">2</div>
                            Configurar URLs do Aplicativo
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="space-y-4 pl-9">
                          <p className="text-sm text-muted-foreground">
                            Copie estas URLs para os campos correspondentes:
                          </p>
                          
                          <div className="space-y-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Handler URL (URL do manipulador)</Label>
                              <div className="flex gap-2">
                                <Input
                                  readOnly
                                  value={BITRIX24_HANDLER_URL}
                                  className="font-mono text-xs bg-muted"
                                />
                                <Button
                                  variant="outline"
                                  size="icon"
                                  onClick={() => copyToClipboard(BITRIX24_HANDLER_URL, "Handler URL")}
                                >
                                  <Copy className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>

                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Initial Install URL (URL de instalação inicial)</Label>
                              <div className="flex gap-2">
                                <Input
                                  readOnly
                                  value={BITRIX24_INITIAL_INSTALL_URL}
                                  className="font-mono text-xs bg-muted"
                                />
                                <Button
                                  variant="outline"
                                  size="icon"
                                  onClick={() => copyToClipboard(BITRIX24_INITIAL_INSTALL_URL, "Initial Install URL")}
                                >
                                  <Copy className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>

                      <AccordionItem value="step3">
                        <AccordionTrigger className="text-sm">
                          <div className="flex items-center gap-3">
                            <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">3</div>
                            Selecionar Permissões
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="pl-9">
                          <p className="text-sm text-muted-foreground mb-3">
                            Marque as seguintes permissões:
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="secondary" className="font-mono">imopenlines</Badge>
                            <Badge variant="secondary" className="font-mono">imconnector</Badge>
                            <Badge variant="secondary" className="font-mono">im</Badge>
                            <Badge variant="secondary" className="font-mono">crm</Badge>
                          </div>
                        </AccordionContent>
                      </AccordionItem>

                      <AccordionItem value="step4">
                        <AccordionTrigger className="text-sm">
                          <div className="flex items-center gap-3">
                            <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">4</div>
                            Instalar e Configurar
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="text-sm text-muted-foreground pl-9">
                          <ol className="list-decimal list-inside space-y-2">
                            <li>Clique em <strong>Salvar</strong> para criar o aplicativo</li>
                            <li>Clique em <strong>Instalar</strong></li>
                            <li>A tela do Thoth abrirá dentro do Bitrix24</li>
                            <li>Escolha a instância W-API para conectar</li>
                            <li>Clique em <strong>Ativar Conector</strong></li>
                          </ol>
                        </AccordionContent>
                      </AccordionItem>

                      <AccordionItem value="step5">
                        <AccordionTrigger className="text-sm">
                          <div className="flex items-center gap-3">
                            <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">5</div>
                            Adicionar Canal no Open Channels
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="text-sm text-muted-foreground pl-9">
                          <ol className="list-decimal list-inside space-y-2">
                            <li>No Bitrix24, vá em <strong>Open Channels</strong> → <strong>Adicionar canal</strong></li>
                            <li>Escolha <strong>Thoth WhatsApp</strong> na lista</li>
                            <li>Configure as opções do canal (horário, equipe, etc.)</li>
                            <li>Pronto! As mensagens do WhatsApp chegarão no Bitrix24</li>
                          </ol>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>

                    {/* Status if installed via app */}
                    {bitrixConfig.member_id && (
                      <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-5 w-5 text-green-500" />
                          <span className="font-medium text-green-600 dark:text-green-400">
                            App instalado em: {String(bitrixConfig.domain || "")}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Webhook Manual Mode */}
                {bitrixConfigMode === "webhook" && (
                  <div className="space-y-6">
                    {/* Instructions */}
                    <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-3">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="h-5 w-5 text-sky-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium">Como configurar o Bitrix24:</p>
                          <ol className="list-decimal list-inside text-muted-foreground mt-2 space-y-1">
                            <li>Acesse seu Bitrix24 → Aplicativos → Webhooks</li>
                            <li>Crie um webhook de saída com permissões: <code className="bg-muted px-1 rounded">imopenlines, imconnector, im, crm</code></li>
                            <li>Copie a URL do webhook e cole abaixo</li>
                            <li>Clique em "Registrar Conector"</li>
                            <li>No Bitrix24, vá em Open Channels → Adicionar canal → Escolha "Thoth WhatsApp"</li>
                          </ol>
                        </div>
                      </div>
                    </div>

                    {/* Config Form */}
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="bitrix-webhook">Webhook URL do Bitrix24</Label>
                        <Input
                          id="bitrix-webhook"
                          placeholder="https://seudominio.bitrix24.com.br/rest/1/xxxxx/"
                          value={bitrixWebhookUrl}
                          onChange={(e) => setBitrixWebhookUrl(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          Ex: https://seudominio.bitrix24.com.br/rest/1/abcd1234efgh5678/
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="bitrix-connector">ID do Conector</Label>
                        <Input
                          id="bitrix-connector"
                          placeholder="thoth_whatsapp"
                          value={bitrixConnectorId}
                          onChange={(e) => setBitrixConnectorId(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          Identificador único do seu conector (use letras e underscores)
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="bitrix-instance">Instância W-API</Label>
                        <Select value={bitrixInstanceId} onValueChange={setBitrixInstanceId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione uma instância" />
                          </SelectTrigger>
                          <SelectContent>
                            {instances.map((inst) => (
                              <SelectItem key={inst.id} value={inst.id}>
                                {inst.name} {inst.phone_number ? `(${inst.phone_number})` : ""} 
                                {inst.status === "connected" && " ✓"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          Qual número WhatsApp será usado para este Open Channel
                        </p>
                      </div>
                    </div>

                    {/* Status */}
                    {bitrixIntegration?.config && !bitrixConfig.member_id && (
                      <div className="bg-muted/30 rounded-lg p-4 space-y-2">
                        <p className="text-sm font-medium">Status do Conector:</p>
                        <div className="flex flex-wrap gap-3 text-sm">
                          <div className="flex items-center gap-1.5">
                            {bitrixConfig.registered ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
                            ) : (
                              <XCircle className="h-4 w-4 text-muted-foreground" />
                            )}
                            Registrado
                          </div>
                          <div className="flex items-center gap-1.5">
                            {bitrixConfig.events_url ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
                            ) : (
                              <XCircle className="h-4 w-4 text-muted-foreground" />
                            )}
                            Eventos vinculados
                          </div>
                          <div className="flex items-center gap-1.5">
                            {bitrixConfig.instance_id ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
                            ) : (
                              <XCircle className="h-4 w-4 text-muted-foreground" />
                            )}
                            Instância configurada
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-3">
                      <Button onClick={handleRegisterBitrix24} disabled={registeringBitrix}>
                        {registeringBitrix ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Registrando...
                          </>
                        ) : (
                          <>
                            <Building2 className="h-4 w-4 mr-2" />
                            {bitrixIntegration ? "Atualizar Conector" : "Registrar Conector"}
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Documentation Link */}
                <div className="pt-4 border-t">
                  <Button variant="outline" asChild>
                    <a href="https://apidocs.bitrix24.com/api-reference/imopenlines/index.html" target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Documentação Bitrix24
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Contact Sync Card */}
            {bitrixIntegration?.is_active && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                        <Users className="h-6 w-6 text-emerald-500" />
                      </div>
                      <div>
                        <CardTitle>Sincronização de Contatos</CardTitle>
                        <CardDescription>
                          Sincronize contatos entre WhatsApp e Bitrix24 CRM
                        </CardDescription>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="bg-muted/50 rounded-lg p-4 text-sm">
                    <div className="flex items-start gap-2">
                      <ArrowLeftRight className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">Sincronização bidirecional:</p>
                        <ul className="text-muted-foreground mt-1 space-y-1">
                          <li>• <strong>Do Bitrix24:</strong> Importa contatos do CRM para o WhatsApp</li>
                          <li>• <strong>Para o Bitrix24:</strong> Exporta contatos do WhatsApp para o CRM</li>
                          <li>• <strong>Ambos:</strong> Sincroniza em ambas as direções</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Direção da Sincronização</Label>
                      <Select value={syncDirection} onValueChange={(v) => setSyncDirection(v as typeof syncDirection)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="both">Bidirecional (recomendado)</SelectItem>
                          <SelectItem value="from_bitrix">Importar do Bitrix24</SelectItem>
                          <SelectItem value="to_bitrix">Exportar para o Bitrix24</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Instância WhatsApp</Label>
                      <Select value={bitrixInstanceId} onValueChange={setBitrixInstanceId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Usar instância configurada" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">Usar instância configurada</SelectItem>
                          {instances.map((inst) => (
                            <SelectItem key={inst.id} value={inst.id}>
                              {inst.name} {inst.phone_number ? `(${inst.phone_number})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <Button onClick={handleSyncContacts} disabled={syncingContacts} className="gap-2">
                    {syncingContacts ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Sincronizando...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4" />
                        Sincronizar Contatos
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="ai" className="mt-6 space-y-4">
            {integrationTypes
              .filter((t) => ["openai", "elevenlabs"].includes(t.type))
              .map((intType) => {
                const status = getIntegrationStatus(intType.type);
                return (
                  <Card key={intType.type}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className={`h-12 w-12 rounded-xl ${intType.color}/10 flex items-center justify-center`}>
                            <intType.icon className={`h-6 w-6 text-${intType.color.replace("bg-", "")}`} />
                          </div>
                          <div>
                            <CardTitle>{intType.name}</CardTitle>
                            <CardDescription>{intType.description}</CardDescription>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {status && (
                            <Switch
                              checked={status.is_active}
                              onCheckedChange={() => handleToggleIntegration(status)}
                            />
                          )}
                          {status ? (
                            <Badge variant="outline" className="gap-1.5">
                              <span className="h-2 w-2 rounded-full bg-green-500" />
                              Conectado
                            </Badge>
                          ) : (
                            <Badge variant="secondary">Não configurado</Badge>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <Button variant="outline" onClick={() => handleOpenConfig(intType)}>
                        <Settings className="h-4 w-4 mr-2" />
                        {status ? "Editar" : "Configurar"}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
          </TabsContent>

          <TabsContent value="webhooks" className="mt-6 space-y-4">
            {integrationTypes
              .filter((t) => ["webhook", "n8n"].includes(t.type))
              .map((intType) => {
                const status = getIntegrationStatus(intType.type);
                return (
                  <Card key={intType.type}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className={`h-12 w-12 rounded-xl ${intType.color}/10 flex items-center justify-center`}>
                            <intType.icon className={`h-6 w-6`} />
                          </div>
                          <div>
                            <CardTitle>{intType.name}</CardTitle>
                            <CardDescription>{intType.description}</CardDescription>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {status && (
                            <Switch
                              checked={status.is_active}
                              onCheckedChange={() => handleToggleIntegration(status)}
                            />
                          )}
                          {status ? (
                            <Badge variant="outline" className="gap-1.5">
                              <span className="h-2 w-2 rounded-full bg-green-500" />
                              Ativo
                            </Badge>
                          ) : (
                            <Badge variant="secondary">Não configurado</Badge>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <Button variant="outline" onClick={() => handleOpenConfig(intType)}>
                        <Settings className="h-4 w-4 mr-2" />
                        {status ? "Editar" : "Configurar"}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
          </TabsContent>
        </Tabs>

        {/* Config Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {selectedType && <selectedType.icon className="h-5 w-5" />}
                Configurar {selectedType?.name}
              </DialogTitle>
              <DialogDescription>{selectedType?.description}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {selectedType?.fields.map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={field.key}>{field.label}</Label>
                  <Input
                    id={field.key}
                    type={field.type}
                    placeholder={field.placeholder}
                    value={formData[field.key] || ""}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>

            <DialogFooter>
              {selectedType?.docs && (
                <Button variant="link" asChild className="mr-auto">
                  <a href={selectedType.docs} target="_blank" rel="noopener noreferrer">
                    Ver documentação
                  </a>
                </Button>
              )}
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSaveIntegration} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  "Salvar"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}

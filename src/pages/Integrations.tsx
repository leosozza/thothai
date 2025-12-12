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
          <TabsContent value="crm" className="mt-6">
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
                {bitrixIntegration?.config && (
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
                  <Button variant="outline" asChild>
                    <a href="https://apidocs.bitrix24.com/api-reference/imopenlines/index.html" target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Documentação Bitrix24
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
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

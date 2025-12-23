import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  Plus,
  Smartphone,
  Wifi,
  WifiOff,
  QrCode,
  Loader2,
  Trash2,
  Settings,
  RefreshCw,
  Shield,
  MessageSquare,
} from "lucide-react";

interface Instance {
  id: string;
  name: string;
  phone_number: string | null;
  status: string;
  instance_key: string | null;
  profile_picture_url: string | null;
  qr_code: string | null;
  created_at: string;
  connection_type?: string;
  provider_type?: string;
  evolution_instance_name?: string | null;
  gupshup_app_id?: string | null;
}

const statusConfig: Record<string, { label: string; color: string; icon: typeof Wifi }> = {
  connected: { label: "Conectado", color: "bg-green-500", icon: Wifi },
  disconnected: { label: "Desconectado", color: "bg-gray-400", icon: WifiOff },
  connecting: { label: "Conectando...", color: "bg-yellow-500", icon: RefreshCw },
  qr_pending: { label: "Aguardando QR", color: "bg-blue-500", icon: QrCode },
};

type ConnectionType = "waba" | "official" | "evolution";

export default function Instances() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newInstanceName, setNewInstanceName] = useState("");
  const [connectionType, setConnectionType] = useState<ConnectionType>("waba");
  const [evolutionInstanceName, setEvolutionInstanceName] = useState("");
  const [gupshupApiKey, setGupshupApiKey] = useState("");
  const [gupshupAppId, setGupshupAppId] = useState("");
  const [gupshupPhoneNumber, setGupshupPhoneNumber] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [connectingInstance, setConnectingInstance] = useState<Instance | null>(null);
  const [connecting, setConnecting] = useState(false);
  const { user } = useAuth();
  const { workspace } = useWorkspace();

  useEffect(() => {
    if (user) {
      fetchInstances();

      // Subscribe to realtime updates
      const channel = supabase
        .channel("instances-changes")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "instances",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            console.log("Instance update:", payload);
            fetchInstances();
            
            // Check if instance got connected
            if (payload.eventType === "UPDATE" && payload.new) {
              const updated = payload.new as Instance;
              if (updated.status === "connected" && connectingInstance?.id === updated.id) {
                toast.success("WhatsApp conectado com sucesso!");
                setQrDialogOpen(false);
                setConnectingInstance(null);
              }
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user, connectingInstance]);

  const fetchInstances = async () => {
    try {
      const { data, error } = await supabase
        .from("instances")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setInstances(data || []);
    } catch (error) {
      console.error("Error fetching instances:", error);
      toast.error("Erro ao carregar instâncias");
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setNewInstanceName("");
    setConnectionType("waba");
    setEvolutionInstanceName("");
    setGupshupApiKey("");
    setGupshupAppId("");
    setGupshupPhoneNumber("");
  };

  const createInstance = async () => {
    if (!newInstanceName.trim()) {
      toast.error("Digite um nome para a instância");
      return;
    }

    if (connectionType === "official") {
      if (!gupshupApiKey.trim() || !gupshupAppId.trim()) {
        toast.error("Preencha a API Key e o App ID");
        return;
      }
    }

    if (connectionType === "evolution") {
      if (!evolutionInstanceName.trim()) {
        toast.error("Digite o nome da instância Evolution");
        return;
      }
    }

    setCreating(true);
    try {
      // Determine provider_type and initial status
      const providerType = connectionType === "evolution" ? "evolution" : connectionType === "official" ? "gupshup" : "wapi";
      const initialStatus = connectionType === "official" ? "connecting" : "disconnected";

      // Create instance in database
      const { data: newInstance, error } = await supabase.from("instances").insert({
        user_id: user?.id,
        workspace_id: workspace?.id,
        name: newInstanceName.trim(),
        status: initialStatus,
        connection_type: connectionType === "evolution" ? "waba" : connectionType,
        provider_type: providerType,
        evolution_instance_name: connectionType === "evolution" ? evolutionInstanceName.trim() : null,
      }).select().single();

      if (error) throw error;

      // Handle connection based on type
      if (connectionType === "official" && newInstance) {
        // Gupshup connection
        const response = await supabase.functions.invoke("gupshup-connect", {
          body: {
            instanceId: newInstance.id,
            workspaceId: workspace?.id,
            gupshupApiKey: gupshupApiKey.trim(),
            gupshupAppId: gupshupAppId.trim(),
            phoneNumber: gupshupPhoneNumber.trim() || null,
          },
        });

        if (response.error) {
          throw new Error(response.error.message || "Erro ao conectar Gupshup");
        }

        if (response.data?.error) {
          throw new Error(response.data.error);
        }

        toast.success("Instância criada e conectada com sucesso!");
      } else if (connectionType === "evolution" && newInstance) {
        // Evolution API connection
        const response = await supabase.functions.invoke("evolution-connect", {
          body: {
            instanceId: newInstance.id,
            workspaceId: workspace?.id,
            action: "create",
            evolutionInstanceName: evolutionInstanceName.trim(),
          },
        });

        if (response.error) {
          throw new Error(response.error.message || "Erro ao criar instância Evolution");
        }

        if (response.data?.error) {
          throw new Error(response.data.error);
        }

        toast.success("Instância Evolution criada! Clique em Conectar para escanear o QR Code.");
      } else {
        toast.success("Instância criada! Clique em Conectar para escanear o QR Code.");
      }

      resetForm();
      setDialogOpen(false);
      fetchInstances();
    } catch (error) {
      console.error("Error creating instance:", error);
      toast.error(error instanceof Error ? error.message : "Erro ao criar instância");
    } finally {
      setCreating(false);
    }
  };

  const deleteInstance = async (id: string) => {
    try {
      const { error } = await supabase.from("instances").delete().eq("id", id);

      if (error) throw error;

      toast.success("Instância removida");
      fetchInstances();
    } catch (error) {
      console.error("Error deleting instance:", error);
      toast.error("Erro ao remover instância");
    }
  };

  const connectInstance = async (instance: Instance) => {
    if (!workspace) {
      toast.error("Selecione um workspace");
      return;
    }

    // If it's an official (Gupshup) instance, show settings dialog instead
    if (instance.connection_type === "official") {
      toast.info("Para reconectar, edite as configurações da instância.");
      return;
    }

    setConnectingInstance(instance);
    setConnecting(true);
    setQrDialogOpen(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      // Determine which connect function to use based on provider_type
      const providerType = instance.provider_type || "wapi";
      const connectFunction = providerType === "evolution" ? "evolution-connect" : "wapi-connect";
      
      const response = await supabase.functions.invoke(connectFunction, {
        body: {
          instanceId: instance.id,
          workspaceId: workspace.id,
          action: "connect",
          evolutionInstanceName: instance.evolution_instance_name,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || "Erro ao conectar");
      }

      const data = response.data;

      if (data.error) {
        throw new Error(data.error);
      }

      if (data.status === "connected") {
        toast.success("WhatsApp já está conectado!");
        setQrDialogOpen(false);
        setConnectingInstance(null);
        fetchInstances();
      } else if (data.qr_code) {
        // QR Code received, will show in dialog
        setConnectingInstance({
          ...instance,
          qr_code: data.qr_code,
          status: "qr_pending",
        });
      } else {
        toast.info("Aguardando QR Code...");
      }
    } catch (error) {
      console.error("Error connecting instance:", error);
      toast.error(error instanceof Error ? error.message : "Erro ao conectar");
      setQrDialogOpen(false);
      setConnectingInstance(null);
    } finally {
      setConnecting(false);
    }
  };

  const refreshQrCode = async () => {
    if (!connectingInstance) return;
    setConnecting(true);
    await connectInstance(connectingInstance);
  };

  const getStatusBadge = (status: string) => {
    const config = statusConfig[status] || statusConfig.disconnected;
    const Icon = config.icon;

    return (
      <Badge variant="secondary" className="gap-1.5">
        <span className={`h-2 w-2 rounded-full ${config.color}`} />
        <Icon className={`h-3 w-3 ${status === "connecting" ? "animate-spin" : ""}`} />
        {config.label}
      </Badge>
    );
  };

const getConnectionTypeBadge = (connectionType?: string, providerType?: string) => {
    if (connectionType === "official") {
      return (
        <Badge variant="outline" className="gap-1 text-green-600 border-green-200 bg-green-50">
          <Shield className="h-3 w-3" />
          Gupshup
        </Badge>
      );
    }
    if (providerType === "evolution") {
      return (
        <Badge variant="outline" className="gap-1 text-emerald-600 border-emerald-200 bg-emerald-50">
          <MessageSquare className="h-3 w-3" />
          Evolution
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="gap-1 text-blue-600 border-blue-200 bg-blue-50">
        <QrCode className="h-3 w-3" />
        W-API
      </Badge>
    );
  };

  return (
    <AppLayout title="Instâncias WhatsApp">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Gerenciar Instâncias</h2>
            <p className="text-muted-foreground">
              Conecte e gerencie seus números do WhatsApp Business.
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) resetForm();
          }}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Nova Instância
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Criar Nova Instância</DialogTitle>
                <DialogDescription>
                  Configure seu número do WhatsApp Business.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-6 py-4">
                {/* Instance Name */}
                <div className="space-y-2">
                  <Label htmlFor="instance-name">Nome da Instância</Label>
                  <Input
                    id="instance-name"
                    placeholder="Ex: Vendas, Suporte, Marketing..."
                    value={newInstanceName}
                    onChange={(e) => setNewInstanceName(e.target.value)}
                    disabled={creating}
                  />
                </div>

                {/* Connection Type Selector */}
                <div className="space-y-3">
                  <Label>Tipo de Conexão</Label>
                  <RadioGroup 
                    value={connectionType} 
                    onValueChange={(v) => setConnectionType(v as ConnectionType)}
                    className="space-y-3"
                  >
                    <div className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                      <RadioGroupItem value="waba" id="waba" className="mt-1" />
                      <Label htmlFor="waba" className="flex-1 cursor-pointer">
                        <div className="flex items-center gap-2 font-medium">
                          <QrCode className="h-4 w-4 text-blue-500" />
                          W-API (QR Code)
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          Conecte via W-API escaneando o QR Code pelo celular.
                        </p>
                      </Label>
                    </div>
                    <div className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                      <RadioGroupItem value="evolution" id="evolution" className="mt-1" />
                      <Label htmlFor="evolution" className="flex-1 cursor-pointer">
                        <div className="flex items-center gap-2 font-medium">
                          <MessageSquare className="h-4 w-4 text-emerald-500" />
                          Evolution API (QR Code)
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          Conecte via seu servidor Evolution API.
                        </p>
                      </Label>
                    </div>
                    <div className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                      <RadioGroupItem value="official" id="official" className="mt-1" />
                      <Label htmlFor="official" className="flex-1 cursor-pointer">
                        <div className="flex items-center gap-2 font-medium">
                          <Shield className="h-4 w-4 text-green-500" />
                          Gupshup (API Oficial)
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          API oficial da Meta via Gupshup. Requer cadastro.
                        </p>
                      </Label>
                    </div>
                  </RadioGroup>
                </div>

                {/* Evolution API Fields */}
                {connectionType === "evolution" && (
                  <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
                    <div className="flex items-center gap-2 text-sm font-medium text-emerald-600">
                      <MessageSquare className="h-4 w-4" />
                      Configuração Evolution API
                    </div>
                    
                    <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
                      <p className="text-xs text-blue-700 dark:text-blue-300">
                        Certifique-se de ter configurado o servidor Evolution em{" "}
                        <strong>Configurações → Provedores</strong> antes de criar a instância.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="evolution-instance-name">Nome da Instância no Evolution *</Label>
                      <Input
                        id="evolution-instance-name"
                        placeholder="Ex: thoth-vendas"
                        value={evolutionInstanceName}
                        onChange={(e) => setEvolutionInstanceName(e.target.value)}
                        disabled={creating}
                      />
                      <p className="text-xs text-muted-foreground">
                        Nome único para identificar a instância no servidor Evolution
                      </p>
                    </div>
                  </div>
                )}

                {/* Gupshup Fields (only shown when official is selected) */}
                {connectionType === "official" && (
                  <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
                    <div className="flex items-center gap-2 text-sm font-medium text-green-600">
                      <Shield className="h-4 w-4" />
                      Configuração da API Oficial
                    </div>
                    
                    {/* Instructions block */}
                    <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
                      <p className="text-sm text-blue-800 dark:text-blue-200 font-medium mb-2">
                        📋 Como obter suas credenciais:
                      </p>
                      <ol className="text-xs text-blue-700 dark:text-blue-300 space-y-1 list-decimal list-inside">
                        <li>
                          Crie uma conta gratuita em{" "}
                          <a 
                            href="https://www.gupshup.io" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="underline font-medium hover:text-blue-900 dark:hover:text-blue-100"
                          >
                            gupshup.io
                          </a>
                        </li>
                        <li>Configure seu número WhatsApp Business no painel</li>
                        <li>Copie a API Key e App ID gerados</li>
                      </ol>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="gupshup-api-key">API Key *</Label>
                      <Input
                        id="gupshup-api-key"
                        type="password"
                        placeholder="Cole sua API Key do painel"
                        value={gupshupApiKey}
                        onChange={(e) => setGupshupApiKey(e.target.value)}
                        disabled={creating}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="gupshup-app-id">App ID / Source Name *</Label>
                      <Input
                        id="gupshup-app-id"
                        placeholder="Ex: MyApp ou nome do seu app"
                        value={gupshupAppId}
                        onChange={(e) => setGupshupAppId(e.target.value)}
                        disabled={creating}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="gupshup-phone">Número do WhatsApp (opcional)</Label>
                      <Input
                        id="gupshup-phone"
                        placeholder="5511999999999"
                        value={gupshupPhoneNumber}
                        onChange={(e) => setGupshupPhoneNumber(e.target.value)}
                        disabled={creating}
                      />
                      <p className="text-xs text-muted-foreground">
                        Formato internacional sem + ou espaços
                      </p>
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={createInstance} disabled={creating}>
                  {creating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {connectionType === "official" ? "Conectando..." : "Criando..."}
                    </>
                  ) : connectionType === "official" ? (
                    "Criar e Conectar"
                  ) : connectionType === "evolution" ? (
                    "Criar no Evolution"
                  ) : (
                    "Criar Instância"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* QR Code Dialog */}
        <Dialog open={qrDialogOpen} onOpenChange={(open) => {
          setQrDialogOpen(open);
          if (!open) setConnectingInstance(null);
        }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Conectar WhatsApp</DialogTitle>
              <DialogDescription>
                Escaneie o QR Code com seu WhatsApp para conectar.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center py-6">
              {connecting ? (
                <div className="flex flex-col items-center gap-4 py-8">
                  <Loader2 className="h-12 w-12 animate-spin text-primary" />
                  <p className="text-muted-foreground">Gerando QR Code...</p>
                </div>
              ) : connectingInstance?.qr_code ? (
                <>
                  <div className="bg-white p-4 rounded-lg shadow-sm">
                    <img
                      src={connectingInstance.qr_code.startsWith("data:")
                        ? connectingInstance.qr_code
                        : `data:image/png;base64,${connectingInstance.qr_code}`
                      }
                      alt="QR Code WhatsApp"
                      className="w-64 h-64"
                    />
                  </div>
                  <div className="mt-4 text-center space-y-2">
                    <p className="text-sm text-muted-foreground">
                      1. Abra o WhatsApp no seu celular
                    </p>
                    <p className="text-sm text-muted-foreground">
                      2. Vá em Menu &gt; Aparelhos conectados
                    </p>
                    <p className="text-sm text-muted-foreground">
                      3. Escaneie este QR Code
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="mt-4 gap-2"
                    onClick={refreshQrCode}
                    disabled={connecting}
                  >
                    <RefreshCw className="h-4 w-4" />
                    Gerar novo QR Code
                  </Button>
                </>
              ) : (
                <div className="flex flex-col items-center gap-4 py-8">
                  <QrCode className="h-16 w-16 text-muted-foreground" />
                  <p className="text-muted-foreground text-center">
                    Aguardando QR Code da W-API...
                  </p>
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={refreshQrCode}
                    disabled={connecting}
                  >
                    <RefreshCw className="h-4 w-4" />
                    Tentar novamente
                  </Button>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Instances Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : instances.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Smartphone className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="font-medium text-lg mb-2">Nenhuma instância</h3>
              <p className="text-muted-foreground text-sm max-w-sm mb-4">
                Crie sua primeira instância para conectar um número do WhatsApp.
              </p>
              <Button onClick={() => setDialogOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                Criar Instância
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {instances.map((instance) => (
              <Card key={instance.id} className="relative overflow-hidden">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                        {instance.profile_picture_url ? (
                          <img
                            src={instance.profile_picture_url}
                            alt={instance.name}
                            className="h-10 w-10 rounded-full object-cover"
                          />
                        ) : (
                          <Smartphone className="h-5 w-5 text-primary" />
                        )}
                      </div>
                      <div>
                        <CardTitle className="text-lg">{instance.name}</CardTitle>
                        <CardDescription>
                          {instance.phone_number || "Número não conectado"}
                        </CardDescription>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Provedor</span>
                    {getConnectionTypeBadge(instance.connection_type, instance.provider_type)}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Status</span>
                    {getStatusBadge(instance.status)}
                  </div>

                  <div className="flex gap-2">
                    {instance.status === "connected" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 gap-2 text-green-600"
                        disabled
                      >
                        <Wifi className="h-4 w-4" />
                        Conectado
                      </Button>
                    ) : instance.connection_type === "official" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 gap-2"
                        disabled
                      >
                        <Shield className="h-4 w-4" />
                        Verificar Conexão
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 gap-2"
                        onClick={() => connectInstance(instance)}
                      >
                        <QrCode className="h-4 w-4" />
                        Conectar
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => toast.info("Configurações em breve")}
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => deleteInstance(instance.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Info Card */}
        <Card className="bg-muted/50">
          <CardHeader>
            <CardTitle className="text-base">Sobre as Instâncias</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              • <strong>W-API</strong>: Conecta via W-API escaneando QR Code. Configure as credenciais em Configurações → Provedores.
            </p>
            <p>
              • <strong>Evolution API</strong>: Conecta via seu servidor Evolution. Configure a URL e API Key em Configurações → Provedores.
            </p>
            <p>
              • <strong>Gupshup</strong>: Usa a API oficial do WhatsApp via Gupshup. Requer conta verificada no Meta Business.
            </p>
            <p>
              • As mensagens recebidas aparecerão na página de Conversas independente do provedor escolhido.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

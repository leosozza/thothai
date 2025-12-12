import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  X,
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
}

const statusConfig: Record<string, { label: string; color: string; icon: typeof Wifi }> = {
  connected: { label: "Conectado", color: "bg-green-500", icon: Wifi },
  disconnected: { label: "Desconectado", color: "bg-gray-400", icon: WifiOff },
  connecting: { label: "Conectando...", color: "bg-yellow-500", icon: RefreshCw },
  qr_pending: { label: "Aguardando QR", color: "bg-blue-500", icon: QrCode },
};

export default function Instances() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newInstanceName, setNewInstanceName] = useState("");
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

  const createInstance = async () => {
    if (!newInstanceName.trim()) {
      toast.error("Digite um nome para a instância");
      return;
    }

    setCreating(true);
    try {
      const { error } = await supabase.from("instances").insert({
        user_id: user?.id,
        workspace_id: workspace?.id,
        name: newInstanceName.trim(),
        status: "disconnected",
      });

      if (error) throw error;

      toast.success("Instância criada com sucesso!");
      setNewInstanceName("");
      setDialogOpen(false);
      fetchInstances();
    } catch (error) {
      console.error("Error creating instance:", error);
      toast.error("Erro ao criar instância");
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

    setConnectingInstance(instance);
    setConnecting(true);
    setQrDialogOpen(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const response = await supabase.functions.invoke("wapi-connect", {
        body: {
          instanceId: instance.id,
          workspaceId: workspace.id,
          action: "connect",
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
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Nova Instância
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Criar Nova Instância</DialogTitle>
                <DialogDescription>
                  Dê um nome para identificar este número do WhatsApp.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
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
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={createInstance} disabled={creating}>
                  {creating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Criando...
                    </>
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
              • Cada instância representa um número do WhatsApp Business conectado.
            </p>
            <p>
              • Configure a W-API em Integrações antes de conectar.
            </p>
            <p>
              • As mensagens recebidas aparecerão na página de Conversas.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

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
} from "lucide-react";

interface Instance {
  id: string;
  name: string;
  phone_number: string | null;
  status: string;
  instance_key: string | null;
  profile_picture_url: string | null;
  created_at: string;
}

const statusConfig: Record<string, { label: string; color: string; icon: typeof Wifi }> = {
  connected: { label: "Conectado", color: "bg-status-connected", icon: Wifi },
  disconnected: { label: "Desconectado", color: "bg-status-disconnected", icon: WifiOff },
  connecting: { label: "Conectando...", color: "bg-status-pending", icon: RefreshCw },
  qr_pending: { label: "Aguardando QR", color: "bg-status-pending", icon: QrCode },
};

export default function Instances() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newInstanceName, setNewInstanceName] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const { user } = useAuth();

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
          () => {
            fetchInstances();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user]);

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

  const getStatusBadge = (status: string) => {
    const config = statusConfig[status] || statusConfig.disconnected;
    const Icon = config.icon;

    return (
      <Badge variant="secondary" className="gap-1.5">
        <span className={`h-2 w-2 rounded-full ${config.color}`} />
        <Icon className="h-3 w-3" />
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
                        <Smartphone className="h-5 w-5 text-primary" />
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
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 gap-2"
                      onClick={() => toast.info("Integração W-API será configurada em breve")}
                    >
                      <QrCode className="h-4 w-4" />
                      Conectar
                    </Button>
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
              • Você pode conectar até 5 instâncias no plano atual.
            </p>
            <p>
              • A integração com W-API será configurada na próxima etapa.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

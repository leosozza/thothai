import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Phone,
  User,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  RefreshCw,
  Play,
  Pause,
} from "lucide-react";

interface BatchCall {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  status: string;
  total_recipients: number;
  calls_dispatched: number;
  calls_completed: number;
  calls_failed: number;
  elevenlabs_batch_id: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  persona?: {
    id: string;
    name: string;
    avatar_url: string | null;
  };
  telephony_number?: {
    id: string;
    phone_number: string;
    friendly_name: string | null;
  };
}

interface Recipient {
  id: string;
  phone_number: string;
  name: string | null;
  status: string;
  called_at: string | null;
  duration_seconds: number | null;
  result_summary: string | null;
}

interface BatchDetailsDialogProps {
  batch: BatchCall;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
}

export function BatchDetailsDialog({ batch, open, onOpenChange, onRefresh }: BatchDetailsDialogProps) {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const { workspace } = useWorkspace();

  useEffect(() => {
    if (open) {
      fetchDetails();
    }
  }, [open, batch.id]);

  const fetchDetails = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("elevenlabs-batch-calls", {
        body: {
          action: "get_batch_status",
          workspace_id: workspace?.id,
          batch_id: batch.id,
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      setRecipients(data.recipients || []);
    } catch (error) {
      console.error("Error fetching batch details:", error);
      toast.error("Erro ao carregar detalhes");
    } finally {
      setLoading(false);
    }
  };

  const handleStartBatch = async () => {
    setActionLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("elevenlabs-batch-calls", {
        body: {
          action: "start_batch",
          workspace_id: workspace?.id,
          batch_id: batch.id,
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      toast.success("Campanha iniciada!");
      onRefresh();
    } catch (error: any) {
      console.error("Error starting batch:", error);
      toast.error(error.message || "Erro ao iniciar campanha");
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelBatch = async () => {
    setActionLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("elevenlabs-batch-calls", {
        body: {
          action: "cancel_batch",
          workspace_id: workspace?.id,
          batch_id: batch.id,
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      toast.success("Campanha cancelada");
      onRefresh();
    } catch (error: any) {
      console.error("Error cancelling batch:", error);
      toast.error(error.message || "Erro ao cancelar campanha");
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      pending: { label: "Pendente", variant: "secondary" },
      in_progress: { label: "Em Andamento", variant: "default" },
      completed: { label: "Concluída", variant: "secondary" },
      failed: { label: "Falhou", variant: "destructive" },
      no_answer: { label: "Sem Resposta", variant: "outline" },
    };

    const config = statusConfig[status] || { label: status, variant: "secondary" as const };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getProgressPercentage = () => {
    if (batch.total_recipients === 0) return 0;
    return Math.round(((batch.calls_completed + batch.calls_failed) / batch.total_recipients) * 100);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle>{batch.name}</DialogTitle>
              <DialogDescription>
                {batch.description || "Detalhes da campanha de chamadas"}
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={fetchDetails}>
                <RefreshCw className="h-4 w-4" />
              </Button>
              {batch.status === "draft" && (
                <Button size="sm" onClick={handleStartBatch} disabled={actionLoading}>
                  {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                  Iniciar
                </Button>
              )}
              {batch.status === "in_progress" && (
                <Button size="sm" variant="destructive" onClick={handleCancelBatch} disabled={actionLoading}>
                  {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4 mr-2" />}
                  Cancelar
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          <Tabs defaultValue="overview" className="h-full flex flex-col">
            <TabsList className="w-full">
              <TabsTrigger value="overview" className="flex-1">Visão Geral</TabsTrigger>
              <TabsTrigger value="recipients" className="flex-1">Destinatários</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="flex-1 overflow-auto">
              <div className="space-y-6 p-4">
                {/* Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 rounded-lg bg-secondary/50">
                    <p className="text-sm text-muted-foreground">Total</p>
                    <p className="text-2xl font-bold">{batch.total_recipients}</p>
                  </div>
                  <div className="p-4 rounded-lg bg-primary/10">
                    <p className="text-sm text-muted-foreground">Disparadas</p>
                    <p className="text-2xl font-bold">{batch.calls_dispatched}</p>
                  </div>
                  <div className="p-4 rounded-lg bg-success/10">
                    <p className="text-sm text-muted-foreground">Concluídas</p>
                    <p className="text-2xl font-bold text-success">{batch.calls_completed}</p>
                  </div>
                  <div className="p-4 rounded-lg bg-destructive/10">
                    <p className="text-sm text-muted-foreground">Falhas</p>
                    <p className="text-2xl font-bold text-destructive">{batch.calls_failed}</p>
                  </div>
                </div>

                {/* Progress */}
                {batch.status === "in_progress" && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>Progresso</span>
                      <span>{getProgressPercentage()}%</span>
                    </div>
                    <div className="h-3 bg-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${getProgressPercentage()}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Info */}
                <div className="space-y-3">
                  {batch.persona && (
                    <div className="flex items-center gap-2 text-sm">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Persona:</span>
                      <span>{batch.persona.name}</span>
                    </div>
                  )}
                  {batch.telephony_number && (
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Número:</span>
                      <span>
                        {batch.telephony_number.friendly_name || batch.telephony_number.phone_number}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Criada:</span>
                    <span>{format(new Date(batch.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</span>
                  </div>
                  {batch.started_at && (
                    <div className="flex items-center gap-2 text-sm">
                      <Play className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Iniciada:</span>
                      <span>{format(new Date(batch.started_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</span>
                    </div>
                  )}
                  {batch.completed_at && (
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Concluída:</span>
                      <span>{format(new Date(batch.completed_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</span>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="recipients" className="flex-1 overflow-hidden">
              {loading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <ScrollArea className="h-[400px]">
                  <div className="space-y-2 p-4">
                    {recipients.map((recipient) => (
                      <div
                        key={recipient.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-secondary/30"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-full bg-secondary">
                            <Phone className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="font-medium">
                              {recipient.name || recipient.phone_number}
                            </p>
                            {recipient.name && (
                              <p className="text-sm text-muted-foreground">{recipient.phone_number}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {recipient.duration_seconds && (
                            <span className="text-sm text-muted-foreground">
                              {Math.floor(recipient.duration_seconds / 60)}:
                              {(recipient.duration_seconds % 60).toString().padStart(2, "0")}
                            </span>
                          )}
                          {getStatusBadge(recipient.status)}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}

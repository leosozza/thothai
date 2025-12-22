import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  PhoneOutgoing,
  Plus,
  Play,
  Pause,
  Trash2,
  RefreshCw,
  Users,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  BarChart3,
} from "lucide-react";
import { CreateBatchDialog } from "./CreateBatchDialog";
import { BatchDetailsDialog } from "./BatchDetailsDialog";

interface BatchCall {
  id: string;
  workspace_id: string;
  persona_id: string | null;
  telephony_number_id: string | null;
  elevenlabs_batch_id: string | null;
  name: string;
  description: string | null;
  scheduled_time: string | null;
  total_recipients: number;
  calls_dispatched: number;
  calls_completed: number;
  calls_failed: number;
  status: string;
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

export function BatchCallsPanel() {
  const [batches, setBatches] = useState<BatchCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<BatchCall | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const { workspace } = useWorkspace();

  useEffect(() => {
    if (workspace) {
      fetchBatches();

      // Subscribe to realtime updates
      const channel = supabase
        .channel("batch-calls-changes")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "batch_calls",
            filter: `workspace_id=eq.${workspace.id}`,
          },
          () => {
            fetchBatches();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [workspace]);

  const fetchBatches = async () => {
    if (!workspace) return;

    try {
      const { data, error } = await supabase.functions.invoke("elevenlabs-batch-calls", {
        body: {
          action: "list_batches",
          workspace_id: workspace.id,
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      setBatches(data.batches || []);
    } catch (error) {
      console.error("Error fetching batches:", error);
      toast.error("Erro ao carregar campanhas");
    } finally {
      setLoading(false);
    }
  };

  const handleStartBatch = async (batchId: string) => {
    setActionLoading(batchId);
    try {
      const { data, error } = await supabase.functions.invoke("elevenlabs-batch-calls", {
        body: {
          action: "start_batch",
          workspace_id: workspace?.id,
          batch_id: batchId,
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      toast.success(`Campanha iniciada! ${data.recipients_count} chamadas em andamento.`);
      fetchBatches();
    } catch (error: any) {
      console.error("Error starting batch:", error);
      toast.error(error.message || "Erro ao iniciar campanha");
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancelBatch = async (batchId: string) => {
    setActionLoading(batchId);
    try {
      const { data, error } = await supabase.functions.invoke("elevenlabs-batch-calls", {
        body: {
          action: "cancel_batch",
          workspace_id: workspace?.id,
          batch_id: batchId,
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      toast.success("Campanha cancelada");
      fetchBatches();
    } catch (error: any) {
      console.error("Error cancelling batch:", error);
      toast.error(error.message || "Erro ao cancelar campanha");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteBatch = async (batchId: string) => {
    try {
      const { error } = await supabase
        .from("batch_calls")
        .delete()
        .eq("id", batchId);

      if (error) throw error;

      toast.success("Campanha excluída");
      fetchBatches();
    } catch (error) {
      console.error("Error deleting batch:", error);
      toast.error("Erro ao excluir campanha");
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      draft: { label: "Rascunho", variant: "secondary" },
      scheduled: { label: "Agendada", variant: "outline" },
      in_progress: { label: "Em Andamento", variant: "default" },
      completed: { label: "Concluída", variant: "secondary" },
      cancelled: { label: "Cancelada", variant: "destructive" },
      failed: { label: "Falhou", variant: "destructive" },
    };

    const config = statusConfig[status] || { label: status, variant: "secondary" as const };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getProgressPercentage = (batch: BatchCall) => {
    if (batch.total_recipients === 0) return 0;
    return Math.round(((batch.calls_completed + batch.calls_failed) / batch.total_recipients) * 100);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Campanhas de Chamadas em Lote</h2>
          <p className="text-sm text-muted-foreground">
            Gerencie campanhas de chamadas automatizadas
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchBatches}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Atualizar
          </Button>
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Nova Campanha
          </Button>
        </div>
      </div>

      {/* Batches List */}
      {batches.length === 0 ? (
        <Card className="glass-card p-8 text-center">
          <PhoneOutgoing className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="font-medium text-foreground mb-2">Nenhuma campanha criada</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Crie sua primeira campanha de chamadas em lote para alcançar vários contatos automaticamente.
          </p>
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Criar Campanha
          </Button>
        </Card>
      ) : (
        <ScrollArea className="h-[500px]">
          <div className="space-y-3">
            {batches.map((batch) => (
              <Card
                key={batch.id}
                className="glass-card p-4 hover:bg-accent/5 transition-colors cursor-pointer"
                onClick={() => setSelectedBatch(batch)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-3">
                      <h3 className="font-medium">{batch.name}</h3>
                      {getStatusBadge(batch.status)}
                    </div>

                    {batch.description && (
                      <p className="text-sm text-muted-foreground line-clamp-1">
                        {batch.description}
                      </p>
                    )}

                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Users className="h-4 w-4" />
                        <span>{batch.total_recipients} contatos</span>
                      </div>
                      {batch.persona && (
                        <div className="flex items-center gap-1">
                          <span>Persona: {batch.persona.name}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        <span>
                          {formatDistanceToNow(new Date(batch.created_at), {
                            addSuffix: true,
                            locale: ptBR,
                          })}
                        </span>
                      </div>
                    </div>

                    {/* Progress for in_progress batches */}
                    {batch.status === "in_progress" && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span>Progresso</span>
                          <span>{getProgressPercentage(batch)}%</span>
                        </div>
                        <div className="h-2 bg-secondary rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary transition-all"
                            style={{ width: `${getProgressPercentage(batch)}%` }}
                          />
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <CheckCircle className="h-3 w-3 text-success" />
                            {batch.calls_completed} concluídas
                          </span>
                          <span className="flex items-center gap-1">
                            <XCircle className="h-3 w-3 text-destructive" />
                            {batch.calls_failed} falhas
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Stats for completed batches */}
                    {batch.status === "completed" && (
                      <div className="flex items-center gap-4 text-xs">
                        <span className="flex items-center gap-1 text-success">
                          <CheckCircle className="h-3 w-3" />
                          {batch.calls_completed} concluídas
                        </span>
                        {batch.calls_failed > 0 && (
                          <span className="flex items-center gap-1 text-destructive">
                            <XCircle className="h-3 w-3" />
                            {batch.calls_failed} falhas
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    {batch.status === "draft" && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => handleStartBatch(batch.id)}
                          disabled={actionLoading === batch.id || batch.total_recipients === 0}
                        >
                          {actionLoading === batch.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleDeleteBatch(batch.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    {batch.status === "in_progress" && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleCancelBatch(batch.id)}
                        disabled={actionLoading === batch.id}
                      >
                        {actionLoading === batch.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Pause className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setSelectedBatch(batch)}>
                      <BarChart3 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Create Dialog */}
      <CreateBatchDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSuccess={() => {
          fetchBatches();
          setCreateDialogOpen(false);
        }}
      />

      {/* Details Dialog */}
      {selectedBatch && (
        <BatchDetailsDialog
          batch={selectedBatch}
          open={!!selectedBatch}
          onOpenChange={(open) => !open && setSelectedBatch(null)}
          onRefresh={fetchBatches}
        />
      )}
    </div>
  );
}

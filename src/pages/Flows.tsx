import { useState, useCallback, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  MarkerType,
  Node,
  Edge,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Plus,
  Workflow,
  Play,
  Pause,
  Save,
  Trash2,
  MessageSquare,
  Bot,
  GitBranch,
  Clock,
  Zap,
  ArrowLeft,
  Settings,
  Loader2,
  Copy,
} from "lucide-react";

interface Flow {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_value: string | null;
  is_active: boolean;
  nodes: unknown;
  edges: unknown;
  created_at: string;
}

const triggerTypes = [
  { value: "keyword", label: "Palavra-chave", icon: MessageSquare },
  { value: "first_message", label: "Primeira mensagem", icon: Zap },
  { value: "schedule", label: "Agendamento", icon: Clock },
  { value: "webhook", label: "Webhook", icon: GitBranch },
  { value: "manual", label: "Manual", icon: Play },
];

const nodeTypes = [
  { type: "message", label: "Mensagem", icon: MessageSquare, color: "#3b82f6" },
  { type: "ai_response", label: "Resposta IA", icon: Bot, color: "#8b5cf6" },
  { type: "condition", label: "Condição", icon: GitBranch, color: "#f59e0b" },
  { type: "delay", label: "Delay", icon: Clock, color: "#6b7280" },
  { type: "action", label: "Ação", icon: Zap, color: "#10b981" },
];

const initialNodes: Node[] = [
  {
    id: "trigger",
    type: "input",
    position: { x: 250, y: 0 },
    data: { label: "🎯 Gatilho" },
    style: {
      background: "hsl(var(--primary))",
      color: "hsl(var(--primary-foreground))",
      border: "none",
      borderRadius: "8px",
      padding: "10px 20px",
    },
  },
];

export default function Flows() {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [selectedFlow, setSelectedFlow] = useState<Flow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "editor">("list");
  const { workspace } = useWorkspace();

  // Form states
  const [flowName, setFlowName] = useState("");
  const [flowDescription, setFlowDescription] = useState("");
  const [triggerType, setTriggerType] = useState("keyword");
  const [triggerValue, setTriggerValue] = useState("");

  // React Flow states
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { strokeWidth: 2 },
          },
          eds
        )
      ),
    [setEdges]
  );

  useEffect(() => {
    if (workspace) {
      fetchFlows();
    }
  }, [workspace]);

  const fetchFlows = async () => {
    try {
      const { data, error } = await supabase
        .from("flows")
        .select("*")
        .eq("workspace_id", workspace?.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setFlows(data || []);
    } catch (error) {
      console.error("Error fetching flows:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFlow = async () => {
    if (!flowName.trim()) {
      toast.error("Digite um nome para o fluxo");
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("flows")
        .insert([{
          workspace_id: workspace?.id,
          name: flowName.trim(),
          description: flowDescription.trim() || null,
          trigger_type: triggerType,
          trigger_value: triggerValue.trim() || null,
          nodes: JSON.parse(JSON.stringify(initialNodes)),
          edges: JSON.parse(JSON.stringify([])),
        }])
        .select()
        .single();

      if (error) throw error;

      toast.success("Fluxo criado!");
      setDialogOpen(false);
      setFlowName("");
      setFlowDescription("");
      setTriggerType("keyword");
      setTriggerValue("");
      fetchFlows();

      // Open editor for new flow
      setSelectedFlow(data);
      setNodes(initialNodes);
      setEdges([]);
      setViewMode("editor");
    } catch (error) {
      console.error("Error creating flow:", error);
      toast.error("Erro ao criar fluxo");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveFlow = async () => {
    if (!selectedFlow) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from("flows")
        .update({
          nodes: JSON.parse(JSON.stringify(nodes)),
          edges: JSON.parse(JSON.stringify(edges)),
        })
        .eq("id", selectedFlow.id);

      if (error) throw error;
      toast.success("Fluxo salvo!");
    } catch (error) {
      console.error("Error saving flow:", error);
      toast.error("Erro ao salvar fluxo");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleFlow = async (flow: Flow) => {
    try {
      const { error } = await supabase
        .from("flows")
        .update({ is_active: !flow.is_active })
        .eq("id", flow.id);

      if (error) throw error;
      toast.success(flow.is_active ? "Fluxo desativado" : "Fluxo ativado");
      fetchFlows();
    } catch (error) {
      console.error("Error toggling flow:", error);
      toast.error("Erro ao alterar status");
    }
  };

  const handleDeleteFlow = async (id: string) => {
    try {
      const { error } = await supabase.from("flows").delete().eq("id", id);

      if (error) throw error;
      toast.success("Fluxo removido");
      fetchFlows();
    } catch (error) {
      console.error("Error deleting flow:", error);
      toast.error("Erro ao remover fluxo");
    }
  };

  const handleOpenEditor = (flow: Flow) => {
    setSelectedFlow(flow);
    setNodes((flow.nodes as Node[]) || initialNodes);
    setEdges((flow.edges as Edge[]) || []);
    setViewMode("editor");
  };

  const addNode = (type: string) => {
    const nodeConfig = nodeTypes.find((n) => n.type === type);
    if (!nodeConfig) return;

    const newNode: Node = {
      id: `${type}-${Date.now()}`,
      position: { x: Math.random() * 300 + 100, y: Math.random() * 200 + 100 },
      data: { label: `${nodeConfig.label}` },
      style: {
        background: nodeConfig.color,
        color: "white",
        border: "none",
        borderRadius: "8px",
        padding: "10px 20px",
      },
    };

    setNodes((nds) => [...nds, newNode]);
  };

  if (viewMode === "editor" && selectedFlow) {
    return (
      <AppLayout title="Editor de Fluxo">
        <div className="h-[calc(100vh-3.5rem)] flex flex-col">
          {/* Editor Header */}
          <div className="h-14 border-b border-border flex items-center justify-between px-4 bg-card">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => setViewMode("list")}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <h3 className="font-semibold">{selectedFlow.name}</h3>
                <p className="text-xs text-muted-foreground">{selectedFlow.description}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleSaveFlow} disabled={saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Salvar
              </Button>
              <Button size="sm" className="gap-2">
                <Play className="h-4 w-4" />
                Testar
              </Button>
            </div>
          </div>

          {/* Editor Canvas */}
          <div className="flex-1 flex">
            {/* Nodes Palette */}
            <div className="w-60 border-r border-border bg-card p-4 space-y-4">
              <h4 className="font-medium text-sm">Blocos</h4>
              <div className="grid gap-2">
                {nodeTypes.map((node) => (
                  <Button
                    key={node.type}
                    variant="outline"
                    className="justify-start gap-2 h-10"
                    onClick={() => addNode(node.type)}
                  >
                    <node.icon className="h-4 w-4" style={{ color: node.color }} />
                    {node.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* React Flow Canvas */}
            <div className="flex-1">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                fitView
                className="bg-muted/30"
              >
                <Controls />
                <Background />
                <Panel position="bottom-right" className="bg-card p-2 rounded-lg border shadow-lg">
                  <p className="text-xs text-muted-foreground">
                    Arraste para conectar os blocos
                  </p>
                </Panel>
              </ReactFlow>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Fluxos de Automação">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Workflow className="h-7 w-7 text-primary" />
              Editor de Fluxos
            </h2>
            <p className="text-muted-foreground">
              Crie automações visuais para seus atendimentos.
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Novo Fluxo
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Criar Novo Fluxo</DialogTitle>
                <DialogDescription>
                  Configure o gatilho que iniciará a automação.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="flow-name">Nome do Fluxo</Label>
                  <Input
                    id="flow-name"
                    placeholder="Ex: Atendimento Inicial"
                    value={flowName}
                    onChange={(e) => setFlowName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="flow-desc">Descrição (opcional)</Label>
                  <Input
                    id="flow-desc"
                    placeholder="Descreva o objetivo do fluxo"
                    value={flowDescription}
                    onChange={(e) => setFlowDescription(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tipo de Gatilho</Label>
                  <Select value={triggerType} onValueChange={setTriggerType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {triggerTypes.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          <div className="flex items-center gap-2">
                            <t.icon className="h-4 w-4" />
                            {t.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {triggerType === "keyword" && (
                  <div className="space-y-2">
                    <Label htmlFor="trigger-value">Palavra-chave</Label>
                    <Input
                      id="trigger-value"
                      placeholder="Ex: oi, olá, menu"
                      value={triggerValue}
                      onChange={(e) => setTriggerValue(e.target.value)}
                    />
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleCreateFlow} disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Criando...
                    </>
                  ) : (
                    "Criar Fluxo"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Flows Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : flows.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Workflow className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="font-medium text-lg mb-2">Nenhum fluxo</h3>
              <p className="text-muted-foreground text-sm max-w-sm mb-4">
                Crie seu primeiro fluxo para automatizar atendimentos.
              </p>
              <Button onClick={() => setDialogOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                Novo Fluxo
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {flows.map((flow) => {
              const trigger = triggerTypes.find((t) => t.value === flow.trigger_type);
              const TriggerIcon = trigger?.icon || Zap;

              return (
                <Card
                  key={flow.id}
                  className="relative overflow-hidden cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => handleOpenEditor(flow)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Workflow className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <CardTitle className="text-lg">{flow.name}</CardTitle>
                          <CardDescription className="text-xs flex items-center gap-1 mt-0.5">
                            <TriggerIcon className="h-3 w-3" />
                            {trigger?.label}
                            {flow.trigger_value && `: "${flow.trigger_value}"`}
                          </CardDescription>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={flow.is_active}
                          onCheckedChange={() => handleToggleFlow(flow)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="text-sm text-muted-foreground">
                          {flow.is_active ? "Ativo" : "Inativo"}
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            toast.info("Duplicar fluxo em breve");
                          }}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteFlow(flow.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

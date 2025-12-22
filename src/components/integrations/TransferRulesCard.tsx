import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  ArrowLeftRight,
  Plus,
  Trash2,
  Loader2,
  Phone,
  Globe,
  RefreshCw,
  Settings,
} from "lucide-react";

interface TransferRule {
  id: string;
  workspace_id: string;
  persona_id: string | null;
  name: string;
  destination_type: "phone" | "sip_uri";
  destination: string;
  condition: string;
  transfer_type: "conference" | "sip_refer" | "warm";
  priority: number;
  is_active: boolean;
  persona_name?: string;
}

interface Persona {
  id: string;
  name: string;
  elevenlabs_agent_id: string | null;
}

export function TransferRulesCard() {
  const { workspace } = useWorkspace();
  const [rules, setRules] = useState<TransferRule[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<TransferRule | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    persona_id: "",
    destination_type: "phone" as "phone" | "sip_uri",
    destination: "",
    condition: "",
    transfer_type: "conference" as "conference" | "sip_refer" | "warm",
    priority: 0,
  });

  useEffect(() => {
    if (workspace?.id) {
      fetchRules();
      fetchPersonas();
    }
  }, [workspace?.id]);

  const fetchRules = async () => {
    if (!workspace?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("telephony_transfer_rules")
        .select(`
          *,
          personas (name)
        `)
        .eq("workspace_id", workspace.id)
        .order("priority", { ascending: false });

      if (error) throw error;

      const mappedRules: TransferRule[] = (data || []).map((r: any) => ({
        ...r,
        persona_name: r.personas?.name,
      }));
      setRules(mappedRules);
    } catch (error) {
      console.error("Error fetching transfer rules:", error);
      toast.error("Erro ao carregar regras de transferência");
    } finally {
      setLoading(false);
    }
  };

  const fetchPersonas = async () => {
    if (!workspace?.id) return;
    try {
      const { data, error } = await supabase
        .from("personas")
        .select("id, name, elevenlabs_agent_id")
        .eq("workspace_id", workspace.id)
        .eq("is_active", true);

      if (error) throw error;
      setPersonas(data || []);
    } catch (error) {
      console.error("Error fetching personas:", error);
    }
  };

  const openDialog = (rule?: TransferRule) => {
    if (rule) {
      setEditingRule(rule);
      setFormData({
        name: rule.name,
        persona_id: rule.persona_id || "",
        destination_type: rule.destination_type,
        destination: rule.destination,
        condition: rule.condition,
        transfer_type: rule.transfer_type,
        priority: rule.priority,
      });
    } else {
      setEditingRule(null);
      setFormData({
        name: "",
        persona_id: "",
        destination_type: "phone",
        destination: "",
        condition: "",
        transfer_type: "conference",
        priority: 0,
      });
    }
    setDialogOpen(true);
  };

  const saveRule = async () => {
    if (!workspace?.id) return;
    if (!formData.name || !formData.destination || !formData.condition) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    setSaving(true);
    try {
      const ruleData = {
        workspace_id: workspace.id,
        persona_id: formData.persona_id || null,
        name: formData.name,
        destination_type: formData.destination_type,
        destination: formData.destination,
        condition: formData.condition,
        transfer_type: formData.transfer_type,
        priority: formData.priority,
      };

      if (editingRule) {
        const { error } = await supabase
          .from("telephony_transfer_rules")
          .update(ruleData)
          .eq("id", editingRule.id);

        if (error) throw error;
        toast.success("Regra atualizada com sucesso!");
      } else {
        const { error } = await supabase
          .from("telephony_transfer_rules")
          .insert(ruleData);

        if (error) throw error;
        toast.success("Regra criada com sucesso!");
      }

      setDialogOpen(false);
      fetchRules();
      
      // Sync with ElevenLabs if persona has agent
      if (formData.persona_id) {
        const persona = personas.find(p => p.id === formData.persona_id);
        if (persona?.elevenlabs_agent_id) {
          syncRulesToAgent(persona.id, persona.elevenlabs_agent_id);
        }
      }
    } catch (error) {
      console.error("Error saving rule:", error);
      toast.error("Erro ao salvar regra");
    } finally {
      setSaving(false);
    }
  };

  const toggleRule = async (rule: TransferRule) => {
    try {
      const { error } = await supabase
        .from("telephony_transfer_rules")
        .update({ is_active: !rule.is_active })
        .eq("id", rule.id);

      if (error) throw error;
      
      setRules(prev =>
        prev.map(r => (r.id === rule.id ? { ...r, is_active: !r.is_active } : r))
      );
      
      toast.success(rule.is_active ? "Regra desativada" : "Regra ativada");
    } catch (error) {
      console.error("Error toggling rule:", error);
      toast.error("Erro ao alterar regra");
    }
  };

  const deleteRule = async (ruleId: string) => {
    if (!confirm("Tem certeza que deseja excluir esta regra?")) return;

    try {
      const { error } = await supabase
        .from("telephony_transfer_rules")
        .delete()
        .eq("id", ruleId);

      if (error) throw error;
      
      setRules(prev => prev.filter(r => r.id !== ruleId));
      toast.success("Regra excluída");
    } catch (error) {
      console.error("Error deleting rule:", error);
      toast.error("Erro ao excluir regra");
    }
  };

  const syncRulesToAgent = async (personaId: string, agentId: string) => {
    setSyncing(true);
    try {
      const { error } = await supabase.functions.invoke("elevenlabs-configure-transfer", {
        body: {
          persona_id: personaId,
          agent_id: agentId,
        },
      });

      if (error) throw error;
      toast.success("Regras sincronizadas com ElevenLabs!");
    } catch (error) {
      console.error("Error syncing rules to agent:", error);
      toast.error("Erro ao sincronizar com ElevenLabs");
    } finally {
      setSyncing(false);
    }
  };

  const syncAllRules = async () => {
    setSyncing(true);
    try {
      // Get all personas with ElevenLabs agents that have rules
      const personasWithRules = personas.filter(p => 
        p.elevenlabs_agent_id && 
        rules.some(r => r.persona_id === p.id && r.is_active)
      );

      for (const persona of personasWithRules) {
        await syncRulesToAgent(persona.id, persona.elevenlabs_agent_id!);
      }

      toast.success("Todas as regras foram sincronizadas!");
    } catch (error) {
      console.error("Error syncing all rules:", error);
      toast.error("Erro ao sincronizar regras");
    } finally {
      setSyncing(false);
    }
  };

  const getTransferTypeLabel = (type: string) => {
    switch (type) {
      case "conference":
        return "Conferência";
      case "sip_refer":
        return "SIP REFER";
      case "warm":
        return "Warm Transfer";
      default:
        return type;
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

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <ArrowLeftRight className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">Regras de Transferência</CardTitle>
                <CardDescription>
                  Configure quando e para onde a IA deve transferir chamadas
                </CardDescription>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={syncAllRules}
                disabled={syncing || rules.length === 0}
              >
                {syncing ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Sincronizar
              </Button>
              <Button size="sm" onClick={() => openDialog()}>
                <Plus className="h-4 w-4 mr-2" />
                Nova Regra
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <ArrowLeftRight className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Nenhuma regra de transferência configurada</p>
              <p className="text-sm mt-1">
                Crie regras para definir quando a IA deve transferir chamadas para humanos
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Persona</TableHead>
                  <TableHead>Destino</TableHead>
                  <TableHead>Condição</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-center">Ativo</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium">{rule.name}</TableCell>
                    <TableCell>
                      {rule.persona_name || (
                        <span className="text-muted-foreground">Todas</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {rule.destination_type === "phone" ? (
                          <Phone className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Globe className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="text-sm font-mono">{rule.destination}</span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate" title={rule.condition}>
                      {rule.condition}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{getTransferTypeLabel(rule.transfer_type)}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={rule.is_active}
                        onCheckedChange={() => toggleRule(rule)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openDialog(rule)}
                        >
                          <Settings className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteRule(rule.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingRule ? "Editar Regra" : "Nova Regra de Transferência"}
            </DialogTitle>
            <DialogDescription>
              Configure quando a IA deve transferir a chamada para um humano
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome da Regra *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Ex: Transferir para Vendas"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="persona">Persona (opcional)</Label>
              <Select
                value={formData.persona_id}
                onValueChange={(value) => setFormData({ ...formData, persona_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Aplicar a todas as personas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Todas as personas</SelectItem>
                  {personas.map((persona) => (
                    <SelectItem key={persona.id} value={persona.id}>
                      {persona.name}
                      {persona.elevenlabs_agent_id && (
                        <span className="ml-2 text-xs text-muted-foreground">(ElevenLabs)</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="destination_type">Tipo de Destino</Label>
                <Select
                  value={formData.destination_type}
                  onValueChange={(value: "phone" | "sip_uri") =>
                    setFormData({ ...formData, destination_type: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="phone">Telefone</SelectItem>
                    <SelectItem value="sip_uri">SIP URI</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="transfer_type">Tipo de Transferência</Label>
                <Select
                  value={formData.transfer_type}
                  onValueChange={(value: "conference" | "sip_refer" | "warm") =>
                    setFormData({ ...formData, transfer_type: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="conference">Conferência</SelectItem>
                    <SelectItem value="sip_refer">SIP REFER</SelectItem>
                    <SelectItem value="warm">Warm Transfer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="destination">
                {formData.destination_type === "phone" ? "Número de Telefone *" : "SIP URI *"}
              </Label>
              <Input
                id="destination"
                value={formData.destination}
                onChange={(e) => setFormData({ ...formData, destination: e.target.value })}
                placeholder={
                  formData.destination_type === "phone"
                    ? "+5511999999999"
                    : "sip:vendas@company.bitrix24.com"
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="condition">Condição de Transferência *</Label>
              <Textarea
                id="condition"
                value={formData.condition}
                onChange={(e) => setFormData({ ...formData, condition: e.target.value })}
                placeholder="Ex: Quando o cliente pedir para falar com um atendente humano ou vendedor"
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Descreva em linguagem natural quando a transferência deve ocorrer
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">Prioridade</Label>
              <Input
                id="priority"
                type="number"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground">
                Regras com maior prioridade são avaliadas primeiro
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={saveRule} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Salvando...
                </>
              ) : (
                "Salvar"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

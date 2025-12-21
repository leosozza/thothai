import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  Plus,
  Bot,
  Edit,
  Trash2,
  Star,
  Volume2,
  Loader2,
  Sparkles,
  MessageSquare,
} from "lucide-react";

interface Persona {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  system_prompt: string;
  voice_enabled: boolean;
  voice_id: string | null;
  temperature: number;
  welcome_message: string | null;
  is_default: boolean;
  department_id: string | null;
}

interface BotStatus {
  enabled: boolean;
  personaId: string | null;
  personaName: string | null;
  integrationId: string | null;
}

export default function Personas() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);
  const [saving, setSaving] = useState(false);
  const [botStatus, setBotStatus] = useState<BotStatus>({
    enabled: false,
    personaId: null,
    personaName: null,
    integrationId: null,
  });
  const [togglingBot, setTogglingBot] = useState(false);
  const { workspace } = useWorkspace();

  // Form states
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [temperature, setTemperature] = useState([0.7]);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [isDefault, setIsDefault] = useState(false);

  useEffect(() => {
    if (workspace) {
      fetchPersonas();
      fetchBotStatus();
    }
  }, [workspace]);

  const fetchPersonas = async () => {
    try {
      const { data, error } = await supabase
        .from("personas")
        .select("*")
        .eq("workspace_id", workspace?.id)
        .order("created_at", { ascending: true });

      if (error) throw error;
      setPersonas(data || []);
    } catch (error) {
      console.error("Error fetching personas:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchBotStatus = async () => {
    try {
      const { data: integration } = await supabase
        .from("integrations")
        .select("id, config")
        .eq("workspace_id", workspace?.id)
        .eq("type", "bitrix24")
        .single();

      if (integration) {
        const config = integration.config as Record<string, unknown> | null;
        const personaId = config?.bot_persona_id as string | null;
        let personaName = null;

        if (personaId) {
          const { data: persona } = await supabase
            .from("personas")
            .select("name")
            .eq("id", personaId)
            .single();
          personaName = persona?.name || null;
        }

        setBotStatus({
          enabled: Boolean(config?.bot_enabled),
          personaId,
          personaName,
          integrationId: integration.id,
        });
      }
    } catch (error) {
      console.error("Error fetching bot status:", error);
    }
  };

  const handleToggleBot = async (enabled: boolean) => {
    if (!botStatus.integrationId) {
      toast.error("Nenhuma integração Bitrix24 encontrada");
      return;
    }

    setTogglingBot(true);
    try {
      const response = await supabase.functions.invoke("bitrix24-webhook", {
        body: {
          action: "update_bot_config",
          integration_id: botStatus.integrationId,
          bot_enabled: enabled,
        },
      });

      if (response.error) throw response.error;

      setBotStatus((prev) => ({ ...prev, enabled }));
      toast.success(enabled ? "Bot ativado!" : "Bot desativado");
    } catch (error) {
      console.error("Error toggling bot:", error);
      toast.error("Erro ao alterar status do bot");
    } finally {
      setTogglingBot(false);
    }
  };

  const resetForm = () => {
    setName("");
    setDescription("");
    setSystemPrompt("");
    setWelcomeMessage("");
    setTemperature([0.7]);
    setVoiceEnabled(false);
    setIsDefault(false);
    setEditingPersona(null);
  };

  const handleOpenCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const handleOpenEdit = (persona: Persona) => {
    setEditingPersona(persona);
    setName(persona.name);
    setDescription(persona.description || "");
    setSystemPrompt(persona.system_prompt);
    setWelcomeMessage(persona.welcome_message || "");
    setTemperature([persona.temperature]);
    setVoiceEnabled(persona.voice_enabled);
    setIsDefault(persona.is_default);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim() || !systemPrompt.trim()) {
      toast.error("Nome e prompt são obrigatórios");
      return;
    }

    setSaving(true);
    try {
      const data = {
        workspace_id: workspace?.id,
        name: name.trim(),
        description: description.trim() || null,
        system_prompt: systemPrompt.trim(),
        welcome_message: welcomeMessage.trim() || null,
        temperature: temperature[0],
        voice_enabled: voiceEnabled,
        is_default: isDefault,
      };

      if (editingPersona) {
        const { error } = await supabase
          .from("personas")
          .update(data)
          .eq("id", editingPersona.id);

        if (error) throw error;
        toast.success("Persona atualizada!");
      } else {
        const { error } = await supabase.from("personas").insert(data);

        if (error) throw error;
        toast.success("Persona criada!");
      }

      setDialogOpen(false);
      resetForm();
      fetchPersonas();
    } catch (error) {
      console.error("Error saving persona:", error);
      toast.error("Erro ao salvar persona");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from("personas").delete().eq("id", id);

      if (error) throw error;
      toast.success("Persona removida");
      fetchPersonas();
    } catch (error) {
      console.error("Error deleting persona:", error);
      toast.error("Erro ao remover persona");
    }
  };

  const handleSetDefault = async (persona: Persona) => {
    try {
      // Remove default from all
      await supabase
        .from("personas")
        .update({ is_default: false })
        .eq("workspace_id", workspace?.id);

      // Set new default
      const { error } = await supabase
        .from("personas")
        .update({ is_default: true })
        .eq("id", persona.id);

      if (error) throw error;

      // Check for Bitrix24 integration and activate bot
      if (botStatus.integrationId) {
        try {
          await supabase.functions.invoke("bitrix24-webhook", {
            body: {
              action: "update_bot_config",
              integration_id: botStatus.integrationId,
              bot_enabled: true,
              bot_persona_id: persona.id,
              bot_welcome_message: persona.welcome_message,
            },
          });

          setBotStatus((prev) => ({
            ...prev,
            enabled: true,
            personaId: persona.id,
            personaName: persona.name,
          }));

          toast.success(`Bot Bitrix24 ativado com a persona "${persona.name}"`);
        } catch (botError) {
          console.error("Error activating bot:", botError);
          toast.success(`${persona.name} é agora a persona padrão`);
        }
      } else {
        toast.success(`${persona.name} é agora a persona padrão`);
      }

      fetchPersonas();
    } catch (error) {
      console.error("Error setting default:", error);
      toast.error("Erro ao definir padrão");
    }
  };

  return (
    <AppLayout title="Personas">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Bot className="h-7 w-7 text-primary" />
              Personas da IA
            </h2>
            <p className="text-muted-foreground">
              Crie diferentes personalidades para sua IA.
            </p>
          </div>
          <Button className="gap-2" onClick={handleOpenCreate}>
            <Plus className="h-4 w-4" />
            Nova Persona
          </Button>
        </div>

        {/* Bot Status Card */}
        {botStatus.integrationId && (
          <Card className="border-primary/20">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <MessageSquare className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Bot Bitrix24</CardTitle>
                    <CardDescription>
                      {botStatus.enabled
                        ? `Usando: ${botStatus.personaName || "Persona não definida"}`
                        : "Chatbot AI desativado"}
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={botStatus.enabled ? "default" : "secondary"}>
                    {botStatus.enabled ? "Ativo" : "Inativo"}
                  </Badge>
                  <Switch
                    checked={botStatus.enabled}
                    onCheckedChange={handleToggleBot}
                    disabled={togglingBot}
                  />
                </div>
              </div>
            </CardHeader>
          </Card>
        )}

        {/* Personas Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : personas.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Sparkles className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="font-medium text-lg mb-2">Nenhuma persona</h3>
              <p className="text-muted-foreground text-sm max-w-sm mb-4">
                Crie personas para dar diferentes personalidades à sua IA.
              </p>
              <Button onClick={handleOpenCreate} className="gap-2">
                <Plus className="h-4 w-4" />
                Criar Persona
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {personas.map((persona) => (
              <Card key={persona.id} className="relative overflow-hidden">
                {persona.is_default && (
                  <div className="absolute top-0 right-0">
                    <Badge className="rounded-none rounded-bl-lg bg-primary text-primary-foreground gap-1">
                      <Star className="h-3 w-3" />
                      Padrão
                    </Badge>
                  </div>
                )}
                <CardHeader>
                  <div className="flex items-start gap-4">
                    <Avatar className="h-14 w-14">
                      <AvatarImage src={persona.avatar_url || ""} />
                      <AvatarFallback className="bg-primary/10 text-primary text-lg">
                        {persona.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <CardTitle className="text-lg">{persona.name}</CardTitle>
                      <CardDescription className="line-clamp-2">
                        {persona.description || "Sem descrição"}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">Temp:</span>
                      <span className="font-medium">{persona.temperature}</span>
                    </div>
                    {persona.voice_enabled && (
                      <Badge variant="outline" className="gap-1">
                        <Volume2 className="h-3 w-3" />
                        Voz
                      </Badge>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => handleOpenEdit(persona)}
                    >
                      <Edit className="h-4 w-4 mr-1" />
                      Editar
                    </Button>
                    {!persona.is_default && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSetDefault(persona)}
                      >
                        <Star className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(persona.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Create/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingPersona ? "Editar Persona" : "Criar Persona"}
              </DialogTitle>
              <DialogDescription>
                Configure a personalidade e comportamento da IA.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 py-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Nome *</Label>
                  <Input
                    id="name"
                    placeholder="Ex: Assistente de Vendas"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Descrição</Label>
                  <Input
                    id="description"
                    placeholder="Breve descrição da persona"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="system-prompt">Prompt do Sistema *</Label>
                <Textarea
                  id="system-prompt"
                  placeholder="Você é um assistente de vendas amigável e prestativo..."
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={6}
                />
                <p className="text-xs text-muted-foreground">
                  Defina como a IA deve se comportar e responder.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="welcome">Mensagem de Boas-vindas</Label>
                <Textarea
                  id="welcome"
                  placeholder="Olá! Como posso ajudar você hoje?"
                  value={welcomeMessage}
                  onChange={(e) => setWelcomeMessage(e.target.value)}
                  rows={2}
                />
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Temperatura: {temperature[0]}</Label>
                    <span className="text-xs text-muted-foreground">
                      Menor = mais preciso, Maior = mais criativo
                    </span>
                  </div>
                  <Slider
                    value={temperature}
                    onValueChange={setTemperature}
                    min={0}
                    max={1}
                    step={0.1}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Respostas por voz</Label>
                    <p className="text-xs text-muted-foreground">
                      Habilitar Text-to-Speech para esta persona
                    </p>
                  </div>
                  <Switch checked={voiceEnabled} onCheckedChange={setVoiceEnabled} />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Persona padrão</Label>
                    <p className="text-xs text-muted-foreground">
                      Usar como persona padrão para novos atendimentos
                    </p>
                  </div>
                  <Switch checked={isDefault} onCheckedChange={setIsDefault} />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Salvando...
                  </>
                ) : editingPersona ? (
                  "Salvar Alterações"
                ) : (
                  "Criar Persona"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}

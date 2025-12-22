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
  bitrix_bot_enabled: boolean;
}

interface BitrixIntegration {
  id: string;
  config: {
    bot_id?: number;
    bot_enabled?: boolean;
    bot_persona_id?: string;
    [key: string]: unknown;
  };
}

export default function Personas() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);
  const [saving, setSaving] = useState(false);
  const [bitrixIntegration, setBitrixIntegration] = useState<BitrixIntegration | null>(null);
  const [togglingBitrix, setTogglingBitrix] = useState(false);
  const { workspace } = useWorkspace();

  // Form states
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [temperature, setTemperature] = useState([0.7]);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [isDefault, setIsDefault] = useState(false);
  const [bitrixBotEnabled, setBitrixBotEnabled] = useState(false);

  useEffect(() => {
    if (workspace) {
      fetchPersonas();
      fetchBitrixIntegration();
    }
  }, [workspace]);

  const fetchBitrixIntegration = async () => {
    try {
      const { data, error } = await supabase
        .from("integrations")
        .select("id, config")
        .eq("workspace_id", workspace?.id)
        .eq("type", "bitrix24")
        .eq("is_active", true)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        setBitrixIntegration(data as BitrixIntegration);
      }
    } catch (error) {
      console.error("Error fetching Bitrix24 integration:", error);
    }
  };

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

  const resetForm = () => {
    setName("");
    setDescription("");
    setSystemPrompt("");
    setWelcomeMessage("");
    setTemperature([0.7]);
    setVoiceEnabled(false);
    setIsDefault(false);
    setBitrixBotEnabled(false);
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
    setBitrixBotEnabled(persona.bitrix_bot_enabled || false);
    setDialogOpen(true);
  };

  const handleToggleBitrixBot = async (personaId: string, enable: boolean) => {
    if (!bitrixIntegration) return;
    
    setTogglingBitrix(true);
    try {
      const persona = personas.find(p => p.id === personaId);
      if (!persona) throw new Error("Persona não encontrada");

      if (enable) {
        // Disable any other persona that's currently the Bitrix bot
        await supabase
          .from("personas")
          .update({ bitrix_bot_enabled: false })
          .eq("workspace_id", workspace?.id)
          .eq("bitrix_bot_enabled", true);

        // ALWAYS check database for current bot_id (not local state)
        console.log("[Bitrix Bot] Checking database for existing bot_id...");
        const { data: currentIntegration, error: fetchError } = await supabase
          .from("integrations")
          .select("config")
          .eq("id", bitrixIntegration.id)
          .single();

        if (fetchError) {
          console.error("[Bitrix Bot] Error fetching integration:", fetchError);
          throw fetchError;
        }

        const currentBotId = (currentIntegration?.config as Record<string, unknown>)?.bot_id;
        console.log("[Bitrix Bot] Current bot_id from database:", currentBotId);

        // Register bot if not already registered
        if (!currentBotId) {
          console.log("[Bitrix Bot] No bot_id found, registering bot...");
          toast.loading("Registrando bot no Bitrix24...", { id: "bot-register" });
          
          const { data: registerData, error: registerError } = await supabase.functions.invoke(
            "bitrix24-bot-register",
            {
              body: {
                action: "register",
                integration_id: bitrixIntegration.id,
                bot_name: persona.name,
                bot_description: persona.description || `Assistente IA - ${persona.name}`,
              },
            }
          );

          toast.dismiss("bot-register");

          console.log("[Bitrix Bot] Register response:", registerData, "Error:", registerError);

          if (registerError) {
            console.error("[Bitrix Bot] Function invoke error:", registerError);
            throw new Error(registerError.message || "Erro ao chamar função de registro");
          }

          if (registerData?.error) {
            console.error("[Bitrix Bot] Register returned error:", registerData.error);
            throw new Error(registerData.error);
          }

          if (!registerData?.bot_id) {
            console.error("[Bitrix Bot] No bot_id returned:", registerData);
            throw new Error("Bot registrado mas bot_id não retornado");
          }

          console.log("[Bitrix Bot] Bot registered successfully with ID:", registerData.bot_id);
          toast.success(`Bot registrado com ID: ${registerData.bot_id}`);
          
          // Update local state with new bot_id
          bitrixIntegration.config.bot_id = registerData.bot_id;
        } else {
          console.log("[Bitrix Bot] Bot already registered with ID:", currentBotId);
        }
      }

      // Update the persona
      const { error: personaError } = await supabase
        .from("personas")
        .update({ bitrix_bot_enabled: enable })
        .eq("id", personaId);

      if (personaError) throw personaError;

      // Update the Bitrix24 integration config
      const newConfig = {
        ...bitrixIntegration.config,
        bot_enabled: enable,
        bot_persona_id: enable ? personaId : null,
      };

      const { error: integrationError } = await supabase
        .from("integrations")
        .update({ config: newConfig })
        .eq("id", bitrixIntegration.id);

      if (integrationError) throw integrationError;

      // Update local state
      setBitrixIntegration({ ...bitrixIntegration, config: newConfig });
      
      toast.success(enable 
        ? "Chatbot ativado para todos os canais do Contact Center" 
        : "Chatbot desativado do Bitrix24"
      );
      fetchPersonas();
    } catch (error) {
      console.error("[Bitrix Bot] Error toggling:", error);
      toast.error(error instanceof Error ? error.message : "Erro ao atualizar configuração do Bitrix24");
    } finally {
      setTogglingBitrix(false);
    }
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
      toast.success(`${persona.name} é agora a persona padrão`);
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
                  <div className="flex flex-wrap items-center gap-2 text-sm">
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
                    {persona.bitrix_bot_enabled && (
                      <Badge variant="secondary" className="gap-1 bg-blue-500/10 text-blue-600 border-blue-200">
                        <MessageSquare className="h-3 w-3" />
                        Bitrix24
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

                {bitrixIntegration && editingPersona && (
                  <div className="flex items-center justify-between p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                    <div>
                      <Label className="flex items-center gap-2">
                        <MessageSquare className="h-4 w-4 text-blue-600" />
                        Chatbot no Contact Center
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Ativar para todos os canais (Instagram, Widget, Telegram, etc.)
                      </p>
                    </div>
                    <Switch 
                      checked={editingPersona.bitrix_bot_enabled || false}
                      onCheckedChange={(checked) => handleToggleBitrixBot(editingPersona.id, checked)}
                      disabled={togglingBitrix}
                    />
                  </div>
                )}
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

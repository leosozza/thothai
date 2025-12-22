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
  Upload,
  XCircle,
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
  bitrix_bot_id: number | null;
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
  const [publishingPersonaId, setPublishingPersonaId] = useState<string | null>(null);
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

  const handlePublishToBitrix = async (personaId: string) => {
    if (!bitrixIntegration) {
      toast.error("Integração Bitrix24 não encontrada");
      return;
    }
    
    setPublishingPersonaId(personaId);
    try {
      const persona = personas.find(p => p.id === personaId);
      if (!persona) throw new Error("Persona não encontrada");

      toast.loading(`Publicando "${persona.name}" no Bitrix24...`, { id: "publish-bot" });
      
      const { data, error } = await supabase.functions.invoke("bitrix24-bot-register", {
        body: {
          action: "register_persona",
          integration_id: bitrixIntegration.id,
          persona_id: personaId,
        },
      });

      toast.dismiss("publish-bot");

      if (error) {
        console.error("Publish error:", error);
        throw new Error(error.message || "Erro ao publicar bot");
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      toast.success(`"${persona.name}" publicado no Bitrix24! (Bot ID: ${data.bot_id})`);
      fetchPersonas();
    } catch (error) {
      console.error("Error publishing persona:", error);
      toast.error(error instanceof Error ? error.message : "Erro ao publicar no Bitrix24");
    } finally {
      setPublishingPersonaId(null);
    }
  };

  const handleUnpublishFromBitrix = async (personaId: string) => {
    if (!bitrixIntegration) {
      toast.error("Integração Bitrix24 não encontrada");
      return;
    }
    
    setPublishingPersonaId(personaId);
    try {
      const persona = personas.find(p => p.id === personaId);
      if (!persona) throw new Error("Persona não encontrada");

      toast.loading(`Removendo "${persona.name}" do Bitrix24...`, { id: "unpublish-bot" });
      
      const { data, error } = await supabase.functions.invoke("bitrix24-bot-register", {
        body: {
          action: "unregister_persona",
          integration_id: bitrixIntegration.id,
          persona_id: personaId,
        },
      });

      toast.dismiss("unpublish-bot");

      if (error) {
        console.error("Unpublish error:", error);
        throw new Error(error.message || "Erro ao remover bot");
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      toast.success(`"${persona.name}" removido do Bitrix24`);
      fetchPersonas();
    } catch (error) {
      console.error("Error unpublishing persona:", error);
      toast.error(error instanceof Error ? error.message : "Erro ao remover do Bitrix24");
    } finally {
      setPublishingPersonaId(null);
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
    const persona = personas.find(p => p.id === id);
    
    // If persona is published as bot, unpublish first
    if (persona?.bitrix_bot_id && bitrixIntegration) {
      try {
        toast.loading("Removendo bot do Bitrix24...", { id: "delete-bot" });
        await supabase.functions.invoke("bitrix24-bot-register", {
          body: {
            action: "unregister_persona",
            integration_id: bitrixIntegration.id,
            persona_id: id,
          },
        });
        toast.dismiss("delete-bot");
      } catch (error) {
        console.error("Error unpublishing before delete:", error);
        // Continue with delete anyway
      }
    }

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
              Crie diferentes personalidades para sua IA. Cada persona pode ser publicada como um bot no Bitrix24.
            </p>
          </div>
          <Button className="gap-2" onClick={handleOpenCreate}>
            <Plus className="h-4 w-4" />
            Nova Persona
          </Button>
        </div>

        {/* Bitrix24 Info */}
        {bitrixIntegration && (
          <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
            <CardContent className="py-3 px-4">
              <div className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300">
                <MessageSquare className="h-4 w-4" />
                <span>
                  Bitrix24 conectado. Publique suas personas como bots no Contact Center.
                </span>
              </div>
            </CardContent>
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
                    {persona.bitrix_bot_id && (
                      <Badge variant="secondary" className="gap-1 bg-green-500/10 text-green-600 border-green-200">
                        <MessageSquare className="h-3 w-3" />
                        Bot ID: {persona.bitrix_bot_id}
                      </Badge>
                    )}
                  </div>

                  {/* Bitrix24 Publish/Unpublish */}
                  {bitrixIntegration && (
                    <div className="pt-2 border-t">
                      {persona.bitrix_bot_id ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full gap-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => handleUnpublishFromBitrix(persona.id)}
                          disabled={publishingPersonaId === persona.id}
                        >
                          {publishingPersonaId === persona.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <XCircle className="h-4 w-4" />
                          )}
                          Despublicar do Bitrix24
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full gap-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                          onClick={() => handlePublishToBitrix(persona.id)}
                          disabled={publishingPersonaId === persona.id}
                        >
                          {publishingPersonaId === persona.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Upload className="h-4 w-4" />
                          )}
                          Publicar no Bitrix24
                        </Button>
                      )}
                    </div>
                  )}

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

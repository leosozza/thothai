import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Loader2, Phone, RefreshCw, Settings, Trash2, MessageSquare, Download } from "lucide-react";
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
import { VoiceTestButton } from "@/components/calls/VoiceTestButton";

interface TelephonyNumber {
  id: string;
  provider_id: string;
  phone_number: string;
  friendly_name: string | null;
  persona_id: string | null;
  elevenlabs_agent_id: string | null;
  is_active: boolean;
  provider_type?: string;
  provider_name?: string;
  persona_name?: string;
}

interface Persona {
  id: string;
  name: string;
  elevenlabs_agent_id: string | null;
}

const providerIcons: Record<string, typeof Phone> = {
  wavoip: MessageSquare,
  twilio: Phone,
  telnyx: Phone,
};

const providerColors: Record<string, string> = {
  wavoip: "bg-green-500",
  twilio: "bg-red-500",
  telnyx: "bg-emerald-500",
};

export function TelephonyNumbersCard() {
  const { workspace } = useWorkspace();
  const [numbers, setNumbers] = useState<TelephonyNumber[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [providers, setProviders] = useState<{ id: string; name: string; provider_type: string }[]>([]);
  const [hasProviders, setHasProviders] = useState(false);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState<TelephonyNumber | null>(null);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (workspace?.id) {
      fetchData();
    }
  }, [workspace?.id]);

  const fetchData = async () => {
    if (!workspace?.id) return;

    setLoading(true);
    try {
      // Fetch providers to check if any exist
      const { data: providersData } = await supabase
        .from("telephony_providers")
        .select("id, name, provider_type")
        .eq("workspace_id", workspace.id);

      setHasProviders((providersData?.length || 0) > 0);
      setProviders(providersData || []);

      // Fetch numbers
      const { data: numbersData, error: numbersError } = await supabase
        .from("telephony_numbers")
        .select(`
          id,
          provider_id,
          phone_number,
          friendly_name,
          persona_id,
          elevenlabs_agent_id,
          is_active,
          telephony_providers (provider_type, name),
          personas (name)
        `)
        .eq("workspace_id", workspace.id);

      if (numbersError) throw numbersError;

      const mappedNumbers: TelephonyNumber[] = (numbersData || []).map((item: any) => ({
        id: item.id,
        provider_id: item.provider_id,
        phone_number: item.phone_number,
        friendly_name: item.friendly_name,
        persona_id: item.persona_id,
        elevenlabs_agent_id: item.elevenlabs_agent_id,
        is_active: item.is_active,
        provider_type: item.telephony_providers?.provider_type,
        provider_name: item.telephony_providers?.name,
        persona_name: item.personas?.name,
      }));

      setNumbers(mappedNumbers);

      // Fetch personas
      const { data: personasData, error: personasError } = await supabase
        .from("personas")
        .select("id, name, elevenlabs_agent_id")
        .eq("workspace_id", workspace.id);

      if (personasError) throw personasError;

      setPersonas(personasData || []);
    } catch (error) {
      console.error("Error fetching telephony data:", error);
      toast.error("Erro ao carregar dados de telefonia");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenConfig = (number: TelephonyNumber) => {
    setSelectedNumber(number);
    setSelectedPersonaId(number.persona_id || "");
    setConfigDialogOpen(true);
  };

  const handleSaveConfig = async () => {
    if (!selectedNumber) return;

    setSaving(true);
    try {
      // Get elevenlabs_agent_id from selected persona
      const persona = personas.find((p) => p.id === selectedPersonaId);
      const elevenlabsAgentId = persona?.elevenlabs_agent_id || null;

      const { error } = await supabase
        .from("telephony_numbers")
        .update({
          persona_id: selectedPersonaId || null,
          elevenlabs_agent_id: elevenlabsAgentId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedNumber.id);

      if (error) throw error;

      toast.success("Configuração salva com sucesso!");
      setConfigDialogOpen(false);
      fetchData();
    } catch (error) {
      console.error("Error saving number config:", error);
      toast.error("Erro ao salvar configuração");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteNumber = async (numberId: string) => {
    try {
      const { error } = await supabase
        .from("telephony_numbers")
        .delete()
        .eq("id", numberId);

      if (error) throw error;

      toast.success("Número removido com sucesso!");
      fetchData();
    } catch (error) {
      console.error("Error deleting number:", error);
      toast.error("Erro ao remover número");
    }
  };

  const handleImportNumbers = async () => {
    if (!workspace?.id || providers.length === 0) return;

    setImporting(true);
    try {
      let imported = 0;
      
      for (const provider of providers) {
        const { data, error } = await supabase.functions.invoke("elevenlabs-register-phone", {
          body: {
            action: "import_from_provider",
            workspace_id: workspace.id,
            provider_id: provider.id,
          },
        });

        if (error) {
          console.error(`Error importing from ${provider.name}:`, error);
          continue;
        }

        if (data?.success && data?.number_id) {
          imported++;
        }
      }

      if (imported > 0) {
        toast.success(`${imported} número(s) importado(s) com sucesso!`);
        fetchData();
      } else {
        toast.info("Nenhum novo número encontrado para importar");
      }
    } catch (error) {
      console.error("Error importing numbers:", error);
      toast.error("Erro ao importar números");
    } finally {
      setImporting(false);
    }
  };

  // Don't render if no providers are configured
  if (!hasProviders && !loading) {
    return null;
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <Phone className="h-6 w-6 text-blue-500" />
              </div>
              <div>
                <CardTitle>Números de Telefone ({numbers.length})</CardTitle>
                <CardDescription>
                  Gerencie números associados aos provedores de telefonia
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleImportNumbers} disabled={importing || loading}>
                {importing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Importar Números
              </Button>
              <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : numbers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Phone className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-sm">Nenhum número cadastrado ainda.</p>
              <p className="text-xs mt-2">
                Clique em "Importar Números" para buscar os números dos provedores conectados.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {numbers.map((number) => {
                const IconComponent = providerIcons[number.provider_type || "twilio"] || Phone;
                const colorClass = providerColors[number.provider_type || "twilio"] || "bg-gray-500";

                return (
                  <div
                    key={number.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`h-10 w-10 rounded-full ${colorClass}/10 flex items-center justify-center`}>
                        <IconComponent className={`h-5 w-5 ${colorClass.replace("bg-", "text-")}`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium font-mono">{number.phone_number}</p>
                          <Badge variant="outline" className="text-xs">
                            {number.provider_name}
                          </Badge>
                        </div>
                        {number.persona_name ? (
                          <p className="text-sm text-muted-foreground">
                            → {number.persona_name}
                          </p>
                        ) : (
                          <p className="text-sm text-amber-600">
                            ⚠ Nenhuma persona associada
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={number.is_active ? "outline" : "secondary"}>
                        {number.is_active ? "Ativo" : "Inativo"}
                      </Badge>
                      
                      {number.elevenlabs_agent_id && (
                        <VoiceTestButton
                          agentId={number.elevenlabs_agent_id}
                          personaName={number.persona_name || number.phone_number}
                          compact
                        />
                      )}
                      
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenConfig(number)}
                      >
                        <Settings className="h-4 w-4" />
                      </Button>
                      
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteNumber(number.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Config Dialog */}
      <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Configurar Número
            </DialogTitle>
            <DialogDescription>
              Associe este número a uma persona com agente de voz configurado
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <Label className="text-muted-foreground">Número</Label>
              <p className="text-lg font-mono font-medium">{selectedNumber?.phone_number}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="persona">Persona (Agente de IA)</Label>
              <Select value={selectedPersonaId} onValueChange={setSelectedPersonaId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma persona" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Nenhuma</SelectItem>
                  {personas.map((persona) => (
                    <SelectItem key={persona.id} value={persona.id}>
                      {persona.name}
                      {persona.elevenlabs_agent_id ? " ✓" : " (sem agente)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Selecione uma persona com ElevenLabs Agent ID configurado para atendimento automático.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveConfig} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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

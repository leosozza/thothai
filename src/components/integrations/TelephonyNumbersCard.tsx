import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Loader2, Phone, RefreshCw, Settings, Trash2, MessageSquare, Download, PhoneOutgoing } from "lucide-react";
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
  elevenlabs_phone_id: string | null;
  provider_number_id: string | null;
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
  sip: Phone,
};

const providerColors: Record<string, string> = {
  wavoip: "bg-green-500",
  twilio: "bg-red-500",
  telnyx: "bg-emerald-500",
  sip: "bg-purple-500",
};

// Providers that support outbound calls
const OUTBOUND_CAPABLE_PROVIDERS = ["twilio", "telnyx"];

const supportsOutbound = (providerType: string | undefined): boolean => {
  return OUTBOUND_CAPABLE_PROVIDERS.includes(providerType || "");
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
  const [elevenlabsPhoneId, setElevenlabsPhoneId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [registeringNumber, setRegisteringNumber] = useState<string | null>(null);

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
          elevenlabs_phone_id,
          provider_number_id,
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
        elevenlabs_phone_id: item.elevenlabs_phone_id,
        provider_number_id: item.provider_number_id,
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
    setElevenlabsPhoneId(number.elevenlabs_phone_id || "");
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
          persona_id: selectedPersonaId === "none" ? null : selectedPersonaId || null,
          elevenlabs_agent_id: elevenlabsAgentId,
          elevenlabs_phone_id: elevenlabsPhoneId.trim() ? elevenlabsPhoneId.trim() : null,
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

  const handleRegisterInElevenLabs = async (number: TelephonyNumber) => {
    if (!workspace?.id) return;

    setRegisteringNumber(number.id);
    try {
      // Get provider config for SIP credentials
      const { data: provider } = await supabase
        .from("telephony_providers")
        .select("config, provider_type")
        .eq("id", number.provider_id)
        .single();

      if (!provider) {
        throw new Error("Provedor não encontrado");
      }

      const config = provider.config as {
        sip_account?: string;
        sip_password?: string;
        sip_server?: string;
      };

      // For SIP providers, we need credentials
      if (provider.provider_type === "sip" && (!config.sip_account || !config.sip_password || !config.sip_server)) {
        toast.error("Configuração SIP incompleta. Verifique conta, senha e servidor.");
        return;
      }

      // Get agent ID from persona or number
      let agentId = number.elevenlabs_agent_id;
      if (!agentId && number.persona_id) {
        const persona = personas.find(p => p.id === number.persona_id);
        agentId = persona?.elevenlabs_agent_id || null;
      }

      if (!agentId) {
        toast.error("Primeiro associe uma persona com agente ElevenLabs configurado.");
        return;
      }

      const { data, error } = await supabase.functions.invoke("elevenlabs-register-phone", {
        body: {
          action: "register_sip",
          workspace_id: workspace.id,
          phone_number: number.phone_number,
          agent_id: agentId,
          sip_account: config.sip_account,
          sip_password: config.sip_password,
          sip_server: config.sip_server,
          number_id: number.id,
        },
      });

      if (error) throw error;

      if (data?.success) {
        // Update the number with the ElevenLabs phone ID
        if (data.elevenlabs_phone_id) {
          await supabase
            .from("telephony_numbers")
            .update({ 
              provider_number_id: data.elevenlabs_phone_id,
              updated_at: new Date().toISOString(),
            })
            .eq("id", number.id);
        }

        toast.success("Número registrado no ElevenLabs com sucesso!");
        fetchData();
      } else {
        throw new Error(data?.error || "Erro ao registrar");
      }
    } catch (error: any) {
      console.error("Error registering in ElevenLabs:", error);
      toast.error(error.message || "Erro ao registrar no ElevenLabs");
    } finally {
      setRegisteringNumber(null);
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
                const isElevenLabsRegistered =
                  number.provider_type === "twilio"
                    ? !!number.elevenlabs_phone_id
                    : !!number.provider_number_id;

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
                          {/* Outbound capability indicator */}
                          {supportsOutbound(number.provider_type) ? (
                            <Badge variant="default" className="text-xs bg-green-600 hover:bg-green-700">
                              ↔ Entrada/Saída
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs bg-amber-500/10 text-amber-600 hover:bg-amber-500/20">
                              ← Apenas Entrada
                            </Badge>
                          )}
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

                        {number.provider_type === "twilio" && !number.elevenlabs_phone_id && (
                          <p className="text-xs text-orange-500 mt-1">
                            ⚠ Cole o ElevenLabs Phone ID nas configurações do número
                          </p>
                        )}

                        {!isElevenLabsRegistered && number.provider_type === "sip" && (
                          <p className="text-xs text-orange-500 mt-1">
                            ⚠ Não registrado no ElevenLabs
                          </p>
                        )}

                        {isElevenLabsRegistered && (
                          <p className="text-xs text-green-600 mt-1">
                            ✓ Registrado no ElevenLabs
                          </p>
                        )}

                        {!supportsOutbound(number.provider_type) && (
                          <p className="text-xs text-muted-foreground mt-1">
                            ℹ SIP/Wavoip só recebe chamadas. Use Twilio/Telnyx para fazer chamadas.
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={number.is_active ? "outline" : "secondary"}>
                        {number.is_active ? "Ativo" : "Inativo"}
                      </Badge>
                      
                      {/* Show Register button for SIP numbers not yet registered */}
                      {!number.provider_number_id && (number.provider_type === "sip" || number.provider_type === "wavoip") && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRegisterInElevenLabs(number)}
                          disabled={registeringNumber === number.id}
                        >
                          {registeringNumber === number.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <PhoneOutgoing className="h-4 w-4 mr-1" />
                              Registrar
                            </>
                          )}
                        </Button>
                      )}
                      
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
                  <SelectItem value="none">Nenhuma</SelectItem>
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

            {selectedNumber?.provider_type === "twilio" && (
              <div className="space-y-2">
                <Label htmlFor="elevenlabs_phone_id">ElevenLabs Phone ID</Label>
                <input
                  id="elevenlabs_phone_id"
                  type="text"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="ph_xxxxxxxxx"
                  defaultValue={selectedNumber?.elevenlabs_phone_id || ""}
                  onChange={(e) => {
                    if (selectedNumber) {
                      selectedNumber.elevenlabs_phone_id = e.target.value || null;
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Após registrar o número no ElevenLabs, cole o ID aqui (ex: ph_abc123xyz).
                  <a 
                    href="https://elevenlabs.io/app/agents/phone-numbers" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="ml-1 text-primary underline"
                  >
                    Registrar número →
                  </a>
                </p>
              </div>
            )}
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

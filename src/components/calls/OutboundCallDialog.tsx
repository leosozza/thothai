import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Phone, Loader2, AlertCircle, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

interface Contact {
  id: string;
  name: string | null;
  push_name: string | null;
  phone_number: string;
}

interface Persona {
  id: string;
  name: string;
  elevenlabs_agent_id: string | null;
}

interface TelephonyNumber {
  id: string;
  phone_number: string;
  friendly_name: string | null;
  provider_number_id: string | null;
  elevenlabs_agent_id: string | null;
  persona_id: string | null;
  provider_type?: string;
  provider_name?: string;
}

// Providers that support outbound calls
const OUTBOUND_CAPABLE_PROVIDERS = ["twilio", "telnyx"];

const supportsOutbound = (providerType: string | undefined): boolean => {
  return OUTBOUND_CAPABLE_PROVIDERS.includes(providerType || "");
};

interface OutboundCallDialogProps {
  contact?: Contact;
  workspaceId: string;
  trigger?: React.ReactNode;
}

export function OutboundCallDialog({ contact, workspaceId, trigger }: OutboundCallDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [calling, setCalling] = useState(false);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [telephonyNumbers, setTelephonyNumbers] = useState<TelephonyNumber[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>("");
  const [selectedTelephonyId, setSelectedTelephonyId] = useState<string>("");
  const [phoneNumber, setPhoneNumber] = useState(contact?.phone_number || "");

  useEffect(() => {
    if (open) {
      fetchData();
      if (contact?.phone_number) {
        setPhoneNumber(contact.phone_number);
      }
    }
  }, [open, contact]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch personas with ElevenLabs agent configured
      const { data: personasData } = await supabase
        .from("personas")
        .select("id, name, elevenlabs_agent_id")
        .eq("workspace_id", workspaceId)
        .eq("is_active", true)
        .not("elevenlabs_agent_id", "is", null);

      setPersonas(personasData || []);

      // Fetch telephony numbers with provider info
      const { data: numbersData } = await supabase
        .from("telephony_numbers")
        .select(`
          id, phone_number, friendly_name, provider_number_id, elevenlabs_agent_id, persona_id,
          telephony_providers (provider_type, name)
        `)
        .eq("workspace_id", workspaceId)
        .eq("is_active", true);

      // Map to include provider info
      const mappedNumbers: TelephonyNumber[] = (numbersData || []).map((item: any) => ({
        id: item.id,
        phone_number: item.phone_number,
        friendly_name: item.friendly_name,
        provider_number_id: item.provider_number_id,
        elevenlabs_agent_id: item.elevenlabs_agent_id,
        persona_id: item.persona_id,
        provider_type: item.telephony_providers?.provider_type,
        provider_name: item.telephony_providers?.name,
      }));

      setTelephonyNumbers(mappedNumbers);

      // Auto-select if only one option
      if (personasData?.length === 1) {
        setSelectedPersonaId(personasData[0].id);
      }
      if (numbersData?.length === 1) {
        setSelectedTelephonyId(numbersData[0].id);
      }
    } catch (error) {
      console.error("Error fetching data:", error);
      toast.error("Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  };

  const handleCall = async () => {
    if (!phoneNumber) {
      toast.error("Número de telefone é obrigatório");
      return;
    }

    if (!selectedTelephonyId) {
      toast.error("Selecione um número de telefonia");
      return;
    }

    setCalling(true);
    try {
      const { data, error } = await supabase.functions.invoke("elevenlabs-outbound-call", {
        body: {
          to_number: phoneNumber.replace(/\D/g, ""),
          persona_id: selectedPersonaId || undefined,
          telephony_number_id: selectedTelephonyId,
          workspace_id: workspaceId,
          contact_id: contact?.id,
          contact_name: contact?.name || contact?.push_name,
        },
      });

      if (error) throw error;

      if (data?.error) {
        throw new Error(data.error);
      }

      toast.success("Chamada iniciada!", {
        description: `Ligando para ${phoneNumber}`,
      });

      setOpen(false);
    } catch (error) {
      console.error("Error making call:", error);
      toast.error("Erro ao iniciar chamada", {
        description: error instanceof Error ? error.message : "Tente novamente",
      });
    } finally {
      setCalling(false);
    }
  };

  const contactName = contact?.name || contact?.push_name || "Contato";
  
  // Filter numbers that support outbound calls
  const outboundCapableNumbers = telephonyNumbers.filter(n => supportsOutbound(n.provider_type));
  const hasOutboundNumbers = outboundCapableNumbers.length > 0;
  const hasRequiredConfig = hasOutboundNumbers && (personas.length > 0 || outboundCapableNumbers.some(n => n.elevenlabs_agent_id));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="icon">
            <Phone className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Fazer Ligação
          </DialogTitle>
          <DialogDescription>
            {contact 
              ? `Ligar para ${contactName}`
              : "Iniciar uma chamada de voz com IA"
            }
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !hasRequiredConfig ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {!hasOutboundNumbers ? (
                <>
                  Nenhum número com suporte a chamadas de saída.
                  <br />
                  <span className="font-medium">Twilio ou Telnyx</span> são necessários para fazer ligações.
                  Números SIP/WaVoIP só podem receber chamadas.
                </>
              ) : (
                <>
                  Nenhum número de telefonia ou persona com agente ElevenLabs configurado.
                  Configure primeiro em Integrações → Telefonia.
                </>
              )}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            {/* Phone Number */}
            <div className="space-y-2">
              <Label htmlFor="phone">Número de Destino</Label>
              <Input
                id="phone"
                placeholder="+5511999999999"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
              />
            </div>

            {/* Persona Selection */}
            {personas.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="persona">Agente de IA</Label>
                <Select value={selectedPersonaId} onValueChange={setSelectedPersonaId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o agente" />
                  </SelectTrigger>
                  <SelectContent>
                    {personas.map((persona) => (
                      <SelectItem key={persona.id} value={persona.id}>
                        {persona.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Selecione qual persona/agente vai conduzir a ligação
                </p>
              </div>
            )}

            {/* Telephony Number Selection */}
            <div className="space-y-2">
              <Label htmlFor="telephony">Número de Origem</Label>
              <Select value={selectedTelephonyId} onValueChange={setSelectedTelephonyId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o número" />
                </SelectTrigger>
                <SelectContent>
                  {outboundCapableNumbers.map((number) => (
                    <SelectItem key={number.id} value={number.id}>
                      <span className="flex items-center gap-2">
                        {number.friendly_name || number.phone_number}
                        <Badge variant="outline" className="text-xs ml-1">
                          {number.provider_name || number.provider_type}
                        </Badge>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Apenas números Twilio/Telnyx podem fazer chamadas de saída
              </p>
            </div>

            {/* Warning if there are SIP numbers that can't be used */}
            {telephonyNumbers.length > outboundCapableNumbers.length && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  {telephonyNumbers.length - outboundCapableNumbers.length} número(s) SIP/WaVoIP não listado(s) - só recebem chamadas.
                </AlertDescription>
              </Alert>
            )}

            {/* Call Button */}
            <Button
              onClick={handleCall}
              disabled={calling || !phoneNumber || !selectedTelephonyId}
              className="w-full gap-2"
            >
              {calling ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Iniciando chamada...
                </>
              ) : (
                <>
                  <Phone className="h-4 w-4" />
                  Ligar Agora
                </>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

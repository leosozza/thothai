import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Upload } from "lucide-react";

interface Recipient {
  phone_number: string;
  name: string;
  dynamic_variables: Record<string, string>;
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
}

interface CreateBatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function CreateBatchDialog({ open, onOpenChange, onSuccess }: CreateBatchDialogProps) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [telephonyNumbers, setTelephonyNumbers] = useState<TelephonyNumber[]>([]);
  
  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [personaId, setPersonaId] = useState("");
  const [telephonyNumberId, setTelephonyNumberId] = useState("");
  const [recipients, setRecipients] = useState<Recipient[]>([
    { phone_number: "", name: "", dynamic_variables: {} }
  ]);

  const { workspace } = useWorkspace();

  useEffect(() => {
    if (open && workspace) {
      fetchPersonas();
      fetchTelephonyNumbers();
    }
  }, [open, workspace]);

  const fetchPersonas = async () => {
    if (!workspace) return;

    try {
      const { data, error } = await supabase
        .from("personas")
        .select("id, name, elevenlabs_agent_id")
        .eq("workspace_id", workspace.id)
        .eq("is_active", true)
        .not("elevenlabs_agent_id", "is", null);

      if (error) throw error;
      setPersonas(data || []);
    } catch (error) {
      console.error("Error fetching personas:", error);
    }
  };

  const fetchTelephonyNumbers = async () => {
    if (!workspace) return;

    try {
      const { data, error } = await supabase
        .from("telephony_numbers")
        .select("id, phone_number, friendly_name")
        .eq("workspace_id", workspace.id)
        .eq("is_active", true);

      if (error) throw error;
      setTelephonyNumbers(data || []);
    } catch (error) {
      console.error("Error fetching telephony numbers:", error);
    }
  };

  const handleAddRecipient = () => {
    setRecipients([...recipients, { phone_number: "", name: "", dynamic_variables: {} }]);
  };

  const handleRemoveRecipient = (index: number) => {
    setRecipients(recipients.filter((_, i) => i !== index));
  };

  const handleRecipientChange = (index: number, field: keyof Recipient, value: string) => {
    const updated = [...recipients];
    if (field === "dynamic_variables") {
      // Parse dynamic variables from JSON string
      try {
        updated[index].dynamic_variables = JSON.parse(value);
      } catch {
        // Keep as empty object if invalid JSON
      }
    } else {
      updated[index][field] = value;
    }
    setRecipients(updated);
  };

  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split("\n");
      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
      
      const phoneIndex = headers.findIndex((h) => h.includes("phone") || h.includes("telefone"));
      const nameIndex = headers.findIndex((h) => h.includes("name") || h.includes("nome"));

      if (phoneIndex === -1) {
        toast.error("CSV deve ter uma coluna 'phone' ou 'telefone'");
        return;
      }

      const newRecipients: Recipient[] = [];
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(",").map((v) => v.trim());
        if (values[phoneIndex]) {
          const dynamicVars: Record<string, string> = {};
          headers.forEach((header, idx) => {
            if (idx !== phoneIndex && idx !== nameIndex && values[idx]) {
              dynamicVars[header] = values[idx];
            }
          });

          newRecipients.push({
            phone_number: values[phoneIndex],
            name: nameIndex !== -1 ? values[nameIndex] : "",
            dynamic_variables: dynamicVars,
          });
        }
      }

      if (newRecipients.length > 0) {
        setRecipients(newRecipients);
        toast.success(`${newRecipients.length} contatos importados`);
      }
    };
    reader.readAsText(file);
  };

  const handleCreate = async () => {
    if (!workspace) return;

    const validRecipients = recipients.filter((r) => r.phone_number.trim());
    if (validRecipients.length === 0) {
      toast.error("Adicione pelo menos um destinatário");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("elevenlabs-batch-calls", {
        body: {
          action: "create_batch",
          workspace_id: workspace.id,
          name,
          description,
          persona_id: personaId,
          telephony_number_id: telephonyNumberId,
          recipients: validRecipients.map((r) => ({
            phone_number: r.phone_number,
            name: r.name || undefined,
            dynamic_variables: Object.keys(r.dynamic_variables).length > 0 ? r.dynamic_variables : undefined,
          })),
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      toast.success("Campanha criada com sucesso!");
      resetForm();
      onSuccess();
    } catch (error: any) {
      console.error("Error creating batch:", error);
      toast.error(error.message || "Erro ao criar campanha");
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setStep(1);
    setName("");
    setDescription("");
    setPersonaId("");
    setTelephonyNumberId("");
    setRecipients([{ phone_number: "", name: "", dynamic_variables: {} }]);
  };

  const canProceedStep1 = name && personaId && telephonyNumberId;
  const canCreate = canProceedStep1 && recipients.some((r) => r.phone_number.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nova Campanha de Chamadas</DialogTitle>
          <DialogDescription>
            {step === 1 ? "Configure as informações básicas da campanha" : "Adicione os destinatários"}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome da Campanha *</Label>
              <Input
                id="name"
                placeholder="Ex: Campanha de Cobrança Janeiro"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Descrição</Label>
              <Textarea
                id="description"
                placeholder="Descreva o objetivo desta campanha..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="persona">Persona/Agente *</Label>
              <Select value={personaId} onValueChange={setPersonaId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a persona" />
                </SelectTrigger>
                <SelectContent>
                  {personas.map((persona) => (
                    <SelectItem key={persona.id} value={persona.id}>
                      {persona.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {personas.length === 0 && (
                <p className="text-xs text-destructive">
                  Nenhuma persona com agente ElevenLabs configurado
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="number">Número de Telefonia *</Label>
              <Select value={telephonyNumberId} onValueChange={setTelephonyNumberId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o número" />
                </SelectTrigger>
                <SelectContent>
                  {telephonyNumbers.map((number) => (
                    <SelectItem key={number.id} value={number.id}>
                      {number.friendly_name || number.phone_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {telephonyNumbers.length === 0 && (
                <p className="text-xs text-destructive">
                  Nenhum número de telefonia configurado
                </p>
              )}
            </div>

            <div className="flex justify-end pt-4">
              <Button onClick={() => setStep(2)} disabled={!canProceedStep1}>
                Próximo: Adicionar Destinatários
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Destinatários ({recipients.filter((r) => r.phone_number).length})</Label>
              <div className="flex items-center gap-2">
                <Label htmlFor="csv-upload" className="cursor-pointer">
                  <Button variant="outline" size="sm" asChild>
                    <span>
                      <Upload className="h-4 w-4 mr-2" />
                      Importar CSV
                    </span>
                  </Button>
                </Label>
                <input
                  id="csv-upload"
                  type="file"
                  accept=".csv"
                  onChange={handleCsvImport}
                  className="hidden"
                />
                <Button variant="outline" size="sm" onClick={handleAddRecipient}>
                  <Plus className="h-4 w-4 mr-2" />
                  Adicionar
                </Button>
              </div>
            </div>

            <div className="max-h-[300px] overflow-y-auto space-y-3">
              {recipients.map((recipient, index) => (
                <div key={index} className="flex items-start gap-3 p-3 border rounded-lg">
                  <div className="flex-1 grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Telefone *</Label>
                      <Input
                        placeholder="+5511999999999"
                        value={recipient.phone_number}
                        onChange={(e) => handleRecipientChange(index, "phone_number", e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Nome</Label>
                      <Input
                        placeholder="João Silva"
                        value={recipient.name}
                        onChange={(e) => handleRecipientChange(index, "name", e.target.value)}
                      />
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveRecipient(index)}
                    disabled={recipients.length === 1}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              Dica: Importe um arquivo CSV com colunas "phone" (ou "telefone") e "name" (ou "nome").
              Outras colunas serão usadas como variáveis dinâmicas.
            </p>

            <div className="flex justify-between pt-4">
              <Button variant="outline" onClick={() => setStep(1)}>
                Voltar
              </Button>
              <Button onClick={handleCreate} disabled={!canCreate || loading}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Criando...
                  </>
                ) : (
                  "Criar Campanha"
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

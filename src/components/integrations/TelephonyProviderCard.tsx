import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Loader2, Phone, MessageSquare, ExternalLink, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface TelephonyProvider {
  id: string;
  provider_type: string;
  name: string;
  config: Record<string, unknown>;
  is_active: boolean;
}

interface TelephonyProviderCardProps {
  providerType: "wavoip" | "twilio" | "telnyx";
  onSaved?: () => void;
}

const providerConfigs = {
  wavoip: {
    name: "WaVoIP",
    description: "Chamadas de voz via WhatsApp",
    icon: MessageSquare,
    color: "bg-green-500",
    fields: [
      { key: "api_token", label: "API Token", type: "password", placeholder: "Seu token WaVoIP" },
      { key: "instance_key", label: "Instance Key", type: "text", placeholder: "Chave da instância" },
    ],
    docs: "https://wavoip.com/docs",
  },
  twilio: {
    name: "Twilio",
    description: "SIP Trunking e números virtuais",
    icon: Phone,
    color: "bg-red-500",
    fields: [
      { key: "account_sid", label: "Account SID", type: "text", placeholder: "ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" },
      { key: "auth_token", label: "Auth Token", type: "password", placeholder: "Seu Auth Token" },
    ],
    docs: "https://www.twilio.com/docs/voice",
  },
  telnyx: {
    name: "Telnyx",
    description: "SIP Trunking de baixo custo",
    icon: Phone,
    color: "bg-emerald-500",
    fields: [
      { key: "api_key", label: "API Key", type: "password", placeholder: "KEY..." },
      { key: "connection_id", label: "Connection ID", type: "text", placeholder: "ID da conexão SIP" },
    ],
    docs: "https://developers.telnyx.com/docs/voice",
  },
};

export function TelephonyProviderCard({
  providerType,
  onSaved,
}: TelephonyProviderCardProps) {
  const { workspace } = useWorkspace();
  const [existingProvider, setExistingProvider] = useState<TelephonyProvider | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formData, setFormData] = useState<Record<string, string>>({});

  const config = providerConfigs[providerType];
  const IconComponent = config.icon;

  useEffect(() => {
    if (workspace?.id) {
      fetchProvider();
    }
  }, [workspace?.id, providerType]);

  const fetchProvider = async () => {
    if (!workspace?.id) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("telephony_providers")
        .select("*")
        .eq("workspace_id", workspace.id)
        .eq("provider_type", providerType)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setExistingProvider({
          id: data.id,
          provider_type: data.provider_type,
          name: data.name,
          config: data.config as Record<string, unknown>,
          is_active: data.is_active ?? false,
        });
        
        // Populate form data from existing config
        const configData: Record<string, string> = {};
        for (const field of config.fields) {
          configData[field.key] = ((data.config as Record<string, unknown>)?.[field.key] as string) || "";
        }
        setFormData(configData);
      } else {
        setExistingProvider(null);
        setFormData({});
      }
    } catch (error) {
      console.error("Error fetching telephony provider:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!workspace?.id) return;

    // Validate required fields
    const missingFields = config.fields.filter((f) => !formData[f.key]);
    if (missingFields.length > 0) {
      toast.error(`Preencha todos os campos: ${missingFields.map((f) => f.label).join(", ")}`);
      return;
    }

    setSaving(true);
    try {
      if (existingProvider) {
        // Update existing provider
        const { error } = await supabase
          .from("telephony_providers")
          .update({
            config: formData,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingProvider.id);

        if (error) throw error;
        toast.success(`${config.name} atualizado com sucesso!`);
      } else {
        // Create new provider
        const { error } = await supabase.from("telephony_providers").insert({
          workspace_id: workspace.id,
          provider_type: providerType,
          name: config.name,
          config: formData,
          is_active: true,
        });

        if (error) throw error;
        toast.success(`${config.name} conectado com sucesso!`);
      }
      fetchProvider();
      onSaved?.();
    } catch (error) {
      console.error("Error saving telephony provider:", error);
      toast.error(`Erro ao salvar ${config.name}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!existingProvider) return;

    setDeleting(true);
    try {
      const { error } = await supabase
        .from("telephony_providers")
        .delete()
        .eq("id", existingProvider.id);

      if (error) throw error;
      toast.success(`${config.name} removido com sucesso!`);
      setFormData({});
      setExistingProvider(null);
      onSaved?.();
    } catch (error) {
      console.error("Error deleting telephony provider:", error);
      toast.error(`Erro ao remover ${config.name}`);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className={`h-12 w-12 rounded-xl ${config.color}/10 flex items-center justify-center`}>
              <IconComponent className={`h-6 w-6 ${config.color.replace("bg-", "text-")}`} />
            </div>
            <div>
              <CardTitle>{config.name}</CardTitle>
              <CardDescription>{config.description}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`h-12 w-12 rounded-xl ${config.color}/10 flex items-center justify-center`}>
              <IconComponent className={`h-6 w-6 ${config.color.replace("bg-", "text-")}`} />
            </div>
            <div>
              <CardTitle>{config.name}</CardTitle>
              <CardDescription>{config.description}</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {existingProvider ? (
              <Badge variant="outline" className="gap-1.5">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                Conectado
              </Badge>
            ) : (
              <Badge variant="secondary">Não configurado</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {config.fields.map((field) => (
          <div key={field.key} className="space-y-2">
            <Label htmlFor={`${providerType}-${field.key}`}>{field.label}</Label>
            <Input
              id={`${providerType}-${field.key}`}
              type={field.type}
              placeholder={field.placeholder}
              value={formData[field.key] || ""}
              onChange={(e) => setFormData((prev) => ({ ...prev, [field.key]: e.target.value }))}
            />
          </div>
        ))}

        <div className="flex gap-2 pt-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : existingProvider ? (
              "Atualizar"
            ) : (
              `Conectar ${config.name}`
            )}
          </Button>

          {existingProvider && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={deleting}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Remover
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remover {config.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta ação irá remover a integração com {config.name} e todos os números associados.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>Remover</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          <Button variant="ghost" size="sm" asChild>
            <a href={config.docs} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-1" />
              Docs
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

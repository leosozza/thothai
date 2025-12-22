import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Key } from "lucide-react";

interface AIProvider {
  id: string;
  name: string;
  slug: string;
  is_native: boolean;
  is_free: boolean;
  available_models: string[];
}

interface AIModelSelectorProps {
  selectedProviderId: string | null;
  selectedModel: string;
  useNativeCredits: boolean;
  onProviderChange: (providerId: string | null, providerSlug: string) => void;
  onModelChange: (model: string) => void;
  onUseNativeCreditsChange: (useNative: boolean) => void;
}

export function AIModelSelector({
  selectedProviderId,
  selectedModel,
  useNativeCredits,
  onProviderChange,
  onModelChange,
  onUseNativeCreditsChange,
}: AIModelSelectorProps) {
  const { workspace } = useWorkspace();
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [configuredProviderIds, setConfiguredProviderIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProviders();
  }, [workspace?.id]);

  const fetchProviders = async () => {
    try {
      // Fetch all providers
      const { data: providersData } = await supabase
        .from("ai_providers")
        .select("id, name, slug, is_native, is_free, available_models")
        .eq("is_active", true)
        .order("is_native", { ascending: false })
        .order("name");

      const parsed = (providersData || []).map(p => ({
        ...p,
        available_models: Array.isArray(p.available_models) 
          ? (p.available_models as unknown as string[])
          : [],
      })) as AIProvider[];

      setProviders(parsed);

      // Fetch configured credentials for this workspace
      if (workspace?.id) {
        const { data: creds } = await supabase
          .from("workspace_ai_credentials")
          .select("provider_id")
          .eq("workspace_id", workspace.id)
          .eq("is_active", true);

        setConfiguredProviderIds((creds || []).map(c => c.provider_id));
      }
    } catch (error) {
      console.error("Error fetching providers:", error);
    } finally {
      setLoading(false);
    }
  };

  const selectedProvider = providers.find(p => p.id === selectedProviderId);
  const availableModels = selectedProvider?.available_models || 
    providers.find(p => p.is_native)?.available_models || [];

  const isProviderAvailable = (provider: AIProvider) => {
    return provider.is_native || configuredProviderIds.includes(provider.id);
  };

  const handleProviderChange = (providerId: string) => {
    const provider = providers.find(p => p.id === providerId);
    if (provider) {
      onProviderChange(providerId, provider.slug);
      // Set first available model for this provider
      if (provider.available_models.length > 0) {
        onModelChange(provider.available_models[0]);
      }
    }
  };

  if (loading) {
    return <div className="animate-pulse h-20 bg-muted rounded-lg" />;
  }

  return (
    <div className="space-y-4 p-4 rounded-lg bg-muted/50 border">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Configuração de IA</Label>
        <Badge variant="outline" className="text-xs">
          {useNativeCredits ? (
            <>
              <Sparkles className="h-3 w-3 mr-1" />
              Créditos Nativos
            </>
          ) : (
            <>
              <Key className="h-3 w-3 mr-1" />
              API Key Própria
            </>
          )}
        </Badge>
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="useNative" className="text-sm">Usar créditos nativos</Label>
          <p className="text-xs text-muted-foreground">
            Usar Lovable AI ao invés de API key própria
          </p>
        </div>
        <Switch
          id="useNative"
          checked={useNativeCredits}
          onCheckedChange={onUseNativeCreditsChange}
        />
      </div>

      {!useNativeCredits && (
        <div className="space-y-2">
          <Label>Provedor de IA</Label>
          <Select
            value={selectedProviderId || ""}
            onValueChange={handleProviderChange}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione um provedor" />
            </SelectTrigger>
            <SelectContent>
              {providers.map(provider => (
                <SelectItem 
                  key={provider.id} 
                  value={provider.id}
                  disabled={!isProviderAvailable(provider)}
                >
                  <div className="flex items-center gap-2">
                    <span>{provider.name}</span>
                    {provider.is_native && (
                      <Badge variant="secondary" className="text-xs">Nativo</Badge>
                    )}
                    {provider.is_free && !provider.is_native && (
                      <Badge variant="outline" className="text-xs">Free</Badge>
                    )}
                    {!isProviderAvailable(provider) && (
                      <span className="text-xs text-muted-foreground">(não configurado)</span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <Label>Modelo</Label>
        <Select
          value={selectedModel}
          onValueChange={onModelChange}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione um modelo" />
          </SelectTrigger>
          <SelectContent>
            {availableModels.map(model => (
              <SelectItem key={model} value={model}>
                {model}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

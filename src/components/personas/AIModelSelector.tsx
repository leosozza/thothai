import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Key, Zap, Star, Crown } from "lucide-react";

interface NativeAIModel {
  id: string;
  name: string;
  display_name: string;
  tier: "basic" | "professional" | "expert";
  token_cost_multiplier: number;
  provider_source: string;
}

interface AIProvider {
  id: string;
  name: string;
  slug: string;
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

const tierConfig = {
  basic: {
    label: "Basic",
    multiplier: "1x",
    color: "bg-green-500/10 text-green-600 border-green-500/30",
    icon: Zap,
  },
  professional: {
    label: "Professional",
    multiplier: "2x",
    color: "bg-blue-500/10 text-blue-600 border-blue-500/30",
    icon: Star,
  },
  expert: {
    label: "Expert",
    multiplier: "5x",
    color: "bg-purple-500/10 text-purple-600 border-purple-500/30",
    icon: Crown,
  },
};

export function AIModelSelector({
  selectedProviderId,
  selectedModel,
  useNativeCredits,
  onProviderChange,
  onModelChange,
  onUseNativeCreditsChange,
}: AIModelSelectorProps) {
  const { workspace } = useWorkspace();
  const [nativeModels, setNativeModels] = useState<NativeAIModel[]>([]);
  const [externalProviders, setExternalProviders] = useState<AIProvider[]>([]);
  const [configuredProviderIds, setConfiguredProviderIds] = useState<string[]>([]);
  const [selectedTier, setSelectedTier] = useState<"basic" | "professional" | "expert">("professional");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [workspace?.id]);

  // Determine initial tier based on selected model
  useEffect(() => {
    if (useNativeCredits && selectedModel) {
      const model = nativeModels.find(m => m.name === selectedModel);
      if (model) {
        setSelectedTier(model.tier);
      }
    }
  }, [selectedModel, nativeModels, useNativeCredits]);

  const fetchData = async () => {
    try {
      // Fetch native AI models
      const { data: nativeData } = await supabase
        .from("native_ai_models")
        .select("id, name, display_name, tier, token_cost_multiplier, provider_source")
        .eq("is_active", true)
        .order("tier")
        .order("display_name");

      setNativeModels((nativeData || []) as NativeAIModel[]);

      // Fetch external providers (non-native, public only)
      const { data: providersData } = await supabase
        .from("ai_providers")
        .select("id, name, slug, available_models")
        .eq("is_active", true)
        .eq("is_native", false)
        .eq("is_public", true)
        .order("name");

      const parsed = (providersData || []).map(p => ({
        ...p,
        available_models: Array.isArray(p.available_models) 
          ? (p.available_models as unknown as string[])
          : [],
      })) as AIProvider[];

      setExternalProviders(parsed);

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
      console.error("Error fetching AI data:", error);
    } finally {
      setLoading(false);
    }
  };

  const getModelsByTier = (tier: "basic" | "professional" | "expert") => {
    return nativeModels.filter(m => m.tier === tier);
  };

  const configuredProviders = externalProviders.filter(p => 
    configuredProviderIds.includes(p.id)
  );

  const handleModeChange = (mode: string) => {
    const isNative = mode === "native";
    onUseNativeCreditsChange(isNative);
    
    if (isNative) {
      // Select first model from current tier
      const models = getModelsByTier(selectedTier);
      if (models.length > 0) {
        onModelChange(models[0].name);
        onProviderChange(null, "lovable");
      }
    } else {
      // Select first configured provider
      if (configuredProviders.length > 0) {
        const provider = configuredProviders[0];
        onProviderChange(provider.id, provider.slug);
        if (provider.available_models.length > 0) {
          onModelChange(provider.available_models[0]);
        }
      }
    }
  };

  const handleTierChange = (tier: "basic" | "professional" | "expert") => {
    setSelectedTier(tier);
    const models = getModelsByTier(tier);
    if (models.length > 0) {
      onModelChange(models[0].name);
    }
  };

  const handleNativeModelChange = (modelName: string) => {
    onModelChange(modelName);
    onProviderChange(null, "lovable");
  };

  const handleProviderChange = (providerId: string) => {
    const provider = externalProviders.find(p => p.id === providerId);
    if (provider) {
      onProviderChange(providerId, provider.slug);
      if (provider.available_models.length > 0) {
        onModelChange(provider.available_models[0]);
      }
    }
  };

  const selectedProvider = externalProviders.find(p => p.id === selectedProviderId);

  if (loading) {
    return <div className="animate-pulse h-24 bg-muted rounded-lg" />;
  }

  return (
    <div className="space-y-4 p-4 rounded-lg bg-muted/50 border">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Configuração de IA</Label>
        <Badge variant="outline" className="text-xs">
          {useNativeCredits ? (
            <>
              <Sparkles className="h-3 w-3 mr-1" />
              ThothAI
            </>
          ) : (
            <>
              <Key className="h-3 w-3 mr-1" />
              API Própria
            </>
          )}
        </Badge>
      </div>

      <RadioGroup
        value={useNativeCredits ? "native" : "own"}
        onValueChange={handleModeChange}
        className="grid grid-cols-2 gap-4"
      >
        <div>
          <RadioGroupItem
            value="native"
            id="native"
            className="peer sr-only"
          />
          <Label
            htmlFor="native"
            className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
          >
            <Sparkles className="mb-2 h-5 w-5" />
            <span className="text-sm font-medium">ThothAI</span>
            <span className="text-xs text-muted-foreground">Usa créditos</span>
          </Label>
        </div>
        <div>
          <RadioGroupItem
            value="own"
            id="own"
            className="peer sr-only"
            disabled={configuredProviders.length === 0}
          />
          <Label
            htmlFor="own"
            className={`flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary ${
              configuredProviders.length === 0 ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
            }`}
          >
            <Key className="mb-2 h-5 w-5" />
            <span className="text-sm font-medium">API Própria</span>
            <span className="text-xs text-muted-foreground">
              {configuredProviders.length > 0 
                ? `${configuredProviders.length} configurado(s)`
                : "Nenhuma configurada"
              }
            </span>
          </Label>
        </div>
      </RadioGroup>

      {useNativeCredits ? (
        <>
          <div className="space-y-2">
            <Label>Tier</Label>
            <Select
              value={selectedTier}
              onValueChange={(v) => handleTierChange(v as "basic" | "professional" | "expert")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["basic", "professional", "expert"] as const).map((tier) => {
                  const config = tierConfig[tier];
                  const TierIcon = config.icon;
                  return (
                    <SelectItem key={tier} value={tier}>
                      <div className="flex items-center gap-2">
                        <TierIcon className="h-4 w-4" />
                        <span>{config.label}</span>
                        <Badge variant="outline" className="text-xs ml-2">
                          {config.multiplier}
                        </Badge>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Modelo</Label>
            <Select
              value={selectedModel}
              onValueChange={handleNativeModelChange}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione um modelo" />
              </SelectTrigger>
              <SelectContent>
                {getModelsByTier(selectedTier).map(model => (
                  <SelectItem key={model.id} value={model.name}>
                    {model.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      ) : (
        <>
          <div className="space-y-2">
            <Label>Provedor</Label>
            <Select
              value={selectedProviderId || ""}
              onValueChange={handleProviderChange}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione um provedor" />
              </SelectTrigger>
              <SelectContent>
                {configuredProviders.map(provider => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedProvider && (
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
                  {selectedProvider.available_models.map(model => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </>
      )}
    </div>
  );
}

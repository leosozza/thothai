import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Key, Volume2, Play, Pause, Zap, Star, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";

interface NativeVoiceModel {
  id: string;
  name: string;
  display_name: string;
  type: "tts" | "stt";
  tier: "basic" | "professional" | "expert";
  token_cost_multiplier: number;
  provider_source: string;
  voice_id: string | null;
  language: string | null;
  gender: string | null;
  sample_audio_url: string | null;
}

interface VoiceProvider {
  id: string;
  name: string;
  slug: string;
  type: string;
  available_voices: Array<{ id: string; name: string; gender?: string }>;
}

interface VoiceModelSelectorProps {
  voiceEnabled: boolean;
  onVoiceEnabledChange: (enabled: boolean) => void;
  selectedVoiceProviderId: string | null;
  selectedVoiceId: string | null;
  useNativeVoice: boolean;
  onProviderChange: (providerId: string | null) => void;
  onVoiceChange: (voiceId: string | null) => void;
  onUseNativeVoiceChange: (useNative: boolean) => void;
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

export function VoiceModelSelector({
  voiceEnabled,
  onVoiceEnabledChange,
  selectedVoiceProviderId,
  selectedVoiceId,
  useNativeVoice,
  onProviderChange,
  onVoiceChange,
  onUseNativeVoiceChange,
}: VoiceModelSelectorProps) {
  const { workspace } = useWorkspace();
  const [nativeVoices, setNativeVoices] = useState<NativeVoiceModel[]>([]);
  const [voiceProviders, setVoiceProviders] = useState<VoiceProvider[]>([]);
  const [configuredProviderIds, setConfiguredProviderIds] = useState<string[]>([]);
  const [selectedTier, setSelectedTier] = useState<"basic" | "professional" | "expert">("professional");
  const [loading, setLoading] = useState(true);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetchData();
  }, [workspace?.id]);

  useEffect(() => {
    if (useNativeVoice && selectedVoiceId) {
      const voice = nativeVoices.find(v => v.voice_id === selectedVoiceId);
      if (voice) {
        setSelectedTier(voice.tier);
      }
    }
  }, [selectedVoiceId, nativeVoices, useNativeVoice]);

  const fetchData = async () => {
    try {
      // Fetch native voice models (TTS only)
      const { data: nativeData } = await supabase
        .from("native_voice_models")
        .select("*")
        .eq("is_active", true)
        .eq("type", "tts")
        .order("tier")
        .order("display_name");

      setNativeVoices((nativeData || []) as NativeVoiceModel[]);

      // Fetch voice providers (non-native, TTS)
      const { data: providersData } = await supabase
        .from("voice_providers")
        .select("id, name, slug, type, available_voices")
        .eq("is_active", true)
        .eq("is_native", false)
        .eq("type", "tts")
        .order("name");

      const parsed = (providersData || []).map(p => ({
        ...p,
        available_voices: Array.isArray(p.available_voices)
          ? (p.available_voices as unknown as Array<{ id: string; name: string; gender?: string }>)
          : [],
      })) as VoiceProvider[];

      setVoiceProviders(parsed);

      // Fetch configured credentials from multiple sources
      if (workspace?.id) {
        // 1. Get from workspace_voice_credentials (new system)
        const { data: newCreds } = await supabase
          .from("workspace_voice_credentials")
          .select("provider_id")
          .eq("workspace_id", workspace.id)
          .eq("is_active", true);

        const newCredProviderIds = (newCreds || []).map(c => c.provider_id);

        // 2. Get from integrations table (legacy system - elevenlabs, azure_tts, etc.)
        const { data: legacyIntegrations } = await supabase
          .from("integrations")
          .select("id, type, config, is_active")
          .eq("workspace_id", workspace.id)
          .eq("is_active", true)
          .in("type", ["elevenlabs", "azure_tts", "google_tts", "openai_whisper"]);

        // Map legacy integration types to voice provider slugs
        const legacyTypeToSlug: Record<string, string> = {
          "elevenlabs": "elevenlabs",
          "azure_tts": "azure",
          "google_tts": "google",
          "openai_whisper": "openai",
        };

        // Find provider IDs for legacy integrations
        const legacyProviderIds: string[] = [];
        for (const integration of legacyIntegrations || []) {
          const slug = legacyTypeToSlug[integration.type];
          if (slug) {
            const provider = parsed.find(p => p.slug === slug);
            if (provider) {
              legacyProviderIds.push(provider.id);
            }
          }
        }

        // Combine both sources (deduplicated)
        const allProviderIds = [...new Set([...newCredProviderIds, ...legacyProviderIds])];
        setConfiguredProviderIds(allProviderIds);
      }
    } catch (error) {
      console.error("Error fetching voice data:", error);
    } finally {
      setLoading(false);
    }
  };

  const getVoicesByTier = (tier: "basic" | "professional" | "expert") => {
    return nativeVoices.filter(v => v.tier === tier);
  };

  const configuredProviders = voiceProviders.filter(p =>
    configuredProviderIds.includes(p.id)
  );

  const handleModeChange = (mode: string) => {
    const isNative = mode === "native";
    onUseNativeVoiceChange(isNative);

    if (isNative) {
      const voices = getVoicesByTier(selectedTier);
      if (voices.length > 0) {
        onVoiceChange(voices[0].voice_id);
        onProviderChange(null);
      }
    } else {
      if (configuredProviders.length > 0) {
        const provider = configuredProviders[0];
        onProviderChange(provider.id);
        if (provider.available_voices.length > 0) {
          onVoiceChange(provider.available_voices[0].id);
        }
      }
    }
  };

  const handleTierChange = (tier: "basic" | "professional" | "expert") => {
    setSelectedTier(tier);
    const voices = getVoicesByTier(tier);
    if (voices.length > 0) {
      onVoiceChange(voices[0].voice_id);
    }
  };

  const handleProviderChange = (providerId: string) => {
    const provider = voiceProviders.find(p => p.id === providerId);
    if (provider) {
      onProviderChange(providerId);
      if (provider.available_voices.length > 0) {
        onVoiceChange(provider.available_voices[0].id);
      }
    }
  };

  const handlePlaySample = (voiceId: string, sampleUrl: string | null) => {
    if (!sampleUrl) return;

    if (playingVoiceId === voiceId && audioElement) {
      audioElement.pause();
      setPlayingVoiceId(null);
      setAudioElement(null);
      return;
    }

    if (audioElement) {
      audioElement.pause();
    }

    const audio = new Audio(sampleUrl);
    audio.onended = () => {
      setPlayingVoiceId(null);
      setAudioElement(null);
    };
    audio.play();
    setPlayingVoiceId(voiceId);
    setAudioElement(audio);
  };

  const selectedProvider = voiceProviders.find(p => p.id === selectedVoiceProviderId);

  if (loading) {
    return <div className="animate-pulse h-24 bg-muted rounded-lg" />;
  }

  return (
    <div className="space-y-4 p-4 rounded-lg bg-muted/50 border">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Volume2 className="h-4 w-4 text-muted-foreground" />
          <Label className="text-sm font-medium">Configuração de Voz</Label>
        </div>
        <Switch checked={voiceEnabled} onCheckedChange={onVoiceEnabledChange} />
      </div>

      {!voiceEnabled && (
        <p className="text-sm text-muted-foreground">
          Habilite para permitir respostas por voz (Text-to-Speech)
        </p>
      )}

      {voiceEnabled && (
        <>
          <div className="flex items-center justify-end">
            <Badge variant="outline" className="text-xs">
              {useNativeVoice ? (
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
            value={useNativeVoice ? "native" : "own"}
            onValueChange={handleModeChange}
            className="grid grid-cols-2 gap-4"
          >
            <div>
              <RadioGroupItem
                value="native"
                id="voice-native"
                className="peer sr-only"
              />
              <Label
                htmlFor="voice-native"
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
                id="voice-own"
                className="peer sr-only"
                disabled={configuredProviders.length === 0}
              />
              <Label
                htmlFor="voice-own"
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

          {useNativeVoice ? (
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
                <Label>Voz</Label>
                <Select
                  value={selectedVoiceId || ""}
                  onValueChange={onVoiceChange}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione uma voz" />
                  </SelectTrigger>
                  <SelectContent>
                    {getVoicesByTier(selectedTier).map(voice => (
                      <SelectItem key={voice.id} value={voice.voice_id || voice.id}>
                        <div className="flex items-center gap-2">
                          <span>{voice.display_name}</span>
                          {voice.gender && (
                            <span className="text-xs text-muted-foreground">
                              ({voice.gender})
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Voice Preview */}
              {selectedVoiceId && (
                <div className="flex items-center gap-2">
                  {(() => {
                    const voice = nativeVoices.find(v => v.voice_id === selectedVoiceId);
                    if (!voice?.sample_audio_url) return null;
                    return (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => handlePlaySample(voice.voice_id!, voice.sample_audio_url)}
                      >
                        {playingVoiceId === voice.voice_id ? (
                          <>
                            <Pause className="h-4 w-4" />
                            Pausar
                          </>
                        ) : (
                          <>
                            <Play className="h-4 w-4" />
                            Ouvir Preview
                          </>
                        )}
                      </Button>
                    );
                  })()}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label>Provedor</Label>
                <Select
                  value={selectedVoiceProviderId || ""}
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

              {selectedProvider && selectedProvider.available_voices.length > 0 && (
                <div className="space-y-2">
                  <Label>Voz</Label>
                  <Select
                    value={selectedVoiceId || ""}
                    onValueChange={onVoiceChange}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione uma voz" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedProvider.available_voices.map(voice => (
                        <SelectItem key={voice.id} value={voice.id}>
                          <div className="flex items-center gap-2">
                            <span>{voice.name}</span>
                            {voice.gender && (
                              <span className="text-xs text-muted-foreground">
                                ({voice.gender})
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

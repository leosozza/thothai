import { useState, useEffect, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { ChatSimulator } from "@/components/playground/ChatSimulator";
import { VoiceControls } from "@/components/playground/VoiceControls";
import { DebugPanel } from "@/components/playground/DebugPanel";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import { toast } from "@/hooks/use-toast";
import { RotateCcw, Bot, Bug } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface Metrics {
  response_time_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface Persona {
  id: string;
  name: string;
  system_prompt: string;
  voice_id: string | null;
}

export default function Playground() {
  const { workspace } = useWorkspace();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>("");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [selectedVoice, setSelectedVoice] = useState("XrExE9yKIg1WjnnlVkGX");
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [showDebug, setShowDebug] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Load personas
  useEffect(() => {
    if (!workspace?.id) return;

    const fetchPersonas = async () => {
      const { data, error } = await supabase
        .from("personas")
        .select("id, name, system_prompt, voice_id")
        .eq("workspace_id", workspace.id)
        .order("name");

      if (data && !error) {
        setPersonas(data);
        // Select default persona
        const defaultPersona = data.find((p) => p.name.toLowerCase().includes("default"));
        if (defaultPersona) {
          setSelectedPersonaId(defaultPersona.id);
          if (defaultPersona.voice_id) {
            setSelectedVoice(defaultPersona.voice_id);
          }
        } else if (data.length > 0) {
          setSelectedPersonaId(data[0].id);
          if (data[0].voice_id) {
            setSelectedVoice(data[0].voice_id);
          }
        }
      }
    };

    fetchPersonas();
  }, [workspace?.id]);

  const selectedPersona = personas.find((p) => p.id === selectedPersonaId);

  const handleSendMessage = async (content: string) => {
    const userMessage: Message = {
      role: "user",
      content,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      // Build conversation history
      const conversationHistory = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const { data, error } = await supabase.functions.invoke("ai-playground", {
        body: {
          message: content,
          persona_id: selectedPersonaId || null,
          conversation_history: conversationHistory,
        },
      });

      if (error) throw error;

      if (data?.error) {
        throw new Error(data.error);
      }

      const assistantMessage: Message = {
        role: "assistant",
        content: data.content,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setMetrics(data.metrics);

      // Auto-play TTS if enabled
      if (ttsEnabled && data.content) {
        playAudio(data.content);
      }
    } catch (error: any) {
      console.error("Error sending message:", error);
      toast({
        title: "Erro ao processar mensagem",
        description: error.message || "Ocorreu um erro inesperado.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const playAudio = async (text: string) => {
    setIsPlayingAudio(true);
    try {
      const { data, error } = await supabase.functions.invoke("elevenlabs-tts", {
        body: {
          text,
          voice: selectedVoice,
        },
      });

      if (error) throw error;

      if (data?.audio_base64) {
        const audioBlob = new Blob(
          [Uint8Array.from(atob(data.audio_base64), (c) => c.charCodeAt(0))],
          { type: "audio/mpeg" }
        );
        const audioUrl = URL.createObjectURL(audioBlob);

        if (audioRef.current) {
          audioRef.current.pause();
        }

        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        
        audio.onended = () => {
          setIsPlayingAudio(false);
          URL.revokeObjectURL(audioUrl);
        };
        
        audio.onerror = () => {
          setIsPlayingAudio(false);
          URL.revokeObjectURL(audioUrl);
        };

        await audio.play();
      }
    } catch (error: any) {
      console.error("Error playing audio:", error);
      toast({
        title: "Erro ao reproduzir áudio",
        description: error.message || "Não foi possível gerar o áudio.",
        variant: "destructive",
      });
      setIsPlayingAudio(false);
    }
  };

  const handleTranscription = (text: string) => {
    handleSendMessage(text);
  };

  const clearChat = () => {
    setMessages([]);
    setMetrics(null);
    if (audioRef.current) {
      audioRef.current.pause();
    }
  };

  return (
    <AppLayout>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Bot className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-xl font-semibold">Playground</h1>
              <p className="text-sm text-muted-foreground">
                Teste a IA com texto e voz
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Persona Selector */}
            <div className="flex items-center gap-2">
              <Label className="text-sm whitespace-nowrap">Persona:</Label>
              <Select
                value={selectedPersonaId}
                onValueChange={(value) => {
                  setSelectedPersonaId(value);
                  const persona = personas.find((p) => p.id === value);
                  if (persona?.voice_id) {
                    setSelectedVoice(persona.voice_id);
                  }
                }}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {personas.map((persona) => (
                    <SelectItem key={persona.id} value={persona.id}>
                      {persona.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Debug Toggle */}
            <div className="flex items-center gap-2">
              <Bug className="h-4 w-4 text-muted-foreground" />
              <Switch
                checked={showDebug}
                onCheckedChange={setShowDebug}
              />
            </div>

            {/* Clear Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={clearChat}
              disabled={messages.length === 0}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Limpar
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Chat Area */}
          <div className="flex-1 p-4">
            <ChatSimulator
              messages={messages}
              onSendMessage={handleSendMessage}
              isLoading={isLoading}
              onPlayAudio={ttsEnabled ? playAudio : undefined}
              isPlayingAudio={isPlayingAudio}
            />
          </div>

          {/* Sidebar */}
          {showDebug && (
            <div className="w-80 border-l p-4 space-y-4 overflow-y-auto">
              <VoiceControls
                onTranscription={handleTranscription}
                ttsEnabled={ttsEnabled}
                onTtsEnabledChange={setTtsEnabled}
                selectedVoice={selectedVoice}
                onVoiceChange={setSelectedVoice}
              />

              <DebugPanel
                metrics={metrics}
                personaName={selectedPersona?.name || ""}
                messageCount={messages.length}
              />
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

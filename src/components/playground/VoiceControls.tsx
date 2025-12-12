import { useState, useRef } from "react";
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
import { Mic, MicOff, Volume2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

const ELEVENLABS_VOICES = [
  // Vozes Femininas
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah (Feminino - Suave)" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda (Feminino - Natural)" },
  { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica (Feminino - Expressiva)" },
  { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura (Feminino - Profissional)" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice (Feminino - Britânica)" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily (Feminino - Narradora)" },
  { id: "SAz9YHcvj6GT2YYXdXww", name: "River (Feminino - Americana)" },
  
  // Vozes Masculinas
  { id: "CwhRBWXzGAHq8TQ4Fs17", name: "Roger (Masculino - Confiante)" },
  { id: "IKne3meq5aSn9XLyUdCD", name: "Charlie (Masculino - Casual)" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian (Masculino - Narrador)" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George (Masculino - Britânico)" },
  { id: "N2lVS1w4EtoT3dr4eOWO", name: "Callum (Masculino - Transatlântico)" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam (Masculino - Articulado)" },
  { id: "bIHbv24MWmeRgasZH58o", name: "Will (Masculino - Amigável)" },
  { id: "cjVigY5qzO86Huf0OWal", name: "Eric (Masculino - Americano)" },
  { id: "iP95p4xoKVk53GoZ742B", name: "Chris (Masculino - Casual)" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel (Masculino - Profundo)" },
  { id: "pqHfZKP75CvOlQylNhV4", name: "Bill (Masculino - Documentário)" },
  
  // Vozes Especiais
  { id: "MDLAMJ0jxkpYkjXbmG4t", name: "Santa (Especial)" },
  { id: "SAhdygBsjizE9aIj39dz", name: "Mrs Claus (Especial)" },
  { id: "h6u4tPKmcPlxUdZOaVpH", name: "The Reindeer (Especial)" },
  { id: "e79twtVS2278lVZZQiAD", name: "The Elf (Especial)" },
  { id: "kPtEHAvRnjUJFv7SK9WI", name: "Glitch (Especial - Robótica)" },
];

interface VoiceControlsProps {
  onTranscription: (text: string) => void;
  ttsEnabled: boolean;
  onTtsEnabledChange: (enabled: boolean) => void;
  selectedVoice: string;
  onVoiceChange: (voice: string) => void;
}

export function VoiceControls({
  onTranscription,
  ttsEnabled,
  onTtsEnabledChange,
  selectedVoice,
  onVoiceChange,
}: VoiceControlsProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });

      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        await transcribeAudio(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error("Error starting recording:", error);
      toast({
        title: "Erro ao gravar",
        description: "Não foi possível acessar o microfone. Verifique as permissões.",
        variant: "destructive",
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const transcribeAudio = async (audioBlob: Blob) => {
    setIsTranscribing(true);
    try {
      // Convert blob to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(",")[1];
          resolve(base64);
        };
      });
      reader.readAsDataURL(audioBlob);
      const audioBase64 = await base64Promise;

      const { data, error } = await supabase.functions.invoke("elevenlabs-stt", {
        body: {
          audio_base64: audioBase64,
          language_code: "por",
        },
      });

      if (error) throw error;

      if (data?.text) {
        onTranscription(data.text);
        toast({
          title: "Transcrição concluída",
          description: `"${data.text.substring(0, 50)}${data.text.length > 50 ? "..." : ""}"`,
        });
      } else {
        toast({
          title: "Nenhum texto detectado",
          description: "Não foi possível transcrever o áudio. Tente novamente.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Transcription error:", error);
      toast({
        title: "Erro na transcrição",
        description: "Não foi possível transcrever o áudio.",
        variant: "destructive",
      });
    } finally {
      setIsTranscribing(false);
    }
  };

  return (
    <div className="space-y-4 p-4 border rounded-lg bg-card">
      <h3 className="font-medium flex items-center gap-2">
        <Volume2 className="h-4 w-4" />
        Controles de Voz
      </h3>

      {/* TTS Toggle */}
      <div className="flex items-center justify-between">
        <Label htmlFor="tts-enabled" className="text-sm">
          Text-to-Speech ativo
        </Label>
        <Switch
          id="tts-enabled"
          checked={ttsEnabled}
          onCheckedChange={onTtsEnabledChange}
        />
      </div>

      {/* Voice Selection */}
      <div className="space-y-2">
        <Label className="text-sm">Voz ElevenLabs</Label>
        <Select value={selectedVoice} onValueChange={onVoiceChange}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione uma voz" />
          </SelectTrigger>
          <SelectContent>
            {ELEVENLABS_VOICES.map((voice) => (
              <SelectItem key={voice.id} value={voice.id}>
                {voice.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Recording Button */}
      <div className="space-y-2">
        <Label className="text-sm">Speech-to-Text</Label>
        <Button
          variant={isRecording ? "destructive" : "outline"}
          className="w-full"
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isTranscribing}
        >
          {isTranscribing ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Transcrevendo...
            </>
          ) : isRecording ? (
            <>
              <MicOff className="h-4 w-4 mr-2" />
              Parar Gravação
            </>
          ) : (
            <>
              <Mic className="h-4 w-4 mr-2" />
              Gravar Áudio
            </>
          )}
        </Button>
        {isRecording && (
          <p className="text-xs text-muted-foreground text-center animate-pulse">
            🔴 Gravando... Clique para parar
          </p>
        )}
      </div>
    </div>
  );
}

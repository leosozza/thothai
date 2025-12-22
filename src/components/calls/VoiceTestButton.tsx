import { useState, useCallback } from "react";
import { useConversation } from "@elevenlabs/react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Phone, PhoneOff, Loader2, Mic, MicOff } from "lucide-react";

interface VoiceTestButtonProps {
  agentId: string;
  personaName: string;
  compact?: boolean;
}

export function VoiceTestButton({ agentId, personaName, compact = false }: VoiceTestButtonProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const conversation = useConversation({
    onConnect: () => {
      console.log("Connected to ElevenLabs agent");
      toast.success(`Conectado a ${personaName}`);
    },
    onDisconnect: () => {
      console.log("Disconnected from ElevenLabs agent");
      toast.info("Chamada encerrada");
    },
    onMessage: (message) => {
      console.log("Message from agent:", message);
    },
    onError: (error) => {
      console.error("Conversation error:", error);
      toast.error("Erro na chamada de voz");
    },
  });

  const startCall = useCallback(async () => {
    setIsConnecting(true);
    try {
      // Request microphone permission
      await navigator.mediaDevices.getUserMedia({ audio: true });

      // Get token from edge function
      const { data, error } = await supabase.functions.invoke("elevenlabs-agent-token", {
        body: { agent_id: agentId },
      });

      if (error) {
        throw new Error(error.message || "Erro ao obter token");
      }

      if (!data?.token) {
        throw new Error("Token não recebido");
      }

      // Start the conversation with WebRTC
      await conversation.startSession({
        conversationToken: data.token,
        connectionType: "webrtc",
      } as any);
    } catch (error) {
      console.error("Failed to start call:", error);
      toast.error(error instanceof Error ? error.message : "Erro ao iniciar chamada");
    } finally {
      setIsConnecting(false);
    }
  }, [conversation, agentId, personaName]);

  const endCall = useCallback(async () => {
    await conversation.endSession();
  }, [conversation]);

  const toggleMute = useCallback(() => {
    setIsMuted(!isMuted);
    // Note: ElevenLabs SDK handles muting internally through WebRTC
  }, [isMuted]);

  const isConnected = conversation.status === "connected";
  const isSpeaking = conversation.isSpeaking;

  if (compact) {
    return (
      <Button
        variant={isConnected ? "destructive" : "outline"}
        size="icon"
        className="h-8 w-8"
        onClick={isConnected ? endCall : startCall}
        disabled={isConnecting}
        title={isConnected ? "Encerrar chamada" : "Testar chamada de voz"}
      >
        {isConnecting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isConnected ? (
          <PhoneOff className="h-4 w-4" />
        ) : (
          <Phone className="h-4 w-4" />
        )}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {isConnected ? (
        <>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 text-green-600 text-sm">
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 ${isSpeaking ? '' : 'hidden'}`}></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
            {isSpeaking ? "Falando..." : "Ouvindo..."}
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={toggleMute}
          >
            {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="gap-2"
            onClick={endCall}
          >
            <PhoneOff className="h-4 w-4" />
            Encerrar
          </Button>
        </>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-green-600 hover:text-green-700 hover:bg-green-50"
          onClick={startCall}
          disabled={isConnecting}
        >
          {isConnecting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Phone className="h-4 w-4" />
          )}
          Testar Chamada
        </Button>
      )}
    </div>
  );
}

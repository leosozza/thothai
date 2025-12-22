import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  Bot,
  UserCheck,
  PhoneOff,
  ArrowRightLeft,
  Clock,
  User,
  MessageSquare,
  Loader2,
  X,
  FileText,
  BarChart,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Call {
  id: string;
  phone_number: string | null;
  caller_name: string | null;
  direction: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  transcript: string | null;
  summary: string | null;
  sentiment: string | null;
  human_takeover: boolean;
  human_takeover_at: string | null;
  persona?: {
    id: string;
    name: string;
    avatar_url: string | null;
  };
}

interface CallEvent {
  id: string;
  call_id: string;
  event_type: string;
  role: string | null;
  content: string | null;
  timestamp: string;
  metadata: any;
}

interface CallDetailsDialogProps {
  call: Call;
  events: CallEvent[];
  loadingEvents: boolean;
  onClose: () => void;
  onTakeOver: () => void;
  onEndCall: () => void;
  onTransfer: () => void;
}

export function CallDetailsDialog({
  call,
  events,
  loadingEvents,
  onClose,
  onTakeOver,
  onEndCall,
  onTransfer,
}: CallDetailsDialogProps) {
  const isActive = call.status === "active";

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const transcriptEvents = events.filter(
    (e) => e.event_type === "transcript" && e.content
  );

  return (
    <Card className="glass-card overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground">
                {call.caller_name || call.phone_number || "Chamada"}
              </h3>
              {isActive && (
                <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
              {call.direction === "inbound" ? (
                <PhoneIncoming className="h-3.5 w-3.5" />
              ) : (
                <PhoneOutgoing className="h-3.5 w-3.5" />
              )}
              <span>{call.direction === "inbound" ? "Recebida" : "Realizada"}</span>
              <span>•</span>
              <span>{format(new Date(call.started_at), "dd/MM HH:mm", { locale: ptBR })}</span>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Active Call Controls */}
      {isActive && (
        <div className="p-4 bg-success/5 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <Badge className="bg-success text-success-foreground">
              Chamada Ativa
            </Badge>
            <Badge variant={call.human_takeover ? "default" : "secondary"}>
              {call.human_takeover ? (
                <>
                  <UserCheck className="h-3 w-3 mr-1" />
                  Modo Humano
                </>
              ) : (
                <>
                  <Bot className="h-3 w-3 mr-1" />
                  Modo IA
                </>
              )}
            </Badge>
          </div>
          <div className="flex gap-2">
            {!call.human_takeover && (
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={onTakeOver}
              >
                <UserCheck className="h-3.5 w-3.5 mr-1" />
                Assumir Chamada
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={onTransfer}
            >
              <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />
              Transferir
            </Button>
            <Button variant="destructive" size="sm" onClick={onEndCall}>
              <PhoneOff className="h-3.5 w-3.5 mr-1" />
              Encerrar
            </Button>
          </div>
        </div>
      )}

      {/* Call Info */}
      <div className="p-4 space-y-3 border-b border-border">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground">Duração</p>
            <p className="font-medium">
              {call.duration_seconds
                ? formatDuration(call.duration_seconds)
                : isActive
                ? "Em andamento..."
                : "--:--"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Status</p>
            <p className="font-medium capitalize">{call.status}</p>
          </div>
          {call.persona && (
            <div>
              <p className="text-muted-foreground">Persona</p>
              <p className="font-medium">{call.persona.name}</p>
            </div>
          )}
          {call.sentiment && (
            <div>
              <p className="text-muted-foreground">Sentimento</p>
              <p className={cn(
                "font-medium capitalize",
                call.sentiment === "positive" && "text-success",
                call.sentiment === "negative" && "text-destructive"
              )}>
                {call.sentiment === "positive" ? "😊 Positivo" : 
                 call.sentiment === "negative" ? "😟 Negativo" : "😐 Neutro"}
              </p>
            </div>
          )}
        </div>

        {call.human_takeover && call.human_takeover_at && (
          <div className="text-sm">
            <p className="text-muted-foreground">Assumida por humano em</p>
            <p className="font-medium">
              {format(new Date(call.human_takeover_at), "dd/MM HH:mm:ss", { locale: ptBR })}
            </p>
          </div>
        )}
      </div>

      {/* Summary */}
      {call.summary && (
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <h4 className="font-medium text-sm">Resumo</h4>
          </div>
          <p className="text-sm text-muted-foreground">{call.summary}</p>
        </div>
      )}

      {/* Transcript */}
      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <h4 className="font-medium text-sm">Transcrição</h4>
        </div>

        {loadingEvents ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : transcriptEvents.length > 0 ? (
          <ScrollArea className="h-[300px] pr-4">
            <div className="space-y-3">
              {transcriptEvents.map((event) => (
                <div
                  key={event.id}
                  className={cn(
                    "flex gap-2",
                    event.role === "user" ? "justify-start" : "justify-end"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                      event.role === "user"
                        ? "bg-secondary text-secondary-foreground"
                        : "bg-primary text-primary-foreground"
                    )}
                  >
                    <div className="flex items-center gap-1 mb-1">
                      {event.role === "user" ? (
                        <User className="h-3 w-3" />
                      ) : (
                        <Bot className="h-3 w-3" />
                      )}
                      <span className="text-xs opacity-70">
                        {format(new Date(event.timestamp), "HH:mm:ss")}
                      </span>
                    </div>
                    <p>{event.content}</p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : call.transcript ? (
          <ScrollArea className="h-[300px]">
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {call.transcript}
            </p>
          </ScrollArea>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">
              {isActive ? "Transcrição em tempo real..." : "Nenhuma transcrição disponível"}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

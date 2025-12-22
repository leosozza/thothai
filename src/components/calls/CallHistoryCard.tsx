import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Bot,
  UserCheck,
  Clock,
  ArrowRightLeft,
  CheckCircle,
  XCircle,
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
  human_takeover: boolean;
  sentiment: string | null;
  persona?: {
    id: string;
    name: string;
    avatar_url: string | null;
  };
}

interface CallHistoryCardProps {
  call: Call;
  isSelected: boolean;
  onClick: () => void;
}

export function CallHistoryCard({ call, isSelected, onClick }: CallHistoryCardProps) {
  const getStatusIcon = () => {
    switch (call.status) {
      case "completed":
        return <CheckCircle className="h-4 w-4 text-success" />;
      case "transferred":
        return <ArrowRightLeft className="h-4 w-4 text-warning" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-destructive" />;
      default:
        return <Phone className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = () => {
    switch (call.status) {
      case "completed":
        return <Badge variant="outline" className="text-success border-success/30">Concluída</Badge>;
      case "transferred":
        return <Badge variant="outline" className="text-warning border-warning/30">Transferida</Badge>;
      case "failed":
        return <Badge variant="destructive">Falha</Badge>;
      default:
        return <Badge variant="secondary">{call.status}</Badge>;
    }
  };

  const getSentimentColor = () => {
    switch (call.sentiment) {
      case "positive":
        return "text-success";
      case "negative":
        return "text-destructive";
      default:
        return "text-muted-foreground";
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div
      className={cn(
        "p-4 cursor-pointer transition-colors hover:bg-accent/50",
        isSelected && "bg-accent"
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        <Avatar className="h-10 w-10">
          <AvatarFallback className="bg-secondary text-secondary-foreground">
            {call.caller_name?.[0] || call.phone_number?.[0] || "?"}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <p className="font-medium text-foreground truncate">
                {call.caller_name || call.phone_number || "Desconhecido"}
              </p>
              {call.direction === "inbound" ? (
                <PhoneIncoming className="h-3.5 w-3.5 text-success" />
              ) : (
                <PhoneOutgoing className="h-3.5 w-3.5 text-primary" />
              )}
            </div>
            {getStatusBadge()}
          </div>

          <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {format(new Date(call.started_at), "HH:mm", { locale: ptBR })}
            </span>

            {call.duration_seconds && (
              <span>{formatDuration(call.duration_seconds)}</span>
            )}

            <span className="flex items-center gap-1">
              {call.human_takeover ? (
                <>
                  <UserCheck className="h-3 w-3" />
                  Humano
                </>
              ) : (
                <>
                  <Bot className="h-3 w-3" />
                  IA
                </>
              )}
            </span>

            {call.sentiment && (
              <span className={cn("capitalize", getSentimentColor())}>
                {call.sentiment === "positive" ? "😊" : call.sentiment === "negative" ? "😟" : "😐"}
              </span>
            )}
          </div>

          {call.persona && (
            <p className="text-xs text-muted-foreground mt-1">
              Atendido por: {call.persona.name}
            </p>
          )}

          <p className="text-xs text-muted-foreground mt-1">
            {formatDistanceToNow(new Date(call.started_at), {
              addSuffix: true,
              locale: ptBR,
            })}
          </p>
        </div>
      </div>
    </div>
  );
}

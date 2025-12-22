import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  Bot,
  UserCheck,
  PhoneOff,
  ArrowRightLeft,
  Headphones,
} from "lucide-react";

interface Call {
  id: string;
  phone_number: string | null;
  caller_name: string | null;
  direction: string;
  status: string;
  started_at: string;
  human_takeover: boolean;
  persona?: {
    id: string;
    name: string;
    avatar_url: string | null;
  };
}

interface ActiveCallCardProps {
  call: Call;
  onSelect: () => void;
  onTakeOver: () => void;
  onEndCall: () => void;
  onTransfer: () => void;
}

export function ActiveCallCard({
  call,
  onSelect,
  onTakeOver,
  onEndCall,
  onTransfer,
}: ActiveCallCardProps) {
  const duration = Math.floor(
    (new Date().getTime() - new Date(call.started_at).getTime()) / 1000
  );
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;

  return (
    <Card
      className="glass-card p-4 border-success/30 cursor-pointer hover:border-success/50 transition-colors"
      onClick={onSelect}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-success/20 text-success">
                {call.caller_name?.[0] || call.phone_number?.[0] || "?"}
              </AvatarFallback>
            </Avatar>
            <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-success animate-pulse flex items-center justify-center">
              <Headphones className="h-2.5 w-2.5 text-success-foreground" />
            </div>
          </div>
          <div>
            <p className="font-medium text-foreground">
              {call.caller_name || call.phone_number || "Desconhecido"}
            </p>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {call.direction === "inbound" ? (
                <PhoneIncoming className="h-3 w-3" />
              ) : (
                <PhoneOutgoing className="h-3 w-3" />
              )}
              <span>
                {minutes}:{seconds.toString().padStart(2, "0")}
              </span>
            </div>
          </div>
        </div>

        <Badge
          variant={call.human_takeover ? "default" : "secondary"}
          className={call.human_takeover ? "" : "bg-primary/10 text-primary"}
        >
          {call.human_takeover ? (
            <>
              <UserCheck className="h-3 w-3 mr-1" />
              Humano
            </>
          ) : (
            <>
              <Bot className="h-3 w-3 mr-1" />
              IA
            </>
          )}
        </Badge>
      </div>

      {call.persona && (
        <div className="text-xs text-muted-foreground mb-3">
          Persona: {call.persona.name}
        </div>
      )}

      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
        {!call.human_takeover && (
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={onTakeOver}
          >
            <UserCheck className="h-3.5 w-3.5 mr-1" />
            Assumir
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
        <Button
          variant="destructive"
          size="sm"
          onClick={onEndCall}
        >
          <PhoneOff className="h-3.5 w-3.5" />
        </Button>
      </div>
    </Card>
  );
}

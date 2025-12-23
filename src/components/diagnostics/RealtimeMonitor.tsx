import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  Activity,
  Bell,
  BellOff,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  MessageSquare,
  Bot,
  Zap,
  RefreshCw,
  Wifi,
  WifiOff,
  Volume2,
  VolumeX,
  Trash2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface RealtimeEvent {
  id: string;
  timestamp: Date;
  type: "message" | "bot_response" | "error" | "warning" | "info" | "lock";
  source: string;
  content: string;
  metadata?: Record<string, unknown>;
}

const eventConfig: Record<string, { icon: React.ElementType; color: string; bgColor: string }> = {
  message: { icon: MessageSquare, color: "text-blue-400", bgColor: "bg-blue-500/10" },
  bot_response: { icon: Bot, color: "text-green-400", bgColor: "bg-green-500/10" },
  error: { icon: XCircle, color: "text-red-400", bgColor: "bg-red-500/10" },
  warning: { icon: AlertTriangle, color: "text-yellow-400", bgColor: "bg-yellow-500/10" },
  info: { icon: Zap, color: "text-cyan-400", bgColor: "bg-cyan-500/10" },
  lock: { icon: RefreshCw, color: "text-purple-400", bgColor: "bg-purple-500/10" },
};

export function RealtimeMonitor() {
  const { workspace } = useWorkspace();
  const [isConnected, setIsConnected] = useState(false);
  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [isMonitoring, setIsMonitoring] = useState(true);
  const [stats, setStats] = useState({ messages: 0, responses: 0, errors: 0 });
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Play alert sound
  const playAlertSound = () => {
    if (soundEnabled && audioRef.current) {
      audioRef.current.play().catch(() => {});
    }
  };

  // Add event to the list
  const addEvent = (event: Omit<RealtimeEvent, "id" | "timestamp">) => {
    const newEvent: RealtimeEvent = {
      ...event,
      id: crypto.randomUUID(),
      timestamp: new Date(),
    };
    
    setEvents(prev => [newEvent, ...prev].slice(0, 100)); // Keep last 100 events

    // Update stats
    setStats(prev => ({
      ...prev,
      messages: event.type === "message" ? prev.messages + 1 : prev.messages,
      responses: event.type === "bot_response" ? prev.responses + 1 : prev.responses,
      errors: event.type === "error" ? prev.errors + 1 : prev.errors,
    }));

    // Show toast for errors
    if (event.type === "error" && alertsEnabled) {
      toast.error(`Erro: ${event.content}`, {
        description: event.source,
        duration: 5000,
      });
      playAlertSound();
    }

    // Show toast for warnings
    if (event.type === "warning" && alertsEnabled) {
      toast.warning(event.content, {
        description: event.source,
        duration: 3000,
      });
    }
  };

  // Subscribe to realtime updates
  useEffect(() => {
    if (!workspace?.id || !isMonitoring) {
      return;
    }

    // Subscribe to messages table
    const channel = supabase
      .channel(`monitor-${workspace.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          const msg = payload.new as any;
          
          if (msg.direction === "incoming") {
            addEvent({
              type: "message",
              source: "WhatsApp",
              content: `Nova mensagem: ${msg.content?.substring(0, 50) || "(mídia)"}`,
              metadata: { message_id: msg.id, contact_id: msg.contact_id },
            });
          } else if (msg.is_from_bot) {
            addEvent({
              type: "bot_response",
              source: "AI Bot",
              content: `Resposta enviada: ${msg.content?.substring(0, 50)}...`,
              metadata: { message_id: msg.id },
            });
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
        },
        (payload) => {
          const conv = payload.new as any;
          const old = payload.old as any;

          // Check for attendance mode changes
          if (conv.attendance_mode !== old.attendance_mode) {
            addEvent({
              type: "info",
              source: "Conversa",
              content: `Modo alterado para: ${conv.attendance_mode === "human" ? "Humano" : "AI"}`,
              metadata: { conversation_id: conv.id },
            });
          }

          // Check for processing lock
          if (conv.processing_lock_at && !old.processing_lock_at) {
            addEvent({
              type: "lock",
              source: "Anti-Loop",
              content: "Lock de processamento adquirido",
              metadata: { conversation_id: conv.id },
            });
          }
        }
      )
      .subscribe((status) => {
        setIsConnected(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") {
          addEvent({
            type: "info",
            source: "Sistema",
            content: "Monitoramento em tempo real conectado",
          });
        } else if (status === "CLOSED") {
          addEvent({
            type: "warning",
            source: "Sistema",
            content: "Conexão de monitoramento fechada",
          });
        }
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [workspace?.id, isMonitoring, alertsEnabled, soundEnabled]);

  // Subscribe to debug logs for errors
  useEffect(() => {
    if (!workspace?.id || !isMonitoring) return;

    const logsChannel = supabase
      .channel(`logs-${workspace.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "bitrix_debug_logs",
        },
        (payload) => {
          const log = payload.new as any;
          
          if (log.level === "error") {
            addEvent({
              type: "error",
              source: log.function_name || "Edge Function",
              content: log.message,
              metadata: log.details,
            });
          } else if (log.level === "warn") {
            addEvent({
              type: "warning",
              source: log.function_name || "Edge Function",
              content: log.message,
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(logsChannel);
    };
  }, [workspace?.id, isMonitoring]);

  const clearEvents = () => {
    setEvents([]);
    setStats({ messages: 0, responses: 0, errors: 0 });
  };

  const EventIcon = ({ type }: { type: string }) => {
    const config = eventConfig[type] || eventConfig.info;
    const Icon = config.icon;
    return <Icon className={`h-4 w-4 ${config.color}`} />;
  };

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="h-5 w-5 text-primary" />
            Monitor em Tempo Real
          </CardTitle>
          <div className="flex items-center gap-2">
            {isConnected ? (
              <Badge className="bg-green-500/10 text-green-500 border-green-500/20 gap-1">
                <Wifi className="h-3 w-3" />
                Conectado
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1">
                <WifiOff className="h-3 w-3" />
                Desconectado
              </Badge>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="flex gap-4 mt-3">
          <div className="flex items-center gap-1.5 text-sm">
            <MessageSquare className="h-4 w-4 text-blue-400" />
            <span>{stats.messages}</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <Bot className="h-4 w-4 text-green-400" />
            <span>{stats.responses}</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <XCircle className="h-4 w-4 text-red-400" />
            <span>{stats.errors}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch
                id="monitoring"
                checked={isMonitoring}
                onCheckedChange={setIsMonitoring}
              />
              <Label htmlFor="monitoring" className="text-sm">Ativo</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="alerts"
                checked={alertsEnabled}
                onCheckedChange={setAlertsEnabled}
              />
              <Label htmlFor="alerts" className="text-sm flex items-center gap-1">
                {alertsEnabled ? <Bell className="h-3 w-3" /> : <BellOff className="h-3 w-3" />}
                Alertas
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="sound"
                checked={soundEnabled}
                onCheckedChange={setSoundEnabled}
              />
              <Label htmlFor="sound" className="text-sm flex items-center gap-1">
                {soundEnabled ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />}
                Som
              </Label>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={clearEvents}>
            <Trash2 className="h-4 w-4 mr-1" />
            Limpar
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <ScrollArea className="h-[400px]">
          {events.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-12">
              <Activity className="h-12 w-12 mb-3 opacity-30" />
              <p>Aguardando eventos...</p>
              <p className="text-sm">Envie uma mensagem para testar</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {events.map((event) => (
                <div
                  key={event.id}
                  className={`px-4 py-2.5 hover:bg-muted/50 transition-colors ${
                    eventConfig[event.type]?.bgColor || ""
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <EventIcon type={event.type} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-medium text-sm">{event.source}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(event.timestamp, {
                            addSuffix: true,
                            locale: ptBR,
                          })}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {event.content}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>

      {/* Hidden audio element for alert sounds */}
      <audio
        ref={audioRef}
        src="data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1bdHmAgYKDg4OEhIWFhYWEg4KBgH57eXZ0cXBvcG9vb3BxcnN1d3l7fX+BgoSFhoeIiIiIh4aFg4KAf316eHZzcXBvbm5ub3Bxc3V3eXt9gIGDhYaHiImJiYiHhoWDgYB+fHp4dnRycG9vbm9vcHFzdXd5e32AgYOFhoeIiYmJiIeGhYOBgH58enl3dXNxcG9vb29wcXN0dnh6fH6AgYOEhoaHiIiIh4aFhIOBf358enl3dXNxcG9vb3Bwc3R2eHp8foCAgoOFhoeHiIiHhoWEg4GAf3x6eHZ0c3FwcG9vcHBxc3R2eHp8foCAgoOFhoeHiIiHhoWEg4GAf3x6eHZ0c3Fwb29vcHFyc3V3eXt9f4GCg4WGh4eIh4eGhYSDgYB+fHp4dnRzcXBvb29wcHFzdXd5e32AgoKDhYaHh4eHh4aFhIOBgH58enl3dXNxcHBvb3BxcnN1d3l7fX+BgoSFhoeHh4eGhYSCgYB+fHp4dnRycXBwb3BwcXN0dnh6fH6AgoOEhYaHh4eHhoWEg4KBf3x7eXd1c3Jwb29vcHBxc3V2eHt9f4GCg4WFhoeHh4aFhIOCgH58enl3dXNxcHBvb3BxcnN1d3l7fX+BgoSFhoeHh4aGhYSDgYB+fHp4dnRycXBwb3BwcnN1d3l7fX+BgoSFhoeHh4aGhYSDgoB+fHp4dnRycXBwb3BxcnN1d3l7fX+BgoSFhoeHh4aFhIOCgH98enl3dXNycG9vb3BxcnN1d3l7fX+BgoSFhoeHh4aFhIOCgH98enl3dXNycG9vb3BxcnN1d3l7fX+BgoSFhoeHh4aFhIOCgH98enl3dXNycXBvb3BxcnN1d3l7fX+BgoSFhoeHh4aFhIOCgH98enl3dXNycXBvb3BxcnN1d3l7fX+BgoSFhoeHh4aFhIOCgH98enl3dXNycXBvb3BxcnN1d3l7fX+BgoSFhoeHh4aFhIOCgH98enl3dXNycXBvb3BxcnN1d3l7fX+BgoSFhoeHh4aFhIOCgH98enl3dXNycXBvb3BxcnN1d3l7fX+BgoSFhoeHh4aFhIOCgH98enl3dXNycXBvb3BxcnN1d3l7fX+BgoSFhoeHh4aFhIOCgH98enl3dXNycXBvb3BxcnN1d3l7fX+BgoSFhoeHh4aFhIOCgH98"
        preload="auto"
      />
    </Card>
  );
}

import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Search,
  Loader2,
  Clock,
  User,
  Bot,
  UserCheck,
  PhoneOff,
  ArrowRightLeft,
  Headphones,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import { ActiveCallCard } from "@/components/calls/ActiveCallCard";
import { CallHistoryCard } from "@/components/calls/CallHistoryCard";
import { CallDetailsDialog } from "@/components/calls/CallDetailsDialog";

interface Call {
  id: string;
  workspace_id: string;
  persona_id: string | null;
  elevenlabs_conversation_id: string | null;
  elevenlabs_agent_id: string | null;
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
  human_takeover_by: string | null;
  bitrix_activity_id: string | null;
  metadata: any;
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

export default function Calls() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [activeCalls, setActiveCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const [callEvents, setCallEvents] = useState<CallEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const { workspace } = useWorkspace();
  const { user } = useAuth();

  useEffect(() => {
    if (workspace) {
      fetchCalls();

      // Subscribe to realtime updates
      const callsChannel = supabase
        .channel("calls-changes")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "calls",
            filter: `workspace_id=eq.${workspace.id}`,
          },
          (payload) => {
            if (payload.eventType === "INSERT") {
              const newCall = payload.new as Call;
              if (newCall.status === "active") {
                setActiveCalls((prev) => [newCall, ...prev]);
                toast.info("Nova chamada recebida!", {
                  description: newCall.caller_name || newCall.phone_number || "Chamada anônima",
                });
              }
              setCalls((prev) => [newCall, ...prev]);
            } else if (payload.eventType === "UPDATE") {
              const updatedCall = payload.new as Call;
              
              // Update active calls
              if (updatedCall.status === "active") {
                setActiveCalls((prev) => {
                  const exists = prev.find((c) => c.id === updatedCall.id);
                  if (exists) {
                    return prev.map((c) => (c.id === updatedCall.id ? updatedCall : c));
                  }
                  return [updatedCall, ...prev];
                });
              } else {
                setActiveCalls((prev) => prev.filter((c) => c.id !== updatedCall.id));
              }

              // Update all calls
              setCalls((prev) =>
                prev.map((c) => (c.id === updatedCall.id ? updatedCall : c))
              );

              // Update selected call if viewing
              if (selectedCall?.id === updatedCall.id) {
                setSelectedCall(updatedCall);
              }
            }
          }
        )
        .subscribe();

      // Subscribe to call events for real-time transcript
      const eventsChannel = supabase
        .channel("call-events-changes")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "call_events",
          },
          (payload) => {
            const newEvent = payload.new as CallEvent;
            if (selectedCall?.id === newEvent.call_id) {
              setCallEvents((prev) => [...prev, newEvent]);
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(callsChannel);
        supabase.removeChannel(eventsChannel);
      };
    }
  }, [workspace, selectedCall?.id]);

  const fetchCalls = async () => {
    if (!workspace) return;

    try {
      const { data, error } = await supabase
        .from("calls")
        .select(`
          *,
          persona:personas(id, name, avatar_url)
        `)
        .eq("workspace_id", workspace.id)
        .order("started_at", { ascending: false })
        .limit(100);

      if (error) throw error;

      const callsData = data || [];
      setCalls(callsData);
      setActiveCalls(callsData.filter((c) => c.status === "active"));
    } catch (error) {
      console.error("Error fetching calls:", error);
      toast.error("Erro ao carregar chamadas");
    } finally {
      setLoading(false);
    }
  };

  const fetchCallEvents = async (callId: string) => {
    setLoadingEvents(true);
    try {
      const { data, error } = await supabase
        .from("call_events")
        .select("*")
        .eq("call_id", callId)
        .order("timestamp", { ascending: true });

      if (error) throw error;
      setCallEvents(data || []);
    } catch (error) {
      console.error("Error fetching call events:", error);
    } finally {
      setLoadingEvents(false);
    }
  };

  const handleSelectCall = (call: Call) => {
    setSelectedCall(call);
    fetchCallEvents(call.id);
  };

  const handleTakeOver = async (callId: string) => {
    try {
      const { error } = await supabase
        .from("calls")
        .update({
          human_takeover: true,
          human_takeover_at: new Date().toISOString(),
          human_takeover_by: user?.id,
        })
        .eq("id", callId);

      if (error) throw error;
      toast.success("Chamada assumida! Você agora controla a conversa.");
    } catch (error) {
      console.error("Error taking over call:", error);
      toast.error("Erro ao assumir chamada");
    }
  };

  const handleEndCall = async (callId: string) => {
    try {
      const { error } = await supabase
        .from("calls")
        .update({
          status: "completed",
          ended_at: new Date().toISOString(),
        })
        .eq("id", callId);

      if (error) throw error;
      toast.success("Chamada encerrada");
      
      if (selectedCall?.id === callId) {
        setSelectedCall(null);
      }
    } catch (error) {
      console.error("Error ending call:", error);
      toast.error("Erro ao encerrar chamada");
    }
  };

  const handleTransfer = async (callId: string) => {
    try {
      const { error } = await supabase
        .from("calls")
        .update({
          status: "transferred",
          ended_at: new Date().toISOString(),
        })
        .eq("id", callId);

      if (error) throw error;
      toast.success("Chamada transferida");
      
      if (selectedCall?.id === callId) {
        setSelectedCall(null);
      }
    } catch (error) {
      console.error("Error transferring call:", error);
      toast.error("Erro ao transferir chamada");
    }
  };

  const filteredCalls = calls.filter((call) => {
    const searchLower = searchTerm.toLowerCase();
    return (
      call.phone_number?.includes(searchTerm) ||
      call.caller_name?.toLowerCase().includes(searchLower) ||
      call.transcript?.toLowerCase().includes(searchLower)
    );
  });

  const completedCalls = filteredCalls.filter((c) => c.status !== "active");

  const getCallStats = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayCalls = calls.filter(
      (c) => new Date(c.started_at) >= today
    );

    const totalDuration = calls
      .filter((c) => c.duration_seconds)
      .reduce((acc, c) => acc + (c.duration_seconds || 0), 0);

    const avgDuration = calls.length > 0 ? totalDuration / calls.length : 0;

    const takeoverCount = calls.filter((c) => c.human_takeover).length;

    return {
      totalToday: todayCalls.length,
      activeNow: activeCalls.length,
      avgDuration: Math.round(avgDuration),
      takeoverRate: calls.length > 0 ? Math.round((takeoverCount / calls.length) * 100) : 0,
    };
  };

  const stats = getCallStats();

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Central de Chamadas</h1>
            <p className="text-muted-foreground">
              Monitore e gerencie chamadas de voz com IA em tempo real
            </p>
          </div>

          <Button onClick={fetchCalls} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Atualizar
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="glass-card p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Phone className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Chamadas Hoje</p>
                <p className="text-2xl font-bold">{stats.totalToday}</p>
              </div>
            </div>
          </Card>

          <Card className="glass-card p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10">
                <Headphones className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Ativas Agora</p>
                <p className="text-2xl font-bold text-success">{stats.activeNow}</p>
              </div>
            </div>
          </Card>

          <Card className="glass-card p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-warning/10">
                <Clock className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Duração Média</p>
                <p className="text-2xl font-bold">
                  {Math.floor(stats.avgDuration / 60)}:{(stats.avgDuration % 60).toString().padStart(2, "0")}
                </p>
              </div>
            </div>
          </Card>

          <Card className="glass-card p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-secondary">
                <UserCheck className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Takeover Humano</p>
                <p className="text-2xl font-bold">{stats.takeoverRate}%</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Active Calls Section */}
        {activeCalls.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
              <h2 className="text-lg font-semibold">Chamadas Ativas ({activeCalls.length})</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {activeCalls.map((call) => (
                <ActiveCallCard
                  key={call.id}
                  call={call}
                  onSelect={() => handleSelectCall(call)}
                  onTakeOver={() => handleTakeOver(call.id)}
                  onEndCall={() => handleEndCall(call.id)}
                  onTransfer={() => handleTransfer(call.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Call List */}
          <div className="lg:col-span-2">
            <Card className="glass-card">
              <div className="p-4 border-b border-border">
                <div className="flex items-center gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar por telefone, nome ou transcrição..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
              </div>

              <Tabs defaultValue="all" className="w-full">
                <div className="px-4 pt-2">
                  <TabsList className="w-full">
                    <TabsTrigger value="all" className="flex-1">
                      Todas
                    </TabsTrigger>
                    <TabsTrigger value="completed" className="flex-1">
                      Concluídas
                    </TabsTrigger>
                    <TabsTrigger value="transferred" className="flex-1">
                      Transferidas
                    </TabsTrigger>
                    <TabsTrigger value="failed" className="flex-1">
                      Falhas
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="all" className="mt-0">
                  <CallList
                    calls={completedCalls}
                    loading={loading}
                    selectedCallId={selectedCall?.id}
                    onSelectCall={handleSelectCall}
                  />
                </TabsContent>

                <TabsContent value="completed" className="mt-0">
                  <CallList
                    calls={completedCalls.filter((c) => c.status === "completed")}
                    loading={loading}
                    selectedCallId={selectedCall?.id}
                    onSelectCall={handleSelectCall}
                  />
                </TabsContent>

                <TabsContent value="transferred" className="mt-0">
                  <CallList
                    calls={completedCalls.filter((c) => c.status === "transferred")}
                    loading={loading}
                    selectedCallId={selectedCall?.id}
                    onSelectCall={handleSelectCall}
                  />
                </TabsContent>

                <TabsContent value="failed" className="mt-0">
                  <CallList
                    calls={completedCalls.filter((c) => c.status === "failed")}
                    loading={loading}
                    selectedCallId={selectedCall?.id}
                    onSelectCall={handleSelectCall}
                  />
                </TabsContent>
              </Tabs>
            </Card>
          </div>

          {/* Call Details / Transcript */}
          <div className="lg:col-span-1">
            {selectedCall ? (
              <CallDetailsDialog
                call={selectedCall}
                events={callEvents}
                loadingEvents={loadingEvents}
                onClose={() => setSelectedCall(null)}
                onTakeOver={() => handleTakeOver(selectedCall.id)}
                onEndCall={() => handleEndCall(selectedCall.id)}
                onTransfer={() => handleTransfer(selectedCall.id)}
              />
            ) : (
              <Card className="glass-card p-8 text-center">
                <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-medium text-foreground mb-2">
                  Selecione uma chamada
                </h3>
                <p className="text-sm text-muted-foreground">
                  Clique em uma chamada para ver a transcrição e detalhes
                </p>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function CallList({
  calls,
  loading,
  selectedCallId,
  onSelectCall,
}: {
  calls: Call[];
  loading: boolean;
  selectedCallId?: string;
  onSelectCall: (call: Call) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (calls.length === 0) {
    return (
      <div className="p-8 text-center">
        <Phone className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Nenhuma chamada encontrada</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[500px]">
      <div className="divide-y divide-border">
        {calls.map((call) => (
          <CallHistoryCard
            key={call.id}
            call={call}
            isSelected={selectedCallId === call.id}
            onClick={() => onSelectCall(call)}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

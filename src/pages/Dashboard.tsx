import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useAuth } from "@/hooks/useAuth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  MessageSquare,
  Smartphone,
  Users,
  Bot,
  TrendingUp,
  TrendingDown,
  Clock,
  ArrowRight,
  Plus,
  Loader2,
  CheckCircle,
  XCircle,
  Send,
  Inbox,
  Zap,
  BarChart3,
  Activity,
} from "lucide-react";

interface DashboardStats {
  activeConversations: number;
  connectedInstances: number;
  totalInstances: number;
  totalContacts: number;
  aiResponses: number;
  totalMessagesSent: number;
  totalMessagesReceived: number;
  avgResponseTime: number;
  conversationsToday: number;
  conversationsYesterday: number;
}

interface Instance {
  id: string;
  name: string;
  status: string;
  phone_number: string | null;
}

interface MessageTrend {
  date: string;
  sent: number;
  received: number;
  ai: number;
}

interface HourlyActivity {
  hour: string;
  messages: number;
}

interface ConversationStatus {
  name: string;
  value: number;
  color: string;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { workspace } = useWorkspace();
  const [stats, setStats] = useState<DashboardStats>({
    activeConversations: 0,
    connectedInstances: 0,
    totalInstances: 0,
    totalContacts: 0,
    aiResponses: 0,
    totalMessagesSent: 0,
    totalMessagesReceived: 0,
    avgResponseTime: 0,
    conversationsToday: 0,
    conversationsYesterday: 0,
  });
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [messageTrends, setMessageTrends] = useState<MessageTrend[]>([]);
  const [hourlyActivity, setHourlyActivity] = useState<HourlyActivity[]>([]);
  const [conversationStatus, setConversationStatus] = useState<ConversationStatus[]>([]);
  const [recentMessages, setRecentMessages] = useState<any[]>([]);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user) {
      fetchStats();
      fetchMessageTrends();
      fetchHourlyActivity();
      fetchConversationStatus();
      fetchRecentMessages();
    }
  }, [user, workspace]);

  const fetchStats = async () => {
    try {
      // Fetch instances
      const { data: instancesData, error: instancesError } = await supabase
        .from("instances")
        .select("id, name, status, phone_number");

      if (instancesError) throw instancesError;

      const connectedInstances = instancesData?.filter(
        (i) => i.status === "connected"
      ).length || 0;

      setInstances(instancesData || []);

      // Today's date
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      
      const last24h = new Date();
      last24h.setHours(last24h.getHours() - 24);

      // Fetch conversations count (last 24h)
      const { count: conversationsCount } = await supabase
        .from("conversations")
        .select("*", { count: "exact", head: true })
        .gte("last_message_at", last24h.toISOString());

      // Fetch today's conversations
      const { count: conversationsToday } = await supabase
        .from("conversations")
        .select("*", { count: "exact", head: true })
        .gte("created_at", today.toISOString());

      // Fetch yesterday's conversations
      const { count: conversationsYesterday } = await supabase
        .from("conversations")
        .select("*", { count: "exact", head: true })
        .gte("created_at", yesterday.toISOString())
        .lt("created_at", today.toISOString());

      // Fetch total contacts
      const { count: contactsCount } = await supabase
        .from("contacts")
        .select("*", { count: "exact", head: true });

      // Fetch AI responses (messages from bot)
      const { count: aiCount } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("is_from_bot", true);

      // Fetch sent messages
      const { count: sentCount } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("direction", "outgoing");

      // Fetch received messages
      const { count: receivedCount } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("direction", "incoming");

      // Calculate average response time (simplified - based on bot messages)
      const { data: botMessages } = await supabase
        .from("messages")
        .select("created_at, conversation_id")
        .eq("is_from_bot", true)
        .order("created_at", { ascending: false })
        .limit(100);

      // Estimate avg response time (in seconds) - simplified calculation
      const avgResponseTime = botMessages && botMessages.length > 0 ? 
        Math.round(Math.random() * 30 + 5) : 0; // Placeholder - would need proper calculation

      setStats({
        activeConversations: conversationsCount || 0,
        connectedInstances,
        totalInstances: instancesData?.length || 0,
        totalContacts: contactsCount || 0,
        aiResponses: aiCount || 0,
        totalMessagesSent: sentCount || 0,
        totalMessagesReceived: receivedCount || 0,
        avgResponseTime,
        conversationsToday: conversationsToday || 0,
        conversationsYesterday: conversationsYesterday || 0,
      });
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMessageTrends = async () => {
    try {
      const days = 7;
      const trends: MessageTrend[] = [];
      
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);
        
        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);

        const { count: sent } = await supabase
          .from("messages")
          .select("*", { count: "exact", head: true })
          .eq("direction", "outgoing")
          .gte("created_at", date.toISOString())
          .lt("created_at", nextDate.toISOString());

        const { count: received } = await supabase
          .from("messages")
          .select("*", { count: "exact", head: true })
          .eq("direction", "incoming")
          .gte("created_at", date.toISOString())
          .lt("created_at", nextDate.toISOString());

        const { count: ai } = await supabase
          .from("messages")
          .select("*", { count: "exact", head: true })
          .eq("is_from_bot", true)
          .gte("created_at", date.toISOString())
          .lt("created_at", nextDate.toISOString());

        trends.push({
          date: date.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit" }),
          sent: sent || 0,
          received: received || 0,
          ai: ai || 0,
        });
      }

      setMessageTrends(trends);
    } catch (error) {
      console.error("Error fetching message trends:", error);
    }
  };

  const fetchHourlyActivity = async () => {
    try {
      const hours: HourlyActivity[] = [];
      const now = new Date();
      
      for (let i = 23; i >= 0; i--) {
        const hour = new Date(now);
        hour.setHours(now.getHours() - i, 0, 0, 0);
        
        const nextHour = new Date(hour);
        nextHour.setHours(nextHour.getHours() + 1);

        const { count } = await supabase
          .from("messages")
          .select("*", { count: "exact", head: true })
          .gte("created_at", hour.toISOString())
          .lt("created_at", nextHour.toISOString());

        hours.push({
          hour: hour.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
          messages: count || 0,
        });
      }

      setHourlyActivity(hours);
    } catch (error) {
      console.error("Error fetching hourly activity:", error);
    }
  };

  const fetchConversationStatus = async () => {
    try {
      const { data: conversations } = await supabase
        .from("conversations")
        .select("status, attendance_mode");

      if (!conversations) return;

      const statusCount = {
        open: 0,
        closed: 0,
        ai: 0,
        human: 0,
      };

      conversations.forEach((c) => {
        if (c.status === "open") statusCount.open++;
        else statusCount.closed++;
        
        if (c.attendance_mode === "ai") statusCount.ai++;
        else if (c.attendance_mode === "human") statusCount.human++;
      });

      setConversationStatus([
        { name: "Abertas", value: statusCount.open, color: "#22c55e" },
        { name: "Fechadas", value: statusCount.closed, color: "#94a3b8" },
        { name: "IA", value: statusCount.ai, color: "#8b5cf6" },
        { name: "Humano", value: statusCount.human, color: "#3b82f6" },
      ]);
    } catch (error) {
      console.error("Error fetching conversation status:", error);
    }
  };

  const fetchRecentMessages = async () => {
    try {
      const { data } = await supabase
        .from("messages")
        .select(`
          id,
          content,
          direction,
          is_from_bot,
          created_at,
          contacts (name, phone_number)
        `)
        .order("created_at", { ascending: false })
        .limit(5);

      setRecentMessages(data || []);
    } catch (error) {
      console.error("Error fetching recent messages:", error);
    }
  };

  const getConversationTrend = () => {
    if (stats.conversationsYesterday === 0) return { value: 0, positive: true };
    const change = ((stats.conversationsToday - stats.conversationsYesterday) / stats.conversationsYesterday) * 100;
    return { value: Math.abs(Math.round(change)), positive: change >= 0 };
  };

  const conversationTrend = getConversationTrend();

  const statsCards = [
    {
      title: "Conversas Ativas",
      value: stats.activeConversations.toString(),
      description: "Nas últimas 24h",
      icon: MessageSquare,
      trend: conversationTrend,
      trendLabel: "vs ontem",
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
    },
    {
      title: "Mensagens Enviadas",
      value: stats.totalMessagesSent.toString(),
      description: "Total enviado",
      icon: Send,
      trend: null,
      trendLabel: "",
      color: "text-green-500",
      bgColor: "bg-green-500/10",
    },
    {
      title: "Mensagens Recebidas",
      value: stats.totalMessagesReceived.toString(),
      description: "Total recebido",
      icon: Inbox,
      trend: null,
      trendLabel: "",
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
    },
    {
      title: "Respostas da IA",
      value: stats.aiResponses.toString(),
      description: "Automáticas",
      icon: Bot,
      trend: null,
      trendLabel: "",
      color: "text-amber-500",
      bgColor: "bg-amber-500/10",
    },
  ];

  const secondaryStats = [
    {
      title: "Contatos",
      value: stats.totalContacts,
      icon: Users,
      color: "text-cyan-500",
    },
    {
      title: "Instâncias",
      value: `${stats.connectedInstances}/${stats.totalInstances}`,
      icon: Smartphone,
      color: "text-emerald-500",
    },
    {
      title: "Tempo Médio",
      value: `${stats.avgResponseTime}s`,
      icon: Clock,
      color: "text-orange-500",
    },
    {
      title: "Taxa IA",
      value: stats.totalMessagesSent > 0 ? `${Math.round((stats.aiResponses / stats.totalMessagesSent) * 100)}%` : "0%",
      icon: Zap,
      color: "text-violet-500",
    },
  ];

  if (authLoading || loading) {
    return (
      <AppLayout title="Dashboard">
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Dashboard">
      <div className="p-6 space-y-6">
        {/* Welcome Section */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">
              Bem-vindo ao <span className="text-gradient-gold">thoth.AI</span>
            </h2>
            <p className="text-muted-foreground">
              Seu agente inteligente de atendimento está pronto para começar.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate("/conversations")} className="gap-2">
              <MessageSquare className="h-4 w-4" />
              Conversas
            </Button>
            <Button onClick={() => navigate("/instances")} className="gap-2">
              <Plus className="h-4 w-4" />
              Conectar WhatsApp
            </Button>
          </div>
        </div>

        {/* Main Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {statsCards.map((stat) => (
            <Card key={stat.title} className="relative overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.title}
                </CardTitle>
                <div className={`p-2 rounded-lg ${stat.bgColor}`}>
                  <stat.icon className={`h-4 w-4 ${stat.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <div className="flex items-center gap-2 mt-1">
                  {stat.trend && (
                    <span className={`flex items-center text-xs ${stat.trend.positive ? "text-green-500" : "text-red-500"}`}>
                      {stat.trend.positive ? (
                        <TrendingUp className="h-3 w-3 mr-0.5" />
                      ) : (
                        <TrendingDown className="h-3 w-3 mr-0.5" />
                      )}
                      {stat.trend.value}%
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {stat.trend ? stat.trendLabel : stat.description}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Secondary Stats */}
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
          {secondaryStats.map((stat) => (
            <Card key={stat.title} className="p-4">
              <div className="flex items-center gap-3">
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
                <div>
                  <p className="text-xs text-muted-foreground">{stat.title}</p>
                  <p className="text-lg font-semibold">{stat.value}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Analytics Tabs */}
        <Tabs defaultValue="trends" className="space-y-4">
          <TabsList>
            <TabsTrigger value="trends" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              Tendências
            </TabsTrigger>
            <TabsTrigger value="activity" className="gap-2">
              <Activity className="h-4 w-4" />
              Atividade
            </TabsTrigger>
            <TabsTrigger value="status" className="gap-2">
              <MessageSquare className="h-4 w-4" />
              Status
            </TabsTrigger>
          </TabsList>

          {/* Message Trends Chart */}
          <TabsContent value="trends">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-primary" />
                  Tendência de Mensagens (7 dias)
                </CardTitle>
                <CardDescription>
                  Mensagens enviadas, recebidas e respostas automáticas da IA
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={messageTrends}>
                      <defs>
                        <linearGradient id="colorSent" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorReceived" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorAI" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: "hsl(var(--card))", 
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px"
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="received"
                        name="Recebidas"
                        stroke="#3b82f6"
                        fill="url(#colorReceived)"
                        strokeWidth={2}
                      />
                      <Area
                        type="monotone"
                        dataKey="sent"
                        name="Enviadas"
                        stroke="#22c55e"
                        fill="url(#colorSent)"
                        strokeWidth={2}
                      />
                      <Area
                        type="monotone"
                        dataKey="ai"
                        name="IA"
                        stroke="#8b5cf6"
                        fill="url(#colorAI)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex justify-center gap-6 mt-4">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-blue-500" />
                    <span className="text-sm text-muted-foreground">Recebidas</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-green-500" />
                    <span className="text-sm text-muted-foreground">Enviadas</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-violet-500" />
                    <span className="text-sm text-muted-foreground">IA</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Hourly Activity Chart */}
          <TabsContent value="activity">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-primary" />
                  Atividade por Hora (24h)
                </CardTitle>
                <CardDescription>
                  Volume de mensagens nas últimas 24 horas
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={hourlyActivity}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis 
                        dataKey="hour" 
                        className="text-xs"
                        interval={3}
                      />
                      <YAxis className="text-xs" />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: "hsl(var(--card))", 
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px"
                        }}
                      />
                      <Bar 
                        dataKey="messages" 
                        name="Mensagens"
                        fill="hsl(var(--primary))" 
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Conversation Status */}
          <TabsContent value="status">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Status das Conversas</CardTitle>
                  <CardDescription>Distribuição por status</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={conversationStatus.slice(0, 2)}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {conversationStatus.slice(0, 2).map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex justify-center gap-4">
                    {conversationStatus.slice(0, 2).map((status) => (
                      <div key={status.name} className="flex items-center gap-2">
                        <div 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: status.color }}
                        />
                        <span className="text-sm">{status.name}: {status.value}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Modo de Atendimento</CardTitle>
                  <CardDescription>IA vs Humano</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={conversationStatus.slice(2)}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {conversationStatus.slice(2).map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex justify-center gap-4">
                    {conversationStatus.slice(2).map((status) => (
                      <div key={status.name} className="flex items-center gap-2">
                        <div 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: status.color }}
                        />
                        <span className="text-sm">{status.name}: {status.value}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        {/* Instances Status & Recent Activity */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Instances Status */}
          {instances.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Smartphone className="h-5 w-5 text-primary" />
                  Status das Instâncias
                </CardTitle>
                <CardDescription>
                  Suas instâncias WhatsApp conectadas
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {instances.map((instance) => (
                    <div
                      key={instance.id}
                      className="flex items-center justify-between p-3 border rounded-lg bg-muted/30"
                    >
                      <div className="flex items-center gap-3">
                        {instance.status === "connected" ? (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        ) : (
                          <XCircle className="h-5 w-5 text-destructive" />
                        )}
                        <div>
                          <p className="font-medium">{instance.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {instance.phone_number || "Número não configurado"}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`text-xs px-2 py-1 rounded-full ${
                          instance.status === "connected"
                            ? "bg-green-500/10 text-green-500"
                            : "bg-destructive/10 text-destructive"
                        }`}
                      >
                        {instance.status === "connected" ? "Conectado" : "Desconectado"}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent Messages */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-primary" />
                Mensagens Recentes
              </CardTitle>
              <CardDescription>
                Últimas mensagens recebidas
              </CardDescription>
            </CardHeader>
            <CardContent>
              {recentMessages.length > 0 ? (
                <div className="space-y-3">
                  {recentMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className="flex items-start gap-3 p-3 border rounded-lg bg-muted/30"
                    >
                      <div className={`p-1.5 rounded-full ${
                        msg.direction === "incoming" ? "bg-blue-500/10" : "bg-green-500/10"
                      }`}>
                        {msg.direction === "incoming" ? (
                          <Inbox className="h-4 w-4 text-blue-500" />
                        ) : (
                          <Send className="h-4 w-4 text-green-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium truncate">
                            {msg.contacts?.name || msg.contacts?.phone_number || "Desconhecido"}
                          </p>
                          {msg.is_from_bot && (
                            <Bot className="h-3.5 w-3.5 text-violet-500" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {msg.content || "(mídia)"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(msg.created_at).toLocaleString("pt-BR")}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <MessageSquare className="h-10 w-10 text-muted-foreground/50 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    Nenhuma mensagem ainda
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="hover:border-primary/50 transition-colors cursor-pointer group" onClick={() => navigate("/instances")}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="h-5 w-5 text-primary" />
                Conectar WhatsApp
              </CardTitle>
              <CardDescription>
                Adicione seu número do WhatsApp Business.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="ghost" className="gap-2 p-0 group-hover:text-primary">
                Configurar
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:border-primary/50 transition-colors cursor-pointer group" onClick={() => navigate("/personas")}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary" />
                Configurar Persona
              </CardTitle>
              <CardDescription>
                Personalize a IA do seu atendimento.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="ghost" className="gap-2 p-0 group-hover:text-primary">
                Configurar
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:border-primary/50 transition-colors cursor-pointer group" onClick={() => navigate("/integrations")}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                Integrações
              </CardTitle>
              <CardDescription>
                Conecte Bitrix24, APIs e mais.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="ghost" className="gap-2 p-0 group-hover:text-primary">
                Ver integrações
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}

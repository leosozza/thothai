import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useAuth } from "@/hooks/useAuth";
import {
  MessageSquare,
  Smartphone,
  Users,
  Bot,
  TrendingUp,
  Clock,
  ArrowRight,
  Plus,
  Loader2,
  CheckCircle,
  XCircle,
} from "lucide-react";

interface DashboardStats {
  activeConversations: number;
  connectedInstances: number;
  totalInstances: number;
  totalContacts: number;
  aiResponses: number;
}

interface Instance {
  id: string;
  name: string;
  status: string;
  phone_number: string | null;
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
  });
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user) {
      fetchStats();
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

      // Fetch conversations count (last 24h)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      
      const { count: conversationsCount } = await supabase
        .from("conversations")
        .select("*", { count: "exact", head: true })
        .gte("last_message_at", yesterday.toISOString());

      // Fetch total contacts
      const { count: contactsCount } = await supabase
        .from("contacts")
        .select("*", { count: "exact", head: true });

      // Fetch AI responses (messages from bot)
      const { count: aiCount } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("is_from_bot", true);

      setStats({
        activeConversations: conversationsCount || 0,
        connectedInstances,
        totalInstances: instancesData?.length || 0,
        totalContacts: contactsCount || 0,
        aiResponses: aiCount || 0,
      });
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
    } finally {
      setLoading(false);
    }
  };

  const statsCards = [
    {
      title: "Conversas Ativas",
      value: stats.activeConversations.toString(),
      description: "Nas últimas 24h",
      icon: MessageSquare,
      trend: `${stats.activeConversations > 0 ? "+" : ""}${stats.activeConversations}`,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
    },
    {
      title: "Instâncias Conectadas",
      value: stats.connectedInstances.toString(),
      description: "WhatsApp Business",
      icon: Smartphone,
      trend: `${stats.connectedInstances} de ${stats.totalInstances}`,
      color: "text-green-500",
      bgColor: "bg-green-500/10",
    },
    {
      title: "Contatos",
      value: stats.totalContacts.toString(),
      description: "Total de contatos",
      icon: Users,
      trend: `+${stats.totalContacts}`,
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
    },
    {
      title: "Respostas da IA",
      value: stats.aiResponses.toString(),
      description: "Mensagens automáticas",
      icon: Bot,
      trend: `${stats.aiResponses} msgs`,
      color: "text-primary",
      bgColor: "bg-primary/10",
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
          <Button onClick={() => navigate("/instances")} className="gap-2">
            <Plus className="h-4 w-4" />
            Conectar WhatsApp
          </Button>
        </div>

        {/* Stats Grid */}
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
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                  <TrendingUp className="h-3 w-3" />
                  {stat.trend} • {stat.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

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

        {/* Quick Actions */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card className="hover:border-primary/50 transition-colors cursor-pointer group" onClick={() => navigate("/instances")}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="h-5 w-5 text-primary" />
                Conectar WhatsApp
              </CardTitle>
              <CardDescription>
                Adicione seu número do WhatsApp Business para começar a receber mensagens.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="ghost" className="gap-2 p-0 group-hover:text-primary">
                Configurar agora
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:border-primary/50 transition-colors cursor-pointer group" onClick={() => navigate("/training")}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary" />
                Treinar IA
              </CardTitle>
              <CardDescription>
                Ensine sua IA com documentos, URLs e histórico de conversas.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="ghost" className="gap-2 p-0 group-hover:text-primary">
                Iniciar treinamento
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:border-primary/50 transition-colors cursor-pointer group" onClick={() => navigate("/flows")}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" />
                Criar Fluxo
              </CardTitle>
              <CardDescription>
                Configure automações e fluxos de atendimento personalizados.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="ghost" className="gap-2 p-0 group-hover:text-primary">
                Criar fluxo
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Recent Activity - Placeholder */}
        <Card>
          <CardHeader>
            <CardTitle>Atividade Recente</CardTitle>
            <CardDescription>
              Suas últimas conversas e eventos aparecerão aqui.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <MessageSquare className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="font-medium text-lg mb-2">Nenhuma atividade ainda</h3>
              <p className="text-muted-foreground text-sm max-w-sm">
                Envie uma mensagem para seu WhatsApp conectado para ver a atividade em tempo real.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

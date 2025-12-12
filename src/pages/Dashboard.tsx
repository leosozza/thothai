import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import {
  MessageSquare,
  Smartphone,
  Users,
  Bot,
  TrendingUp,
  Clock,
  ArrowRight,
  Plus,
} from "lucide-react";

const stats = [
  {
    title: "Conversas Ativas",
    value: "0",
    description: "Nas últimas 24h",
    icon: MessageSquare,
    trend: "+0%",
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
  },
  {
    title: "Instâncias Conectadas",
    value: "0",
    description: "WhatsApp Business",
    icon: Smartphone,
    trend: "0 de 5",
    color: "text-green-500",
    bgColor: "bg-green-500/10",
  },
  {
    title: "Contatos",
    value: "0",
    description: "Total de contatos",
    icon: Users,
    trend: "+0",
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
  },
  {
    title: "Respostas da IA",
    value: "0",
    description: "Mensagens automáticas",
    icon: Bot,
    trend: "0%",
    color: "text-primary",
    bgColor: "bg-primary/10",
  },
];

export default function Dashboard() {
  const navigate = useNavigate();

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
          {stats.map((stat) => (
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
                Conecte seu WhatsApp para começar a receber mensagens e ver a atividade em tempo real.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

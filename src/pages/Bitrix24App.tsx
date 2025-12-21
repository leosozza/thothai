import { useState, useEffect } from "react";
import { Loader2, MessageSquare, Bot, BookOpen, Settings, Phone, LayoutDashboard, Zap, AlertCircle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

type AppView = "loading" | "token" | "dashboard" | "instances" | "training" | "personas" | "settings" | "not-in-bitrix";

interface BitrixStatus {
  found: boolean;
  integration_id?: string;
  domain?: string;
  workspace_id?: string;
  has_access_token?: boolean;
  instances?: Array<{ id: string; name: string; phone_number: string | null; status: string }>;
}

export default function Bitrix24App() {
  const [view, setView] = useState<AppView>("loading");
  const [memberId, setMemberId] = useState<string | null>(null);
  const [domain, setDomain] = useState<string | null>(null);
  const [status, setStatus] = useState<BitrixStatus | null>(null);
  const [linkingToken, setLinkingToken] = useState("");
  const [validatingToken, setValidatingToken] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize from URL params and Bitrix24 SDK
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const memberIdParam = params.get("member_id");
    const domainParam = params.get("DOMAIN");

    if (memberIdParam) setMemberId(memberIdParam);
    if (domainParam) {
      setDomain(domainParam);
      if (!memberIdParam) setMemberId(domainParam);
    }

    initBitrix24SDK();
  }, []);

  const initBitrix24SDK = () => {
    try {
      // @ts-ignore - Bitrix24 JS SDK
      if (window.BX24) {
        // @ts-ignore
        window.BX24.init(() => {
          // @ts-ignore
          window.BX24.fitWindow();
          // @ts-ignore
          window.BX24.callMethod("app.info", {}, (result: any) => {
            const appInfo = result.data();
            if (appInfo?.member_id) setMemberId(appInfo.member_id);
            if (appInfo?.DOMAIN) setDomain(appInfo.DOMAIN);
          });
        });
      }
    } catch (e) {
      console.log("Bitrix24 SDK not available");
    }
  };

  // Load data when memberId is available
  useEffect(() => {
    if (memberId) {
      loadData();
    } else {
      const timer = setTimeout(() => {
        if (!memberId && !domain) {
          // Show fallback view when not inside Bitrix24 iframe
          setView("not-in-bitrix");
        }
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [memberId, domain]);

  const loadData = async () => {
    try {
      setView("loading");
      
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/bitrix24-install?member_id=${encodeURIComponent(memberId || "")}&include_instances=true`
      );

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data: BitrixStatus = await response.json();
      setStatus(data);
      
      if (data.domain) setDomain(data.domain);

      // Check if workspace is linked
      if (data.workspace_id) {
        setView("dashboard");
      } else {
        setView("token");
      }
    } catch (err) {
      console.error("Error loading data:", err);
      setError("Erro ao carregar dados");
      setView("token");
    }
  };

  const handleValidateToken = async () => {
    if (!linkingToken.trim()) {
      toast.error("Digite o token de vinculação");
      return;
    }

    try {
      setValidatingToken(true);

      const response = await fetch(`${SUPABASE_URL}/functions/v1/bitrix24-install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "validate_token",
          token: linkingToken.trim().toUpperCase(),
          member_id: memberId,
          domain: domain,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Token inválido ou expirado");
      }

      if (data?.success) {
        toast.success("Workspace vinculado com sucesso!");
        await loadData();
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao validar token");
    } finally {
      setValidatingToken(false);
    }
  };

  // Navigation items for the sidebar
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "instances", label: "Instâncias", icon: Phone },
    { id: "training", label: "Treinamento", icon: BookOpen },
    { id: "personas", label: "Personas", icon: Bot },
    { id: "settings", label: "Configurações", icon: Settings },
  ];

  if (view === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Carregando Thoth.ai...</p>
        </div>
      </div>
    );
  }

  // Fallback view when page is accessed outside Bitrix24 iframe
  if (view === "not-in-bitrix") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <MessageSquare className="h-8 w-8 text-primary" />
            </div>
            <CardTitle>Thoth.ai para Bitrix24</CardTitle>
            <CardDescription>
              Esta página deve ser acessada de dentro do Bitrix24
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-muted/50 rounded-lg p-4 space-y-3">
              <h4 className="font-medium">Como acessar:</h4>
              <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                <li>Acesse seu portal Bitrix24</li>
                <li>Clique em <strong>"Thoth WhatsApp"</strong> no menu lateral</li>
                <li>O dashboard completo será carregado automaticamente</li>
              </ol>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-amber-600">Não vê o app no menu?</p>
                  <p className="text-muted-foreground mt-1">
                    Verifique se o app "Thoth WhatsApp" está instalado e se o <strong>Handler path</strong> está configurado para:
                  </p>
                  <code className="block mt-2 bg-background px-2 py-1 rounded text-xs">
                    https://chat.thoth24.com/bitrix24-app
                  </code>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <Button asChild variant="default">
                <a href="https://chat.thoth24.com" target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Acessar Thoth.ai Principal
                </a>
              </Button>
              <Button asChild variant="outline">
                <a href="/bitrix24-setup" rel="noopener noreferrer">
                  Configurar Integração
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (view === "token") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Zap className="h-8 w-8 text-primary" />
            </div>
            <CardTitle>Vincular Workspace Thoth.ai</CardTitle>
            <CardDescription>
              Para acessar o painel completo, vincule seu workspace Thoth.ai a este portal Bitrix24
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="token">Token de Vinculação</Label>
              <Input
                id="token"
                placeholder="XXXX-XXXX"
                value={linkingToken}
                onChange={(e) => setLinkingToken(e.target.value.toUpperCase())}
                className="text-center text-lg font-mono tracking-wider"
                maxLength={9}
              />
              <p className="text-xs text-muted-foreground text-center">
                Gere o token em <strong>chat.thoth24.com</strong> → Integrações → Bitrix24
              </p>
            </div>
            
            <Button 
              onClick={handleValidateToken} 
              className="w-full"
              disabled={validatingToken || !linkingToken.trim()}
            >
              {validatingToken ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Zap className="h-4 w-4 mr-2" />
              )}
              Vincular Workspace
            </Button>

            <div className="pt-4 border-t">
              <p className="text-xs text-muted-foreground text-center">
                Não tem uma conta? Acesse{" "}
                <a 
                  href="https://chat.thoth24.com" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  chat.thoth24.com
                </a>
                {" "}para criar
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Main app view with sidebar
  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-56 border-r bg-card flex flex-col">
        {/* Logo */}
        <div className="p-4 border-b">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <MessageSquare className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-lg">Thoth.ai</span>
          </div>
          {domain && (
            <Badge variant="secondary" className="mt-2 text-xs">
              {domain}
            </Badge>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id as AppView)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                view === item.id
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t">
          <p className="text-xs text-muted-foreground">
            Portal: {domain}
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-6 overflow-auto">
        {view === "dashboard" && <DashboardView status={status} />}
        {view === "instances" && <InstancesView status={status} />}
        {view === "training" && <TrainingView />}
        {view === "personas" && <PersonasView />}
        {view === "settings" && <SettingsView domain={domain} />}
      </main>
    </div>
  );
}

// Dashboard View
function DashboardView({ status }: { status: BitrixStatus | null }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Visão geral do seu WhatsApp Business</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Instâncias Ativas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{status?.instances?.length || 0}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="default" className="bg-green-500">Conectado</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Integração</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="secondary">Bitrix24</Badge>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Início Rápido</CardTitle>
          <CardDescription>Configure seu WhatsApp para receber mensagens no Bitrix24</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-4 p-4 bg-muted/50 rounded-lg">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-primary font-bold">1</span>
            </div>
            <div>
              <h4 className="font-medium">Conecte seu WhatsApp</h4>
              <p className="text-sm text-muted-foreground">Vá em Instâncias e conecte seu número WhatsApp</p>
            </div>
          </div>
          
          <div className="flex items-start gap-4 p-4 bg-muted/50 rounded-lg">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-primary font-bold">2</span>
            </div>
            <div>
              <h4 className="font-medium">Configure o Bot</h4>
              <p className="text-sm text-muted-foreground">Treine seu bot com informações da sua empresa</p>
            </div>
          </div>
          
          <div className="flex items-start gap-4 p-4 bg-muted/50 rounded-lg">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-primary font-bold">3</span>
            </div>
            <div>
              <h4 className="font-medium">Vincule ao Contact Center</h4>
              <p className="text-sm text-muted-foreground">No Bitrix24, vá em Contact Center → Thoth WhatsApp</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Instances View
function InstancesView({ status }: { status: BitrixStatus | null }) {
  const instances = status?.instances || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Instâncias WhatsApp</h1>
        <p className="text-muted-foreground">Gerencie suas conexões WhatsApp</p>
      </div>

      {instances.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Phone className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-medium mb-2">Nenhuma instância encontrada</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Acesse o painel completo em chat.thoth24.com para criar instâncias
            </p>
            <Button asChild>
              <a href="https://chat.thoth24.com/instances" target="_blank" rel="noopener noreferrer">
                Abrir Painel Completo
              </a>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {instances.map((instance) => (
            <Card key={instance.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
                    <Phone className="h-5 w-5 text-green-500" />
                  </div>
                  <div>
                    <h4 className="font-medium">{instance.name}</h4>
                    <p className="text-sm text-muted-foreground">{instance.phone_number || "Sem número"}</p>
                  </div>
                </div>
                <Badge variant={instance.status === "connected" ? "default" : "secondary"}>
                  {instance.status === "connected" ? "Conectado" : instance.status}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">
            Para gerenciamento completo das instâncias (criar, editar, reconectar), acesse{" "}
            <a 
              href="https://app.thoth24.com/instances" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              app.thoth24.com
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// Training View
function TrainingView() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Treinamento do Bot</h1>
        <p className="text-muted-foreground">Configure como seu bot deve responder</p>
      </div>

      <Card>
        <CardContent className="py-12 text-center">
          <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-medium mb-2">Treinamento Avançado</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Acesse o painel completo para adicionar documentos, FAQs e configurar o treinamento do bot
          </p>
          <Button asChild>
            <a href="https://app.thoth24.com/training" target="_blank" rel="noopener noreferrer">
              Abrir Treinamento
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// Personas View
function PersonasView() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Personas</h1>
        <p className="text-muted-foreground">Configure a personalidade do seu bot</p>
      </div>

      <Card>
        <CardContent className="py-12 text-center">
          <Bot className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-medium mb-2">Gerenciar Personas</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Acesse o painel completo para criar e editar personas com diferentes personalidades
          </p>
          <Button asChild>
            <a href="https://app.thoth24.com/personas" target="_blank" rel="noopener noreferrer">
              Abrir Personas
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// Settings View
function SettingsView({ domain }: { domain: string | null }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="text-muted-foreground">Configurações da integração Bitrix24</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Informações da Integração</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between items-center py-2 border-b">
            <span className="text-muted-foreground">Portal Bitrix24</span>
            <span className="font-medium">{domain}</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b">
            <span className="text-muted-foreground">Status</span>
            <Badge variant="default" className="bg-green-500">Ativo</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">
            Para configurações avançadas, acesse{" "}
            <a 
              href="https://app.thoth24.com/settings" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              app.thoth24.com
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

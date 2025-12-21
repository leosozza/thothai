import { useState, useEffect } from "react";
import { Loader2, MessageSquare, Bot, BookOpen, Settings, Phone, LayoutDashboard, AlertCircle, ExternalLink, RefreshCw, RotateCcw, Search, Stethoscope, CheckCircle, XCircle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

type AppView = "loading" | "pending" | "dashboard" | "instances" | "training" | "personas" | "settings" | "not-in-bitrix";

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
        console.log("BX24 SDK detected in Bitrix24App, initializing...");
        // @ts-ignore
        window.BX24.init(() => {
          console.log("BX24.init() completed in Bitrix24App");
          // @ts-ignore
          window.BX24.fitWindow();
          
          // CRITICAL: Call installFinish immediately after init
          // This ensures Bitrix24 knows the app installation is complete
          try {
            // @ts-ignore
            window.BX24.installFinish();
            console.log("BX24.installFinish() called in Bitrix24App");
          } catch (installErr) {
            console.log("BX24.installFinish() error in Bitrix24App:", installErr);
          }
          
          // @ts-ignore
          window.BX24.callMethod("app.info", {}, (result: any) => {
            const appInfoData = result.data();
            console.log("app.info result in Bitrix24App:", appInfoData);
            if (appInfoData?.member_id) setMemberId(appInfoData.member_id);
            if (appInfoData?.DOMAIN) setDomain(appInfoData.DOMAIN);
            
            // If app is not marked as INSTALLED, try installFinish again
            if (appInfoData && !appInfoData.INSTALLED) {
              console.log("App not marked as INSTALLED in Bitrix24App, retrying installFinish...");
              try {
                // @ts-ignore
                window.BX24.installFinish();
                console.log("BX24.installFinish() retry completed in Bitrix24App");
              } catch (retryErr) {
                console.log("BX24.installFinish() retry error:", retryErr);
              }
            }
          });
        });
      } else {
        console.log("BX24 SDK not available on window in Bitrix24App");
      }
    } catch (e) {
      console.log("Bitrix24 SDK initialization error in Bitrix24App:", e);
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
        // Workspace not linked yet - show pending message instead of token
        setView("pending");
      }
    } catch (err) {
      console.error("Error loading data:", err);
      setView("pending");
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

  if (view === "pending") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
            <CardTitle>Instalação em Andamento</CardTitle>
            <CardDescription>
              Aguarde enquanto configuramos seu workspace automaticamente.
              Se demorar mais de 30 segundos, recarregue a página.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={() => window.location.reload()} variant="outline" className="w-full">
              <RefreshCw className="h-4 w-4 mr-2" />
              Recarregar Página
            </Button>
            
            <div className="pt-4 border-t">
              <p className="text-xs text-muted-foreground text-center">
                Portal: {domain || memberId || "Identificando..."}
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
        {view === "settings" && <SettingsView domain={domain} status={status} memberId={memberId} onReload={loadData} />}
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
              href="https://chat.thoth24.com/instances" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              chat.thoth24.com
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
            <a href="https://chat.thoth24.com/training" target="_blank" rel="noopener noreferrer">
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
            <a href="https://chat.thoth24.com/personas" target="_blank" rel="noopener noreferrer">
              Abrir Personas
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// Settings View with Diagnostic Tools
function SettingsView({ 
  domain, 
  status, 
  memberId,
  onReload 
}: { 
  domain: string | null; 
  status: BitrixStatus | null;
  memberId: string | null;
  onReload: () => Promise<void>;
}) {
  const [verificando, setVerificando] = useState(false);
  const [diagnosticando, setDiagnosticando] = useState(false);
  const [reconectando, setReconectando] = useState(false);
  const [reconfigurando, setReconfigurando] = useState(false);
  
  const [verificationResult, setVerificationResult] = useState<{
    success: boolean;
    message: string;
    details?: Record<string, any>;
  } | null>(null);
  
  const [diagnosisResult, setDiagnosisResult] = useState<{
    issues: Array<{ level: "error" | "warning" | "info"; message: string }>;
    recommendations: string[];
  } | null>(null);

  const handleVerifyIntegration = async () => {
    try {
      setVerificando(true);
      setVerificationResult(null);
      
      const response = await fetch(`${SUPABASE_URL}/functions/v1/bitrix24-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "check_status",
          integration_id: status?.integration_id,
        }),
      });
      
      const data = await response.json();
      
      if (response.ok && data.success !== false) {
        setVerificationResult({
          success: true,
          message: "Integração funcionando corretamente",
          details: data,
        });
        toast.success("Integração verificada com sucesso!");
      } else {
        setVerificationResult({
          success: false,
          message: data.error || "Problemas detectados na integração",
          details: data,
        });
        toast.error("Problemas detectados na integração");
      }
    } catch (err: any) {
      setVerificationResult({
        success: false,
        message: err.message || "Erro ao verificar integração",
      });
      toast.error("Erro ao verificar integração");
    } finally {
      setVerificando(false);
    }
  };

  const handleDiagnose = async () => {
    try {
      setDiagnosticando(true);
      setDiagnosisResult(null);
      
      const issues: Array<{ level: "error" | "warning" | "info"; message: string }> = [];
      const recommendations: string[] = [];

      // Check basic status
      if (!status?.integration_id) {
        issues.push({ level: "error", message: "Integração não encontrada no banco de dados" });
        recommendations.push("Reinstale o app no Bitrix24");
      }

      if (!status?.workspace_id) {
        issues.push({ level: "error", message: "Workspace não vinculado" });
        recommendations.push("Vincule um workspace Thoth.ai usando um token de vinculação");
      }

      if (!status?.has_access_token) {
        issues.push({ level: "warning", message: "Access token pode estar expirado" });
        recommendations.push("Clique em 'Reconectar' para renovar o token");
      }

      if (!status?.instances || status.instances.length === 0) {
        issues.push({ level: "info", message: "Nenhuma instância WhatsApp conectada" });
        recommendations.push("Crie uma instância WhatsApp em chat.thoth24.com");
      }

      // Check connector status
      try {
        const connectorResponse = await fetch(`${SUPABASE_URL}/functions/v1/bitrix24-webhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "list_channels",
            integration_id: status?.integration_id,
            include_connector_status: true,
          }),
        });
        
        const connectorData = await connectorResponse.json();
        
        if (!connectorData.channels || connectorData.channels.length === 0) {
          issues.push({ level: "warning", message: "Nenhum canal Open Channel configurado no Bitrix24" });
          recommendations.push("Configure o conector no Contact Center do Bitrix24");
        } else {
          const inactiveChannels = connectorData.channels.filter((c: any) => !c.active);
          if (inactiveChannels.length > 0) {
            issues.push({ level: "warning", message: `${inactiveChannels.length} canal(is) inativo(s) no Bitrix24` });
          }
        }
      } catch (e) {
        issues.push({ level: "info", message: "Não foi possível verificar status do conector" });
      }

      if (issues.length === 0) {
        issues.push({ level: "info", message: "Nenhum problema encontrado!" });
      }

      setDiagnosisResult({ issues, recommendations });
      toast.success("Diagnóstico concluído");
    } catch (err: any) {
      toast.error("Erro ao diagnosticar: " + err.message);
    } finally {
      setDiagnosticando(false);
    }
  };

  const handleReconnect = async () => {
    try {
      setReconectando(true);
      
      const response = await fetch(`${SUPABASE_URL}/functions/v1/bitrix24-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "refresh_token",
          integration_id: status?.integration_id,
        }),
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        toast.success("Reconexão realizada com sucesso!");
        await onReload();
      } else {
        toast.error(data.error || "Erro ao reconectar");
      }
    } catch (err: any) {
      toast.error("Erro ao reconectar: " + err.message);
    } finally {
      setReconectando(false);
    }
  };

  const handleReconfigureFromZero = async () => {
    if (!confirm("Isso vai reconfigurar completamente o conector. Continuar?")) {
      return;
    }
    
    try {
      setReconfigurando(true);
      
      const response = await fetch(`${SUPABASE_URL}/functions/v1/bitrix24-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reconfigure_connector",
          integration_id: status?.integration_id,
        }),
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        toast.success("Reconfiguração concluída! O conector foi re-registrado.");
        await onReload();
      } else {
        toast.error(data.error || "Erro ao reconfigurar");
      }
    } catch (err: any) {
      toast.error("Erro ao reconfigurar: " + err.message);
    } finally {
      setReconfigurando(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="text-muted-foreground">Configurações da integração Bitrix24</p>
      </div>

      {/* Integration Info Card */}
      <Card>
        <CardHeader>
          <CardTitle>Informações da Integração</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between items-center py-2 border-b">
            <span className="text-muted-foreground">Portal Bitrix24</span>
            <span className="font-medium">{domain || "-"}</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b">
            <span className="text-muted-foreground">Member ID</span>
            <span className="font-mono text-sm">{memberId || "-"}</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b">
            <span className="text-muted-foreground">Integration ID</span>
            <span className="font-mono text-xs">{status?.integration_id || "-"}</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b">
            <span className="text-muted-foreground">Workspace Vinculado</span>
            {status?.workspace_id ? (
              <Badge variant="default" className="bg-green-500">Sim</Badge>
            ) : (
              <Badge variant="destructive">Não</Badge>
            )}
          </div>
          <div className="flex justify-between items-center py-2 border-b">
            <span className="text-muted-foreground">Access Token</span>
            {status?.has_access_token ? (
              <Badge variant="default" className="bg-green-500">Válido</Badge>
            ) : (
              <Badge variant="secondary">Expirado/Ausente</Badge>
            )}
          </div>
          <div className="flex justify-between items-center py-2">
            <span className="text-muted-foreground">Instâncias</span>
            <span className="font-medium">{status?.instances?.length || 0}</span>
          </div>
        </CardContent>
      </Card>

      {/* Advanced Actions Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Ações Avançadas
          </CardTitle>
          <CardDescription>Diagnóstico e manutenção da integração</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Button 
              onClick={handleVerifyIntegration} 
              disabled={verificando}
              variant="outline"
              className="w-full justify-start"
            >
              {verificando ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Search className="h-4 w-4 mr-2" />
              )}
              Verificar Integração
            </Button>
            
            <Button 
              onClick={handleDiagnose} 
              disabled={diagnosticando}
              variant="outline"
              className="w-full justify-start"
            >
              {diagnosticando ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Stethoscope className="h-4 w-4 mr-2" />
              )}
              Diagnosticar Problemas
            </Button>
            
            <Button 
              onClick={handleReconnect} 
              disabled={reconectando}
              variant="outline"
              className="w-full justify-start"
            >
              {reconectando ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Reconectar
            </Button>
            
            <Button 
              onClick={handleReconfigureFromZero} 
              disabled={reconfigurando}
              variant="destructive"
              className="w-full justify-start"
            >
              {reconfigurando ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4 mr-2" />
              )}
              Reconfigurar do Zero
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Verification Result */}
      {verificationResult && (
        <Card className={verificationResult.success ? "border-green-500/50" : "border-destructive/50"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              {verificationResult.success ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : (
                <XCircle className="h-5 w-5 text-destructive" />
              )}
              Resultado da Verificação
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={verificationResult.success ? "text-green-600" : "text-destructive"}>
              {verificationResult.message}
            </p>
            {verificationResult.details && (
              <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto max-h-32">
                {JSON.stringify(verificationResult.details, null, 2)}
              </pre>
            )}
          </CardContent>
        </Card>
      )}

      {/* Diagnosis Result */}
      {diagnosisResult && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Stethoscope className="h-5 w-5" />
              Resultado do Diagnóstico
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Issues */}
            <div className="space-y-2">
              <h4 className="font-medium text-sm">Problemas Encontrados:</h4>
              {diagnosisResult.issues.map((issue, i) => (
                <div 
                  key={i} 
                  className={cn(
                    "flex items-start gap-2 p-2 rounded text-sm",
                    issue.level === "error" && "bg-destructive/10 text-destructive",
                    issue.level === "warning" && "bg-amber-500/10 text-amber-600",
                    issue.level === "info" && "bg-blue-500/10 text-blue-600"
                  )}
                >
                  {issue.level === "error" && <XCircle className="h-4 w-4 shrink-0 mt-0.5" />}
                  {issue.level === "warning" && <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />}
                  {issue.level === "info" && <Info className="h-4 w-4 shrink-0 mt-0.5" />}
                  {issue.message}
                </div>
              ))}
            </div>
            
            {/* Recommendations */}
            {diagnosisResult.recommendations.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium text-sm">Recomendações:</h4>
                <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                  {diagnosisResult.recommendations.map((rec, i) => (
                    <li key={i}>{rec}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Link to full settings */}
      <Card>
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">
            Para configurações avançadas, acesse{" "}
            <a 
              href="https://chat.thoth24.com/settings" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              chat.thoth24.com
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

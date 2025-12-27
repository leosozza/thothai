import { useState, useEffect } from "react";
import { Loader2, Bot, BookOpen, Settings, Phone, LayoutDashboard, AlertCircle, ExternalLink, RefreshCw, RotateCcw, Search, Stethoscope, CheckCircle, XCircle, Info, GitBranch, Plus, Trash2, Power, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ThothLogo } from "@/components/ThothLogo";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

// Helper to call bitrix24-data Edge Function (bypasses RLS)
async function callBitrixData(action: string, memberId: string, data?: any) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/bitrix24-data`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, member_id: memberId, data })
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }
  
  return response.json();
}

type AppView = "loading" | "pending" | "dashboard" | "instances" | "training" | "personas" | "flows" | "settings" | "not-in-bitrix";

interface BitrixStatus {
  found: boolean;
  integration_id?: string;
  workspace_id?: string; // NEW: workspace_id for CRUD operations
  domain?: string;
  is_active?: boolean;
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

      // SIMPLIFIED: Show dashboard if integration exists (workspace_id no longer required)
      if (data.found && data.integration_id) {
        setView("dashboard");
      } else {
        // Integration not found - show pending message
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
    { id: "flows", label: "Fluxos", icon: GitBranch },
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
            <div className="flex justify-center mb-4">
              <ThothLogo size="lg" showText={false} />
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
            <CardTitle>Finalizando Instalação</CardTitle>
            <CardDescription>
              Aguarde enquanto finalizamos a configuração.
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
          <ThothLogo size="sm" showText={true} />
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
        {view === "instances" && <InstancesView status={status} memberId={memberId} />}
        {view === "flows" && <FlowsView status={status} memberId={memberId} />}
        {view === "training" && <TrainingView memberId={memberId} />}
        {view === "personas" && <PersonasView memberId={memberId} />}
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

// Instances View - Full CRUD using Edge Function
function InstancesView({ status, memberId }: { status: BitrixStatus | null; memberId: string | null }) {
  const [instances, setInstances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [selectedInstance, setSelectedInstance] = useState<any>(null);
  const [connecting, setConnecting] = useState(false);
  const [newInstance, setNewInstance] = useState({ 
    name: "", 
    connection_type: "waba",
    gupshup_api_key: "",
    gupshup_app_id: ""
  });

  useEffect(() => {
    if (memberId) {
      fetchInstances();
    } else {
      setLoading(false);
    }
  }, [memberId]);

  const fetchInstances = async () => {
    if (!memberId) return;
    
    try {
      const result = await callBitrixData("get_instances", memberId);
      if (result.error) throw new Error(result.error);
      setInstances(result.data || []);
    } catch (err: any) {
      console.error("Error fetching instances:", err);
      toast.error("Erro ao carregar instâncias: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateInstance = async () => {
    if (!newInstance.name.trim()) {
      toast.error("Nome da instância é obrigatório");
      return;
    }

    if (!memberId) {
      toast.error("member_id não encontrado");
      return;
    }

    try {
      const result = await callBitrixData("create_instance", memberId, {
        name: newInstance.name,
        connection_type: newInstance.connection_type,
        ...(newInstance.connection_type === "oficial" && {
          gupshup_api_key: newInstance.gupshup_api_key,
          gupshup_app_id: newInstance.gupshup_app_id,
        })
      });

      if (result.error) throw new Error(result.error);

      toast.success("Instância criada! Clique em Conectar para vincular seu WhatsApp.");
      setCreateDialogOpen(false);
      setNewInstance({ name: "", connection_type: "waba", gupshup_api_key: "", gupshup_app_id: "" });
      fetchInstances();
      
      // Auto open connection dialog for WABA
      if (newInstance.connection_type === "waba" && result.data) {
        setSelectedInstance(result.data);
        handleConnectInstance(result.data);
      }
    } catch (err: any) {
      toast.error("Erro ao criar instância: " + err.message);
    }
  };

  const handleConnectInstance = async (instance: any) => {
    try {
      setConnecting(true);
      setSelectedInstance(instance);

      const { data, error } = await supabase.functions.invoke("wapi-connect", {
        body: { instance_id: instance.id }
      });

      if (error) throw error;

      if (data?.qr_code) {
        // Update instance with QR code
        await supabase
          .from("instances")
          .update({ qr_code: data.qr_code })
          .eq("id", instance.id);
        
        setSelectedInstance({ ...instance, qr_code: data.qr_code });
        setQrDialogOpen(true);
      } else if (data?.status === "connected") {
        toast.success("WhatsApp já está conectado!");
        fetchInstances();
      } else {
        toast.info("Gerando QR Code...");
        setQrDialogOpen(true);
      }
    } catch (err: any) {
      toast.error("Erro ao conectar: " + err.message);
    } finally {
      setConnecting(false);
    }
  };

  const handleDeleteInstance = async (instanceId: string) => {
    if (!confirm("Tem certeza que deseja excluir esta instância?")) return;
    if (!memberId) return;

    try {
      const result = await callBitrixData("delete_instance", memberId, { id: instanceId });
      if (result.error) throw new Error(result.error);

      toast.success("Instância excluída");
      fetchInstances();
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    }
  };

  const statusConfig: Record<string, { label: string; color: string }> = {
    connected: { label: "Conectado", color: "bg-green-500" },
    disconnected: { label: "Desconectado", color: "bg-red-500" },
    connecting: { label: "Conectando...", color: "bg-yellow-500" },
  };

  if (!memberId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Instâncias WhatsApp</h1>
          <p className="text-muted-foreground">Gerencie suas conexões WhatsApp</p>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h3 className="font-medium mb-2">Sessão não identificada</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Recarregue a página para identificar sua sessão Bitrix24.
            </p>
            <Button onClick={() => window.location.reload()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Recarregar
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Instâncias WhatsApp</h1>
          <p className="text-muted-foreground">Gerencie suas conexões WhatsApp</p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Nova Instância
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Criar Nova Instância</DialogTitle>
              <DialogDescription>
                Conecte um novo número WhatsApp
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nome da Instância</Label>
                <Input
                  value={newInstance.name}
                  onChange={(e) => setNewInstance({ ...newInstance, name: e.target.value })}
                  placeholder="Ex: WhatsApp Comercial"
                />
              </div>
              <div className="space-y-2">
                <Label>Tipo de Conexão</Label>
                <Select
                  value={newInstance.connection_type}
                  onValueChange={(v) => setNewInstance({ ...newInstance, connection_type: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="waba">WhatsApp WABA (QR Code)</SelectItem>
                    <SelectItem value="oficial">WhatsApp Oficial (Gupshup)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {newInstance.connection_type === "oficial" && (
                <>
                  <div className="space-y-2">
                    <Label>Gupshup API Key</Label>
                    <Input
                      value={newInstance.gupshup_api_key}
                      onChange={(e) => setNewInstance({ ...newInstance, gupshup_api_key: e.target.value })}
                      placeholder="Sua API Key do Gupshup"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Gupshup App ID</Label>
                    <Input
                      value={newInstance.gupshup_app_id}
                      onChange={(e) => setNewInstance({ ...newInstance, gupshup_app_id: e.target.value })}
                      placeholder="ID do App no Gupshup"
                    />
                  </div>
                </>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleCreateInstance}>
                Criar Instância
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* QR Code Dialog */}
      <Dialog open={qrDialogOpen} onOpenChange={setQrDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conectar WhatsApp</DialogTitle>
            <DialogDescription>
              Escaneie o QR Code com seu WhatsApp
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center py-4">
            {selectedInstance?.qr_code ? (
              <img 
                src={selectedInstance.qr_code.startsWith("data:") 
                  ? selectedInstance.qr_code 
                  : `data:image/png;base64,${selectedInstance.qr_code}`
                } 
                alt="QR Code" 
                className="w-64 h-64"
              />
            ) : (
              <div className="w-64 h-64 flex items-center justify-center bg-muted rounded">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            )}
            <p className="text-sm text-muted-foreground mt-4 text-center">
              1. Abra o WhatsApp no seu celular<br/>
              2. Vá em Configurações → Aparelhos conectados<br/>
              3. Toque em "Conectar um aparelho"<br/>
              4. Escaneie este QR Code
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setQrDialogOpen(false)}>
              Fechar
            </Button>
            <Button onClick={() => handleConnectInstance(selectedInstance)} disabled={connecting}>
              {connecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Atualizar QR Code
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : instances.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Phone className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-medium mb-2">Nenhuma instância criada</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Clique em "Nova Instância" para conectar seu primeiro WhatsApp
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {instances.map((instance) => (
            <Card key={instance.id}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center",
                      instance.status === "connected" ? "bg-green-500/10" : "bg-muted"
                    )}>
                      <Phone className={cn(
                        "h-5 w-5",
                        instance.status === "connected" ? "text-green-500" : "text-muted-foreground"
                      )} />
                    </div>
                    <div>
                      <h4 className="font-medium">{instance.name}</h4>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">
                          {instance.phone_number || "Não conectado"}
                        </span>
                        <Badge variant="secondary" className="text-xs">
                          {instance.connection_type === "oficial" ? "Oficial" : "WABA"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge 
                      variant={instance.status === "connected" ? "default" : "secondary"}
                      className={instance.status === "connected" ? "bg-green-500" : ""}
                    >
                      {statusConfig[instance.status]?.label || instance.status}
                    </Badge>
                    {instance.status !== "connected" && instance.connection_type === "waba" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleConnectInstance(instance)}
                        disabled={connecting}
                      >
                        {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Conectar"}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteInstance(instance.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// Training View - Full CRUD using Edge Function
function TrainingView({ memberId }: { memberId: string | null }) {
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newDoc, setNewDoc] = useState({ title: "", content: "", source_type: "manual" });

  useEffect(() => {
    if (memberId) {
      fetchDocuments();
    } else {
      setLoading(false);
    }
  }, [memberId]);

  const fetchDocuments = async () => {
    if (!memberId) return;
    
    try {
      const result = await callBitrixData("get_documents", memberId);
      if (result.error) throw new Error(result.error);
      setDocuments(result.data || []);
    } catch (err: any) {
      console.error("Error fetching documents:", err);
      toast.error("Erro ao carregar documentos: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateDocument = async () => {
    if (!newDoc.title.trim()) {
      toast.error("Título é obrigatório");
      return;
    }

    if (!memberId) {
      toast.error("Sessão não identificada");
      return;
    }

    try {
      setUploading(true);

      const result = await callBitrixData("create_document", memberId, {
        title: newDoc.title,
        content: newDoc.content,
        source_type: newDoc.source_type
      });

      if (result.error) throw new Error(result.error);

      toast.success("Documento criado com sucesso!");
      setCreateDialogOpen(false);
      setNewDoc({ title: "", content: "", source_type: "manual" });
      fetchDocuments();
    } catch (err: any) {
      toast.error("Erro ao criar documento: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    if (!confirm("Tem certeza que deseja excluir este documento?")) return;
    if (!memberId) return;

    try {
      const result = await callBitrixData("delete_document", memberId, { id: docId });
      if (result.error) throw new Error(result.error);

      toast.success("Documento excluído");
      fetchDocuments();
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    }
  };

  const statusLabels: Record<string, { label: string; color: string }> = {
    pending: { label: "Processando", color: "bg-yellow-500" },
    processing: { label: "Processando", color: "bg-yellow-500" },
    ready: { label: "Pronto", color: "bg-green-500" },
    completed: { label: "Pronto", color: "bg-green-500" },
    error: { label: "Erro", color: "bg-red-500" }
  };

  if (!memberId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Treinamento do Bot</h1>
          <p className="text-muted-foreground">Configure como seu bot deve responder</p>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h3 className="font-medium mb-2">Sessão não identificada</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Recarregue a página para identificar sua sessão Bitrix24.
            </p>
            <Button onClick={() => window.location.reload()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Recarregar
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Treinamento do Bot</h1>
          <p className="text-muted-foreground">Adicione documentos para treinar seu bot</p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Novo Documento
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Adicionar Documento de Treinamento</DialogTitle>
              <DialogDescription>
                Adicione informações que o bot deve usar para responder
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Título</Label>
                <Input
                  value={newDoc.title}
                  onChange={(e) => setNewDoc({ ...newDoc, title: e.target.value })}
                  placeholder="Ex: FAQ - Perguntas Frequentes"
                />
              </div>
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select
                  value={newDoc.source_type}
                  onValueChange={(v) => setNewDoc({ ...newDoc, source_type: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Texto</SelectItem>
                    <SelectItem value="faq">FAQ</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Conteúdo</Label>
                <Textarea
                  value={newDoc.content}
                  onChange={(e) => setNewDoc({ ...newDoc, content: e.target.value })}
                  placeholder="Cole aqui as informações que o bot deve conhecer..."
                  className="min-h-[200px]"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleCreateDocument} disabled={uploading}>
                {uploading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Adicionar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : documents.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-medium mb-2">Nenhum documento de treinamento</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Adicione documentos com informações sobre sua empresa para treinar o bot
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {documents.map((doc) => (
            <Card key={doc.id}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <BookOpen className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h4 className="font-medium">{doc.title}</h4>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Badge variant="secondary" className="text-xs">
                          {doc.source_type}
                        </Badge>
                        {doc.chunks_count > 0 && (
                          <span className="text-xs">{doc.chunks_count} chunks</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge 
                      variant="secondary"
                      className={statusLabels[doc.status]?.color || ""}
                    >
                      {statusLabels[doc.status]?.label || doc.status}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteDocument(doc.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">
            Para upload de arquivos PDF, Word e outros formatos, acesse{" "}
            <a 
              href="https://chat.thoth24.com/training" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              chat.thoth24.com/training
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// Personas View - Full CRUD using Edge Function
function PersonasView({ memberId }: { memberId: string | null }) {
  const [personas, setPersonas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingPersona, setEditingPersona] = useState<any>(null);
  const [publishingBot, setPublishingBot] = useState<string | null>(null);
  const [newPersona, setNewPersona] = useState({ 
    name: "", 
    description: "", 
    system_prompt: "",
    welcome_message: "",
    fallback_message: "",
    temperature: 0.7
  });

  useEffect(() => {
    if (memberId) {
      fetchPersonas();
    } else {
      setLoading(false);
    }
  }, [memberId]);

  const fetchPersonas = async () => {
    if (!memberId) return;
    
    try {
      const result = await callBitrixData("get_personas", memberId);
      if (result.error) throw new Error(result.error);
      setPersonas(result.data || []);
    } catch (err: any) {
      console.error("Error fetching personas:", err);
      toast.error("Erro ao carregar personas: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSavePersona = async () => {
    const data = editingPersona || newPersona;
    
    if (!data.name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }

    if (!data.system_prompt.trim()) {
      toast.error("Prompt do sistema é obrigatório");
      return;
    }

    if (!memberId) {
      toast.error("Sessão não identificada");
      return;
    }

    try {
      if (editingPersona?.id) {
        // Update existing
        const result = await callBitrixData("update_persona", memberId, {
          id: editingPersona.id,
          name: data.name,
          description: data.description,
          system_prompt: data.system_prompt,
          welcome_message: data.welcome_message,
          fallback_message: data.fallback_message,
          temperature: data.temperature
        });

        if (result.error) throw new Error(result.error);
        toast.success("Persona atualizada!");
      } else {
        // Create new
        const result = await callBitrixData("create_persona", memberId, {
          name: data.name,
          description: data.description,
          system_prompt: data.system_prompt,
          welcome_message: data.welcome_message,
          fallback_message: data.fallback_message,
          temperature: data.temperature
        });

        if (result.error) throw new Error(result.error);
        toast.success("Persona criada!");
      }

      setCreateDialogOpen(false);
      setEditingPersona(null);
      setNewPersona({ name: "", description: "", system_prompt: "", welcome_message: "", fallback_message: "", temperature: 0.7 });
      fetchPersonas();
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    }
  };

  const handleToggleActive = async (personaId: string, isActive: boolean) => {
    if (!memberId) return;
    
    try {
      const result = await callBitrixData("update_persona", memberId, {
        id: personaId,
        is_active: !isActive
      });

      if (result.error) throw new Error(result.error);
      toast.success(isActive ? "Persona desativada" : "Persona ativada");
      fetchPersonas();
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    }
  };

  const handleSetDefault = async (personaId: string) => {
    if (!memberId) return;
    
    try {
      const result = await callBitrixData("set_default_persona", memberId, { id: personaId });

      if (result.error) throw new Error(result.error);
      toast.success("Persona definida como padrão");
      fetchPersonas();
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    }
  };

  const handleDeletePersona = async (personaId: string) => {
    if (!confirm("Tem certeza que deseja excluir esta persona?")) return;
    if (!memberId) return;

    try {
      const result = await callBitrixData("delete_persona", memberId, { id: personaId });

      if (result.error) throw new Error(result.error);
      toast.success("Persona excluída");
      fetchPersonas();
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    }
  };

  const openEditDialog = (persona: any) => {
    setEditingPersona({
      ...persona,
      temperature: persona.temperature || 0.7
    });
    setCreateDialogOpen(true);
  };

  const handlePublishBot = async (personaId: string, force: boolean = false) => {
    if (!memberId) return;
    
    try {
      setPublishingBot(personaId);
      const result = await callBitrixData("publish_persona_bot", memberId, { persona_id: personaId, force });
      
      if (result.error) throw new Error(result.error);
      
      toast.success(force ? "Bot republicado no Bitrix24!" : "Bot publicado no Bitrix24!");
      fetchPersonas();
    } catch (err: any) {
      console.error("Error publishing bot:", err);
      toast.error("Erro ao publicar bot: " + err.message);
    } finally {
      setPublishingBot(null);
    }
  };

  const handleUnpublishBot = async (personaId: string) => {
    if (!memberId) return;
    if (!confirm("Tem certeza que deseja remover este bot do Bitrix24?")) return;
    
    try {
      setPublishingBot(personaId);
      const result = await callBitrixData("unpublish_persona_bot", memberId, { persona_id: personaId });
      
      if (result.error) throw new Error(result.error);
      
      toast.success("Bot removido do Bitrix24");
      fetchPersonas();
    } catch (err: any) {
      console.error("Error unpublishing bot:", err);
      toast.error("Erro ao remover bot: " + err.message);
    } finally {
      setPublishingBot(null);
    }
  };

  if (!memberId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Personas</h1>
          <p className="text-muted-foreground">Configure a personalidade do seu bot</p>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h3 className="font-medium mb-2">Sessão não identificada</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Recarregue a página para identificar sua sessão Bitrix24.
            </p>
            <Button onClick={() => window.location.reload()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Recarregar
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentData = editingPersona || newPersona;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Personas</h1>
          <p className="text-muted-foreground">Configure a personalidade do seu bot</p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={(open) => {
          setCreateDialogOpen(open);
          if (!open) setEditingPersona(null);
        }}>
          <DialogTrigger asChild>
            <Button onClick={() => setEditingPersona(null)}>
              <Plus className="h-4 w-4 mr-2" />
              Nova Persona
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingPersona ? "Editar Persona" : "Criar Nova Persona"}</DialogTitle>
              <DialogDescription>
                Configure como o bot deve se comportar e responder
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nome</Label>
                  <Input
                    value={currentData.name}
                    onChange={(e) => editingPersona 
                      ? setEditingPersona({ ...editingPersona, name: e.target.value })
                      : setNewPersona({ ...newPersona, name: e.target.value })
                    }
                    placeholder="Ex: Assistente de Vendas"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Temperatura (Criatividade)</Label>
                  <Input
                    type="number"
                    min="0"
                    max="1"
                    step="0.1"
                    value={currentData.temperature}
                    onChange={(e) => editingPersona 
                      ? setEditingPersona({ ...editingPersona, temperature: parseFloat(e.target.value) })
                      : setNewPersona({ ...newPersona, temperature: parseFloat(e.target.value) })
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Descrição</Label>
                <Input
                  value={currentData.description || ""}
                  onChange={(e) => editingPersona 
                    ? setEditingPersona({ ...editingPersona, description: e.target.value })
                    : setNewPersona({ ...newPersona, description: e.target.value })
                  }
                  placeholder="Breve descrição desta persona"
                />
              </div>
              <div className="space-y-2">
                <Label>Prompt do Sistema *</Label>
                <Textarea
                  value={currentData.system_prompt}
                  onChange={(e) => editingPersona 
                    ? setEditingPersona({ ...editingPersona, system_prompt: e.target.value })
                    : setNewPersona({ ...newPersona, system_prompt: e.target.value })
                  }
                  placeholder="Você é um assistente de vendas especializado em..."
                  className="min-h-[150px]"
                />
              </div>
              <div className="space-y-2">
                <Label>Mensagem de Boas-vindas</Label>
                <Textarea
                  value={currentData.welcome_message || ""}
                  onChange={(e) => editingPersona 
                    ? setEditingPersona({ ...editingPersona, welcome_message: e.target.value })
                    : setNewPersona({ ...newPersona, welcome_message: e.target.value })
                  }
                  placeholder="Olá! Sou o assistente virtual. Como posso ajudar?"
                />
              </div>
              <div className="space-y-2">
                <Label>Mensagem de Fallback</Label>
                <Textarea
                  value={currentData.fallback_message || ""}
                  onChange={(e) => editingPersona 
                    ? setEditingPersona({ ...editingPersona, fallback_message: e.target.value })
                    : setNewPersona({ ...newPersona, fallback_message: e.target.value })
                  }
                  placeholder="Desculpe, não entendi. Pode reformular?"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSavePersona}>
                {editingPersona ? "Salvar" : "Criar"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : personas.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Bot className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-medium mb-2">Nenhuma persona criada</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Crie uma persona para definir como o bot deve se comportar
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {personas.map((persona) => (
            <Card key={persona.id}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center",
                      persona.is_active ? "bg-primary/10" : "bg-muted"
                    )}>
                      <Bot className={cn(
                        "h-5 w-5",
                        persona.is_active ? "text-primary" : "text-muted-foreground"
                      )} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium">{persona.name}</h4>
                        {persona.is_default && (
                          <Badge variant="default" className="text-xs">Padrão</Badge>
                        )}
                        {persona.bitrix_bot_id && (
                          <Badge variant="outline" className="text-xs bg-green-100 text-green-700 border-green-300">
                            <MessageSquare className="h-3 w-3 mr-1" />
                            Bot Ativo
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {persona.description || "Sem descrição"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={persona.is_active}
                      onCheckedChange={() => handleToggleActive(persona.id, persona.is_active)}
                    />
                    {!persona.is_default && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSetDefault(persona.id)}
                      >
                        Definir Padrão
                      </Button>
                    )}
                    {persona.bitrix_bot_id ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handlePublishBot(persona.id, true)}
                          disabled={publishingBot === persona.id}
                          className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                        >
                          {publishingBot === persona.id ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-1" />
                          ) : (
                            <RotateCcw className="h-4 w-4 mr-1" />
                          )}
                          Republicar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleUnpublishBot(persona.id)}
                          disabled={publishingBot === persona.id}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          {publishingBot === persona.id ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-1" />
                          ) : (
                            <XCircle className="h-4 w-4 mr-1" />
                          )}
                          Remover
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePublishBot(persona.id)}
                        disabled={publishingBot === persona.id}
                        className="text-green-600 hover:text-green-700 hover:bg-green-50"
                      >
                        {publishingBot === persona.id ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-1" />
                        ) : (
                          <MessageSquare className="h-4 w-4 mr-1" />
                        )}
                        Publicar Bot
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditDialog(persona)}
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeletePersona(persona.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// Flows View - Manage automation flows using Edge Function
function FlowsView({ status, memberId }: { status: BitrixStatus | null; memberId: string | null }) {
  const [flows, setFlows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newFlow, setNewFlow] = useState({ name: "", description: "", trigger_type: "keyword", trigger_value: "", intent_triggers: "" });

  useEffect(() => {
    if (memberId) {
      fetchFlows();
    } else {
      setLoading(false);
    }
  }, [memberId]);

  const fetchFlows = async () => {
    if (!memberId) return;
    
    try {
      const result = await callBitrixData("get_flows", memberId);
      if (result.error) throw new Error(result.error);
      setFlows(result.data || []);
    } catch (err: any) {
      console.error("Error fetching flows:", err);
      toast.error("Erro ao carregar fluxos: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFlow = async () => {
    if (!newFlow.name.trim()) {
      toast.error("Nome do fluxo é obrigatório");
      return;
    }

    if (!memberId) {
      toast.error("Sessão não identificada");
      return;
    }

    try {
      const result = await callBitrixData("create_flow", memberId, {
        name: newFlow.name,
        description: newFlow.description,
        trigger_type: newFlow.trigger_type,
        trigger_value: newFlow.trigger_value || null
      });

      if (result.error) throw new Error(result.error);

      toast.success("Fluxo criado com sucesso!");
      setCreateDialogOpen(false);
      setNewFlow({ name: "", description: "", trigger_type: "keyword", trigger_value: "", intent_triggers: "" });
      fetchFlows();
    } catch (err: any) {
      toast.error("Erro ao criar fluxo: " + err.message);
    }
  };

  const handleToggleFlow = async (flowId: string, isActive: boolean) => {
    if (!memberId) return;
    
    try {
      const result = await callBitrixData("update_flow", memberId, {
        id: flowId,
        is_active: !isActive
      });

      if (result.error) throw new Error(result.error);

      toast.success(isActive ? "Fluxo desativado" : "Fluxo ativado");
      fetchFlows();
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    }
  };

  const handleDeleteFlow = async (flowId: string) => {
    if (!confirm("Tem certeza que deseja excluir este fluxo?")) return;
    if (!memberId) return;

    try {
      const result = await callBitrixData("delete_flow", memberId, { id: flowId });

      if (result.error) throw new Error(result.error);

      toast.success("Fluxo excluído");
      fetchFlows();
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    }
  };

  const triggerTypeLabels: Record<string, string> = {
    keyword: "Palavra-chave",
    first_message: "Primeira mensagem",
    all_messages: "Todas as mensagens",
    intent: "Intenção IA"
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Fluxos de Automação</h1>
          <p className="text-muted-foreground">Configure quando o bot deve seguir fluxos específicos</p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Novo Fluxo
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Criar Novo Fluxo</DialogTitle>
              <DialogDescription>
                Configure como e quando este fluxo será acionado
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nome do Fluxo</Label>
                <Input
                  value={newFlow.name}
                  onChange={(e) => setNewFlow({ ...newFlow, name: e.target.value })}
                  placeholder="Ex: Agendamento de Consulta"
                />
              </div>
              <div className="space-y-2">
                <Label>Descrição</Label>
                <Textarea
                  value={newFlow.description}
                  onChange={(e) => setNewFlow({ ...newFlow, description: e.target.value })}
                  placeholder="Descreva o objetivo deste fluxo"
                />
              </div>
              <div className="space-y-2">
                <Label>Tipo de Gatilho</Label>
                <Select
                  value={newFlow.trigger_type}
                  onValueChange={(v) => setNewFlow({ ...newFlow, trigger_type: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keyword">Palavra-chave</SelectItem>
                    <SelectItem value="first_message">Primeira mensagem</SelectItem>
                    <SelectItem value="all_messages">Todas as mensagens</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {newFlow.trigger_type === "keyword" && (
                <div className="space-y-2">
                  <Label>Palavras-chave (separadas por vírgula)</Label>
                  <Input
                    value={newFlow.trigger_value}
                    onChange={(e) => setNewFlow({ ...newFlow, trigger_value: e.target.value })}
                    placeholder="agendar, marcar, consulta"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label>Gatilhos por Intenção IA (opcional)</Label>
                <Input
                  value={newFlow.intent_triggers}
                  onChange={(e) => setNewFlow({ ...newFlow, intent_triggers: e.target.value })}
                  placeholder="agendamento, suporte, vendas"
                />
                <p className="text-xs text-muted-foreground">
                  A IA detectará automaticamente a intenção do cliente e acionará o fluxo
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleCreateFlow}>
                Criar Fluxo
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : flows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <GitBranch className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-medium mb-2">Nenhum fluxo criado</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Crie fluxos para automatizar conversas específicas como agendamentos, suporte, etc.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {flows.map((flow) => (
            <Card key={flow.id}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center",
                      flow.is_active ? "bg-green-500/10" : "bg-muted"
                    )}>
                      <GitBranch className={cn(
                        "h-5 w-5",
                        flow.is_active ? "text-green-500" : "text-muted-foreground"
                      )} />
                    </div>
                    <div>
                      <h4 className="font-medium">{flow.name}</h4>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Badge variant="secondary" className="text-xs">
                          {triggerTypeLabels[flow.trigger_type] || flow.trigger_type}
                        </Badge>
                        {flow.trigger_value && (
                          <span className="text-xs">{flow.trigger_value}</span>
                        )}
                        {flow.intent_triggers?.length > 0 && (
                          <Badge variant="outline" className="text-xs">
                            IA: {flow.intent_triggers.join(", ")}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={flow.is_active}
                      onCheckedChange={() => handleToggleFlow(flow.id, flow.is_active)}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteFlow(flow.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">
            Para edição avançada de fluxos com editor visual, acesse{" "}
            <a 
              href="https://chat.thoth24.com/flows" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              chat.thoth24.com/flows
            </a>
          </p>
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

      // Workspace check removed - no longer required

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
            <span className="text-muted-foreground">Status</span>
            {status?.is_active ? (
              <Badge variant="default" className="bg-green-500">Ativo</Badge>
            ) : (
              <Badge variant="secondary">Inativo</Badge>
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

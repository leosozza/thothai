import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle, Loader2, MessageSquare, Phone, AlertCircle, RefreshCw, Zap, XCircle } from "lucide-react";
import { toast } from "sonner";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

interface Instance {
  id: string;
  name: string;
  phone_number: string | null;
  status: string;
}

interface BitrixStatus {
  found: boolean;
  integration_id?: string;
  domain?: string;
  registered?: boolean;
  instance_id?: string;
  is_active?: boolean;
  instances?: Instance[];
  has_access_token?: boolean;
  connector_active?: boolean;
  auto_setup_complete?: boolean;
}

type SetupStep = "loading" | "selecting" | "connecting" | "connected" | "error";

export default function Bitrix24Setup() {
  const [step, setStep] = useState<SetupStep>("loading");
  const [memberId, setMemberId] = useState<string | null>(null);
  const [domain, setDomain] = useState<string | null>(null);
  const [status, setStatus] = useState<BitrixStatus | null>(null);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [integrationId, setIntegrationId] = useState<string | null>(null);
  
  
  // Connection states
  const [connecting, setConnecting] = useState(false);
  const installFinishCalled = useRef(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [forceSyncing, setForceSyncing] = useState(false);
  const [appInstalled, setAppInstalled] = useState<boolean | null>(null);
  const [appInfo, setAppInfo] = useState<any>(null);

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
        console.log("BX24 SDK detected, initializing...");
        // @ts-ignore
        window.BX24.init(() => {
          console.log("BX24.init() completed");
          // @ts-ignore
          window.BX24.fitWindow();
          
          // CRITICAL: Call installFinish immediately after init
          // This tells Bitrix24 the app installation is complete
          try {
            // @ts-ignore
            window.BX24.installFinish();
            installFinishCalled.current = true;
            console.log("BX24.installFinish() called immediately after init");
          } catch (installErr) {
            console.log("BX24.installFinish() error:", installErr);
          }
          
          // @ts-ignore
          window.BX24.callMethod("app.info", {}, (result: any) => {
            const appInfoData = result.data();
            console.log("app.info result:", appInfoData);
            if (appInfoData?.member_id) setMemberId(appInfoData.member_id);
            if (appInfoData?.DOMAIN) setDomain(appInfoData.DOMAIN);
            
            // If app is not marked as INSTALLED, try installFinish again
            if (appInfoData && !appInfoData.INSTALLED) {
              console.log("App not marked as INSTALLED, retrying installFinish...");
              try {
                // @ts-ignore
                window.BX24.installFinish();
                console.log("BX24.installFinish() retry completed");
              } catch (retryErr) {
                console.log("BX24.installFinish() retry error:", retryErr);
              }
            }
          });
        });
      } else {
        console.log("BX24 SDK not available on window");
      }
    } catch (e) {
      console.log("Bitrix24 SDK initialization error:", e);
    }
  };

  // CRITICAL: Notify Bitrix24 that installation is complete
  // Without this, Bitrix24 will NOT send events to our handlers
  const notifyInstallFinish = useCallback(() => {
    if (installFinishCalled.current) return;
    
    try {
      // @ts-ignore - Bitrix24 JS SDK
      if (window.BX24) {
        // @ts-ignore
        window.BX24.installFinish();
        installFinishCalled.current = true;
        console.log("BX24.installFinish() called successfully");
      }
    } catch (e) {
      console.log("BX24.installFinish() not available:", e);
    }
  }, []);

  // Load data when memberId is available
  useEffect(() => {
    if (memberId) {
      loadData();
    } else {
      const timer = setTimeout(() => {
        if (!memberId && !domain) {
          setError("Identificação do Bitrix24 não encontrada. Acesse esta página a partir do Bitrix24.");
          setStep("error");
        }
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [memberId, domain]);

  const loadData = useCallback(async () => {
    try {
      setStep("loading");
      setError(null);
      
      const currentMemberId = memberId || domain;
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/bitrix24-install?member_id=${encodeURIComponent(currentMemberId || "")}&include_instances=true`
      );

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data: BitrixStatus = await response.json();
      setStatus(data);
      
      if (data.domain) setDomain(data.domain);
      if (data.instance_id) setSelectedInstance(data.instance_id);
      if (data.instances?.length) setInstances(data.instances);
      if (data.integration_id) setIntegrationId(data.integration_id);

      // Determine step based on status
      // Consider connected if:
      // 1. auto_setup_complete is true AND has instance_id, OR
      // 2. has_access_token AND instance_id AND registered (fallback for older integrations)
      const isConnected = 
        (data.auto_setup_complete && data.instance_id) ||
        (data.has_access_token && data.instance_id && data.registered);
      
      if (isConnected) {
        // CRITICAL: Notify Bitrix24 installation is complete when already connected
        notifyInstallFinish();
        setStep("connected");
      } else if (data.found && data.has_access_token && data.instances?.length) {
        // Integration exists with access token - select instance
        if (data.instances.length === 1) {
          setSelectedInstance(data.instances[0].id);
          setStep("selecting");
        } else {
          setStep("selecting");
        }
      } else if (!data.found || !data.has_access_token) {
        // Integration not found or no access token - show error
        setError("Integração não encontrada ou token expirado. Reinstale o app no Bitrix24.");
        setStep("error");
      } else {
        setStep("selecting");
      }
    } catch (err) {
      console.error("Error loading data:", err);
      setError("Erro ao carregar dados. Verifique se o aplicativo foi instalado.");
      setStep("error");
    }
  }, [memberId, domain]);

  

  const handleAutoSetup = async (integrationIdParam?: string, instanceIdParam?: string) => {
    const effectiveIntegrationId = integrationIdParam || integrationId;
    const effectiveInstanceId = instanceIdParam || selectedInstance;

    if (!effectiveInstanceId) {
      toast.error("Selecione uma instância WhatsApp");
      return;
    }

    if (!effectiveIntegrationId) {
      toast.error("Integração não encontrada");
      return;
    }

    try {
      setConnecting(true);
      setStep("connecting");

      const response = await fetch(`${SUPABASE_URL}/functions/v1/bitrix24-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "auto_setup",
          integration_id: effectiveIntegrationId,
          instance_id: effectiveInstanceId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Erro na configuração automática");
      }

      // Accept partial success if auto_setup_completed is true
      if (data?.success) {
        toast.success("Conectado com sucesso!");
        // CRITICAL: Notify Bitrix24 installation is complete to enable events
        notifyInstallFinish();
        setStep("connected");
        await loadData();
      } else if (data?.results?.connector_registered && data?.results?.events_bound > 0) {
        // Partial success - connector registered and events bound, but line may not verify as active immediately
        toast.success("Conectado! A ativação pode levar alguns segundos.");
        // CRITICAL: Notify Bitrix24 installation is complete to enable events
        notifyInstallFinish();
        setStep("connected");
        await loadData();
      } else {
        throw new Error(data?.error || data?.message || "Erro na configuração");
      }
    } catch (err: any) {
      console.error("Error in auto setup:", err);
      toast.error(err.message || "Erro na configuração automática");
      setStep("selecting");
    } finally {
      setConnecting(false);
    }
  };

  const handleReconnect = async () => {
    setReconnecting(true);
    try {
      await handleAutoSetup();
    } finally {
      setReconnecting(false);
    }
  };

  // Check if app is marked as INSTALLED in Bitrix24
  const checkAppInstalled = useCallback(async () => {
    if (!integrationId) return;
    
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/bitrix24-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "check_app_installed",
          integration_id: integrationId,
        }),
      });
      
      const data = await response.json();
      console.log("App installed check:", data);
      
      setAppInstalled(data.app_installed ?? false);
      setAppInfo(data.app_info);
      
      // If app is NOT installed, try to call installFinish again
      if (!data.app_installed && !installFinishCalled.current) {
        console.log("App not marked as installed, calling BX24.installFinish()...");
        notifyInstallFinish();
      }
    } catch (err) {
      console.error("Error checking app installed:", err);
    }
  }, [integrationId, notifyInstallFinish]);

  // Force reinstall events to make Bitrix24 re-evaluate the installation
  const handleForceSync = async () => {
    if (!integrationId) {
      toast.error("Integração não encontrada");
      return;
    }
    
    try {
      setForceSyncing(true);
      
      // Step 1: Call installFinish via BX24 SDK
      notifyInstallFinish();
      
      // Step 2: Force reinstall events via API
      const response = await fetch(`${SUPABASE_URL}/functions/v1/bitrix24-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "force_reinstall_events",
          integration_id: integrationId,
        }),
      });
      
      const data = await response.json();
      console.log("Force reinstall result:", data);
      
      if (data.success) {
        toast.success("Sincronização forçada concluída! Eventos reconfigurados.");
        
        // Check app status again
        await checkAppInstalled();
        
        // Reload data
        await loadData();
      } else {
        toast.error(data.error || "Erro na sincronização forçada");
      }
    } catch (err: any) {
      console.error("Error in force sync:", err);
      toast.error(err.message || "Erro na sincronização forçada");
    } finally {
      setForceSyncing(false);
    }
  };

  // Check app installed status when connected
  useEffect(() => {
    if (step === "connected" && integrationId) {
      checkAppInstalled();
    }
  }, [step, integrationId, checkAppInstalled]);

  const getInstanceName = (instanceId: string) => {
    const instance = instances.find(i => i.id === instanceId);
    return instance?.name || instance?.phone_number || "WhatsApp";
  };

  // Render based on step
  if (step === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">Carregando configuração...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
              <XCircle className="h-8 w-8 text-destructive" />
            </div>
            <CardTitle>Erro de Configuração</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button onClick={loadData} variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" />
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === "connected") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="w-20 h-20 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="h-10 w-10 text-green-500" />
            </div>
            <CardTitle className="text-xl">WhatsApp Conectado!</CardTitle>
            <CardDescription>
              Seu Bitrix24 está integrado com o WhatsApp via Thoth
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Status info */}
            <div className="bg-muted/50 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Portal Bitrix24</span>
                <Badge variant="outline">{domain}</Badge>
              </div>
              {status?.instance_id && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Instância WhatsApp</span>
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-green-500" />
                    <span className="font-medium">{getInstanceName(status.instance_id)}</span>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge className="bg-green-500/10 text-green-600 hover:bg-green-500/20">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Ativo
                </Badge>
              </div>
            </div>

            {/* App Installation Status */}
            {appInstalled !== null && (
              <div className={`rounded-lg p-3 ${appInstalled ? 'bg-green-500/10' : 'bg-yellow-500/10'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Status da Instalação</span>
                  <Badge variant={appInstalled ? "default" : "secondary"} className={appInstalled ? "bg-green-500" : "bg-yellow-500"}>
                    {appInstalled ? (
                      <>
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Instalado
                      </>
                    ) : (
                      <>
                        <AlertCircle className="h-3 w-3 mr-1" />
                        Pendente
                      </>
                    )}
                  </Badge>
                </div>
                {!appInstalled && (
                  <p className="text-xs text-muted-foreground mt-2">
                    O Bitrix24 ainda não confirmou a instalação. Clique em "Forçar Sincronização" para resolver.
                  </p>
                )}
              </div>
            )}

            {/* Instructions */}
            <div className="bg-primary/5 rounded-lg p-4">
              <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-primary" />
                Como usar
              </h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Mensagens do WhatsApp aparecerão no Chat do Bitrix24</li>
                <li>• Responda diretamente pelo Bitrix24</li>
                <li>• Contatos serão sincronizados automaticamente</li>
              </ul>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                className="flex-1" 
                onClick={handleReconnect}
                disabled={reconnecting || forceSyncing}
              >
                {reconnecting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Reconectar
              </Button>
              <Button 
                variant={appInstalled === false ? "default" : "outline"}
                className="flex-1" 
                onClick={handleForceSync}
                disabled={forceSyncing || reconnecting}
              >
                {forceSyncing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4 mr-2" />
                )}
                Forçar Sincronização
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  

  if (step === "selecting" || step === "connecting") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Phone className="h-8 w-8 text-primary" />
            </div>
            <CardTitle>Selecione o WhatsApp</CardTitle>
            <CardDescription>
              Escolha qual instância WhatsApp conectar ao Bitrix24
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Instância WhatsApp</Label>
              <Select value={selectedInstance} onValueChange={setSelectedInstance}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma instância" />
                </SelectTrigger>
                <SelectContent>
                  {instances.map((instance) => (
                    <SelectItem key={instance.id} value={instance.id}>
                      <div className="flex items-center gap-2">
                        <Phone className="h-4 w-4" />
                        <span>{instance.name}</span>
                        {instance.phone_number && (
                          <span className="text-muted-foreground">
                            ({instance.phone_number})
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button 
              onClick={() => handleAutoSetup()} 
              className="w-full"
              disabled={connecting || !selectedInstance}
            >
              {connecting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Configurando...
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4 mr-2" />
                  Conectar Automaticamente
                </>
              )}
            </Button>

            {step === "connecting" && (
              <div className="text-center text-sm text-muted-foreground">
                <p>Registrando conector no Bitrix24...</p>
                <p>Criando canal de comunicação...</p>
                <p>Ativando integração...</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}

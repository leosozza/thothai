import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle, Loader2, MessageSquare, Phone, AlertCircle, RefreshCw, Zap, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { BX24Result, BX24AppInfo } from "@/types/bitrix24";

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
  requires_token?: boolean;
  workspace_id?: string;
  has_access_token?: boolean;
  connector_active?: boolean;
  auto_setup_complete?: boolean;
}

type SetupStep = "loading" | "token" | "selecting" | "connecting" | "connected" | "error";

export default function Bitrix24Setup() {
  const [step, setStep] = useState<SetupStep>("loading");
  const [memberId, setMemberId] = useState<string | null>(null);
  const [domain, setDomain] = useState<string | null>(null);
  const [status, setStatus] = useState<BitrixStatus | null>(null);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [integrationId, setIntegrationId] = useState<string | null>(null);
  
  // Token for workspace linking
  const [linkingToken, setLinkingToken] = useState<string>("");
  const [validatingToken, setValidatingToken] = useState(false);
  
  // Connection states
  const [connecting, setConnecting] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

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
      // @ts-expect-error - Bitrix24 JS SDK types are defined but window.BX24 may not be loaded yet
      if (window.BX24) {
        // @ts-expect-error - window.BX24 is checked above
        window.BX24.init(() => {
          // @ts-expect-error - window.BX24 is checked above
          window.BX24.callMethod<BX24AppInfo>("app.info", {}, (result: BX24Result<BX24AppInfo>) => {
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
      // Accept as connected if auto_setup_complete is true and has instance_id
      // (even if connector_active is false - it may take time to sync)
      if (data.auto_setup_complete && data.instance_id) {
        setStep("connected");
      } else if (data.workspace_id && data.instances?.length) {
        // Has workspace but not fully connected
        if (data.instances.length === 1) {
          // Auto-select single instance and connect
          setSelectedInstance(data.instances[0].id);
          setStep("selecting");
        } else {
          setStep("selecting");
        }
      } else if (data.requires_token || !data.workspace_id) {
        setStep("token");
      } else {
        setStep("selecting");
      }
    } catch (err) {
      console.error("Error loading data:", err);
      setError("Erro ao carregar dados. Verifique se o aplicativo foi instalado.");
      setStep("error");
    }
  }, [memberId, domain]);

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
        toast.success("Token validado! Configurando automaticamente...");
        
        if (data.instances) setInstances(data.instances);
        if (data.integration_id) setIntegrationId(data.integration_id);
        
        // If only one instance, auto-connect
        if (data.instances?.length === 1) {
          setSelectedInstance(data.instances[0].id);
          await handleAutoSetup(data.integration_id, data.instances[0].id);
        } else if (data.instances?.length > 1) {
          setStep("selecting");
        } else {
          toast.error("Nenhuma instância WhatsApp encontrada. Crie uma instância primeiro.");
          setStep("error");
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Erro ao validar token";
      toast.error(errorMessage);
    } finally {
      setValidatingToken(false);
    }
  };

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
        setStep("connected");
        await loadData();
      } else if (data?.results?.connector_registered && data?.results?.events_bound > 0) {
        // Partial success - connector registered and events bound, but line may not verify as active immediately
        toast.success("Conectado! A ativação pode levar alguns segundos.");
        setStep("connected");
        await loadData();
      } else {
        throw new Error(data?.error || data?.message || "Erro na configuração");
      }
    } catch (err) {
      console.error("Error in auto setup:", err);
      const errorMessage = err instanceof Error ? err.message : "Erro na configuração automática";
      toast.error(errorMessage);
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

            {/* Reconnect button (only if issues) */}
            <Button 
              variant="outline" 
              className="w-full" 
              onClick={handleReconnect}
              disabled={reconnecting}
            >
              {reconnecting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Reconectar
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === "token") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Zap className="h-8 w-8 text-primary" />
            </div>
            <CardTitle>Vincular Workspace</CardTitle>
            <CardDescription>
              Cole o token gerado na página de Integrações do Thoth
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
                Gere o token em Integrações → Bitrix24 → Gerar Token
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
                <CheckCircle className="h-4 w-4 mr-2" />
              )}
              Validar e Conectar
            </Button>
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

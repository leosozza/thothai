import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Loader2, MessageSquare, Phone, AlertCircle, Plug } from "lucide-react";
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
  domain?: string;
  registered?: boolean;
  instance_id?: string;
  is_active?: boolean;
  instances?: Instance[];
}

export default function Bitrix24Setup() {
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [domain, setDomain] = useState<string | null>(null);
  const [status, setStatus] = useState<BitrixStatus | null>(null);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Extract params from URL (provided by Bitrix24 iframe)
    const params = new URLSearchParams(window.location.search);
    const memberIdParam = params.get("member_id");
    const domainParam = params.get("DOMAIN");

    console.log("Bitrix24Setup: URL params", { memberIdParam, domainParam });

    if (memberIdParam) {
      setMemberId(memberIdParam);
    }
    if (domainParam) {
      setDomain(domainParam);
      // If we have domain but no member_id, try to use domain as identifier
      if (!memberIdParam) {
        setMemberId(domainParam);
      }
    }

    // Try to get from Bitrix24 JS SDK
    initBitrix24SDK();
  }, []);

  const initBitrix24SDK = () => {
    try {
      // @ts-ignore - Bitrix24 JS SDK
      if (window.BX24) {
        console.log("Bitrix24 SDK found, initializing...");
        // @ts-ignore
        window.BX24.init(() => {
          console.log("Bitrix24 SDK initialized");
          
          // @ts-ignore
          window.BX24.callMethod("app.info", {}, (result: any) => {
            const appInfo = result.data();
            console.log("Bitrix24 app.info:", appInfo);
            
            if (appInfo?.member_id) {
              setMemberId(appInfo.member_id);
            }
            if (appInfo?.DOMAIN) {
              setDomain(appInfo.DOMAIN);
            }
          });
        });
      } else {
        console.log("Bitrix24 SDK not found, using URL params only");
        // Load data after a short delay to ensure URL params are set
        setTimeout(() => loadData(), 100);
      }
    } catch (e) {
      console.log("Error initializing Bitrix24 SDK:", e);
      setTimeout(() => loadData(), 100);
    }
  };

  useEffect(() => {
    if (memberId) {
      console.log("Member ID set, loading data:", memberId);
      loadData();
    }
  }, [memberId]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Fetch status and instances from Edge Function
      const currentMemberId = memberId || domain;
      console.log("Fetching Bitrix24 status for:", currentMemberId);
      
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/bitrix24-install?member_id=${encodeURIComponent(currentMemberId || "")}&include_instances=true`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data: BitrixStatus = await response.json();
      console.log("Bitrix24 status response:", data);
      
      setStatus(data);
      
      if (data.domain) {
        setDomain(data.domain);
      }
      if (data.instance_id) {
        setSelectedInstance(data.instance_id);
      }
      if (data.instances) {
        setInstances(data.instances);
      }
    } catch (err) {
      console.error("Error loading data:", err);
      setError("Erro ao carregar dados. Verifique se o aplicativo foi instalado corretamente.");
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterConnector = async () => {
    if (!memberId || !selectedInstance) {
      toast.error("Selecione uma instância WhatsApp");
      return;
    }

    try {
      setRegistering(true);

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/bitrix24-register`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            member_id: memberId,
            instance_id: selectedInstance,
            connector_id: `thoth_whatsapp_${memberId.substring(0, 8)}`,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Erro ao registrar conector");
      }

      if (data?.success) {
        toast.success("Conector WhatsApp ativado com sucesso!");
        await loadData();
      } else {
        throw new Error(data?.error || "Erro ao registrar conector");
      }
    } catch (err: any) {
      console.error("Error registering connector:", err);
      toast.error(err.message || "Erro ao ativar conector");
    } finally {
      setRegistering(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Carregando configurações...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center space-y-4">
              <AlertCircle className="h-12 w-12 text-destructive" />
              <p className="text-muted-foreground">{error}</p>
              <Button onClick={loadData}>Tentar novamente</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2">
            <MessageSquare className="h-8 w-8 text-primary" />
            <h1 className="text-2xl font-bold">Thoth WhatsApp</h1>
          </div>
          <p className="text-muted-foreground">
            Conecte seu WhatsApp ao Bitrix24 Open Channels
          </p>
        </div>

        {/* Debug Info (only in development) */}
        {import.meta.env.DEV && (
          <Card className="bg-muted/50">
            <CardContent className="pt-4 text-xs font-mono">
              <p>member_id: {memberId || "null"}</p>
              <p>domain: {domain || "null"}</p>
              <p>status.found: {String(status?.found)}</p>
            </CardContent>
          </Card>
        )}

        {/* Connection Status */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Plug className="h-5 w-5" />
              Status da Conexão
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {domain && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Portal Bitrix24</span>
                <Badge variant="outline">{domain}</Badge>
              </div>
            )}
            
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">App Instalado</span>
              {status?.found ? (
                <Badge variant="default" className="bg-green-500">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Sim
                </Badge>
              ) : (
                <Badge variant="secondary">Pendente</Badge>
              )}
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Conector Registrado</span>
              {status?.registered ? (
                <Badge variant="default" className="bg-green-500">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Ativo
                </Badge>
              ) : (
                <Badge variant="secondary">Não configurado</Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Instance Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Phone className="h-5 w-5" />
              Instância WhatsApp
            </CardTitle>
            <CardDescription>
              Selecione qual número WhatsApp será conectado ao Bitrix24
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {instances.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-muted-foreground text-sm">
                  Nenhuma instância WhatsApp conectada.
                </p>
                <p className="text-muted-foreground text-sm">
                  Configure uma instância no painel Thoth primeiro.
                </p>
                <Button 
                  variant="link" 
                  className="mt-2"
                  onClick={() => window.open("https://chat.thoth24.com/instances", "_blank")}
                >
                  Abrir Painel Thoth
                </Button>
              </div>
            ) : (
              <>
                <Select value={selectedInstance} onValueChange={setSelectedInstance}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione uma instância" />
                  </SelectTrigger>
                  <SelectContent>
                    {instances.map((instance) => (
                      <SelectItem key={instance.id} value={instance.id}>
                        <div className="flex items-center gap-2">
                          <span>{instance.name}</span>
                          {instance.phone_number && (
                            <span className="text-muted-foreground text-sm">
                              ({instance.phone_number})
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button
                  className="w-full"
                  onClick={handleRegisterConnector}
                  disabled={!selectedInstance || registering || status?.registered}
                >
                  {registering ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Ativando...
                    </>
                  ) : status?.registered ? (
                    <>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Conector Ativo
                    </>
                  ) : (
                    "Ativar Conector WhatsApp"
                  )}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* Help */}
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground text-center">
              Após ativar, as mensagens do WhatsApp aparecerão automaticamente
              no Open Channels do Bitrix24.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

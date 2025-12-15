import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle, Loader2, MessageSquare, Phone, AlertCircle, Plug, Key, TestTube, XCircle } from "lucide-react";
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
  requires_token?: boolean;
  workspace_id?: string;
}

export default function Bitrix24Setup() {
const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [validatingToken, setValidatingToken] = useState(false);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [domain, setDomain] = useState<string | null>(null);
  const [status, setStatus] = useState<BitrixStatus | null>(null);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  
  // Token de vinculação
  const [linkingToken, setLinkingToken] = useState<string>("");
  const [tokenValidated, setTokenValidated] = useState(false);
  
  // Webhook URL para apps locais
  const [webhookUrl, setWebhookUrl] = useState<string>(status?.domain ? "" : "");
  const [webhookSaved, setWebhookSaved] = useState(false);
  
  // OAuth manual (fallback)
  const [showOAuthForm, setShowOAuthForm] = useState(false);
  const [clientId, setClientId] = useState<string>("");
  const [clientSecret, setClientSecret] = useState<string>("");
  const [savingOAuth, setSavingOAuth] = useState(false);

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
        // Don't call loadData here - let useEffect handle it when memberId is set
      }
    } catch (e) {
      console.log("Error initializing Bitrix24 SDK:", e);
      // Don't call loadData here - let useEffect handle it when memberId is set
    }
  };

  useEffect(() => {
    if (memberId) {
      console.log("Member ID set, loading data:", memberId);
      loadData();
    } else {
      // If no memberId after initial load, wait and show error
      const timer = setTimeout(() => {
        if (!memberId && !domain) {
          setError("Identificação do Bitrix24 não encontrada. Acesse esta página a partir do Bitrix24 ou use o link correto.");
          setLoading(false);
        }
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [memberId, domain]);

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
      if (data.instances && data.instances.length > 0) {
        setInstances(data.instances);
        setTokenValidated(true); // Se temos instâncias, o workspace já está vinculado
      }
      if (data.workspace_id) {
        setTokenValidated(true);
      }
    } catch (err) {
      console.error("Error loading data:", err);
      setError("Erro ao carregar dados. Verifique se o aplicativo foi instalado corretamente.");
    } finally {
      setLoading(false);
    }
  };

  const handleValidateToken = async () => {
    if (!linkingToken.trim()) {
      toast.error("Digite o token de vinculação");
      return;
    }

    if (!memberId && !domain) {
      toast.error("Identificação do Bitrix24 não encontrada");
      return;
    }

    try {
      setValidatingToken(true);

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/bitrix24-install`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "validate_token",
            token: linkingToken.trim().toUpperCase(),
            member_id: memberId,
            domain: domain,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Token inválido ou expirado");
      }

      if (data?.success) {
        toast.success("Token validado! Workspace vinculado com sucesso.");
        setTokenValidated(true);
        if (data.instances) {
          setInstances(data.instances);
        }
        // Reload data to get updated status
        await loadData();
      } else {
        throw new Error(data?.error || "Token inválido");
      }
    } catch (err: any) {
      console.error("Error validating token:", err);
      toast.error(err.message || "Erro ao validar token");
    } finally {
      setValidatingToken(false);
    }
  };

  const handleSaveWebhook = async () => {
    if (!webhookUrl.trim()) {
      toast.error("Digite a URL do webhook de entrada");
      return;
    }

    // Validar formato da URL de webhook de entrada (inbound)
    if (!webhookUrl.includes("/rest/") || !webhookUrl.includes("bitrix24")) {
      toast.error("URL inválida. A URL deve ser um webhook de entrada do Bitrix24 (formato: https://xxx.bitrix24.com/rest/1/xxxxx/)");
      return;
    }

    if (!memberId && !domain) {
      toast.error("Identificação do Bitrix24 não encontrada");
      return;
    }

    try {
      setSavingWebhook(true);

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/bitrix24-install`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "save_webhook",
            webhook_url: webhookUrl.trim(),
            member_id: memberId,
            domain: domain,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Erro ao salvar webhook");
      }

      if (data?.success) {
        toast.success("Webhook salvo! Agora vincule seu workspace.");
        setWebhookSaved(true);
        await loadData();
      } else {
        throw new Error(data?.error || "Erro ao salvar webhook");
      }
    } catch (err: any) {
      console.error("Error saving webhook:", err);
      toast.error(err.message || "Erro ao salvar webhook");
    } finally {
      setSavingWebhook(false);
    }
  };

  const handleTestConnection = async () => {
    const urlToTest = webhookUrl.trim();
    
    if (!urlToTest) {
      toast.error("Digite a URL do webhook de entrada primeiro");
      return;
    }

    // Validar formato da URL
    if (!urlToTest.includes("/rest/") || !urlToTest.includes("bitrix24")) {
      toast.error("URL inválida. Use o formato: https://xxx.bitrix24.com/rest/1/xxxxx/");
      return;
    }

    try {
      setTestingConnection(true);
      setConnectionTestResult(null);

      // Testar chamando um método simples da API do Bitrix24
      const testUrl = urlToTest.endsWith("/") ? `${urlToTest}profile` : `${urlToTest}/profile`;
      
      console.log("Testing Bitrix24 connection:", testUrl);

      const response = await fetch(testUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = await response.json();
      console.log("Bitrix24 test response:", data);

      if (data.result) {
        // Conexão bem sucedida
        const userName = data.result.NAME || data.result.LAST_NAME || "Usuário";
        setConnectionTestResult({
          success: true,
          message: `Conexão OK! Usuário: ${userName}`,
        });
        toast.success("Conexão com Bitrix24 funcionando!");
      } else if (data.error) {
        // Erro da API
        setConnectionTestResult({
          success: false,
          message: `Erro: ${data.error_description || data.error}`,
        });
        toast.error(`Erro na API: ${data.error_description || data.error}`);
      } else {
        setConnectionTestResult({
          success: false,
          message: "Resposta inesperada da API",
        });
        toast.error("Resposta inesperada do Bitrix24");
      }
    } catch (err: any) {
      console.error("Error testing connection:", err);
      setConnectionTestResult({
        success: false,
        message: err.message || "Erro de conexão",
      });
      toast.error("Erro ao conectar com Bitrix24. Verifique a URL.");
    } finally {
      setTestingConnection(false);
    }
  };

  const handleSaveOAuth = async () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      toast.error("Preencha o Client ID e Client Secret");
      return;
    }

    if (!memberId && !domain) {
      toast.error("Identificação do Bitrix24 não encontrada");
      return;
    }

    try {
      setSavingOAuth(true);

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/bitrix24-install`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "oauth_exchange",
            client_id: clientId.trim(),
            client_secret: clientSecret.trim(),
            member_id: memberId,
            domain: domain,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Erro ao configurar OAuth");
      }

      if (data?.success) {
        toast.success("OAuth configurado! Você será redirecionado para autorização...");
        // Redirect to Bitrix24 OAuth authorization
        if (data.auth_url) {
          window.location.href = data.auth_url;
        } else {
          await loadData();
        }
      } else if (data?.auth_url) {
        // Redirect to authorization
        window.location.href = data.auth_url;
      } else {
        throw new Error(data?.error || "Erro ao configurar OAuth");
      }
    } catch (err: any) {
      console.error("Error setting up OAuth:", err);
      toast.error(err.message || "Erro ao configurar OAuth");
    } finally {
      setSavingOAuth(false);
    }
  };

  const handleRegisterConnector = async () => {
    if (!selectedInstance) {
      toast.error("Selecione uma instância WhatsApp");
      return;
    }

    // Para apps locais, verificar se tem webhook_url
    const hasWebhook = webhookUrl.trim() || status?.domain;
    if (!memberId && !hasWebhook) {
      toast.error("Identificação do Bitrix24 não encontrada");
      return;
    }

    try {
      setRegistering(true);

      const payload: any = {
        instance_id: selectedInstance,
        connector_id: `thoth_whatsapp_${(memberId || domain || "local").substring(0, 8)}`,
      };

      // Usar webhook_url se disponível, senão usar member_id
      if (webhookUrl.trim()) {
        payload.webhook_url = webhookUrl.trim();
        payload.workspace_id = status?.workspace_id;
      } else if (memberId) {
        payload.member_id = memberId;
      }

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/bitrix24-register`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
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

  // Mostrar tela de vinculação de token se não tiver workspace vinculado
  const showTokenInput = !status?.found && !status?.workspace_id && !tokenValidated && instances.length === 0;

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
              <p>tokenValidated: {String(tokenValidated)}</p>
              <p>instances: {instances.length}</p>
            </CardContent>
          </Card>
        )}

        {/* Webhook URL Card - Para apps locais do Bitrix24 */}
        {showTokenInput && !webhookSaved && (
          <Card className="border-amber-500/50 bg-amber-500/5">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-amber-500" />
                Aplicação Local do Bitrix24
              </CardTitle>
              <CardDescription>
                Cole a URL do webhook de entrada (Inbound Webhook) para permitir que o Thoth se comunique com seu Bitrix24.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="webhook-url">URL do Webhook de Entrada (REST)</Label>
                <Input
                  id="webhook-url"
                  placeholder="https://seudominio.bitrix24.com.br/rest/1/abc123xyz/"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Esta URL permite chamar a API REST do Bitrix24
                </p>
              </div>

              {/* Test Connection Result */}
              {connectionTestResult && (
                <div className={`rounded-lg p-3 flex items-center gap-2 ${
                  connectionTestResult.success 
                    ? "bg-green-500/10 border border-green-500/30" 
                    : "bg-destructive/10 border border-destructive/30"
                }`}>
                  {connectionTestResult.success ? (
                    <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive shrink-0" />
                  )}
                  <span className={`text-sm ${connectionTestResult.success ? "text-green-500" : "text-destructive"}`}>
                    {connectionTestResult.message}
                  </span>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  variant="outline"
                  onClick={handleTestConnection}
                  disabled={!webhookUrl.trim() || testingConnection}
                >
                  {testingConnection ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Testando...
                    </>
                  ) : (
                    <>
                      <TestTube className="h-4 w-4 mr-2" />
                      Testar Conexão
                    </>
                  )}
                </Button>

                <Button
                  className="flex-1"
                  variant="secondary"
                  onClick={handleSaveWebhook}
                  disabled={!webhookUrl.trim() || savingWebhook || !connectionTestResult?.success}
                >
                  {savingWebhook ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    <>
                      <Plug className="h-4 w-4 mr-2" />
                      Salvar Webhook
                    </>
                  )}
                </Button>
              </div>

              {!connectionTestResult?.success && webhookUrl.trim() && (
                <p className="text-xs text-muted-foreground text-center">
                  Teste a conexão primeiro antes de salvar
                </p>
              )}

              <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground">
                <p className="font-medium mb-1">Como criar o webhook de entrada:</p>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>Acesse seu portal Bitrix24</li>
                  <li>Vá em: Desenvolvedor → Integrações → Outro → Inbound webhook</li>
                  <li>Ou: Aplicativos → Webhooks → Adicionar webhook de entrada</li>
                  <li>Selecione as permissões: imconnector, imopenlines, crm, user</li>
                  <li>Copie a URL REST gerada (formato: https://xxx.bitrix24.com/rest/1/xxxxx/)</li>
                </ol>
              </div>

              <div className="border-t pt-4 mt-4">
                <Button
                  variant="ghost"
                  className="w-full text-sm"
                  onClick={() => setShowOAuthForm(!showOAuthForm)}
                >
                  {showOAuthForm ? "Ocultar configuração OAuth" : "Ou configure OAuth manualmente (para Contact Center)"}
                </Button>
              </div>

              {showOAuthForm && (
                <div className="space-y-4 border-t pt-4">
                  <p className="text-xs text-muted-foreground">
                    Para que o conector apareça no Contact Center, você precisa configurar um aplicativo OAuth.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="client-id">Client ID (código do aplicativo)</Label>
                    <Input
                      id="client-id"
                      placeholder="local.xxxxxxxxxxxx.xxxxxxxx"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      className="font-mono text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="client-secret">Client Secret (chave do aplicativo)</Label>
                    <Input
                      id="client-secret"
                      type="password"
                      placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      className="font-mono text-sm"
                    />
                  </div>
                  <Button
                    className="w-full"
                    onClick={handleSaveOAuth}
                    disabled={!clientId.trim() || !clientSecret.trim() || savingOAuth}
                  >
                    {savingOAuth ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Configurando...
                      </>
                    ) : (
                      <>
                        <Key className="h-4 w-4 mr-2" />
                        Autorizar OAuth
                      </>
                    )}
                  </Button>
                  <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground">
                    <p className="font-medium mb-1">Onde encontrar:</p>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>Acesse: Desenvolvedor → Integrações → Meus aplicativos</li>
                      <li>Selecione seu aplicativo Thoth</li>
                      <li>Copie o "Código do aplicativo" (Client ID)</li>
                      <li>Copie a "Chave do aplicativo" (Client Secret)</li>
                    </ol>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Token Validation Card - Mostrar quando não há workspace vinculado */}
        {(showTokenInput || webhookSaved) && !tokenValidated && (
          <Card className="border-primary/50">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Key className="h-5 w-5" />
                Vincular ao Workspace
              </CardTitle>
              <CardDescription>
                Cole o token de vinculação gerado no painel Thoth para associar esta instalação ao seu workspace.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="linking-token">Token de Vinculação</Label>
                <Input
                  id="linking-token"
                  placeholder="ABCD1234EFGH5678"
                  value={linkingToken}
                  onChange={(e) => setLinkingToken(e.target.value.toUpperCase())}
                  className="font-mono text-center text-lg tracking-wider"
                  maxLength={16}
                />
                <p className="text-xs text-muted-foreground">
                  Acesse o painel Thoth → Integrações → Bitrix24 → Gerar Token
                </p>
              </div>

              <Button
                className="w-full"
                onClick={handleValidateToken}
                disabled={!linkingToken.trim() || validatingToken}
              >
                {validatingToken ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Validando...
                  </>
                ) : (
                  <>
                    <Key className="h-4 w-4 mr-2" />
                    Validar Token
                  </>
                )}
              </Button>

              <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground">
                <p className="font-medium mb-1">Como obter o token:</p>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>Acesse o painel Thoth (chat.thoth24.com)</li>
                  <li>Vá em Integrações → CRM</li>
                  <li>Clique em "Gerar Token de Vinculação"</li>
                  <li>Copie e cole o token aqui</li>
                </ol>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Connection Status - Mostrar quando token foi validado ou já há integração */}
        {(tokenValidated || status?.found) && (
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
                <span className="text-muted-foreground">Workspace Vinculado</span>
                {tokenValidated || status?.workspace_id ? (
                  <Badge variant="default" className="bg-green-500">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Sim
                  </Badge>
                ) : (
                  <Badge variant="secondary">Não vinculado</Badge>
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
        )}

        {/* Instance Selection - Mostrar quando tem instâncias disponíveis */}
        {(tokenValidated || status?.found) && (
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
                    disabled={!selectedInstance || registering}
                  >
                    {registering ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Registrando no Contact Center...
                      </>
                    ) : status?.registered ? (
                      <>
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Registrar Novamente
                      </>
                    ) : (
                      "Ativar Conector no Contact Center"
                    )}
                  </Button>
                  
                  {status?.registered && (
                    <div className="mt-3 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-center">
                      <p className="text-green-600 dark:text-green-400 text-sm">
                        ✓ O conector "Thoth WhatsApp" está disponível no Contact Center do Bitrix24!
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Vá em Contact Center → + Adicionar para configurar a linha.
                      </p>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Help */}
        <Card>
          <CardContent className="pt-6 space-y-3">
            <p className="text-sm text-muted-foreground text-center">
              Após ativar, o conector <strong>"Thoth WhatsApp"</strong> aparecerá no <strong>Contact Center</strong> do Bitrix24.
            </p>
            <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground">
              <p className="font-medium mb-1">Próximos passos:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Acesse Contact Center no menu lateral do Bitrix24</li>
                <li>Clique em "+ Adicionar" no canto superior</li>
                <li>Selecione "Thoth WhatsApp"</li>
                <li>Configure a Open Line para receber mensagens</li>
              </ol>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
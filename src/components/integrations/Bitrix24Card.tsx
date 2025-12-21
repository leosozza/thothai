import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Building2,
  CheckCircle2,
  Loader2,
  Key,
  Copy,
  RefreshCw,
  ExternalLink,
  Phone,
  AlertCircle,
  Stethoscope,
  Wrench,
  XCircle,
} from "lucide-react";

interface Integration {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown> | null;
  is_active: boolean;
}

interface Instance {
  id: string;
  name: string;
  phone_number: string | null;
  status: string;
}

interface Bitrix24CardProps {
  integration: Integration | null;
  instances: Instance[];
  workspaceId: string | undefined;
  onRefresh: () => void;
}

interface DiagnosisResult {
  connector_id: string;
  line_id: number;
  connector_registered: boolean;
  connector_active: boolean;
  connector_connection: boolean;
  events_bound: boolean;
  issues: string[];
  fixes_applied: string[];
}

export function Bitrix24Card({ integration, instances, workspaceId, onRefresh }: Bitrix24CardProps) {
  const [linkingToken, setLinkingToken] = useState<string | null>(null);
  const [generatingToken, setGeneratingToken] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(null);

  const config = integration?.config || {};
  const isConnected = integration?.is_active && config.auto_setup_completed;
  const domain = config.domain as string || "";
  const instanceId = config.instance_id as string || "";
  
  const linkedInstance = instances.find(i => i.id === instanceId);

  // Fetch existing token on mount
  useEffect(() => {
    fetchExistingToken();
  }, [workspaceId]);

  const fetchExistingToken = async () => {
    if (!workspaceId) return;

    try {
      const { data } = await supabase
        .from("workspace_tokens")
        .select("token, expires_at, is_used")
        .eq("workspace_id", workspaceId)
        .eq("token_type", "bitrix24")
        .eq("is_used", false)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        setLinkingToken(data.token);
      }
    } catch (error) {
      console.error("Error fetching token:", error);
    }
  };

  const handleGenerateToken = async () => {
    if (!workspaceId) {
      toast.error("Workspace não encontrado");
      return;
    }

    setGeneratingToken(true);
    try {
      const token = crypto.randomUUID().replace(/-/g, "").substring(0, 8).toUpperCase();

      const { error } = await supabase
        .from("workspace_tokens")
        .insert({
          workspace_id: workspaceId,
          token,
          token_type: "bitrix24",
        });

      if (error) throw error;

      setLinkingToken(token);
      toast.success("Token gerado!");
    } catch (error) {
      console.error("Error generating token:", error);
      toast.error("Erro ao gerar token");
    } finally {
      setGeneratingToken(false);
    }
  };

  const handleReconnect = async () => {
    if (!integration?.id || !instanceId) {
      toast.error("Dados da integração não disponíveis");
      return;
    }

    setReconnecting(true);
    try {
      const response = await supabase.functions.invoke("bitrix24-webhook", {
        body: {
          action: "auto_setup",
          integration_id: integration.id,
          instance_id: instanceId,
        }
      });

      if (response.data?.success) {
        toast.success("Reconectado com sucesso!");
        onRefresh();
      } else {
        toast.error(response.data?.error || "Erro ao reconectar");
      }
    } catch (error) {
      console.error("Error reconnecting:", error);
      toast.error("Erro ao reconectar");
    } finally {
      setReconnecting(false);
    }
  };

  const handleDiagnose = async () => {
    if (!integration?.id) {
      toast.error("Integração não encontrada");
      return;
    }

    setDiagnosing(true);
    setDiagnosis(null);
    
    try {
      const response = await supabase.functions.invoke("bitrix24-webhook", {
        body: {
          action: "diagnose_connector",
          integration_id: integration.id,
          auto_fix: false,
        }
      });

      if (response.data?.success) {
        setDiagnosis(response.data.diagnosis);
        if (response.data.healthy) {
          toast.success("Conector funcionando corretamente!");
        } else {
          toast.warning(`${response.data.diagnosis.issues.length} problema(s) encontrado(s)`);
        }
      } else {
        toast.error(response.data?.error || "Erro ao diagnosticar");
      }
    } catch (error) {
      console.error("Error diagnosing:", error);
      toast.error("Erro ao diagnosticar");
    } finally {
      setDiagnosing(false);
    }
  };

  const handleAutoFix = async () => {
    if (!integration?.id) {
      toast.error("Integração não encontrada");
      return;
    }

    setFixing(true);
    
    try {
      const response = await supabase.functions.invoke("bitrix24-webhook", {
        body: {
          action: "diagnose_connector",
          integration_id: integration.id,
          auto_fix: true,
        }
      });

      if (response.data?.success) {
        setDiagnosis(response.data.diagnosis);
        if (response.data.diagnosis.fixes_applied.length > 0) {
          toast.success(`${response.data.diagnosis.fixes_applied.length} correção(ões) aplicada(s)!`);
        }
        if (response.data.healthy) {
          toast.success("Conector corrigido e funcionando!");
        } else {
          toast.warning("Alguns problemas não puderam ser corrigidos automaticamente");
        }
        onRefresh();
      } else {
        toast.error(response.data?.error || "Erro ao corrigir");
      }
    } catch (error) {
      console.error("Error fixing:", error);
      toast.error("Erro ao corrigir");
    } finally {
    setFixing(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copiado!");
  };

  // Connected state - simple status view
  if (isConnected) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-green-500/10 flex items-center justify-center">
                <Building2 className="h-6 w-6 text-green-500" />
              </div>
              <div>
                <CardTitle className="flex items-center gap-2">
                  Bitrix24
                  <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Conectado
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Integrado com {domain}
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status Info */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Portal Bitrix24</span>
              <span className="font-medium">{domain}</span>
            </div>
            {linkedInstance && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">WhatsApp Conectado</span>
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-green-500" />
                  <span className="font-medium">{linkedInstance.name}</span>
                  {linkedInstance.phone_number && (
                    <span className="text-muted-foreground text-sm">
                      ({linkedInstance.phone_number})
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Diagnosis Results */}
          {diagnosis && (
            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Stethoscope className="h-5 w-5 text-primary" />
                <span className="font-medium">Diagnóstico do Conector</span>
              </div>
              
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center gap-2">
                  {diagnosis.connector_registered ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-500" />
                  )}
                  <span>Conector Registrado</span>
                </div>
                <div className="flex items-center gap-2">
                  {diagnosis.connector_active ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-500" />
                  )}
                  <span>Conector Ativo</span>
                </div>
                <div className="flex items-center gap-2">
                  {diagnosis.events_bound ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-500" />
                  )}
                  <span>Eventos Configurados</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Linha:</span>
                  <span className="font-medium">{diagnosis.line_id}</span>
                </div>
              </div>

              {diagnosis.issues.length > 0 && (
                <div className="bg-red-500/10 rounded p-2">
                  <p className="text-sm font-medium text-red-600 mb-1">Problemas:</p>
                  <ul className="text-sm text-red-600 list-disc list-inside">
                    {diagnosis.issues.map((issue, i) => (
                      <li key={i}>{issue}</li>
                    ))}
                  </ul>
                </div>
              )}

              {diagnosis.fixes_applied.length > 0 && (
                <div className="bg-green-500/10 rounded p-2">
                  <p className="text-sm font-medium text-green-600 mb-1">Correções Aplicadas:</p>
                  <ul className="text-sm text-green-600 list-disc list-inside">
                    {diagnosis.fixes_applied.map((fix, i) => (
                      <li key={i}>{fix}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* How to use */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Mensagens do WhatsApp aparecerão no Chat do Bitrix24. Responda diretamente pelo CRM.
            </AlertDescription>
          </Alert>

          {/* Action buttons */}
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={handleDiagnose}
              disabled={diagnosing}
              className="flex-1"
            >
              {diagnosing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Stethoscope className="h-4 w-4 mr-2" />
              )}
              Diagnosticar
            </Button>

            <Button 
              variant="outline" 
              onClick={handleAutoFix}
              disabled={fixing}
              className="flex-1"
            >
              {fixing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Wrench className="h-4 w-4 mr-2" />
              )}
              Corrigir Automaticamente
            </Button>
          </div>

          <Button 
            variant="outline" 
            onClick={handleReconnect}
            disabled={reconnecting}
            className="w-full"
          >
            {reconnecting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Reconectar Completo
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Not connected state - show setup instructions
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-sky-500/10 flex items-center justify-center">
              <Building2 className="h-6 w-6 text-sky-500" />
            </div>
            <div>
              <CardTitle>Bitrix24</CardTitle>
              <CardDescription>
                Conecte o WhatsApp ao seu Bitrix24 CRM
              </CardDescription>
            </div>
          </div>
          <Badge variant="secondary">Não configurado</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Quick Setup Instructions */}
        <div className="bg-sky-500/5 border border-sky-500/20 rounded-lg p-4">
          <h4 className="font-medium text-sky-600 dark:text-sky-400 mb-2">
            Configuração Rápida
          </h4>
          <ol className="text-sm text-muted-foreground space-y-2">
            <li className="flex gap-2">
              <span className="font-bold text-primary">1.</span>
              No Bitrix24, vá em Aplicações → Desenvolvedores → Adicionar App Local
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-primary">2.</span>
              Configure as URLs abaixo e adicione permissões: imopenlines, imconnector, im, crm
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-primary">3.</span>
              Instale o app e cole o token gerado aqui
            </li>
          </ol>
        </div>

        {/* URLs to copy */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Handler URL</Label>
            <div className="flex gap-2">
              <Input
                readOnly
                value="https://ybqwwipwimnkonnebbys.supabase.co/functions/v1/bitrix24-install"
                className="font-mono text-xs bg-muted"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard("https://ybqwwipwimnkonnebbys.supabase.co/functions/v1/bitrix24-install")}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Initial Install URL</Label>
            <div className="flex gap-2">
              <Input
                readOnly
                value="https://chat.thoth24.com/bitrix24-setup"
                className="font-mono text-xs bg-muted"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard("https://chat.thoth24.com/bitrix24-setup")}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Token Generation */}
        <div className="border rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            <span className="font-medium">Token de Vinculação</span>
          </div>
          
          {linkingToken ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={linkingToken}
                  className="font-mono text-lg text-center tracking-widest bg-muted"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(linkingToken)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Cole este token na tela de configuração do Bitrix24
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerateToken}
                disabled={generatingToken}
              >
                {generatingToken ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Gerar Novo Token
              </Button>
            </div>
          ) : (
            <Button
              onClick={handleGenerateToken}
              disabled={generatingToken}
              className="w-full"
            >
              {generatingToken ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Key className="h-4 w-4 mr-2" />
              )}
              Gerar Token
            </Button>
          )}
        </div>

        {/* Documentation link */}
        <Button variant="outline" className="w-full" asChild>
          <a 
            href="https://helpdesk.bitrix24.com.br/open/17558322/" 
            target="_blank" 
            rel="noopener noreferrer"
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Ver Tutorial Completo
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

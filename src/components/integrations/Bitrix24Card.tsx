import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Building2,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ExternalLink,
  Phone,
  AlertCircle,
  AlertTriangle,
  XCircle,
  RotateCcw,
  ShoppingCart,
  Bot,
  Zap,
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

interface VerificationResult {
  connector_id: string;
  domain: string;
  token_valid: boolean;
  connectors: { id: string; name: string }[];
  duplicate_connectors: string[];
  events: { event: string; handler: string }[];
  duplicate_events: number;
  lines: {
    id: number;
    name: string;
    active: boolean;
    connector_active: boolean;
    connector_registered: boolean;
    connector_connection: boolean;
  }[];
  mappings: any[];
  issues: string[];
  recommendations: string[];
  warnings?: string[];
  fixes_applied?: string[];
}

export function Bitrix24Card({ integration, instances, workspaceId, onRefresh }: Bitrix24CardProps) {
  const [verifying, setVerifying] = useState(false);
  const [reconfiguring, setReconfiguring] = useState(false);
  const [_registeringRobot, _setRegisteringRobot] = useState(false); // Deprecated - now auto
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [isHealthy, setIsHealthy] = useState<boolean | null>(null);
  const [summary, setSummary] = useState<string>("");
  const [fixesApplied, setFixesApplied] = useState<string[]>([]);
  const autoVerifiedRef = useRef(false);

  const config = integration?.config || {};
  const isConnected = integration?.is_active && config.auto_setup_completed;
  const domain = config.domain as string || "";
  const instanceId = config.instance_id as string || "";
  const robotRegistered = config.robot_registered as boolean || false;
  const robotScopeMissing = config.robot_scope_missing as boolean || false;
  
  const linkedInstance = instances.find(i => i.id === instanceId);

  // Handle re-authorization for missing scopes
  const handleReauthorize = useCallback(() => {
    if (!domain) {
      toast.error("Domínio do portal não encontrado");
      return;
    }
    
    const clientId = "local.67613879b2c3a8.48187943"; // Thoth app client ID
    const redirectUri = `https://ybqwwipwimnkonnebbys.supabase.co/functions/v1/bitrix24-install?reauth=true`;
    const state = encodeURIComponent(domain);
    
    // Request extended scopes including bizproc
    const scopes = "crm,user,imopenlines,imconnector,im,bizproc";
    
    const authUrl = `https://${domain}/oauth/authorize/?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=${scopes}`;
    
    window.open(authUrl, "_blank");
    toast.info("Após autorizar, clique em 'Verificar e Corrigir' para ativar o robot");
  }, [domain]);

  // Auto-verify AND auto-fix on mount (aggressive auto-correction)
  const handleVerifyAndFix = useCallback(async (silent = false) => {
    if (!integration?.id) return;

    if (!silent) setVerifying(true);
    
    try {
      const response = await supabase.functions.invoke("bitrix24-webhook", {
        body: {
          action: "verify_integration",
          integration_id: integration.id,
          auto_fix: true,
        }
      });

      if (response.data?.success) {
        setVerification(response.data.verification);
        setIsHealthy(response.data.healthy);
        setSummary(response.data.summary || "");
        setFixesApplied(response.data.fixes_applied || []);
        
        if (!silent) {
          if (response.data.fixes_applied?.length > 0) {
            toast.success(`${response.data.fixes_applied.length} correção(ões) aplicada(s) automaticamente!`);
          } else if (response.data.healthy) {
            toast.success("Integração funcionando!");
          } else {
            toast.warning(response.data.summary || "Alguns problemas não puderam ser corrigidos");
          }
        } else if (response.data.fixes_applied?.length > 0) {
          toast.success(`Auto-correção: ${response.data.fixes_applied.length} problema(s) corrigido(s)`);
        }
      } else if (!silent) {
        toast.error(response.data?.error || "Erro na verificação");
      }
    } catch (error) {
      console.error("Error verifying:", error);
      if (!silent) toast.error("Erro na verificação");
    } finally {
      setVerifying(false);
    }
  }, [integration?.id]);

  // Auto-verify and auto-fix on mount
  useEffect(() => {
    if (isConnected && integration?.id && !autoVerifiedRef.current) {
      autoVerifiedRef.current = true;
      handleVerifyAndFix(true);
    }
  }, [isConnected, integration?.id, handleVerifyAndFix]);

  const handleReconfigureFromZero = async () => {
    if (!integration?.id) {
      toast.error("Integração não encontrada");
      return;
    }

    const confirmed = window.confirm(
      "Isso vai REMOVER TODOS os conectores WhatsApp/Thoth do Bitrix24 e reconfigurar do zero. Deseja continuar?"
    );
    if (!confirmed) return;

    setReconfiguring(true);
    
    try {
      const response = await supabase.functions.invoke("bitrix24-webhook", {
        body: {
          action: "reconfigure_connector",
          integration_id: integration.id,
        }
      });

      if (response.data?.success) {
        const result = response.data;
        if (result.connector_registered && result.connector_activated) {
          toast.success("✅ Conector registrado e ativado com sucesso!");
        } else if (result.connector_registered) {
          toast.warning("Conector registrado, mas ativação pendente");
        } else {
          toast.warning("Reconfiguração parcial - verifique o diagnóstico");
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        await handleVerifyAndFix(true);
        onRefresh();
      } else {
        toast.error(response.data?.error || "Erro na reconfiguração");
      }
    } catch (error) {
      console.error("Error reconfiguring:", error);
      toast.error("Erro na reconfiguração");
    } finally {
      setReconfiguring(false);
    }
  };

  // Determine status badge
  const getStatusBadge = () => {
    if (verifying) {
      return (
        <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          Verificando...
        </Badge>
      );
    }
    
    if (isHealthy === null) {
      return (
        <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Conectado
        </Badge>
      );
    }
    
    if (isHealthy) {
      const hasWarnings = verification?.warnings && verification.warnings.length > 0;
      if (hasWarnings) {
        return (
          <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">
            <AlertTriangle className="h-3 w-3 mr-1" />
            {summary || "Com avisos"}
          </Badge>
        );
      }
      return (
        <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          {summary || "Funcionando"}
        </Badge>
      );
    }
    
    return (
      <Badge className="bg-red-500/10 text-red-600 border-red-500/20">
        <XCircle className="h-3 w-3 mr-1" />
        {summary || "Problemas"}
      </Badge>
    );
  };

  // Connected state - simplified UI
  if (isConnected) {
    const criticalIssues = verification?.issues.filter(issue => 
      !issue.includes("duplicado") && !issue.includes("removido")
    ) || [];
    const warnings = verification?.warnings || [];

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
                  {getStatusBadge()}
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

          {/* Verification Results - Only show if we have issues or warnings */}
          {verification && (criticalIssues.length > 0 || warnings.length > 0) && (
            <div className="space-y-3">
              {/* Critical Issues */}
              {criticalIssues.length > 0 && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <XCircle className="h-4 w-4 text-red-500" />
                    <span className="font-medium text-red-600">Problemas Críticos</span>
                  </div>
                  <ul className="text-sm text-red-600 space-y-1">
                    {criticalIssues.map((issue, i) => (
                      <li key={i}>• {issue}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Warnings */}
              {warnings.length > 0 && (
                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-4 w-4 text-yellow-500" />
                    <span className="font-medium text-yellow-600">Avisos</span>
                  </div>
                  <ul className="text-sm text-yellow-600 space-y-1">
                    {warnings.map((warning, i) => (
                      <li key={i}>• {warning}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Recommendations */}
              {verification.recommendations.length > 0 && (
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                  <ul className="text-sm text-blue-600 space-y-1">
                    {verification.recommendations.map((rec, i) => (
                      <li key={i}>💡 {rec}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Fixes Applied - show if any auto-corrections were made */}
          {fixesApplied.length > 0 && (
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="font-medium text-green-600">Correções Automáticas</span>
              </div>
              <ul className="text-sm text-green-600 space-y-1">
                {fixesApplied.map((fix, i) => (
                  <li key={i}>✓ {fix}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Robot for Automations - Auto-registered status */}
          <div className={`rounded-lg p-3 border ${
            robotRegistered 
              ? 'bg-green-500/10 border-green-500/20' 
              : robotScopeMissing 
                ? 'bg-orange-500/10 border-orange-500/20'
                : 'bg-yellow-500/10 border-yellow-500/20'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className={`h-4 w-4 ${
                  robotRegistered 
                    ? 'text-green-500' 
                    : robotScopeMissing 
                      ? 'text-orange-500'
                      : 'text-yellow-500'
                }`} />
                <div>
                  <p className="text-sm font-medium">Robot para Automações</p>
                  <p className="text-xs text-muted-foreground">
                    {robotRegistered 
                      ? 'Use "Enviar WhatsApp (Thoth)" nas automações do CRM' 
                      : robotScopeMissing
                        ? 'Requer atualização de permissões no Marketplace'
                        : 'Será ativado automaticamente na próxima verificação'}
                  </p>
                </div>
              </div>
              {robotScopeMissing && !robotRegistered ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReauthorize}
                  className="bg-orange-500/10 text-orange-600 border-orange-500/20 hover:bg-orange-500/20"
                >
                  <ExternalLink className="h-3 w-3 mr-1" />
                  Atualizar Permissões
                </Button>
              ) : (
                <Badge 
                  variant="outline" 
                  className={robotRegistered 
                    ? 'bg-green-500/10 text-green-500 border-green-500/20' 
                    : 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
                  }
                >
                  {robotRegistered ? 'Ativo' : 'Pendente'}
                </Badge>
              )}
            </div>
          </div>

          {/* How to use */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Mensagens do WhatsApp aparecerão no Chat do Bitrix24. Responda diretamente pelo CRM.
            </AlertDescription>
          </Alert>

          {/* Simplified Action buttons - single action + reset */}
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={() => handleVerifyAndFix(false)}
              disabled={verifying || reconfiguring}
              className="flex-1"
            >
              {verifying ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Verificar e Corrigir
            </Button>

            <Button 
              variant="destructive"
              onClick={handleReconfigureFromZero}
              disabled={reconfiguring || verifying}
              size="icon"
              title="Reconfigurar do Zero"
            >
              {reconfiguring ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Not connected state - show Marketplace only
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
        {/* MARKETPLACE - Only Option */}
        <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-4 space-y-4">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-green-600" />
            <h4 className="font-medium text-green-600 dark:text-green-400">
              Instalação via Marketplace
            </h4>
            <Badge className="bg-green-500/10 text-green-600 border-green-500/20 text-xs">
              Recomendado
            </Badge>
          </div>
          
          <ol className="text-sm text-muted-foreground space-y-2">
            <li className="flex gap-2">
              <span className="font-bold text-green-600">1.</span>
              Acesse o Marketplace do Bitrix24
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-green-600">2.</span>
              Busque por "Thoth WhatsApp" ou acesse o link direto
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-green-600">3.</span>
              Clique em "Instalar" e siga as instruções
            </li>
          </ol>

          <Button className="w-full" asChild>
            <a 
              href="https://www.bitrix24.com.br/apps/app/thoth24.thoth_whatsapp/" 
              target="_blank" 
              rel="noopener noreferrer"
            >
              <ShoppingCart className="h-4 w-4 mr-2" />
              Ir para o Marketplace
              <ExternalLink className="h-3 w-3 ml-2" />
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { 
  BookOpen, 
  Phone, 
  Bot, 
  Users, 
  ArrowRightLeft, 
  Webhook, 
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Copy,
  Settings2,
  Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface TelephonyGuideCardProps {
  webhookUrl?: string;
}

export function TelephonyGuideCard({ webhookUrl }: TelephonyGuideCardProps) {
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    toast.success(`${label} copiado!`);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const callWebhookUrl = webhookUrl || `${supabaseUrl}/functions/v1/elevenlabs-call-webhook`;

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <BookOpen className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">Guia de Configuração de Telefonia</CardTitle>
            <CardDescription>
              Configure sua telefonia com IA em 5 passos simples
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Accordion type="single" collapsible className="w-full">
          {/* Step 1: Overview */}
          <AccordionItem value="overview">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="w-6 h-6 p-0 flex items-center justify-center rounded-full">
                  1
                </Badge>
                <Zap className="h-4 w-4 text-muted-foreground" />
                <span>Visão Geral da Arquitetura</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pl-12 space-y-4">
              <div className="p-4 bg-muted/50 rounded-lg font-mono text-sm">
                <pre className="whitespace-pre-wrap text-muted-foreground">
{`┌─────────────┐     ┌─────────────────┐     ┌──────────────┐
│   Cliente   │────▶│  Provedor SIP   │────▶│  ElevenLabs  │
│  (Telefone) │     │ (Twilio/Telnyx) │     │   Agent IA   │
└─────────────┘     └─────────────────┘     └──────┬───────┘
                                                   │
                    ┌─────────────────┐            │ Transferência
                    │    Bitrix24     │◀───────────┘
                    │   (Humanos)     │
                    └─────────────────┘`}
                </pre>
              </div>
              
              <div className="space-y-2">
                <h4 className="font-medium">Fluxo de Chamadas:</h4>
                <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                  <li>Cliente liga para seu número de telefone</li>
                  <li>Provedor SIP (Twilio/Telnyx) recebe a chamada</li>
                  <li>Chamada é roteada para o Agente ElevenLabs via SIP</li>
                  <li>IA conversa com o cliente usando a persona configurada</li>
                  <li>Se necessário, IA transfere para um humano no Bitrix24</li>
                  <li>Webhook registra a chamada e transcrição no Thoth</li>
                </ol>
              </div>

              <div className="flex items-start gap-2 p-3 bg-primary/5 rounded-lg">
                <CheckCircle2 className="h-4 w-4 text-primary mt-0.5" />
                <p className="text-sm text-muted-foreground">
                  <strong>Benefício:</strong> A IA do ElevenLabs atende chamadas 24/7, qualifica leads 
                  e só transfere para humanos quando necessário, aumentando a eficiência da equipe.
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Step 2: Telephony Provider */}
          <AccordionItem value="provider">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="w-6 h-6 p-0 flex items-center justify-center rounded-full">
                  2
                </Badge>
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span>Configurar Provedor de Telefonia</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pl-12 space-y-6">
              {/* WaVoIP */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge className="bg-green-500/10 text-green-600 hover:bg-green-500/20">WaVoIP</Badge>
                  <span className="text-sm text-muted-foreground">Chamadas via WhatsApp</span>
                </div>
                <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                  <li>Acesse <a href="https://wavoip.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">wavoip.com <ExternalLink className="h-3 w-3" /></a> e crie uma conta</li>
                  <li>No painel, vá em <strong>API Settings</strong></li>
                  <li>Copie o <strong>API Token</strong></li>
                  <li>Crie uma nova instância e copie a <strong>Instance Key</strong></li>
                  <li>Cole as credenciais no card WaVoIP abaixo</li>
                </ol>
              </div>

              {/* Twilio */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge className="bg-red-500/10 text-red-600 hover:bg-red-500/20">Twilio</Badge>
                  <span className="text-sm text-muted-foreground">SIP/PSTN - Números convencionais</span>
                </div>
                <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                  <li>Acesse <a href="https://console.twilio.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">console.twilio.com <ExternalLink className="h-3 w-3" /></a></li>
                  <li>No Dashboard, copie o <strong>Account SID</strong></li>
                  <li>Clique em "Show" e copie o <strong>Auth Token</strong></li>
                  <li>Vá em <strong>Phone Numbers → Manage → Active Numbers</strong></li>
                  <li>Compre ou configure um número existente</li>
                  <li>Configure o <strong>Voice Webhook</strong> para o SIP do ElevenLabs</li>
                </ol>
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-xs text-muted-foreground">
                    <strong>SIP URI ElevenLabs:</strong> Será gerado após configurar o agente no ElevenLabs
                  </p>
                </div>
              </div>

              {/* Telnyx */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge className="bg-blue-500/10 text-blue-600 hover:bg-blue-500/20">Telnyx</Badge>
                  <span className="text-sm text-muted-foreground">SIP de baixo custo</span>
                </div>
                <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                  <li>Acesse <a href="https://portal.telnyx.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">portal.telnyx.com <ExternalLink className="h-3 w-3" /></a></li>
                  <li>Vá em <strong>Auth → API Keys</strong> e crie uma chave</li>
                  <li>Em <strong>Networking → SIP Connections</strong>, crie uma conexão</li>
                  <li>Copie o <strong>Connection ID</strong></li>
                  <li>Configure o <strong>Outbound Voice Profile</strong></li>
                  <li>Compre números em <strong>Numbers → Phone Numbers</strong></li>
                </ol>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Step 3: ElevenLabs */}
          <AccordionItem value="elevenlabs">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="w-6 h-6 p-0 flex items-center justify-center rounded-full">
                  3
                </Badge>
                <Bot className="h-4 w-4 text-muted-foreground" />
                <span>Configurar ElevenLabs Conversational AI</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pl-12 space-y-4">
              <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                <li>
                  Acesse <a href="https://elevenlabs.io/app/conversational-ai" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                    ElevenLabs Conversational AI <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>Clique em <strong>"Create Agent"</strong></li>
                <li>Configure o agente:
                  <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                    <li><strong>Name:</strong> Nome do agente (ex: "Assistente Vendas")</li>
                    <li><strong>First Message:</strong> Mensagem inicial (ex: "Olá, sou a assistente virtual da empresa X")</li>
                    <li><strong>System Prompt:</strong> Copie o prompt da sua persona no Thoth</li>
                    <li><strong>Voice:</strong> Escolha uma voz adequada ao seu negócio</li>
                    <li><strong>Language:</strong> Português</li>
                  </ul>
                </li>
                <li>Na aba <strong>"Phone"</strong>, configure a integração SIP:
                  <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                    <li>Anote o <strong>SIP URI</strong> gerado</li>
                    <li>Este SIP URI será usado no seu provedor de telefonia</li>
                  </ul>
                </li>
                <li>Copie o <strong>Agent ID</strong> (no topo da página do agente)</li>
                <li>No Thoth, vá em <strong>Personas</strong> e cole o Agent ID na persona desejada</li>
              </ol>

              <div className="flex items-start gap-2 p-3 bg-amber-500/10 rounded-lg">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
                <p className="text-sm text-muted-foreground">
                  <strong>Importante:</strong> O System Prompt do ElevenLabs deve ser idêntico ao da persona no Thoth 
                  para garantir consistência na comunicação omnichannel.
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Step 4: Associate Numbers */}
          <AccordionItem value="numbers">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="w-6 h-6 p-0 flex items-center justify-center rounded-full">
                  4
                </Badge>
                <Settings2 className="h-4 w-4 text-muted-foreground" />
                <span>Associar Números a Personas</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pl-12 space-y-4">
              <p className="text-sm text-muted-foreground">
                Após conectar um provedor de telefonia, seus números aparecerão no card <strong>"Números de Telefonia"</strong> abaixo.
              </p>

              <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                <li>Localize o número que deseja configurar</li>
                <li>Selecione a <strong>Persona</strong> que atenderá chamadas neste número</li>
                <li>A persona deve ter um <strong>Agent ID do ElevenLabs</strong> configurado</li>
                <li>O sistema usará automaticamente o agente ElevenLabs da persona para atender</li>
              </ol>

              <div className="p-4 bg-muted/50 rounded-lg font-mono text-sm">
                <pre className="whitespace-pre-wrap text-muted-foreground">
{`Número: +55 11 99999-9999
    │
    └──▶ Persona: "Assistente de Vendas"
              │
              └──▶ ElevenLabs Agent ID: "abc123..."
                        │
                        └──▶ Atende chamadas com IA`}
                </pre>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Step 5: Transfer Rules */}
          <AccordionItem value="transfer">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="w-6 h-6 p-0 flex items-center justify-center rounded-full">
                  5
                </Badge>
                <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
                <span>Configurar Transferência para Humanos</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pl-12 space-y-4">
              <p className="text-sm text-muted-foreground">
                Configure regras para transferir chamadas da IA para atendentes humanos quando necessário.
              </p>

              <div className="space-y-3">
                <h4 className="font-medium text-sm">Tipos de Transferência:</h4>
                <div className="grid gap-2">
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="secondary">Conference</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      A IA permanece na chamada brevemente para fazer a passagem, garantindo continuidade.
                    </p>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="secondary">SIP REFER</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Transferência direta para o destino. Mais rápida, mas sem contexto de passagem.
                    </p>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="secondary">Warm</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      A IA primeiro fala com o atendente, passa o contexto, e então conecta o cliente.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="font-medium text-sm">Exemplos de Condições:</h4>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>"Quando o cliente pedir para falar com um humano"</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>"Quando o cliente demonstrar frustração ou insatisfação"</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>"Quando o cliente quiser negociar valores ou condições especiais"</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>"Quando o cliente mencionar problemas técnicos complexos"</span>
                  </li>
                </ul>
              </div>

              <div className="flex items-start gap-2 p-3 bg-primary/5 rounded-lg">
                <Users className="h-4 w-4 text-primary mt-0.5" />
                <p className="text-sm text-muted-foreground">
                  <strong>Integração Bitrix24:</strong> Configure o SIP URI do Bitrix24 como destino 
                  para transferir chamadas diretamente para ramais ou filas de atendimento.
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Step 6: Webhook */}
          <AccordionItem value="webhook">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="w-6 h-6 p-0 flex items-center justify-center rounded-full">
                  6
                </Badge>
                <Webhook className="h-4 w-4 text-muted-foreground" />
                <span>Configurar Webhook no ElevenLabs</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pl-12 space-y-4">
              <p className="text-sm text-muted-foreground">
                Configure o webhook para receber eventos de chamadas e registrá-las automaticamente.
              </p>

              <div className="space-y-2">
                <label className="text-sm font-medium">URL do Webhook:</label>
                <div className="flex gap-2">
                  <code className="flex-1 p-2 bg-muted rounded text-xs break-all">
                    {callWebhookUrl}
                  </code>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => copyToClipboard(callWebhookUrl, "URL do Webhook")}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                <li>No ElevenLabs, vá nas configurações do agente</li>
                <li>Procure a seção <strong>"Webhooks"</strong> ou <strong>"Events"</strong></li>
                <li>Cole a URL do webhook acima</li>
                <li>Ative os seguintes eventos:
                  <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                    <li><code>call.started</code> - Início da chamada</li>
                    <li><code>call.ended</code> - Fim da chamada</li>
                    <li><code>call.transcript</code> - Transcrição completa</li>
                    <li><code>call.human_takeover</code> - Transferência para humano</li>
                  </ul>
                </li>
              </ol>

              <div className="flex items-start gap-2 p-3 bg-green-500/10 rounded-lg">
                <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5" />
                <p className="text-sm text-muted-foreground">
                  <strong>Resultado:</strong> Todas as chamadas serão registradas automaticamente no Thoth, 
                  incluindo transcrição, duração e sentimento detectado.
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Troubleshooting */}
          <AccordionItem value="troubleshooting">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="w-6 h-6 p-0 flex items-center justify-center rounded-full">
                  7
                </Badge>
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                <span>Troubleshooting</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pl-12 space-y-4">
              <div className="space-y-4">
                <div className="p-3 border rounded-lg space-y-2">
                  <p className="font-medium text-sm">❌ Chamada não conecta ao agente</p>
                  <ul className="text-xs text-muted-foreground space-y-1">
                    <li>• Verifique se o SIP URI está correto no provedor</li>
                    <li>• Confirme se o agente está ativo no ElevenLabs</li>
                    <li>• Teste o agente diretamente no ElevenLabs primeiro</li>
                  </ul>
                </div>

                <div className="p-3 border rounded-lg space-y-2">
                  <p className="font-medium text-sm">❌ Webhook não recebe eventos</p>
                  <ul className="text-xs text-muted-foreground space-y-1">
                    <li>• Verifique se a URL do webhook está correta</li>
                    <li>• Confirme se os eventos estão ativados no ElevenLabs</li>
                    <li>• Verifique os logs de Edge Functions no painel</li>
                  </ul>
                </div>

                <div className="p-3 border rounded-lg space-y-2">
                  <p className="font-medium text-sm">❌ Transferência não funciona</p>
                  <ul className="text-xs text-muted-foreground space-y-1">
                    <li>• Verifique se o número de destino está correto</li>
                    <li>• Confirme se a regra de transferência está ativa</li>
                    <li>• Para SIP, verifique se o SIP URI do Bitrix24 está configurado</li>
                  </ul>
                </div>

                <div className="p-3 border rounded-lg space-y-2">
                  <p className="font-medium text-sm">❌ Áudio com problemas de qualidade</p>
                  <ul className="text-xs text-muted-foreground space-y-1">
                    <li>• Verifique a conexão de internet do cliente</li>
                    <li>• Teste com codec G.711 no provedor SIP</li>
                    <li>• Reduza a latência configurando região mais próxima</li>
                  </ul>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}

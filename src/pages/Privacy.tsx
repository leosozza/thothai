import { ThothLogo } from "@/components/ThothLogo";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const Privacy = () => {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link to="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <ThothLogo size="sm" />
        </div>

        {/* Content */}
        <div className="prose prose-invert max-w-none">
          <h1 className="text-3xl font-bold text-foreground mb-6">
            Política de Privacidade
          </h1>
          
          <p className="text-muted-foreground mb-4">
            Última atualização: {new Date().toLocaleDateString('pt-BR')}
          </p>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">1. Introdução</h2>
            <p className="text-muted-foreground">
              A Thoth.ai ("nós", "nosso" ou "empresa") está comprometida em proteger sua privacidade. 
              Esta Política de Privacidade explica como coletamos, usamos, armazenamos e protegemos 
              suas informações quando você utiliza o aplicativo Thoth WhatsApp no Bitrix24.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">2. Dados que Coletamos</h2>
            <p className="text-muted-foreground mb-4">Coletamos os seguintes tipos de dados:</p>
            
            <h3 className="text-lg font-medium text-foreground mb-2">2.1 Dados de Conta</h3>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4">
              <li>Informações de autenticação do Bitrix24 (tokens OAuth)</li>
              <li>ID do portal Bitrix24</li>
              <li>Configurações do aplicativo</li>
            </ul>

            <h3 className="text-lg font-medium text-foreground mb-2">2.2 Dados de Comunicação</h3>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4">
              <li>Mensagens enviadas e recebidas via WhatsApp</li>
              <li>Informações de contato (nome, número de telefone)</li>
              <li>Metadados de conversas (data, hora, status)</li>
            </ul>

            <h3 className="text-lg font-medium text-foreground mb-2">2.3 Dados Técnicos</h3>
            <ul className="list-disc list-inside text-muted-foreground space-y-2">
              <li>Logs de acesso e uso do aplicativo</li>
              <li>Informações de erro e diagnóstico</li>
              <li>Configurações de integração</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">3. Como Usamos seus Dados</h2>
            <p className="text-muted-foreground mb-4">Utilizamos seus dados para:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2">
              <li>Fornecer e manter o serviço de integração WhatsApp-Bitrix24</li>
              <li>Sincronizar mensagens entre WhatsApp e Contact Center</li>
              <li>Processar mensagens com IA quando habilitado</li>
              <li>Melhorar a qualidade e funcionalidades do aplicativo</li>
              <li>Enviar notificações importantes sobre o serviço</li>
              <li>Cumprir obrigações legais</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">4. Compartilhamento de Dados</h2>
            <p className="text-muted-foreground mb-4">Podemos compartilhar seus dados com:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2">
              <li><strong>Bitrix24:</strong> Para funcionamento da integração</li>
              <li><strong>Provedores WhatsApp (Meta/Gupshup):</strong> Para envio e recebimento de mensagens</li>
              <li><strong>Provedores de IA:</strong> Quando recursos de IA estão habilitados (dados são anonimizados)</li>
              <li><strong>Autoridades legais:</strong> Quando exigido por lei</li>
            </ul>
            <p className="text-muted-foreground mt-4">
              <strong>Não vendemos</strong> seus dados pessoais a terceiros.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">5. Segurança dos Dados</h2>
            <p className="text-muted-foreground mb-4">Implementamos medidas de segurança incluindo:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2">
              <li>Criptografia de dados em trânsito (TLS/SSL)</li>
              <li>Criptografia de dados sensíveis em repouso</li>
              <li>Controle de acesso baseado em funções</li>
              <li>Monitoramento contínuo de segurança</li>
              <li>Backups regulares e plano de recuperação de desastres</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">6. Retenção de Dados</h2>
            <p className="text-muted-foreground">
              Mantemos seus dados enquanto sua conta estiver ativa ou conforme necessário para 
              fornecer o serviço. Ao desinstalar o aplicativo, seus dados são removidos de nossos 
              sistemas em até 30 dias, exceto quando a retenção for exigida por lei.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">7. Seus Direitos (LGPD)</h2>
            <p className="text-muted-foreground mb-4">
              De acordo com a Lei Geral de Proteção de Dados (LGPD), você tem direito a:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2">
              <li>Confirmar a existência de tratamento de dados</li>
              <li>Acessar seus dados pessoais</li>
              <li>Corrigir dados incompletos ou desatualizados</li>
              <li>Solicitar anonimização ou exclusão de dados</li>
              <li>Revogar consentimento a qualquer momento</li>
              <li>Solicitar portabilidade dos dados</li>
              <li>Obter informações sobre compartilhamento de dados</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">8. Cookies e Tecnologias Similares</h2>
            <p className="text-muted-foreground">
              O aplicativo utiliza cookies e tecnologias similares para manter sessões ativas e 
              melhorar a experiência do usuário. Você pode configurar seu navegador para recusar 
              cookies, mas isso pode afetar a funcionalidade do aplicativo.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">9. Alterações nesta Política</h2>
            <p className="text-muted-foreground">
              Podemos atualizar esta política periodicamente. Alterações significativas serão 
              comunicadas através do aplicativo ou por e-mail. Recomendamos revisar esta página 
              regularmente.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">10. Contato do DPO</h2>
            <p className="text-muted-foreground">
              Para exercer seus direitos ou esclarecer dúvidas sobre privacidade, entre em contato 
              com nosso Encarregado de Proteção de Dados (DPO):
            </p>
            <div className="mt-4 p-4 bg-muted/50 rounded-lg">
              <p className="text-foreground font-medium">E-mail:</p>
              <a href="mailto:privacidade@thoth.ai" className="text-primary hover:underline">
                privacidade@thoth.ai
              </a>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="mt-12 pt-8 border-t border-border text-center">
          <p className="text-muted-foreground text-sm">
            © {new Date().getFullYear()} Thoth.ai. Todos os direitos reservados.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Privacy;

import { ThothLogo } from "@/components/ThothLogo";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const License = () => {
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
            Termos de Licença de Uso
          </h1>
          
          <p className="text-muted-foreground mb-4">
            Última atualização: {new Date().toLocaleDateString('pt-BR')}
          </p>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">1. Aceitação dos Termos</h2>
            <p className="text-muted-foreground">
              Ao instalar e utilizar o aplicativo Thoth WhatsApp ("Aplicativo") no Bitrix24, você concorda 
              com estes Termos de Licença de Uso. Se você não concordar com estes termos, não instale 
              ou utilize o Aplicativo.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">2. Licença de Uso</h2>
            <p className="text-muted-foreground mb-4">
              Concedemos a você uma licença limitada, não exclusiva, intransferível e revogável para 
              utilizar o Aplicativo de acordo com estes termos. Esta licença permite:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2">
              <li>Integrar suas contas WhatsApp com o Bitrix24</li>
              <li>Enviar e receber mensagens através da plataforma</li>
              <li>Utilizar recursos de automação e IA disponíveis no plano contratado</li>
              <li>Gerenciar conversas e contatos através do Contact Center</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">3. Restrições</h2>
            <p className="text-muted-foreground mb-4">Você concorda em NÃO:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2">
              <li>Modificar, descompilar ou fazer engenharia reversa do Aplicativo</li>
              <li>Utilizar o Aplicativo para enviar spam ou mensagens não solicitadas</li>
              <li>Violar as políticas de uso do WhatsApp Business API</li>
              <li>Sublicenciar, vender ou redistribuir o Aplicativo</li>
              <li>Utilizar o Aplicativo para atividades ilegais ou fraudulentas</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">4. Propriedade Intelectual</h2>
            <p className="text-muted-foreground">
              O Aplicativo e todo o seu conteúdo, recursos e funcionalidades são de propriedade exclusiva 
              da Thoth.ai e estão protegidos por leis de direitos autorais, marcas registradas e outras 
              leis de propriedade intelectual.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">5. Limitação de Responsabilidade</h2>
            <p className="text-muted-foreground">
              O Aplicativo é fornecido "como está", sem garantias de qualquer tipo. Não nos responsabilizamos 
              por danos diretos, indiretos, incidentais ou consequenciais decorrentes do uso ou impossibilidade 
              de uso do Aplicativo.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">6. Rescisão</h2>
            <p className="text-muted-foreground">
              Podemos suspender ou encerrar sua licença a qualquer momento se você violar estes termos. 
              Você pode encerrar sua licença desinstalando o Aplicativo do Bitrix24 a qualquer momento.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">7. Alterações nos Termos</h2>
            <p className="text-muted-foreground">
              Reservamo-nos o direito de modificar estes termos a qualquer momento. Alterações significativas 
              serão comunicadas através do Aplicativo ou por e-mail.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">8. Contato</h2>
            <p className="text-muted-foreground">
              Para dúvidas sobre estes termos, entre em contato conosco através do e-mail: 
              <a href="mailto:suporte@thoth.ai" className="text-primary hover:underline ml-1">
                suporte@thoth.ai
              </a>
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">9. Lei Aplicável</h2>
            <p className="text-muted-foreground">
              Estes termos são regidos pelas leis da República Federativa do Brasil. Qualquer disputa 
              será submetida aos tribunais competentes da cidade de São Paulo, SP.
            </p>
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

export default License;

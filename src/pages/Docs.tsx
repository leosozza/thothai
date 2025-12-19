import { ThothLogo } from "@/components/ThothLogo";
import { Link } from "react-router-dom";
import { ArrowLeft, Download, Settings, MessageSquare, Bot, Users, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { LanguageSelector } from "@/components/LanguageSelector";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const Docs = () => {
  const { t, i18n } = useTranslation();

  const formatDate = () => {
    const locale = i18n.language === 'pt' ? 'pt-BR' : i18n.language;
    return new Date().toLocaleDateString(locale);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link to="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <ThothLogo size="sm" />
          </div>
          <LanguageSelector />
        </div>

        {/* Hero Section */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-foreground mb-4">
            {t('docs.title')}
          </h1>
          <p className="text-xl text-muted-foreground">
            {t('docs.subtitle')}
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            {t('docs.lastUpdated')}: {formatDate()}
          </p>
        </div>

        {/* Quick Start Cards */}
        <div className="grid md:grid-cols-2 gap-4 mb-12">
          <Card className="border-border/50 hover:border-primary/50 transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Download className="h-5 w-5 text-primary" />
                {t('docs.quickStart.installation.title')}
              </CardTitle>
              <CardDescription>{t('docs.quickStart.installation.description')}</CardDescription>
            </CardHeader>
          </Card>
          <Card className="border-border/50 hover:border-primary/50 transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Settings className="h-5 w-5 text-primary" />
                {t('docs.quickStart.configuration.title')}
              </CardTitle>
              <CardDescription>{t('docs.quickStart.configuration.description')}</CardDescription>
            </CardHeader>
          </Card>
          <Card className="border-border/50 hover:border-primary/50 transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <MessageSquare className="h-5 w-5 text-primary" />
                {t('docs.quickStart.messaging.title')}
              </CardTitle>
              <CardDescription>{t('docs.quickStart.messaging.description')}</CardDescription>
            </CardHeader>
          </Card>
          <Card className="border-border/50 hover:border-primary/50 transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Bot className="h-5 w-5 text-primary" />
                {t('docs.quickStart.ai.title')}
              </CardTitle>
              <CardDescription>{t('docs.quickStart.ai.description')}</CardDescription>
            </CardHeader>
          </Card>
        </div>

        {/* Documentation Sections */}
        <div className="space-y-8">
          {/* Installation Section */}
          <section id="installation">
            <h2 className="text-2xl font-bold text-foreground mb-4 flex items-center gap-2">
              <Download className="h-6 w-6 text-primary" />
              {t('docs.sections.installation.title')}
            </h2>
            <div className="prose prose-invert max-w-none">
              <Card className="mb-4">
                <CardContent className="pt-6">
                  <h3 className="text-lg font-semibold mb-3">{t('docs.sections.installation.requirements.title')}</h3>
                  <ul className="list-disc list-inside text-muted-foreground space-y-2">
                    {(t('docs.sections.installation.requirements.items', { returnObjects: true }) as string[]).map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <h3 className="text-lg font-semibold mb-3">{t('docs.sections.installation.steps.title')}</h3>
                  <ol className="list-decimal list-inside text-muted-foreground space-y-3">
                    {(t('docs.sections.installation.steps.items', { returnObjects: true }) as string[]).map((item, index) => (
                      <li key={index} className="leading-relaxed">{item}</li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            </div>
          </section>

          {/* WhatsApp Connection Section */}
          <section id="whatsapp-connection">
            <h2 className="text-2xl font-bold text-foreground mb-4 flex items-center gap-2">
              <MessageSquare className="h-6 w-6 text-primary" />
              {t('docs.sections.whatsapp.title')}
            </h2>
            <Card>
              <CardContent className="pt-6">
                <p className="text-muted-foreground mb-4">{t('docs.sections.whatsapp.description')}</p>
                <ol className="list-decimal list-inside text-muted-foreground space-y-3">
                  {(t('docs.sections.whatsapp.steps', { returnObjects: true }) as string[]).map((item, index) => (
                    <li key={index} className="leading-relaxed">{item}</li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </section>

          {/* Open Channels Configuration Section */}
          <section id="open-channels">
            <h2 className="text-2xl font-bold text-foreground mb-4 flex items-center gap-2">
              <Settings className="h-6 w-6 text-primary" />
              {t('docs.sections.openChannels.title')}
            </h2>
            <Card>
              <CardContent className="pt-6">
                <p className="text-muted-foreground mb-4">{t('docs.sections.openChannels.description')}</p>
                <ol className="list-decimal list-inside text-muted-foreground space-y-3">
                  {(t('docs.sections.openChannels.steps', { returnObjects: true }) as string[]).map((item, index) => (
                    <li key={index} className="leading-relaxed">{item}</li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </section>

          {/* AI Bot Section */}
          <section id="ai-bot">
            <h2 className="text-2xl font-bold text-foreground mb-4 flex items-center gap-2">
              <Bot className="h-6 w-6 text-primary" />
              {t('docs.sections.aiBot.title')}
            </h2>
            <Card>
              <CardContent className="pt-6">
                <p className="text-muted-foreground mb-4">{t('docs.sections.aiBot.description')}</p>
                
                <h3 className="text-lg font-semibold mb-3 mt-6">{t('docs.sections.aiBot.features.title')}</h3>
                <ul className="list-disc list-inside text-muted-foreground space-y-2">
                  {(t('docs.sections.aiBot.features.items', { returnObjects: true }) as string[]).map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>

                <h3 className="text-lg font-semibold mb-3 mt-6">{t('docs.sections.aiBot.setup.title')}</h3>
                <ol className="list-decimal list-inside text-muted-foreground space-y-3">
                  {(t('docs.sections.aiBot.setup.steps', { returnObjects: true }) as string[]).map((item, index) => (
                    <li key={index} className="leading-relaxed">{item}</li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </section>

          {/* Contact Sync Section */}
          <section id="contact-sync">
            <h2 className="text-2xl font-bold text-foreground mb-4 flex items-center gap-2">
              <Users className="h-6 w-6 text-primary" />
              {t('docs.sections.contactSync.title')}
            </h2>
            <Card>
              <CardContent className="pt-6">
                <p className="text-muted-foreground mb-4">{t('docs.sections.contactSync.description')}</p>
                <ul className="list-disc list-inside text-muted-foreground space-y-2">
                  {(t('docs.sections.contactSync.features', { returnObjects: true }) as string[]).map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>

          {/* Troubleshooting Section */}
          <section id="troubleshooting">
            <h2 className="text-2xl font-bold text-foreground mb-4 flex items-center gap-2">
              <AlertTriangle className="h-6 w-6 text-primary" />
              {t('docs.sections.troubleshooting.title')}
            </h2>
            <Accordion type="single" collapsible className="w-full">
              {(t('docs.sections.troubleshooting.items', { returnObjects: true }) as { question: string; answer: string }[]).map((item, index) => (
                <AccordionItem key={index} value={`item-${index}`}>
                  <AccordionTrigger className="text-left">{item.question}</AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    {item.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>

          {/* Support Section */}
          <section id="support" className="mt-12">
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="pt-6">
                <div className="flex items-start gap-4">
                  <CheckCircle2 className="h-8 w-8 text-primary flex-shrink-0" />
                  <div>
                    <h3 className="text-lg font-semibold mb-2">{t('docs.sections.support.title')}</h3>
                    <p className="text-muted-foreground mb-4">{t('docs.sections.support.description')}</p>
                    <div className="space-y-2 text-muted-foreground">
                      <p><strong>{t('docs.sections.support.email')}:</strong> suporte@thoth.ai</p>
                      <p><strong>{t('docs.sections.support.hours')}:</strong> {t('docs.sections.support.hoursValue')}</p>
                      <p><strong>{t('docs.sections.support.response')}:</strong> {t('docs.sections.support.responseValue')}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>
        </div>

        {/* Footer */}
        <div className="mt-12 pt-8 border-t border-border">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-muted-foreground text-sm">
              © {new Date().getFullYear()} Thoth.ai. {t('common.allRightsReserved')}
            </p>
            <div className="flex gap-4">
              <Link to="/license" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                {t('common.termsOfUse')}
              </Link>
              <Link to="/privacy" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                {t('common.privacy')}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Docs;

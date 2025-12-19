import { ThothLogo } from "@/components/ThothLogo";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { LanguageSelector } from "@/components/LanguageSelector";

const License = () => {
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

        {/* Content */}
        <div className="prose prose-invert max-w-none">
          <h1 className="text-3xl font-bold text-foreground mb-6">
            {t('license.title')}
          </h1>
          
          <p className="text-muted-foreground mb-4">
            {t('license.lastUpdated')}: {formatDate()}
          </p>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">{t('license.sections.acceptance.title')}</h2>
            <p className="text-muted-foreground">
              {t('license.sections.acceptance.content')}
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">{t('license.sections.license.title')}</h2>
            <p className="text-muted-foreground mb-4">
              {t('license.sections.license.content')}
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2">
              {(t('license.sections.license.items', { returnObjects: true }) as string[]).map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">{t('license.sections.restrictions.title')}</h2>
            <p className="text-muted-foreground mb-4">{t('license.sections.restrictions.content')}</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2">
              {(t('license.sections.restrictions.items', { returnObjects: true }) as string[]).map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">{t('license.sections.intellectualProperty.title')}</h2>
            <p className="text-muted-foreground">
              {t('license.sections.intellectualProperty.content')}
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">{t('license.sections.liability.title')}</h2>
            <p className="text-muted-foreground">
              {t('license.sections.liability.content')}
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">{t('license.sections.termination.title')}</h2>
            <p className="text-muted-foreground">
              {t('license.sections.termination.content')}
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">{t('license.sections.changes.title')}</h2>
            <p className="text-muted-foreground">
              {t('license.sections.changes.content')}
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">{t('license.sections.contact.title')}</h2>
            <p className="text-muted-foreground">
              {t('license.sections.contact.content')}
              <a href="mailto:suporte@thoth.ai" className="text-primary hover:underline ml-1">
                suporte@thoth.ai
              </a>
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">{t('license.sections.law.title')}</h2>
            <p className="text-muted-foreground">
              {t('license.sections.law.content')}
            </p>
          </section>
        </div>

        {/* Footer */}
        <div className="mt-12 pt-8 border-t border-border text-center">
          <p className="text-muted-foreground text-sm">
            © {new Date().getFullYear()} Thoth.ai. {t('common.allRightsReserved')}
          </p>
        </div>
      </div>
    </div>
  );
};

export default License;

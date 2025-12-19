import { ThothLogo } from "@/components/ThothLogo";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { LanguageSelector } from "@/components/LanguageSelector";

const Privacy = () => {
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
            {t('privacy.title')}
          </h1>
          
          <p className="text-muted-foreground mb-4">
            {t('privacy.lastUpdated')}: {formatDate()}
          </p>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">{t('privacy.sections.introduction.title')}</h2>
            <p className="text-muted-foreground">
              {t('privacy.sections.introduction.content')}
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">{t('privacy.sections.dataCollection.title')}</h2>
            <p className="text-muted-foreground mb-4">{t('privacy.sections.dataCollection.content')}</p>
            
            <h3 className="text-lg font-medium text-foreground mb-2">{t('privacy.sections.dataCollection.accountData.title')}</h3>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4">
              {(t('privacy.sections.dataCollection.accountData.items', { returnObjects: true }) as string[]).map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>

            <h3 className="text-lg font-medium text-foreground mb-2">{t('privacy.sections.dataCollection.communicationData.title')}</h3>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4">
              {(t('privacy.sections.dataCollection.communicationData.items', { returnObjects: true }) as string[]).map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>

            <h3 className="text-lg font-medium text-foreground mb-2">{t('privacy.sections.dataCollection.technicalData.title')}</h3>
            <ul className="list-disc list-inside text-muted-foreground space-y-2">
              {(t('privacy.sections.dataCollection.technicalData.items', { returnObjects: true }) as string[]).map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">{t('privacy.sections.dataUsage.title')}</h2>
            <p className="text-muted-foreground mb-4">{t('privacy.sections.dataUsage.content')}</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2">
              {(t('privacy.sections.dataUsage.items', { returnObjects: true }) as string[]).map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">{t('privacy.sections.dataSharing.title')}</h2>
            <p className="text-muted-foreground mb-4">{t('privacy.sections.dataSharing.content')}</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2">
              {(t('privacy.sections.dataSharing.items', { returnObjects: true }) as string[]).map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
            <p className="text-muted-foreground mt-4">
              <strong>{t('privacy.sections.dataSharing.noSale')}</strong>
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">{t('privacy.sections.dataSecurity.title')}</h2>
            <p className="text-muted-foreground mb-4">{t('privacy.sections.dataSecurity.content')}</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2">
              {(t('privacy.sections.dataSecurity.items', { returnObjects: true }) as string[]).map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">{t('privacy.sections.dataRetention.title')}</h2>
            <p className="text-muted-foreground">
              {t('privacy.sections.dataRetention.content')}
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">{t('privacy.sections.yourRights.title')}</h2>
            <p className="text-muted-foreground mb-4">
              {t('privacy.sections.yourRights.content')}
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2">
              {(t('privacy.sections.yourRights.items', { returnObjects: true }) as string[]).map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">{t('privacy.sections.cookies.title')}</h2>
            <p className="text-muted-foreground">
              {t('privacy.sections.cookies.content')}
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">{t('privacy.sections.policyChanges.title')}</h2>
            <p className="text-muted-foreground">
              {t('privacy.sections.policyChanges.content')}
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">{t('privacy.sections.dpoContact.title')}</h2>
            <p className="text-muted-foreground">
              {t('privacy.sections.dpoContact.content')}
            </p>
            <div className="mt-4 p-4 bg-muted/50 rounded-lg">
              <p className="text-foreground font-medium">{t('privacy.sections.dpoContact.email')}</p>
              <a href="mailto:privacidade@thoth.ai" className="text-primary hover:underline">
                privacidade@thoth.ai
              </a>
            </div>
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

export default Privacy;

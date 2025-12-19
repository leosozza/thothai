import { useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { ThothLogo } from "@/components/ThothLogo";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight, MessageSquare, Bot, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LanguageSelector } from "@/components/LanguageSelector";

export default function Index() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    if (!loading && user) {
      navigate("/dashboard");
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Background Effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-primary/5 rounded-full blur-3xl" />
      </div>

      {/* Navigation */}
      <header className="relative z-10 flex items-center justify-between p-6 max-w-7xl mx-auto">
        <ThothLogo size="md" />
        <div className="flex items-center gap-4">
          <LanguageSelector />
          <Button onClick={() => navigate("/auth")} variant="outline" className="gap-2">
            {t('common.login')}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Hero Section */}
      <main className="relative z-10 flex flex-col items-center justify-center px-6 pt-12 pb-24">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-sm">
            <Zap className="h-4 w-4 text-primary" />
            <span>{t('landing.badge')}</span>
          </div>

          {/* Headline */}
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight">
            {t('landing.headline')}{" "}
            <span className="text-gradient-gold">{t('landing.headlineHighlight')}</span>
          </h1>

          {/* Subheadline */}
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            {t('landing.subheadline')}
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button
              size="lg"
              onClick={() => navigate("/auth")}
              className="gap-2 text-lg px-8 py-6 glow-gold-sm"
            >
              {t('landing.cta')}
              <ArrowRight className="h-5 w-5" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => navigate("/auth")}
              className="gap-2 text-lg px-8 py-6"
            >
              {t('landing.demo')}
            </Button>
          </div>

          {/* Features */}
          <div className="grid md:grid-cols-3 gap-6 pt-12">
            <div className="p-6 rounded-xl bg-card border border-border/50 text-left space-y-3">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <MessageSquare className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold text-lg">{t('landing.features.multiService.title')}</h3>
              <p className="text-muted-foreground text-sm">
                {t('landing.features.multiService.description')}
              </p>
            </div>

            <div className="p-6 rounded-xl bg-card border border-border/50 text-left space-y-3">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Bot className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold text-lg">{t('landing.features.trainableAI.title')}</h3>
              <p className="text-muted-foreground text-sm">
                {t('landing.features.trainableAI.description')}
              </p>
            </div>

            <div className="p-6 rounded-xl bg-card border border-border/50 text-left space-y-3">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Zap className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold text-lg">{t('landing.features.automations.title')}</h3>
              <p className="text-muted-foreground text-sm">
                {t('landing.features.automations.description')}
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border/50 py-8">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <ThothLogo size="sm" />
          <div className="flex items-center gap-6">
            <Link to="/license" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              {t('common.termsOfUse')}
            </Link>
            <Link to="/privacy" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              {t('common.privacy')}
            </Link>
          </div>
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} thoth.AI - {t('common.allRightsReserved')}
          </p>
        </div>
      </footer>
    </div>
  );
}

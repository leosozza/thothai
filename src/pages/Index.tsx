import { useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { ThothLogo } from "@/components/ThothLogo";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight, MessageSquare, Bot, Zap, Shield, Users, BarChart3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LanguageSelector } from "@/components/LanguageSelector";
import { GlassCard, GlassCardIcon } from "@/components/ui/glass-card";

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

  const features = [
    {
      icon: MessageSquare,
      title: t('landing.features.multiService.title'),
      description: t('landing.features.multiService.description'),
    },
    {
      icon: Bot,
      title: t('landing.features.trainableAI.title'),
      description: t('landing.features.trainableAI.description'),
    },
    {
      icon: Zap,
      title: t('landing.features.automations.title'),
      description: t('landing.features.automations.description'),
    },
  ];

  const stats = [
    { icon: Users, value: "10K+", label: "Usuários Ativos" },
    { icon: MessageSquare, value: "1M+", label: "Mensagens/Mês" },
    { icon: BarChart3, value: "99.9%", label: "Uptime" },
    { icon: Shield, value: "100%", label: "Seguro" },
  ];

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Main radial glow */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] gradient-radial opacity-60" />
        
        {/* Secondary glows */}
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[100px]" />
        <div className="absolute top-1/2 right-0 w-[400px] h-[400px] bg-primary/5 rounded-full blur-[80px]" />
        
        {/* Grid pattern overlay */}
        <div 
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `linear-gradient(hsl(160 100% 45%) 1px, transparent 1px),
                             linear-gradient(90deg, hsl(160 100% 45%) 1px, transparent 1px)`,
            backgroundSize: '60px 60px'
          }}
        />
      </div>

      {/* Navigation */}
      <header className="relative z-10 flex items-center justify-between p-6 max-w-7xl mx-auto">
        <ThothLogo size="md" animated />
        <div className="flex items-center gap-4">
          <LanguageSelector />
          <Button 
            onClick={() => navigate("/auth")} 
            variant="outline" 
            className="gap-2 border-primary/30 hover:border-primary/50 hover:bg-primary/10"
          >
            {t('common.login')}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Hero Section */}
      <main className="relative z-10 flex flex-col items-center justify-center px-6 pt-16 pb-24">
        <div className="max-w-5xl mx-auto text-center space-y-10">
          
          {/* Logo Grande Central */}
          <div className="flex justify-center mb-8">
            <div className="animate-float">
              <ThothLogo size="xl" showText={false} animated />
            </div>
          </div>

          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full glass border-primary/20 text-sm font-medium">
            <div className="h-2 w-2 rounded-full bg-primary animate-pulse-primary" />
            <span className="text-primary">{t('landing.badge')}</span>
          </div>

          {/* Headline */}
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-tight">
            {t('landing.headline')}{" "}
            <span className="text-gradient-primary">{t('landing.headlineHighlight')}</span>
          </h1>

          {/* Subheadline */}
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            {t('landing.subheadline')}
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Button
              size="lg"
              onClick={() => navigate("/auth")}
              className="gap-2 text-lg px-8 py-6 glow-primary-sm hover:glow-primary transition-shadow duration-300"
            >
              {t('landing.cta')}
              <ArrowRight className="h-5 w-5" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => navigate("/docs")}
              className="gap-2 text-lg px-8 py-6 border-primary/30 hover:border-primary/50 hover:bg-primary/5"
            >
              {t('landing.demo')}
            </Button>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-12 max-w-3xl mx-auto">
            {stats.map((stat, index) => (
              <div 
                key={index}
                className="glass rounded-xl p-4 text-center border-primary/10 hover:border-primary/20 transition-colors"
              >
                <stat.icon className="h-5 w-5 text-primary mx-auto mb-2" />
                <div className="text-2xl font-bold text-foreground">{stat.value}</div>
                <div className="text-xs text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </div>

          {/* Features */}
          <div className="grid md:grid-cols-3 gap-6 pt-16">
            {features.map((feature, index) => (
              <GlassCard key={index} className="text-left">
                <GlassCardIcon>
                  <feature.icon className="h-6 w-6 text-primary" />
                </GlassCardIcon>
                <h3 className="font-semibold text-lg mb-2">{feature.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {feature.description}
                </p>
              </GlassCard>
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border/30 py-8">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <ThothLogo size="sm" />
          <div className="flex items-center gap-6">
            <Link to="/docs" className="text-sm text-muted-foreground hover:text-primary transition-colors">
              {t('common.documentation')}
            </Link>
            <Link to="/license" className="text-sm text-muted-foreground hover:text-primary transition-colors">
              {t('common.termsOfUse')}
            </Link>
            <Link to="/privacy" className="text-sm text-muted-foreground hover:text-primary transition-colors">
              {t('common.privacy')}
            </Link>
          </div>
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} THOTH24 - {t('common.allRightsReserved')}
          </p>
        </div>
      </footer>
    </div>
  );
}

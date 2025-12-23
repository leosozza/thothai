import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { supabase } from "@/integrations/supabase/client";
import { useTheme } from "next-themes";
import { 
  User, 
  Bell, 
  Shield, 
  CreditCard, 
  Save,
  Loader2,
  Eye,
  EyeOff,
  Check,
  Palette,
  Sun,
  Moon,
  Sparkles,
  Smartphone,
  ExternalLink
} from "lucide-react";

interface Profile {
  id: string;
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  company_name: string | null;
}

interface NotificationSettings {
  emailNewMessage: boolean;
  emailDailySummary: boolean;
  pushNotifications: boolean;
  soundEnabled: boolean;
}

interface ProviderConfig {
  wapi_base_url: string;
  wapi_api_key: string;
  wapi_instance_id: string;
  evolution_server_url: string;
  evolution_api_key: string;
}

const Settings = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const { workspace } = useWorkspace();
  const { theme, setTheme } = useTheme();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Profile form state
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");


  // Notification settings
  const [notifications, setNotifications] = useState<NotificationSettings>({
    emailNewMessage: true,
    emailDailySummary: false,
    pushNotifications: true,
    soundEnabled: true,
  });

  // Security
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  // Provider settings
  const [providerConfig, setProviderConfig] = useState<ProviderConfig>({
    wapi_base_url: "https://api.w-api.app",
    wapi_api_key: "",
    wapi_instance_id: "",
    evolution_server_url: "",
    evolution_api_key: "",
  });
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [savingProviders, setSavingProviders] = useState(false);
  const [showProviderKeys, setShowProviderKeys] = useState(false);


  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user) {
      fetchProfile();
    }
  }, [user]);

  useEffect(() => {
    if (workspace) {
      fetchProviderConfig();
    }
  }, [workspace]);


  const fetchProfile = async () => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user?.id)
        .single();

      if (error) throw error;

      setProfile(data);
      setFullName(data?.full_name || "");
      setCompanyName(data?.company_name || "");
    } catch (error) {
      console.error("Error fetching profile:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchProviderConfig = async () => {
    if (!workspace) return;
    setLoadingProviders(true);

    try {
      // Fetch W-API config
      const { data: wapiIntegration } = await supabase
        .from("integrations")
        .select("config")
        .eq("workspace_id", workspace.id)
        .eq("type", "wapi")
        .maybeSingle();

      // Fetch Evolution API config
      const { data: evolutionIntegration } = await supabase
        .from("integrations")
        .select("config")
        .eq("workspace_id", workspace.id)
        .eq("type", "evolution")
        .maybeSingle();

      const wapiConfig = wapiIntegration?.config as Record<string, string> | null;
      const evolutionConfig = evolutionIntegration?.config as Record<string, string> | null;

      setProviderConfig({
        wapi_base_url: wapiConfig?.base_url || "https://api.w-api.app",
        wapi_api_key: wapiConfig?.api_key || "",
        wapi_instance_id: wapiConfig?.instance_id || "",
        evolution_server_url: evolutionConfig?.server_url || "",
        evolution_api_key: evolutionConfig?.api_key || "",
      });
    } catch (error) {
      console.error("Error fetching provider config:", error);
    } finally {
      setLoadingProviders(false);
    }
  };

  const saveProviderConfig = async () => {
    if (!workspace) return;
    setSavingProviders(true);

    try {
      // Save W-API config
      const { data: existingWapi } = await supabase
        .from("integrations")
        .select("id")
        .eq("workspace_id", workspace.id)
        .eq("type", "wapi")
        .maybeSingle();

      if (existingWapi) {
        await supabase
          .from("integrations")
          .update({
            config: {
              base_url: providerConfig.wapi_base_url,
              api_key: providerConfig.wapi_api_key,
              instance_id: providerConfig.wapi_instance_id,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingWapi.id);
      } else if (providerConfig.wapi_api_key) {
        await supabase.from("integrations").insert({
          workspace_id: workspace.id,
          name: "W-API",
          type: "wapi",
          is_active: true,
          config: {
            base_url: providerConfig.wapi_base_url,
            api_key: providerConfig.wapi_api_key,
            instance_id: providerConfig.wapi_instance_id,
          },
        });
      }

      // Save Evolution API config
      const { data: existingEvolution } = await supabase
        .from("integrations")
        .select("id")
        .eq("workspace_id", workspace.id)
        .eq("type", "evolution")
        .maybeSingle();

      if (existingEvolution) {
        await supabase
          .from("integrations")
          .update({
            config: {
              server_url: providerConfig.evolution_server_url,
              api_key: providerConfig.evolution_api_key,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingEvolution.id);
      } else if (providerConfig.evolution_api_key) {
        await supabase.from("integrations").insert({
          workspace_id: workspace.id,
          name: "Evolution API",
          type: "evolution",
          is_active: true,
          config: {
            server_url: providerConfig.evolution_server_url,
            api_key: providerConfig.evolution_api_key,
          },
        });
      }

      toast({
        title: "Configurações salvas",
        description: "As configurações de provedores foram atualizadas.",
      });
    } catch (error: any) {
      toast({
        title: "Erro ao salvar",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSavingProviders(false);
    }
  };

  const saveProfile = async () => {
    if (!user) return;
    setSaving(true);

    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: fullName,
          company_name: companyName,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);

      if (error) throw error;

      toast({
        title: "Perfil atualizado",
        description: "Suas informações foram salvas com sucesso.",
      });
    } catch (error: any) {
      toast({
        title: "Erro ao salvar",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };


  const changePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast({
        title: "Erro",
        description: "As senhas não coincidem.",
        variant: "destructive",
      });
      return;
    }

    if (newPassword.length < 6) {
      toast({
        title: "Erro",
        description: "A senha deve ter pelo menos 6 caracteres.",
        variant: "destructive",
      });
      return;
    }

    setChangingPassword(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      toast({
        title: "Senha alterada",
        description: "Sua senha foi alterada com sucesso.",
      });

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error: any) {
      toast({
        title: "Erro ao alterar senha",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setChangingPassword(false);
    }
  };


  const getInitials = (name: string | null) => {
    if (!name) return "U";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  if (authLoading || loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Configurações</h1>
          <p className="text-muted-foreground">
            Gerencie suas preferências e configurações da conta
          </p>
        </div>

        <Tabs defaultValue="profile" className="space-y-6">
          <TabsList className="grid w-full grid-cols-6 lg:w-auto lg:inline-flex">
            <TabsTrigger value="profile" className="gap-2">
              <User className="h-4 w-4 hidden sm:inline" />
              Perfil
            </TabsTrigger>
            <TabsTrigger value="providers" className="gap-2">
              <Smartphone className="h-4 w-4 hidden sm:inline" />
              Provedores
            </TabsTrigger>
            <TabsTrigger value="appearance" className="gap-2">
              <Palette className="h-4 w-4 hidden sm:inline" />
              Aparência
            </TabsTrigger>
            <TabsTrigger value="notifications" className="gap-2">
              <Bell className="h-4 w-4 hidden sm:inline" />
              Notificações
            </TabsTrigger>
            <TabsTrigger value="security" className="gap-2">
              <Shield className="h-4 w-4 hidden sm:inline" />
              Segurança
            </TabsTrigger>
            <TabsTrigger value="plan" className="gap-2">
              <CreditCard className="h-4 w-4 hidden sm:inline" />
              Plano
            </TabsTrigger>
          </TabsList>

          {/* Profile Tab */}
          <TabsContent value="profile">
            <Card>
              <CardHeader>
                <CardTitle>Informações do Perfil</CardTitle>
                <CardDescription>
                  Atualize suas informações pessoais
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center gap-4">
                  <Avatar className="h-20 w-20">
                    <AvatarImage src={profile?.avatar_url || undefined} />
                    <AvatarFallback className="text-lg bg-primary/10 text-primary">
                      {getInitials(fullName)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <Button variant="outline" size="sm">
                      Alterar foto
                    </Button>
                    <p className="text-xs text-muted-foreground mt-1">
                      JPG, PNG ou GIF. Máximo 2MB.
                    </p>
                  </div>
                </div>

                <Separator />

                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="fullName">Nome completo</Label>
                    <Input
                      id="fullName"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Seu nome completo"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      value={user?.email || ""}
                      disabled
                      className="bg-muted"
                    />
                    <p className="text-xs text-muted-foreground">
                      O email não pode ser alterado
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="company">Nome da empresa</Label>
                    <Input
                      id="company"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="Nome da sua empresa"
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button onClick={saveProfile} disabled={saving}>
                    {saving ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-2" />
                    )}
                    Salvar alterações
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Providers Tab */}
          <TabsContent value="providers">
            <div className="space-y-6">
              {/* W-API Configuration */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
                          <span className="text-blue-600 font-bold text-sm">W</span>
                        </div>
                        W-API
                      </CardTitle>
                      <CardDescription>
                        Conecte números WhatsApp via QR Code
                      </CardDescription>
                    </div>
                    <a
                      href="https://w-api.app"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1"
                    >
                      Documentação
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="wapi-base-url">URL Base</Label>
                      <Input
                        id="wapi-base-url"
                        value={providerConfig.wapi_base_url}
                        onChange={(e) =>
                          setProviderConfig((prev) => ({
                            ...prev,
                            wapi_base_url: e.target.value,
                          }))
                        }
                        placeholder="https://api.w-api.app"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="wapi-api-key">API Key</Label>
                      <div className="relative">
                        <Input
                          id="wapi-api-key"
                          type={showProviderKeys ? "text" : "password"}
                          value={providerConfig.wapi_api_key}
                          onChange={(e) =>
                            setProviderConfig((prev) => ({
                              ...prev,
                              wapi_api_key: e.target.value,
                            }))
                          }
                          placeholder="Sua API Key da W-API"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full px-3"
                          onClick={() => setShowProviderKeys(!showProviderKeys)}
                        >
                          {showProviderKeys ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="wapi-instance-id">Instance ID (opcional)</Label>
                      <Input
                        id="wapi-instance-id"
                        value={providerConfig.wapi_instance_id}
                        onChange={(e) =>
                          setProviderConfig((prev) => ({
                            ...prev,
                            wapi_instance_id: e.target.value,
                          }))
                        }
                        placeholder="ID da instância padrão"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Evolution API Configuration */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center">
                          <span className="text-green-600 font-bold text-sm">E</span>
                        </div>
                        Evolution API
                      </CardTitle>
                      <CardDescription>
                        Conecte números WhatsApp via servidor Evolution
                      </CardDescription>
                    </div>
                    <a
                      href="https://doc.evolution-api.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1"
                    >
                      Documentação
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
                    <p className="text-sm text-blue-800 dark:text-blue-200 font-medium mb-2">
                      📋 Configuração do Servidor Evolution
                    </p>
                    <p className="text-xs text-blue-700 dark:text-blue-300">
                      Você precisa hospedar sua própria instância do Evolution API. 
                      Use Docker ou VPS para instalação. Consulte a documentação oficial.
                    </p>
                  </div>

                  <div className="grid gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="evolution-server-url">URL do Servidor</Label>
                      <Input
                        id="evolution-server-url"
                        value={providerConfig.evolution_server_url}
                        onChange={(e) =>
                          setProviderConfig((prev) => ({
                            ...prev,
                            evolution_server_url: e.target.value,
                          }))
                        }
                        placeholder="https://evolution.seudominio.com"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="evolution-api-key">API Key Global</Label>
                      <div className="relative">
                        <Input
                          id="evolution-api-key"
                          type={showProviderKeys ? "text" : "password"}
                          value={providerConfig.evolution_api_key}
                          onChange={(e) =>
                            setProviderConfig((prev) => ({
                              ...prev,
                              evolution_api_key: e.target.value,
                            }))
                          }
                          placeholder="Chave API do servidor Evolution"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full px-3"
                          onClick={() => setShowProviderKeys(!showProviderKeys)}
                        >
                          {showProviderKeys ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-end">
                <Button onClick={saveProviderConfig} disabled={savingProviders || loadingProviders}>
                  {savingProviders ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Salvar Configurações
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* Appearance Tab */}
          <TabsContent value="appearance">
            <Card>
              <CardHeader>
                <CardTitle>Aparência</CardTitle>
                <CardDescription>
                  Personalize o visual da plataforma
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <h3 className="font-medium">Tema</h3>
                  <p className="text-sm text-muted-foreground">
                    Escolha o tema que melhor se adapta ao seu estilo
                  </p>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {/* Light Theme */}
                    <button
                      onClick={() => setTheme("light")}
                      className={`relative p-4 rounded-lg border-2 transition-all ${
                        theme === "light"
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
                          <Sun className="h-6 w-6 text-amber-600" />
                        </div>
                        <div className="text-center">
                          <p className="font-medium">Claro</p>
                          <p className="text-xs text-muted-foreground">
                            Tema claro com dourado
                          </p>
                        </div>
                      </div>
                      {theme === "light" && (
                        <div className="absolute top-2 right-2">
                          <Check className="h-4 w-4 text-primary" />
                        </div>
                      )}
                    </button>

                    {/* Dark Theme */}
                    <button
                      onClick={() => setTheme("dark")}
                      className={`relative p-4 rounded-lg border-2 transition-all ${
                        theme === "dark"
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center">
                          <Moon className="h-6 w-6 text-amber-400" />
                        </div>
                        <div className="text-center">
                          <p className="font-medium">Escuro</p>
                          <p className="text-xs text-muted-foreground">
                            Tema escuro com dourado
                          </p>
                        </div>
                      </div>
                      {theme === "dark" && (
                        <div className="absolute top-2 right-2">
                          <Check className="h-4 w-4 text-primary" />
                        </div>
                      )}
                    </button>

                    {/* Thoth24 Theme */}
                    <button
                      onClick={() => setTheme("thoth24")}
                      className={`relative p-4 rounded-lg border-2 transition-all ${
                        theme === "thoth24"
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-slate-900 flex items-center justify-center">
                          <Sparkles className="h-6 w-6 text-cyan-400" />
                        </div>
                        <div className="text-center">
                          <p className="font-medium">Thoth24</p>
                          <p className="text-xs text-muted-foreground">
                            Tema escuro com ciano
                          </p>
                        </div>
                      </div>
                      {theme === "thoth24" && (
                        <div className="absolute top-2 right-2">
                          <Check className="h-4 w-4 text-primary" />
                        </div>
                      )}
                    </button>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <h3 className="font-medium">Preview do tema</h3>
                  <div className="p-4 rounded-lg bg-card border border-border">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
                        <span className="text-primary-foreground font-bold text-sm">AB</span>
                      </div>
                      <div>
                        <p className="font-medium text-foreground">Cor primária ativa</p>
                        <p className="text-sm text-muted-foreground">
                          Este é o visual do seu tema atual
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Notifications Tab */}
          <TabsContent value="notifications">
            <Card>
              <CardHeader>
                <CardTitle>Preferências de Notificação</CardTitle>
                <CardDescription>
                  Configure como deseja receber notificações
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <h3 className="font-medium">Notificações por Email</h3>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">Novas mensagens</p>
                      <p className="text-sm text-muted-foreground">
                        Receba um email quando receber novas mensagens
                      </p>
                    </div>
                    <Switch
                      checked={notifications.emailNewMessage}
                      onCheckedChange={(checked) =>
                        setNotifications((prev) => ({
                          ...prev,
                          emailNewMessage: checked,
                        }))
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">Resumo diário</p>
                      <p className="text-sm text-muted-foreground">
                        Receba um resumo diário das atividades
                      </p>
                    </div>
                    <Switch
                      checked={notifications.emailDailySummary}
                      onCheckedChange={(checked) =>
                        setNotifications((prev) => ({
                          ...prev,
                          emailDailySummary: checked,
                        }))
                      }
                    />
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <h3 className="font-medium">Notificações no App</h3>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">Notificações push</p>
                      <p className="text-sm text-muted-foreground">
                        Receba notificações push no navegador
                      </p>
                    </div>
                    <Switch
                      checked={notifications.pushNotifications}
                      onCheckedChange={(checked) =>
                        setNotifications((prev) => ({
                          ...prev,
                          pushNotifications: checked,
                        }))
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">Som de notificação</p>
                      <p className="text-sm text-muted-foreground">
                        Tocar som ao receber novas mensagens
                      </p>
                    </div>
                    <Switch
                      checked={notifications.soundEnabled}
                      onCheckedChange={(checked) =>
                        setNotifications((prev) => ({
                          ...prev,
                          soundEnabled: checked,
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button disabled>
                    <Save className="h-4 w-4 mr-2" />
                    Salvar preferências
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Security Tab */}
          <TabsContent value="security">
            <Card>
              <CardHeader>
                <CardTitle>Segurança da Conta</CardTitle>
                <CardDescription>
                  Gerencie a segurança da sua conta
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <h3 className="font-medium">Alterar Senha</h3>

                  <div className="grid gap-4 max-w-md">
                    <div className="grid gap-2">
                      <Label htmlFor="newPassword">Nova senha</Label>
                      <div className="relative">
                        <Input
                          id="newPassword"
                          type={showPassword ? "text" : "password"}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Digite a nova senha"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full px-3"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="confirmPassword">Confirmar nova senha</Label>
                      <Input
                        id="confirmPassword"
                        type={showPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Confirme a nova senha"
                      />
                    </div>

                    <Button
                      onClick={changePassword}
                      disabled={changingPassword || !newPassword || !confirmPassword}
                      className="w-fit"
                    >
                      {changingPassword ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Shield className="h-4 w-4 mr-2" />
                      )}
                      Alterar senha
                    </Button>
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <h3 className="font-medium">Autenticação de Dois Fatores</h3>
                  <p className="text-sm text-muted-foreground">
                    Adicione uma camada extra de segurança à sua conta
                  </p>
                  <Badge variant="outline" className="text-muted-foreground">
                    Em breve
                  </Badge>
                </div>

                <Separator />

                <div className="space-y-4">
                  <h3 className="font-medium">Sessões Ativas</h3>
                  <p className="text-sm text-muted-foreground">
                    Gerencie os dispositivos conectados à sua conta
                  </p>
                  <div className="p-4 border rounded-lg bg-muted/50">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">Este dispositivo</p>
                        <p className="text-xs text-muted-foreground">
                          Último acesso: agora
                        </p>
                      </div>
                      <Badge variant="default" className="bg-green-500">
                        Ativo
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Plan Tab */}
          <TabsContent value="plan">
            <Card>
              <CardHeader>
                <CardTitle>Plano e Faturamento</CardTitle>
                <CardDescription>
                  Gerencie seu plano e informações de pagamento
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="p-6 border rounded-lg bg-gradient-to-br from-primary/10 to-primary/5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-semibold capitalize">
                        Plano {workspace?.plan || "Free"}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {workspace?.plan === "free"
                          ? "Recursos básicos para começar"
                          : "Todos os recursos incluídos"}
                      </p>
                    </div>
                    <Badge
                      variant={workspace?.plan === "free" ? "secondary" : "default"}
                      className="capitalize"
                    >
                      {workspace?.plan || "Free"}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                    <div className="p-3 bg-background rounded-lg">
                      <p className="text-2xl font-bold text-primary">∞</p>
                      <p className="text-xs text-muted-foreground">Mensagens</p>
                    </div>
                    <div className="p-3 bg-background rounded-lg">
                      <p className="text-2xl font-bold text-primary">3</p>
                      <p className="text-xs text-muted-foreground">Instâncias</p>
                    </div>
                    <div className="p-3 bg-background rounded-lg">
                      <p className="text-2xl font-bold text-primary">5</p>
                      <p className="text-xs text-muted-foreground">Personas</p>
                    </div>
                    <div className="p-3 bg-background rounded-lg">
                      <p className="text-2xl font-bold text-primary">10</p>
                      <p className="text-xs text-muted-foreground">Fluxos</p>
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <h3 className="font-medium">Upgrade de Plano</h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="p-4 border rounded-lg">
                      <h4 className="font-medium">Pro</h4>
                      <p className="text-2xl font-bold mt-2">
                        R$ 97<span className="text-sm font-normal">/mês</span>
                      </p>
                      <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                        <li>✓ Instâncias ilimitadas</li>
                        <li>✓ Personas ilimitadas</li>
                        <li>✓ Suporte prioritário</li>
                        <li>✓ Integrações avançadas</li>
                      </ul>
                      <Button className="w-full mt-4" variant="outline">
                        Fazer upgrade
                      </Button>
                    </div>

                    <div className="p-4 border rounded-lg border-primary">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium">Enterprise</h4>
                        <Badge>Popular</Badge>
                      </div>
                      <p className="text-2xl font-bold mt-2">
                        R$ 297<span className="text-sm font-normal">/mês</span>
                      </p>
                      <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                        <li>✓ Tudo do Pro</li>
                        <li>✓ API dedicada</li>
                        <li>✓ SLA garantido</li>
                        <li>✓ Suporte 24/7</li>
                      </ul>
                      <Button className="w-full mt-4">
                        Fazer upgrade
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default Settings;

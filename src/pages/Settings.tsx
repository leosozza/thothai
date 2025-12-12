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
import { 
  User, 
  Building2, 
  Bell, 
  Shield, 
  CreditCard, 
  Save,
  Loader2,
  Key,
  Eye,
  EyeOff,
  Copy,
  Check
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

const Settings = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const { workspace, refreshWorkspaces } = useWorkspace();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Profile form state
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");

  // Workspace form state
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceSlug, setWorkspaceSlug] = useState("");

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

  // API Key
  const [showApiKey, setShowApiKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

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
      setWorkspaceName(workspace.name);
      setWorkspaceSlug(workspace.slug);
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

  const saveWorkspace = async () => {
    if (!workspace) return;
    setSaving(true);

    try {
      const { error } = await supabase
        .from("workspaces")
        .update({
          name: workspaceName,
          slug: workspaceSlug.toLowerCase().replace(/[^a-z0-9-]/g, ""),
          updated_at: new Date().toISOString(),
        })
        .eq("id", workspace.id);

      if (error) throw error;

      await refreshWorkspaces();

      toast({
        title: "Workspace atualizado",
        description: "As configurações foram salvas com sucesso.",
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

  const copyApiKey = () => {
    if (workspace) {
      navigator.clipboard.writeText(workspace.id);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
      toast({
        title: "Copiado!",
        description: "API Key copiada para a área de transferência.",
      });
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
          <TabsList className="grid w-full grid-cols-5 lg:w-auto lg:inline-flex">
            <TabsTrigger value="profile" className="gap-2">
              <User className="h-4 w-4 hidden sm:inline" />
              Perfil
            </TabsTrigger>
            <TabsTrigger value="workspace" className="gap-2">
              <Building2 className="h-4 w-4 hidden sm:inline" />
              Workspace
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

          {/* Workspace Tab */}
          <TabsContent value="workspace">
            <Card>
              <CardHeader>
                <CardTitle>Configurações do Workspace</CardTitle>
                <CardDescription>
                  Gerencie as configurações do seu workspace
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="workspaceName">Nome do workspace</Label>
                    <Input
                      id="workspaceName"
                      value={workspaceName}
                      onChange={(e) => setWorkspaceName(e.target.value)}
                      placeholder="Nome do workspace"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="workspaceSlug">Slug (URL)</Label>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        thoth.app/
                      </span>
                      <Input
                        id="workspaceSlug"
                        value={workspaceSlug}
                        onChange={(e) => setWorkspaceSlug(e.target.value)}
                        placeholder="meu-workspace"
                        className="flex-1"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Apenas letras minúsculas, números e hífens
                    </p>
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <h3 className="font-medium flex items-center gap-2">
                    <Key className="h-4 w-4" />
                    API Key
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Use esta chave para integrar com APIs externas
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      type={showApiKey ? "text" : "password"}
                      value={workspace?.id || ""}
                      readOnly
                      className="font-mono text-sm bg-muted"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setShowApiKey(!showApiKey)}
                    >
                      {showApiKey ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={copyApiKey}
                    >
                      {copiedKey ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button onClick={saveWorkspace} disabled={saving}>
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

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/layout/AppLayout";
import { useWorkspace } from "@/hooks/useWorkspace";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { 
  Bot, 
  Key, 
  Check, 
  X, 
  Plus, 
  ExternalLink, 
  Sparkles,
  Loader2,
  Eye,
  EyeOff,
  Trash2,
  Info,
  Coins,
  Zap,
  Crown,
  Star
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface NativeAIModel {
  id: string;
  name: string;
  display_name: string;
  tier: "basic" | "professional" | "expert";
  token_cost_multiplier: number;
  provider_source: string;
  description: string | null;
  is_active: boolean;
}

interface AIProvider {
  id: string;
  name: string;
  slug: string;
  base_url: string;
  is_native: boolean;
  tier: string;
  token_cost_multiplier: number;
  logo_url: string | null;
  docs_url: string | null;
  key_generation_guide: string | null;
  available_models: string[];
  is_active: boolean;
}

interface WorkspaceCredential {
  id: string;
  provider_id: string;
  is_active: boolean;
  last_used_at: string | null;
}

const tierConfig = {
  basic: {
    label: "Basic",
    multiplier: "1x",
    color: "bg-green-500/10 text-green-600 border-green-500/30",
    icon: Zap,
    description: "Modelos leves e gratuitos"
  },
  professional: {
    label: "Professional",
    multiplier: "2x",
    color: "bg-blue-500/10 text-blue-600 border-blue-500/30",
    icon: Star,
    description: "Equilíbrio entre custo e performance"
  },
  expert: {
    label: "Expert",
    multiplier: "5x",
    color: "bg-purple-500/10 text-purple-600 border-purple-500/30",
    icon: Crown,
    description: "Máxima capacidade e qualidade"
  }
};

// Slugs permitidos para API própria (exibição ao cliente)
const allowedOwnApiProviders = ["anthropic", "deepseek", "google", "openai", "groq"];

export default function AIProviders() {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [nativeModels, setNativeModels] = useState<NativeAIModel[]>([]);
  const [credentials, setCredentials] = useState<WorkspaceCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<AIProvider | null>(null);
  const [showAddKeyDialog, setShowAddKeyDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);

  useEffect(() => {
    if (workspace?.id) {
      fetchData();
    }
  }, [workspace?.id]);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // Fetch native AI models
      const { data: nativeData, error: nativeError } = await supabase
        .from("native_ai_models")
        .select("*")
        .eq("is_active", true)
        .order("tier")
        .order("display_name");

      if (nativeError) throw nativeError;
      setNativeModels((nativeData || []) as NativeAIModel[]);

      // Fetch external providers (non-native)
      const { data: providersData, error: providersError } = await supabase
        .from("ai_providers")
        .select("*")
        .eq("is_active", true)
        .eq("is_native", false)
        .order("name");

      if (providersError) throw providersError;

      const parsedProviders = (providersData || []).map(p => ({
        ...p,
        available_models: Array.isArray(p.available_models) 
          ? (p.available_models as unknown as string[])
          : [],
      })) as AIProvider[];

      setProviders(parsedProviders);

      // Fetch workspace credentials
      if (workspace?.id) {
        const { data: credsData, error: credsError } = await supabase
          .from("workspace_ai_credentials")
          .select("id, provider_id, is_active, last_used_at")
          .eq("workspace_id", workspace.id);

        if (credsError) throw credsError;
        setCredentials(credsData || []);
      }
    } catch (error) {
      console.error("Error fetching AI providers:", error);
      toast.error("Erro ao carregar provedores de IA");
    } finally {
      setLoading(false);
    }
  };

  const hasCredential = (providerId: string) => {
    return credentials.some(c => c.provider_id === providerId && c.is_active);
  };

  const getCredential = (providerId: string) => {
    return credentials.find(c => c.provider_id === providerId);
  };

  const openAddKeyDialog = (provider: AIProvider) => {
    setSelectedProvider(provider);
    setApiKey("");
    setShowApiKey(false);
    setTestResult(null);
    setShowAddKeyDialog(true);
  };

  const openDeleteDialog = (provider: AIProvider) => {
    setSelectedProvider(provider);
    setShowDeleteDialog(true);
  };

  const testApiKey = async () => {
    if (!selectedProvider || !apiKey.trim()) return;
    
    setTesting(true);
    setTestResult(null);
    
    try {
      const response = await supabase.functions.invoke("ai-gateway", {
        body: {
          messages: [{ role: "user", content: "Hello" }],
          provider_slug: selectedProvider.slug,
          model: selectedProvider.available_models[0] || "test",
          workspace_id: workspace?.id,
          max_tokens: 5,
        },
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      setTestResult("success");
      toast.success("API key válida!");
    } catch (error) {
      console.error("API key test failed:", error);
      setTestResult("error");
      toast.error("API key inválida ou erro de conexão");
    } finally {
      setTesting(false);
    }
  };

  const saveApiKey = async () => {
    if (!selectedProvider || !apiKey.trim() || !workspace?.id) return;
    
    setSaving(true);
    
    try {
      const existingCred = getCredential(selectedProvider.id);
      
      if (existingCred) {
        const { error } = await supabase
          .from("workspace_ai_credentials")
          .update({
            api_key_encrypted: apiKey.trim(),
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingCred.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("workspace_ai_credentials")
          .insert({
            workspace_id: workspace.id,
            provider_id: selectedProvider.id,
            api_key_encrypted: apiKey.trim(),
            is_active: true,
          });

        if (error) throw error;
      }

      toast.success(`API key do ${selectedProvider.name} salva com sucesso!`);
      setShowAddKeyDialog(false);
      fetchData();
    } catch (error) {
      console.error("Error saving API key:", error);
      toast.error("Erro ao salvar API key");
    } finally {
      setSaving(false);
    }
  };

  const deleteCredential = async () => {
    if (!selectedProvider || !workspace?.id) return;

    const cred = getCredential(selectedProvider.id);
    if (!cred) return;

    try {
      const { error } = await supabase
        .from("workspace_ai_credentials")
        .delete()
        .eq("id", cred.id);

      if (error) throw error;

      toast.success(`API key do ${selectedProvider.name} removida`);
      setShowDeleteDialog(false);
      fetchData();
    } catch (error) {
      console.error("Error deleting credential:", error);
      toast.error("Erro ao remover API key");
    }
  };

  const getModelsByTier = (tier: "basic" | "professional" | "expert") => {
    return nativeModels.filter(m => m.tier === tier);
  };

  const renderTierSection = (tier: "basic" | "professional" | "expert") => {
    const config = tierConfig[tier];
    const models = getModelsByTier(tier);
    const TierIcon = config.icon;

    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge className={`${config.color} border`}>
            <TierIcon className="h-3 w-3 mr-1" />
            {config.label}
          </Badge>
          <span className="text-sm text-muted-foreground">({config.multiplier} tokens)</span>
        </div>
        <p className="text-sm text-muted-foreground">{config.description}</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {models.map(model => (
            <div 
              key={model.id}
              className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{model.display_name}</p>
                {model.description && (
                  <p className="text-xs text-muted-foreground truncate">{model.description}</p>
                )}
              </div>
              <Badge variant="outline" className="text-xs ml-2 shrink-0">
                {config.multiplier}
              </Badge>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderProviderCard = (provider: AIProvider) => {
    const connected = hasCredential(provider.id);
    const credential = getCredential(provider.id);

    return (
      <Card 
        key={provider.id} 
        className={`relative overflow-hidden transition-all duration-200 hover:shadow-lg ${
          connected ? "border-primary/50 bg-primary/5" : ""
        }`}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                <Bot className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <CardTitle className="text-base">{provider.name}</CardTitle>
                {connected && (
                  <Badge variant="default" className="text-xs bg-green-600 mt-1">
                    <Check className="h-3 w-3 mr-1" />
                    Conectado
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1">
            {provider.available_models.slice(0, 3).map((model, i) => (
              <Badge key={i} variant="outline" className="text-xs">
                {model}
              </Badge>
            ))}
            {provider.available_models.length > 3 && (
              <Badge variant="outline" className="text-xs">
                +{provider.available_models.length - 3}
              </Badge>
            )}
          </div>

          {credential?.last_used_at && (
            <p className="text-xs text-muted-foreground">
              Último uso: {new Date(credential.last_used_at).toLocaleDateString("pt-BR")}
            </p>
          )}

          <div className="flex items-center gap-2 pt-2">
            {connected ? (
              <>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => openAddKeyDialog(provider)}
                >
                  <Key className="h-4 w-4 mr-1" />
                  Atualizar
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => openDeleteDialog(provider)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <Button 
                size="sm" 
                onClick={() => openAddKeyDialog(provider)}
              >
                <Plus className="h-4 w-4 mr-1" />
                Adicionar Key
              </Button>
            )}

            {provider.docs_url && (
              <Button 
                variant="ghost" 
                size="sm" 
                asChild
              >
                <a href={provider.docs_url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Provedores de IA</h1>
          <p className="text-muted-foreground mt-1">
            Escolha entre IAs nativas ThothAI (usa créditos) ou configure suas próprias API keys.
          </p>
        </div>

        <Tabs defaultValue="native" className="w-full">
          <TabsList className="grid w-full grid-cols-2 max-w-md">
            <TabsTrigger value="native" className="gap-2">
              <Sparkles className="h-4 w-4" />
              ThothAI
            </TabsTrigger>
            <TabsTrigger value="own" className="gap-2">
              <Key className="h-4 w-4" />
              API Key Própria
            </TabsTrigger>
          </TabsList>

          <TabsContent value="native" className="mt-6 space-y-6">
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="flex items-start gap-4 py-4">
                <Coins className="h-5 w-5 text-primary mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-primary">Como funcionam os créditos ThothAI?</p>
                  <p className="text-muted-foreground mt-1">
                    Use créditos ThothAI para acessar diversos modelos de IA. Modelos <strong>Basic</strong> consomem 1x tokens, 
                    <strong> Professional</strong> 2x tokens, e <strong>Expert</strong> 5x tokens.
                  </p>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-8">
              {renderTierSection("basic")}
              {renderTierSection("professional")}
              {renderTierSection("expert")}
            </div>
          </TabsContent>

          <TabsContent value="own" className="mt-6 space-y-6">
            <Card className="bg-muted/50 border-muted-foreground/20">
              <CardContent className="flex items-start gap-4 py-4">
                <Info className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium">Use sua própria API Key</p>
                  <p className="text-muted-foreground mt-1">
                    Configure sua chave de API de cada provedor. <strong>Sem consumo de créditos</strong> - 
                    você paga diretamente ao provedor.
                  </p>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {providers
                .filter(p => allowedOwnApiProviders.includes(p.slug))
                .map(renderProviderCard)}
            </div>

            {providers.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Bot className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Nenhum provedor externo disponível no momento.</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Add/Edit API Key Dialog */}
      <Dialog open={showAddKeyDialog} onOpenChange={setShowAddKeyDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              {selectedProvider?.name}
            </DialogTitle>
            <DialogDescription>
              {hasCredential(selectedProvider?.id || "") 
                ? "Atualize a API key deste provedor."
                : "Adicione sua API key para usar este provedor."
              }
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key</Label>
              <div className="relative">
                <Input
                  id="apiKey"
                  type={showApiKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {selectedProvider?.key_generation_guide && (
              <div className="rounded-lg bg-muted p-4">
                <ScrollArea className="h-48">
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <pre className="whitespace-pre-wrap text-xs font-sans">
                      {selectedProvider.key_generation_guide}
                    </pre>
                  </div>
                </ScrollArea>
              </div>
            )}

            {testResult && (
              <div className={`flex items-center gap-2 p-3 rounded-lg ${
                testResult === "success" 
                  ? "bg-green-500/10 text-green-600" 
                  : "bg-red-500/10 text-red-600"
              }`}>
                {testResult === "success" ? (
                  <>
                    <Check className="h-4 w-4" />
                    <span className="text-sm">API key válida!</span>
                  </>
                ) : (
                  <>
                    <X className="h-4 w-4" />
                    <span className="text-sm">API key inválida ou erro de conexão</span>
                  </>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button 
              variant="outline" 
              onClick={testApiKey}
              disabled={!apiKey.trim() || testing}
            >
              {testing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Testar Conexão
            </Button>
            <Button 
              onClick={saveApiKey}
              disabled={!apiKey.trim() || saving}
            >
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover API Key?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover a API key do <strong>{selectedProvider?.name}</strong>?
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction 
              onClick={deleteCredential}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}

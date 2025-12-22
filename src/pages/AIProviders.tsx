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
  Coins
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

interface AIProvider {
  id: string;
  name: string;
  slug: string;
  base_url: string;
  is_free: boolean;
  is_native: boolean;
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

export default function AIProviders() {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const [providers, setProviders] = useState<AIProvider[]>([]);
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
      
      // Fetch all active providers
      const { data: providersData, error: providersError } = await supabase
        .from("ai_providers")
        .select("*")
        .eq("is_active", true)
        .order("is_native", { ascending: false })
        .order("is_free", { ascending: false })
        .order("name");

      if (providersError) throw providersError;

      // Parse available_models from JSONB
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
      // Simple test call to verify API key works
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
        // Update existing
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
        // Insert new
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

  const renderProviderCard = (provider: AIProvider) => {
    const connected = provider.is_native || hasCredential(provider.id);
    const credential = getCredential(provider.id);

    return (
      <Card 
        key={provider.id} 
        className={`relative overflow-hidden transition-all duration-200 hover:shadow-lg ${
          connected ? "border-primary/50 bg-primary/5" : ""
        }`}
      >
        {provider.is_native && (
          <div className="absolute top-0 right-0 bg-primary text-primary-foreground px-3 py-1 text-xs font-medium rounded-bl-lg">
            <Sparkles className="h-3 w-3 inline mr-1" />
            Nativo
          </div>
        )}
        
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center">
                <Bot className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <CardTitle className="text-lg">{provider.name}</CardTitle>
                <CardDescription className="flex items-center gap-2 mt-1">
                  {provider.is_free && (
                    <Badge variant="secondary" className="text-xs">
                      Plano Gratuito
                    </Badge>
                  )}
                  {connected && (
                    <Badge variant="default" className="text-xs bg-green-600">
                      <Check className="h-3 w-3 mr-1" />
                      Conectado
                    </Badge>
                  )}
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground mb-2">Modelos disponíveis:</p>
            <div className="flex flex-wrap gap-1">
              {provider.available_models.slice(0, 4).map((model, i) => (
                <Badge key={i} variant="outline" className="text-xs">
                  {model}
                </Badge>
              ))}
              {provider.available_models.length > 4 && (
                <Badge variant="outline" className="text-xs">
                  +{provider.available_models.length - 4}
                </Badge>
              )}
            </div>
          </div>

          {credential?.last_used_at && (
            <p className="text-xs text-muted-foreground">
              Último uso: {new Date(credential.last_used_at).toLocaleDateString("pt-BR")}
            </p>
          )}

          <div className="flex items-center gap-2 pt-2">
            {provider.is_native ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Coins className="h-4 w-4" />
                <span>Usa créditos nativos</span>
              </div>
            ) : connected ? (
              <>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => openAddKeyDialog(provider)}
                >
                  <Key className="h-4 w-4 mr-1" />
                  Atualizar Key
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
                Adicionar API Key
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
            Configure as API keys dos provedores de IA que você deseja usar.
          </p>
        </div>

        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="flex items-start gap-4 py-4">
            <Info className="h-5 w-5 text-primary mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-primary">Como funciona?</p>
              <p className="text-muted-foreground mt-1">
                Você pode usar o <strong>Lovable AI</strong> (créditos nativos) ou configurar suas próprias API keys.
                Cada persona pode usar um provedor diferente. As API keys são armazenadas de forma segura.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map(renderProviderCard)}
        </div>
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
              Isso irá remover a API key do {selectedProvider?.name}. 
              As personas que usam este provedor passarão a usar o Lovable AI.
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

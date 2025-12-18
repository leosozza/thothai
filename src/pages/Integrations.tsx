import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  MessageSquare,
  Zap,
  Webhook,
  Key,
  ExternalLink,
  Loader2,
  Settings,
  AlertCircle,
  Building2,
  CheckCircle2,
  XCircle,
  Copy,
  Star,
  ChevronRight,
  Users,
  RefreshCw,
  ArrowLeftRight,
  Trash2,
  Plus,
  Phone,
  Bot,
  AlertTriangle,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Integration {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown> | null;
  is_active: boolean;
  last_sync_at: string | null;
}

interface Instance {
  id: string;
  name: string;
  phone_number: string | null;
  status: string;
}

interface ChannelMapping {
  id: string;
  instance_id: string;
  line_id: number;
  line_name: string | null;
  is_active: boolean;
  instance_name?: string;
  phone_number?: string | null;
}

const integrationTypes = [
  {
    type: "wapi",
    name: "W-API",
    description: "Conecte ao WhatsApp Business via W-API para enviar e receber mensagens.",
    icon: MessageSquare,
    color: "bg-green-500",
    fields: [
      { key: "api_key", label: "API Key", type: "password", placeholder: "Sua chave da W-API" },
      { key: "instance_id", label: "Instance ID", type: "text", placeholder: "ID da instância W-API" },
    ],
    docs: "https://w-api.io/docs",
  },
  {
    type: "openai",
    name: "OpenAI",
    description: "Use modelos GPT para respostas avançadas de IA.",
    icon: Zap,
    color: "bg-purple-500",
    fields: [
      { key: "api_key", label: "API Key", type: "password", placeholder: "sk-..." },
    ],
    docs: "https://platform.openai.com/docs",
  },
  {
    type: "elevenlabs",
    name: "ElevenLabs",
    description: "Text-to-Speech para respostas em áudio com vozes naturais.",
    icon: MessageSquare,
    color: "bg-blue-500",
    fields: [
      { key: "api_key", label: "API Key", type: "password", placeholder: "Sua chave ElevenLabs" },
      { key: "voice_id", label: "Voice ID", type: "text", placeholder: "ID da voz padrão" },
    ],
    docs: "https://elevenlabs.io/docs",
  },
  {
    type: "webhook",
    name: "Webhook",
    description: "Envie eventos para URLs externas via webhooks.",
    icon: Webhook,
    color: "bg-orange-500",
    fields: [
      { key: "url", label: "Webhook URL", type: "text", placeholder: "https://..." },
      { key: "secret", label: "Secret (opcional)", type: "password", placeholder: "Chave secreta" },
    ],
    docs: null,
  },
  {
    type: "n8n",
    name: "n8n",
    description: "Integre com workflows do n8n para automações avançadas.",
    icon: Zap,
    color: "bg-red-500",
    fields: [
      { key: "webhook_url", label: "Webhook URL", type: "text", placeholder: "URL do webhook n8n" },
    ],
    docs: "https://docs.n8n.io",
  },
];

// Bitrix24 App URLs
const BITRIX24_HANDLER_URL = "https://ybqwwipwimnkonnebbys.supabase.co/functions/v1/bitrix24-install";
const BITRIX24_INITIAL_INSTALL_URL = "https://chat.thoth24.com/bitrix24-setup";

export default function Integrations() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<typeof integrationTypes[0] | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const { workspace } = useWorkspace();

  // Bitrix24 specific states
  const [bitrixWebhookUrl, setBitrixWebhookUrl] = useState("");
  const [bitrixConnectorId, setBitrixConnectorId] = useState("thoth_whatsapp");
  const [bitrixInstanceId, setBitrixInstanceId] = useState("");
  const [registeringBitrix, setRegisteringBitrix] = useState(false);
  const [bitrixConfigMode, setBitrixConfigMode] = useState<"webhook" | "app">("app");
  const [syncingContacts, setSyncingContacts] = useState(false);
  const [syncDirection, setSyncDirection] = useState<"both" | "to_bitrix" | "from_bitrix">("both");

  // Token de vinculação Bitrix24
  const [linkingToken, setLinkingToken] = useState<string | null>(null);
  const [generatingToken, setGeneratingToken] = useState(false);

  // OAuth Manual Bitrix24
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [oauthDomain, setOauthDomain] = useState("");
  const [savingOAuth, setSavingOAuth] = useState(false);

  // Channel Mappings
  const [channelMappings, setChannelMappings] = useState<ChannelMapping[]>([]);
  const [showMappingDialog, setShowMappingDialog] = useState(false);
  const [newMappingInstanceId, setNewMappingInstanceId] = useState("");
  const [newMappingLineId, setNewMappingLineId] = useState("");
  const [newMappingLineName, setNewMappingLineName] = useState("");
  const [savingMapping, setSavingMapping] = useState(false);
  const [cleaningConnectors, setCleaningConnectors] = useState(false);

  // Bitrix24 Channels with enhanced status
  const [bitrixChannels, setBitrixChannels] = useState<Array<{ 
    id: number; 
    name: string; 
    active: boolean;
    connector_active?: boolean;
    connector_registered?: boolean;
    connector_connection?: boolean;
    mapping?: {
      instance_id: string;
      instance_name?: string;
      phone_number?: string | null;
      is_active: boolean;
    };
  }>>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [showCreateChannelDialog, setShowCreateChannelDialog] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [activatingLineId, setActivatingLineId] = useState<number | null>(null);

  // Chatbot AI states
  const [personas, setPersonas] = useState<Array<{ id: string; name: string; description: string | null }>>([]);
  const [chatbotEnabled, setChatbotEnabled] = useState(false);
  const [selectedPersonaId, setSelectedPersonaId] = useState("");
  const [savingChatbot, setSavingChatbot] = useState(false);

  // Universal Bot states
  const [botRegistered, setBotRegistered] = useState(false);
  const [botId, setBotId] = useState<number | null>(null);
  const [botEnabled, setBotEnabled] = useState(false);
  const [botPersonaId, setBotPersonaId] = useState("");
  const [botWelcomeMessage, setBotWelcomeMessage] = useState("");
  const [registeringBot, setRegisteringBot] = useState(false);
  const [unregisteringBot, setUnregisteringBot] = useState(false);
  const [savingBotConfig, setSavingBotConfig] = useState(false);

  // Automation Robot states
  const [robotRegistered, setRobotRegistered] = useState(false);
  const [registeringRobot, setRegisteringRobot] = useState(false);
  const [unregisteringRobot, setUnregisteringRobot] = useState(false);

  // Token status
  const [tokenExpired, setTokenExpired] = useState(false);
  const [tokenRefreshFailed, setTokenRefreshFailed] = useState(false);

  // Test and refresh states
  const [testingConnection, setTestingConnection] = useState(false);
  const [refreshingToken, setRefreshingToken] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string; details?: any } | null>(null);
  
  // Connector activation states
  const [activatingConnector, setActivatingConnector] = useState(false);
  const [checkingConnector, setCheckingConnector] = useState(false);
  const [connectorDiagnosis, setConnectorDiagnosis] = useState<{ registered: boolean; activated: boolean; diagnosis: string } | null>(null);
  const [selectedLineIdForActivation, setSelectedLineIdForActivation] = useState("1");

  useEffect(() => {
    if (workspace) {
      fetchIntegrations();
      fetchInstances();
      fetchChannelMappings();
      fetchPersonas();
    }
  }, [workspace]);

  const fetchIntegrations = async () => {
    try {
      const { data, error } = await supabase
        .from("integrations")
        .select("*")
        .eq("workspace_id", workspace?.id);

      if (error) throw error;
      
      const mappedData: Integration[] = (data || []).map((item) => ({
        id: item.id,
        type: item.type,
        name: item.name,
        config: item.config as Record<string, unknown> | null,
        is_active: item.is_active,
        last_sync_at: item.last_sync_at,
      }));
      
      setIntegrations(mappedData);

      // Load Bitrix24 config if exists
      const bitrixIntegration = mappedData.find((i) => i.type === "bitrix24");
      if (bitrixIntegration?.config) {
        setBitrixWebhookUrl((bitrixIntegration.config.webhook_url as string) || "");
        setBitrixConnectorId((bitrixIntegration.config.connector_id as string) || "thoth_whatsapp");
        setBitrixInstanceId((bitrixIntegration.config.instance_id as string) || "");
        // If has member_id, it was installed via internal app
        if (bitrixIntegration.config.member_id) {
          setBitrixConfigMode("app");
        }
      }
    } catch (error) {
      console.error("Error fetching integrations:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchInstances = async () => {
    try {
      const { data, error } = await supabase
        .from("instances")
        .select("id, name, phone_number, status")
        .eq("workspace_id", workspace?.id);

      if (error) throw error;
      setInstances(data || []);
    } catch (error) {
      console.error("Error fetching instances:", error);
    }
  };

  const fetchChannelMappings = async () => {
    if (!workspace?.id) return;
    try {
      const { data, error } = await supabase
        .from("bitrix_channel_mappings")
        .select(`
          id,
          instance_id,
          line_id,
          line_name,
          is_active,
          instances (name, phone_number)
        `)
        .eq("workspace_id", workspace.id);

      if (error) throw error;

      const mappings: ChannelMapping[] = (data || []).map((item: any) => ({
        id: item.id,
        instance_id: item.instance_id,
        line_id: item.line_id,
        line_name: item.line_name,
        is_active: item.is_active,
        instance_name: item.instances?.name,
        phone_number: item.instances?.phone_number,
      }));

      setChannelMappings(mappings);
    } catch (error) {
      console.error("Error fetching channel mappings:", error);
    }
  };

  // Fetch Bitrix24 channels with connector status
  const fetchBitrixChannels = async (includeConnectorStatus = false) => {
    const bitrix = integrations.find((i) => i.type === "bitrix24");
    if (!bitrix?.config?.access_token && !bitrix?.config?.webhook_url) return;

    setLoadingChannels(true);
    try {
      const response = await supabase.functions.invoke("bitrix24-webhook", {
        body: {
          action: "list_channels",
          integration_id: bitrix.id,
          include_connector_status: includeConnectorStatus
        }
      });

      if (response.data?.channels) {
        setBitrixChannels(response.data.channels);
      } else if (response.data?.error) {
        console.error("Error fetching channels:", response.data.error);
      }
    } catch (error) {
      console.error("Error fetching Bitrix channels:", error);
    } finally {
      setLoadingChannels(false);
    }
  };

  // Activate/deactivate connector for a specific line
  const handleActivateConnectorForLine = async (lineId: number, active: boolean) => {
    const bitrix = integrations.find((i) => i.type === "bitrix24");
    if (!bitrix) {
      toast.error("Integração Bitrix24 não encontrada");
      return;
    }

    setActivatingLineId(lineId);
    try {
      const response = await supabase.functions.invoke("bitrix24-webhook", {
        body: {
          action: "activate_connector_for_line",
          integration_id: bitrix.id,
          line_id: lineId,
          active
        }
      });

      if (response.data?.success) {
        toast.success(response.data.message || (active ? "Conector ativado!" : "Conector desativado!"));
        // Refresh channels with status
        await fetchBitrixChannels(true);
      } else {
        toast.error(response.data?.error || "Erro ao alterar status do conector");
      }
    } catch (error) {
      console.error("Error activating connector:", error);
      toast.error("Erro ao ativar/desativar conector");
    } finally {
      setActivatingLineId(null);
    }
  };

  // Quick mapping for a line
  const handleQuickMapping = (lineId: number, lineName: string) => {
    setNewMappingLineId(lineId.toString());
    setNewMappingLineName(lineName);
    setShowMappingDialog(true);
  };

  // Fetch personas for chatbot
  const fetchPersonas = async () => {
    if (!workspace?.id) return;
    try {
      const { data, error } = await supabase
        .from("personas")
        .select("id, name, description")
        .eq("workspace_id", workspace.id);

      if (error) throw error;
      setPersonas(data || []);

      // Load chatbot and bot config from integration
      const bitrix = integrations.find((i) => i.type === "bitrix24");
      if (bitrix?.config) {
        // Connector chatbot config
        setChatbotEnabled(!!bitrix.config.chatbot_enabled);
        setSelectedPersonaId((bitrix.config.persona_id as string) || "");
        
        // Universal bot config
        setBotRegistered(!!bitrix.config.bot_id);
        setBotId(bitrix.config.bot_id ? Number(bitrix.config.bot_id) : null);
        setBotEnabled(!!bitrix.config.bot_enabled);
        setBotPersonaId((bitrix.config.bot_persona_id as string) || "");
        setBotWelcomeMessage((bitrix.config.bot_welcome_message as string) || "");
        
        // Automation robot status
        setRobotRegistered(!!bitrix.config.robot_registered);
        
        // Token status
        if (bitrix.config.token_expires_at) {
          const expiresAt = new Date(bitrix.config.token_expires_at as string);
          setTokenExpired(expiresAt < new Date());
        }
        setTokenRefreshFailed(!!bitrix.config.token_refresh_failed);
      }
    } catch (error) {
      console.error("Error fetching personas:", error);
    }
  };

  // Save chatbot configuration (connector chatbot)
  const handleSaveChatbotConfig = async () => {
    const bitrix = integrations.find((i) => i.type === "bitrix24");
    if (!bitrix) {
      toast.error("Integração Bitrix24 não encontrada");
      return;
    }

    setSavingChatbot(true);
    try {
      const { error } = await supabase
        .from("integrations")
        .update({
          config: {
            ...(bitrix.config as Record<string, unknown>),
            chatbot_enabled: chatbotEnabled,
            persona_id: selectedPersonaId || null
          },
          updated_at: new Date().toISOString()
        })
        .eq("id", bitrix.id);

      if (error) throw error;
      toast.success("Configurações do chatbot de conector salvas!");
      fetchIntegrations();
    } catch (error) {
      console.error("Error saving chatbot config:", error);
      toast.error("Erro ao salvar configurações do chatbot");
    } finally {
      setSavingChatbot(false);
    }
  };

  // Register universal bot
  const handleRegisterBot = async () => {
    const bitrix = integrations.find((i) => i.type === "bitrix24");
    if (!bitrix) {
      toast.error("Integração Bitrix24 não encontrada");
      return;
    }

    setRegisteringBot(true);
    try {
      const response = await supabase.functions.invoke("bitrix24-bot-register", {
        body: {
          action: "register",
          integration_id: bitrix.id,
          workspace_id: workspace?.id,
          bot_name: "Thoth AI",
          bot_description: "Assistente Virtual com IA"
        }
      });

      if (response.data?.success) {
        toast.success("Bot universal registrado com sucesso!");
        setBotRegistered(true);
        setBotId(response.data.bot_id);
        fetchIntegrations();
      } else {
        toast.error(response.data?.error || "Erro ao registrar bot");
      }
    } catch (error) {
      console.error("Error registering bot:", error);
      toast.error("Erro ao registrar bot");
    } finally {
      setRegisteringBot(false);
    }
  };

  // Unregister universal bot
  const handleUnregisterBot = async () => {
    const bitrix = integrations.find((i) => i.type === "bitrix24");
    if (!bitrix) {
      toast.error("Integração Bitrix24 não encontrada");
      return;
    }

    setUnregisteringBot(true);
    try {
      const response = await supabase.functions.invoke("bitrix24-bot-register", {
        body: {
          action: "unregister",
          integration_id: bitrix.id,
          workspace_id: workspace?.id
        }
      });

      if (response.data?.success) {
        toast.success("Bot removido com sucesso!");
        setBotRegistered(false);
        setBotId(null);
        setBotEnabled(false);
        setBotPersonaId("");
        fetchIntegrations();
      } else {
        toast.error(response.data?.error || "Erro ao remover bot");
      }
    } catch (error) {
      console.error("Error unregistering bot:", error);
      toast.error("Erro ao remover bot");
    } finally {
      setUnregisteringBot(false);
    }
  };

  // Save universal bot configuration
  const handleSaveBotConfig = async () => {
    const bitrix = integrations.find((i) => i.type === "bitrix24");
    if (!bitrix) {
      toast.error("Integração Bitrix24 não encontrada");
      return;
    }

    setSavingBotConfig(true);
    try {
      const { error } = await supabase
        .from("integrations")
        .update({
          config: {
            ...(bitrix.config as Record<string, unknown>),
            bot_enabled: botEnabled,
            bot_persona_id: botPersonaId || null,
            bot_welcome_message: botWelcomeMessage || null
          },
          updated_at: new Date().toISOString()
        })
        .eq("id", bitrix.id);

      if (error) throw error;
      toast.success("Configurações do bot universal salvas!");
      fetchIntegrations();
    } catch (error) {
      console.error("Error saving bot config:", error);
      toast.error("Erro ao salvar configurações do bot");
    } finally {
      setSavingBotConfig(false);
    }
  };

  // Register automation robot (for CRM automations)
  const handleRegisterRobot = async () => {
    const bitrix = integrations.find((i) => i.type === "bitrix24");
    if (!bitrix) {
      toast.error("Integração Bitrix24 não encontrada");
      return;
    }

    setRegisteringRobot(true);
    try {
      const response = await supabase.functions.invoke("bitrix24-webhook", {
        body: {
          action: "register_robot",
          integration_id: bitrix.id,
        }
      });

      if (response.data?.success) {
        toast.success(response.data.message || "Robot de automação registrado com sucesso!");
        setRobotRegistered(true);
        fetchIntegrations();
      } else {
        toast.error(response.data?.error || "Erro ao registrar robot");
      }
    } catch (error) {
      console.error("Error registering robot:", error);
      toast.error("Erro ao registrar robot de automação");
    } finally {
      setRegisteringRobot(false);
    }
  };

  // Unregister automation robot
  const handleUnregisterRobot = async () => {
    const bitrix = integrations.find((i) => i.type === "bitrix24");
    if (!bitrix) {
      toast.error("Integração Bitrix24 não encontrada");
      return;
    }

    setUnregisteringRobot(true);
    try {
      const response = await supabase.functions.invoke("bitrix24-webhook", {
        body: {
          action: "unregister_robot",
          integration_id: bitrix.id,
        }
      });

      if (response.data?.success) {
        toast.success("Robot de automação removido!");
        setRobotRegistered(false);
        fetchIntegrations();
      } else {
        toast.error(response.data?.error || "Erro ao remover robot");
      }
    } catch (error) {
      console.error("Error unregistering robot:", error);
      toast.error("Erro ao remover robot de automação");
    } finally {
      setUnregisteringRobot(false);
    }
  };

  // Create new Bitrix24 channel
  const handleCreateChannel = async () => {
    if (!newChannelName.trim()) {
      toast.error("Digite o nome do canal");
      return;
    }

    const bitrix = integrations.find((i) => i.type === "bitrix24");
    if (!bitrix) {
      toast.error("Integração Bitrix24 não encontrada");
      return;
    }

    setCreatingChannel(true);
    try {
      const response = await supabase.functions.invoke("bitrix24-webhook", {
        body: {
          action: "create_channel",
          integration_id: bitrix.id,
          channel_name: newChannelName
        }
      });

      if (response.data?.success) {
        toast.success(`Canal "${newChannelName}" criado com sucesso!`);
        setNewChannelName("");
        setShowCreateChannelDialog(false);
        fetchBitrixChannels();
      } else {
        toast.error(response.data?.error || "Erro ao criar canal");
      }
    } catch (error) {
      console.error("Error creating channel:", error);
      toast.error("Erro ao criar canal");
    } finally {
      setCreatingChannel(false);
    }
  };

  // Fetch channels and update chatbot config when Bitrix24 integration is loaded
  useEffect(() => {
    const bitrix = integrations.find((i) => i.type === "bitrix24");
    if (bitrix?.is_active && (bitrix?.config?.access_token || bitrix?.config?.webhook_url)) {
      fetchBitrixChannels();
    }
    // Update chatbot config from integration
    if (bitrix?.config) {
      setChatbotEnabled(!!bitrix.config.chatbot_enabled);
      setSelectedPersonaId((bitrix.config.persona_id as string) || "");
      // Update bot config from integration
      setBotRegistered(!!bitrix.config.bot_id);
      setBotId(bitrix.config.bot_id as number | null);
      setBotEnabled(!!bitrix.config.bot_enabled);
      setBotPersonaId((bitrix.config.bot_persona_id as string) || "");
      // Update robot status
      setRobotRegistered(!!bitrix.config.robot_registered);
    }
  }, [integrations]);

  const handleCleanConnectors = async () => {
    if (!workspace?.id) {
      toast.error("Workspace não encontrado");
      return;
    }

    const bitrix = integrations.find((i) => i.type === "bitrix24");
    if (!bitrix) {
      toast.error("Integração Bitrix24 não encontrada");
      return;
    }

    setCleaningConnectors(true);
    try {
      const response = await supabase.functions.invoke("bitrix24-register", {
        body: {
          action: "clean_connectors",
          workspace_id: workspace.id,
          integration_id: bitrix.id,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || "Erro ao limpar conectores");
      }

      const result = response.data;
      if (result?.removed_count > 0) {
        toast.success(`${result.removed_count} conector(es) removido(s) com sucesso!`);
      } else {
        toast.info("Nenhum conector duplicado encontrado");
      }

      fetchIntegrations();
    } catch (error) {
      console.error("Error cleaning connectors:", error);
      toast.error(error instanceof Error ? error.message : "Erro ao limpar conectores");
    } finally {
      setCleaningConnectors(false);
    }
  };

  const handleAddMapping = async () => {
    if (!workspace?.id || !newMappingInstanceId || !newMappingLineId) {
      toast.error("Preencha todos os campos");
      return;
    }

    const bitrix = integrations.find((i) => i.type === "bitrix24");
    if (!bitrix) {
      toast.error("Integração Bitrix24 não encontrada");
      return;
    }

    setSavingMapping(true);
    try {
      // Chamar complete_setup que ativa o conector E salva o mapeamento
      const response = await supabase.functions.invoke("bitrix24-webhook", {
        body: {
          action: "complete_setup",
          workspace_id: workspace.id,
          integration_id: bitrix.id,
          instance_id: newMappingInstanceId,
          line_id: parseInt(newMappingLineId),
          line_name: newMappingLineName || `Linha ${newMappingLineId}`,
        }
      });

      if (response.error) {
        throw new Error(response.error.message || "Erro ao criar mapeamento");
      }

      if (response.data?.error) {
        throw new Error(response.data.error);
      }

      // Mostrar resultado da ativação
      if (response.data?.activation?.success) {
        toast.success("Mapeamento criado e conector ativado no Bitrix24!");
      } else if (response.data?.success) {
        toast.warning("Mapeamento salvo, mas houve um problema na ativação do conector");
      } else {
        toast.success("Mapeamento adicionado com sucesso!");
      }

      setShowMappingDialog(false);
      setNewMappingInstanceId("");
      setNewMappingLineId("");
      setNewMappingLineName("");
      fetchChannelMappings();
    } catch (error: any) {
      console.error("Error adding mapping:", error);
      if (error.message?.includes("já está mapeada") || error.message?.includes("23505")) {
        toast.error("Esta instância ou linha já está mapeada");
      } else {
        toast.error(error.message || "Erro ao adicionar mapeamento");
      }
    } finally {
      setSavingMapping(false);
    }
  };

  const handleDeleteMapping = async (mappingId: string) => {
    try {
      const { error } = await supabase
        .from("bitrix_channel_mappings")
        .delete()
        .eq("id", mappingId);

      if (error) throw error;

      toast.success("Mapeamento removido");
      fetchChannelMappings();
    } catch (error) {
      console.error("Error deleting mapping:", error);
      toast.error("Erro ao remover mapeamento");
    }
  };

  const handleOpenConfig = (type: typeof integrationTypes[0]) => {
    setSelectedType(type);
    const existing = integrations.find((i) => i.type === type.type);
    if (existing && existing.config) {
      setFormData(existing.config as Record<string, string>);
    } else {
      setFormData({});
    }
    setDialogOpen(true);
  };

  const handleSaveIntegration = async () => {
    if (!selectedType) return;

    setSaving(true);
    try {
      const existing = integrations.find((i) => i.type === selectedType.type);

      if (existing) {
        const { error } = await supabase
          .from("integrations")
          .update({
            config: formData,
            is_active: true,
          })
          .eq("id", existing.id);

        if (error) throw error;
      } else {
        const { error } = await supabase.from("integrations").insert({
          workspace_id: workspace?.id,
          type: selectedType.type,
          name: selectedType.name,
          config: formData,
          is_active: true,
        });

        if (error) throw error;
      }

      toast.success("Integração salva!");
      setDialogOpen(false);
      fetchIntegrations();
    } catch (error) {
      console.error("Error saving integration:", error);
      toast.error("Erro ao salvar integração");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleIntegration = async (integration: Integration) => {
    try {
      const { error } = await supabase
        .from("integrations")
        .update({ is_active: !integration.is_active })
        .eq("id", integration.id);

      if (error) throw error;
      toast.success(integration.is_active ? "Integração desativada" : "Integração ativada");
      fetchIntegrations();
    } catch (error) {
      console.error("Error toggling integration:", error);
      toast.error("Erro ao alterar status");
    }
  };

  const getIntegrationStatus = (type: string) => {
    return integrations.find((i) => i.type === type);
  };

  const handleRegisterBitrix24 = async () => {
    if (!bitrixWebhookUrl || !bitrixConnectorId) {
      toast.error("Preencha a URL do Webhook e o ID do Conector");
      return;
    }

    setRegisteringBitrix(true);
    try {
      const existingBitrix = integrations.find((i) => i.type === "bitrix24");

      const response = await supabase.functions.invoke("bitrix24-register", {
        body: {
          webhook_url: bitrixWebhookUrl,
          connector_id: bitrixConnectorId,
          instance_id: bitrixInstanceId || null,
          workspace_id: workspace?.id,
          integration_id: existingBitrix?.id || null,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || "Erro ao registrar conector");
      }

      toast.success("Conector Bitrix24 registrado com sucesso!");
      fetchIntegrations();
    } catch (error) {
      console.error("Error registering Bitrix24:", error);
      toast.error(error instanceof Error ? error.message : "Erro ao registrar conector");
    } finally {
      setRegisteringBitrix(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado!`);
  };

  const handleGenerateLinkingToken = async () => {
    if (!workspace?.id) {
      toast.error("Workspace não encontrado");
      return;
    }

    setGeneratingToken(true);
    try {
      // Generate a random token
      const token = crypto.randomUUID().replace(/-/g, "").substring(0, 16).toUpperCase();

      // Save token to database
      const { error } = await supabase
        .from("workspace_tokens")
        .insert({
          workspace_id: workspace.id,
          token,
          token_type: "bitrix24",
        });

      if (error) throw error;

      setLinkingToken(token);
      toast.success("Token de vinculação gerado com sucesso!");
    } catch (error) {
      console.error("Error generating token:", error);
      toast.error("Erro ao gerar token de vinculação");
    } finally {
      setGeneratingToken(false);
    }
  };

  const fetchExistingToken = async () => {
    if (!workspace?.id) return;

    try {
      const { data } = await supabase
        .from("workspace_tokens")
        .select("token, expires_at, is_used")
        .eq("workspace_id", workspace.id)
        .eq("token_type", "bitrix24")
        .eq("is_used", false)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        setLinkingToken(data.token);
      }
    } catch (error) {
      console.error("Error fetching token:", error);
    }
  };

  useEffect(() => {
    if (workspace) {
      fetchExistingToken();
    }
  }, [workspace]);

  const handleSaveOAuthManual = async () => {
    if (!oauthDomain || !oauthClientId || !oauthClientSecret) {
      toast.error("Preencha todos os campos: Domínio, Client ID e Client Secret");
      return;
    }

    setSavingOAuth(true);
    try {
      const response = await supabase.functions.invoke("bitrix24-install", {
        body: {
          action: "oauth_exchange",
          domain: oauthDomain.replace(/^https?:\/\//, "").replace(/\/$/, ""),
          client_id: oauthClientId,
          client_secret: oauthClientSecret,
          workspace_id: workspace?.id,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || "Erro ao iniciar OAuth");
      }

      const data = response.data;
      const authUrl = data?.auth_url || data?.authorization_url;
      if (authUrl) {
        toast.info("Redirecionando para autorização no Bitrix24...");
        window.location.href = authUrl;
      } else {
        console.error("Response data:", data);
        throw new Error("URL de autorização não retornada");
      }
    } catch (error) {
      console.error("Error initiating OAuth:", error);
      toast.error(error instanceof Error ? error.message : "Erro ao iniciar OAuth");
    } finally {
      setSavingOAuth(false);
    }
  };

  const handleSyncContacts = async () => {
    if (!workspace?.id) {
      toast.error("Workspace não encontrado");
      return;
    }

    const bitrix = integrations.find((i) => i.type === "bitrix24");
    if (!bitrix || !bitrix.is_active) {
      toast.error("Integração Bitrix24 não está ativa");
      return;
    }

    setSyncingContacts(true);
    try {
      const response = await supabase.functions.invoke("bitrix24-sync-contacts", {
        body: {
          workspace_id: workspace.id,
          instance_id: bitrixInstanceId || (bitrix.config?.instance_id as string) || null,
          direction: syncDirection,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || "Erro ao sincronizar contatos");
      }

      const stats = response.data?.stats;
      if (stats) {
        toast.success(
          `Sincronização concluída: ${stats.synced_from_bitrix} importados, ${stats.synced_to_bitrix} exportados, ${stats.updated} atualizados`
        );
      } else {
        toast.success("Contatos sincronizados com sucesso!");
      }
    } catch (error) {
      console.error("Error syncing contacts:", error);
      toast.error(error instanceof Error ? error.message : "Erro ao sincronizar contatos");
    } finally {
      setSyncingContacts(false);
    }
  };

  // Test Bitrix24 connection
  const handleTestConnection = async () => {
    const bitrix = integrations.find((i) => i.type === "bitrix24");
    if (!bitrix) {
      toast.error("Integração Bitrix24 não encontrada");
      return;
    }

    setTestingConnection(true);
    setTestResult(null);
    try {
      const response = await supabase.functions.invoke("bitrix24-test", {
        body: {
          action: "test_connection",
          integration_id: bitrix.id,
          workspace_id: workspace?.id
        }
      });

      if (response.data?.success) {
        setTestResult({ 
          success: true, 
          message: response.data.message,
          details: {
            connectors: response.data.connectors?.length || 0,
            connector_id: response.data.connector_id,
            bot_status: response.data.bot_status,
            token_expires_at: response.data.token_expires_at
          }
        });
        toast.success("Conexão testada com sucesso!");
      } else {
        setTestResult({ 
          success: false, 
          message: response.data?.error || "Falha no teste"
        });
        toast.error(response.data?.error || "Falha no teste de conexão");
      }
    } catch (error) {
      console.error("Error testing connection:", error);
      setTestResult({ success: false, message: "Erro ao testar conexão" });
      toast.error("Erro ao testar conexão");
    } finally {
      setTestingConnection(false);
    }
  };

  // Refresh OAuth token
  const handleRefreshToken = async () => {
    const bitrix = integrations.find((i) => i.type === "bitrix24");
    if (!bitrix) {
      toast.error("Integração Bitrix24 não encontrada");
      return;
    }

    setRefreshingToken(true);
    try {
      const response = await supabase.functions.invoke("bitrix24-test", {
        body: {
          action: "refresh_token",
          integration_id: bitrix.id,
          workspace_id: workspace?.id
        }
      });

      if (response.data?.success) {
        toast.success("Token renovado com sucesso!");
        setTokenExpired(false);
        setTokenRefreshFailed(false);
        fetchIntegrations();
      } else {
        toast.error(response.data?.error || "Falha ao renovar token");
      }
    } catch (error) {
      console.error("Error refreshing token:", error);
      toast.error("Erro ao renovar token");
    } finally {
      setRefreshingToken(false);
    }
  };

  // Check connector status (diagnostic)
  const handleCheckConnector = async () => {
    const bitrix = integrations.find((i) => i.type === "bitrix24");
    if (!bitrix) {
      toast.error("Integração Bitrix24 não encontrada");
      return;
    }

    setCheckingConnector(true);
    try {
      const response = await supabase.functions.invoke("bitrix24-test", {
        body: {
          action: "check_connector",
          integration_id: bitrix.id,
          workspace_id: workspace?.id
        }
      });

      if (response.data?.success) {
        setConnectorDiagnosis({
          registered: response.data.registered,
          activated: response.data.activation_status?.ACTIVE,
          diagnosis: response.data.diagnosis
        });
        toast.info(response.data.diagnosis);
      } else {
        toast.error(response.data?.error || "Falha ao verificar conector");
      }
    } catch (error) {
      console.error("Error checking connector:", error);
      toast.error("Erro ao verificar status do conector");
    } finally {
      setCheckingConnector(false);
    }
  };

  // Activate connector manually
  const handleActivateConnector = async () => {
    const bitrix = integrations.find((i) => i.type === "bitrix24");
    if (!bitrix) {
      toast.error("Integração Bitrix24 não encontrada");
      return;
    }

    setActivatingConnector(true);
    try {
      const response = await supabase.functions.invoke("bitrix24-test", {
        body: {
          action: "activate_connector",
          integration_id: bitrix.id,
          workspace_id: workspace?.id,
          line_id: parseInt(selectedLineIdForActivation) || 1
        }
      });

      if (response.data?.success) {
        toast.success("Conector ativado com sucesso!");
        setConnectorDiagnosis(null);
        fetchIntegrations();
      } else {
        toast.error(response.data?.message || "Falha ao ativar conector");
      }
    } catch (error) {
      console.error("Error activating connector:", error);
      toast.error("Erro ao ativar conector");
    } finally {
      setActivatingConnector(false);
    }
  };

  // Simulate PLACEMENT call (debug)
  const handleSimulatePlacement = async () => {
    const bitrix = integrations.find((i) => i.type === "bitrix24");
    if (!bitrix) {
      toast.error("Integração Bitrix24 não encontrada");
      return;
    }

    setCheckingConnector(true);
    try {
      const response = await supabase.functions.invoke("bitrix24-test", {
        body: {
          action: "simulate_placement",
          integration_id: bitrix.id,
          workspace_id: workspace?.id
        }
      });

      if (response.data?.success) {
        toast.success(response.data.message);
        setConnectorDiagnosis({
          registered: true,
          activated: true,
          diagnosis: `PLACEMENT simulado! Resposta: ${response.data.webhook_response}`
        });
        // Refresh integrations to see updated config
        fetchIntegrations();
      } else {
        toast.error(response.data?.message || "Falha ao simular PLACEMENT");
        setConnectorDiagnosis({
          registered: true,
          activated: false,
          diagnosis: `Erro: ${response.data?.webhook_response || "resposta inesperada"}`
        });
      }
    } catch (error) {
      console.error("Error simulating placement:", error);
      toast.error("Erro ao simular PLACEMENT");
    } finally {
      setCheckingConnector(false);
    }
  };

  const bitrixIntegration = getIntegrationStatus("bitrix24");
  const bitrixConfig = bitrixIntegration?.config || {};

  return (
    <AppLayout title="Integrações">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Settings className="h-7 w-7 text-primary" />
            Integrações
          </h2>
          <p className="text-muted-foreground">
            Conecte serviços externos para expandir as funcionalidades do thoth.AI
          </p>
        </div>

        <Tabs defaultValue="wapi">
          <TabsList>
            <TabsTrigger value="wapi" className="gap-2">
              <MessageSquare className="h-4 w-4" />
              W-API
            </TabsTrigger>
            <TabsTrigger value="crm" className="gap-2">
              <Building2 className="h-4 w-4" />
              CRM
            </TabsTrigger>
            <TabsTrigger value="ai" className="gap-2">
              <Zap className="h-4 w-4" />
              IA & Voz
            </TabsTrigger>
            <TabsTrigger value="webhooks" className="gap-2">
              <Webhook className="h-4 w-4" />
              Webhooks
            </TabsTrigger>
          </TabsList>

          <TabsContent value="wapi" className="mt-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-xl bg-green-500/10 flex items-center justify-center">
                      <MessageSquare className="h-6 w-6 text-green-500" />
                    </div>
                    <div>
                      <CardTitle>W-API</CardTitle>
                      <CardDescription>
                        Integração oficial para WhatsApp Business API
                      </CardDescription>
                    </div>
                  </div>
                  {getIntegrationStatus("wapi") ? (
                    <Badge variant="outline" className="gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-green-500" />
                      Conectado
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Não configurado</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">Como funciona a integração W-API:</p>
                      <ol className="list-decimal list-inside text-muted-foreground mt-2 space-y-1">
                        <li>Crie uma conta em <a href="https://w-api.io" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">w-api.io</a></li>
                        <li>Assine o plano PRO (R$ 29,90/número)</li>
                        <li>Crie uma instância e copie a API Key</li>
                        <li>Cole a API Key abaixo para conectar</li>
                      </ol>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={() => handleOpenConfig(integrationTypes.find((t) => t.type === "wapi")!)}
                  >
                    <Key className="h-4 w-4 mr-2" />
                    {getIntegrationStatus("wapi") ? "Atualizar Configuração" : "Configurar W-API"}
                  </Button>
                  <Button variant="outline" asChild>
                    <a href="https://w-api.io/docs" target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Documentação
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Bitrix24 CRM Tab */}
          <TabsContent value="crm" className="mt-6 space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-xl bg-sky-500/10 flex items-center justify-center">
                      <Building2 className="h-6 w-6 text-sky-500" />
                    </div>
                    <div>
                      <CardTitle>Bitrix24 Open Channels</CardTitle>
                      <CardDescription>
                        Conecte o WhatsApp diretamente ao seu Bitrix24 CRM
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {bitrixIntegration && (
                      <Switch
                        checked={bitrixIntegration.is_active}
                        onCheckedChange={() => handleToggleIntegration(bitrixIntegration)}
                      />
                    )}
                    {bitrixIntegration?.is_active && bitrixConfig.registered ? (
                      <Badge variant="outline" className="gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-green-500" />
                        Conectado
                      </Badge>
                    ) : bitrixIntegration ? (
                      <Badge variant="secondary">Inativo</Badge>
                    ) : (
                      <Badge variant="secondary">Não configurado</Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Config Mode Tabs */}
                <div className="flex gap-2">
                  <Button
                    variant={bitrixConfigMode === "app" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setBitrixConfigMode("app")}
                    className="gap-2"
                  >
                    <Star className="h-4 w-4" />
                    App Interno (Recomendado)
                  </Button>
                  <Button
                    variant={bitrixConfigMode === "webhook" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setBitrixConfigMode("webhook")}
                  >
                    Webhook Manual
                  </Button>
                </div>

                {/* App Interno Mode */}
                {bitrixConfigMode === "app" && (
                  <div className="space-y-6">
                    {/* Benefits */}
                    <div className="bg-sky-500/5 border border-sky-500/20 rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        <Star className="h-5 w-5 text-sky-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium text-sky-600 dark:text-sky-400">Vantagens do App Interno</p>
                          <ul className="text-sm text-muted-foreground mt-1 space-y-1">
                            <li>✓ Detecção automática do domínio Bitrix24</li>
                            <li>✓ Tokens OAuth gerenciados automaticamente</li>
                            <li>✓ Renovação automática de credenciais</li>
                            <li>✓ Não precisa copiar URLs manualmente</li>
                          </ul>
                        </div>
                      </div>
                    </div>

                    {/* Step-by-step Instructions */}
                    <Accordion type="single" collapsible defaultValue="step1">
                      <AccordionItem value="step1">
                        <AccordionTrigger className="text-sm">
                          <div className="flex items-center gap-3">
                            <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">1</div>
                            Criar Aplicativo Local no Bitrix24
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="text-sm text-muted-foreground pl-9">
                          <ol className="list-decimal list-inside space-y-2">
                            <li>Acesse seu Bitrix24</li>
                            <li>Vá em <strong>Aplicativos</strong> → <strong>Marketplace</strong></li>
                            <li>Clique em <strong>Aplicativos Locais</strong> (menu à esquerda)</li>
                            <li>Clique em <strong>Adicionar</strong></li>
                            <li>Selecione <strong>"Aplicativo do servidor"</strong></li>
                          </ol>
                        </AccordionContent>
                      </AccordionItem>

                      <AccordionItem value="step2">
                        <AccordionTrigger className="text-sm">
                          <div className="flex items-center gap-3">
                            <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">2</div>
                            Configurar URLs do Aplicativo
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="space-y-4 pl-9">
                          <p className="text-sm text-muted-foreground">
                            Copie estas URLs para os campos correspondentes:
                          </p>
                          
                          <div className="space-y-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Handler URL (URL do manipulador)</Label>
                              <div className="flex gap-2">
                                <Input
                                  readOnly
                                  value={BITRIX24_HANDLER_URL}
                                  className="font-mono text-xs bg-muted"
                                />
                                <Button
                                  variant="outline"
                                  size="icon"
                                  onClick={() => copyToClipboard(BITRIX24_HANDLER_URL, "Handler URL")}
                                >
                                  <Copy className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>

                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Initial Install URL (URL de instalação inicial)</Label>
                              <div className="flex gap-2">
                                <Input
                                  readOnly
                                  value={BITRIX24_INITIAL_INSTALL_URL}
                                  className="font-mono text-xs bg-muted"
                                />
                                <Button
                                  variant="outline"
                                  size="icon"
                                  onClick={() => copyToClipboard(BITRIX24_INITIAL_INSTALL_URL, "Initial Install URL")}
                                >
                                  <Copy className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>

                      <AccordionItem value="step3">
                        <AccordionTrigger className="text-sm">
                          <div className="flex items-center gap-3">
                            <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">3</div>
                            Selecionar Permissões
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="pl-9">
                          <p className="text-sm text-muted-foreground mb-3">
                            Marque <strong>todas</strong> as seguintes permissões:
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="secondary" className="font-mono">imopenlines</Badge>
                            <Badge variant="secondary" className="font-mono">imconnector</Badge>
                            <Badge variant="secondary" className="font-mono">im</Badge>
                            <Badge variant="secondary" className="font-mono">crm</Badge>
                            <Badge variant="secondary" className="font-mono">user</Badge>
                          </div>
                          <p className="text-xs text-amber-600 mt-3">
                            ⚠️ Todas estas permissões são obrigatórias para que o conector apareça no Contact Center!
                          </p>
                        </AccordionContent>
                      </AccordionItem>

                      <AccordionItem value="step4">
                        <AccordionTrigger className="text-sm">
                          <div className="flex items-center gap-3">
                            <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">4</div>
                            Instalar e Configurar
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="text-sm text-muted-foreground pl-9">
                          <ol className="list-decimal list-inside space-y-2">
                            <li>Clique em <strong>Salvar</strong> para criar o aplicativo</li>
                            <li>Clique em <strong>Instalar</strong></li>
                            <li>A tela do Thoth abrirá dentro do Bitrix24</li>
                            <li>Escolha a instância W-API para conectar</li>
                            <li>Clique em <strong>Ativar Conector</strong></li>
                          </ol>
                        </AccordionContent>
                      </AccordionItem>

                      <AccordionItem value="step5">
                        <AccordionTrigger className="text-sm">
                          <div className="flex items-center gap-3">
                            <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">5</div>
                            Adicionar Canal no Open Channels
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="text-sm text-muted-foreground pl-9">
                          <ol className="list-decimal list-inside space-y-2">
                            <li>No Bitrix24, vá em <strong>Contact Center</strong> (menu lateral)</li>
                            <li>Clique em <strong>+ Adicionar</strong> no canto superior</li>
                            <li>O conector <strong>Thoth WhatsApp</strong> aparecerá na lista de canais disponíveis</li>
                            <li>Clique nele para conectar a uma Open Line</li>
                            <li>Configure as opções do canal (horário, equipe, encaminhamento, etc.)</li>
                            <li>Pronto! As mensagens do WhatsApp chegarão no Bitrix24</li>
                          </ol>
                          <div className="mt-3 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                            <p className="text-green-600 dark:text-green-400 text-xs">
                              ✓ Após ativar o conector, ele aparecerá no Contact Center igual ao [whatcrm] WhatsApp
                            </p>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>

                    {/* Token de Vinculação */}
                    <div className="border rounded-lg p-4 space-y-4">
                      <div className="flex items-start gap-3">
                        <Key className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium">Token de Vinculação</p>
                          <p className="text-sm text-muted-foreground">
                            Gere um token para conectar sua instalação Bitrix24 a este workspace
                          </p>
                        </div>
                      </div>

                      {linkingToken ? (
                        <div className="space-y-3">
                          <div className="flex gap-2">
                            <Input
                              readOnly
                              value={linkingToken}
                              className="font-mono text-sm bg-muted"
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => copyToClipboard(linkingToken, "Token")}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Cole este token na tela de configuração do Bitrix24 para vincular ao seu workspace.
                            O token expira em 7 dias.
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleGenerateLinkingToken}
                            disabled={generatingToken}
                          >
                            {generatingToken ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                              <RefreshCw className="h-4 w-4 mr-2" />
                            )}
                            Gerar Novo Token
                          </Button>
                        </div>
                      ) : (
                        <Button
                          onClick={handleGenerateLinkingToken}
                          disabled={generatingToken}
                        >
                          {generatingToken ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : (
                            <Key className="h-4 w-4 mr-2" />
                          )}
                          Gerar Token de Vinculação
                        </Button>
                      )}
                    </div>

                    {/* Configuração OAuth Manual */}
                    <div className="border rounded-lg p-4 space-y-4">
                      <div className="flex items-start gap-3">
                        <Key className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium">Configuração OAuth Manual</p>
                          <p className="text-sm text-muted-foreground">
                            Use esta opção se o ONAPPINSTALL não funcionar automaticamente
                          </p>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Domínio Bitrix24</Label>
                          <Input
                            placeholder="seudominio.bitrix24.com.br"
                            value={oauthDomain}
                            onChange={(e) => setOauthDomain(e.target.value)}
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">ID do Aplicativo (client_id)</Label>
                          <Input
                            placeholder="local.xxxxxxxx.xxxxxxxx"
                            value={oauthClientId}
                            onChange={(e) => setOauthClientId(e.target.value)}
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Chave do Aplicativo (client_secret)</Label>
                          <Input
                            type="password"
                            placeholder="Chave secreta do aplicativo"
                            value={oauthClientSecret}
                            onChange={(e) => setOauthClientSecret(e.target.value)}
                          />
                        </div>

                        <Button
                          onClick={handleSaveOAuthManual}
                          disabled={savingOAuth || !oauthDomain || !oauthClientId || !oauthClientSecret}
                          className="w-full"
                        >
                          {savingOAuth ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : (
                            <ExternalLink className="h-4 w-4 mr-2" />
                          )}
                          Autorizar OAuth
                        </Button>

                        <p className="text-xs text-muted-foreground">
                          Após clicar, você será redirecionado para o Bitrix24 para autorizar. O token será salvo automaticamente.
                        </p>
                      </div>
                    </div>

                    {/* Status if installed via app */}
                    {bitrixConfig.member_id && (
                      <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                            <span className="font-medium text-green-600 dark:text-green-400">
                              App instalado em: {String(bitrixConfig.domain || "")}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleRefreshToken}
                              disabled={refreshingToken}
                            >
                              {refreshingToken ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                              ) : (
                                <RefreshCw className="h-4 w-4 mr-1" />
                              )}
                              Renovar Token
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleTestConnection}
                              disabled={testingConnection}
                            >
                              {testingConnection ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                              ) : (
                                <Zap className="h-4 w-4 mr-1" />
                              )}
                              Testar Conexão
                            </Button>
                          </div>
                        </div>
                        
                        {/* Token expiration info */}
                        {bitrixConfig.token_expires_at && (
                          <p className="text-xs text-muted-foreground">
                            Token expira em: {new Date(bitrixConfig.token_expires_at as string).toLocaleString()}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Test Result */}
                    {testResult && (
                      <Alert variant={testResult.success ? "default" : "destructive"}>
                        {testResult.success ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <AlertTriangle className="h-4 w-4" />
                        )}
                        <AlertTitle>{testResult.success ? "Conexão OK" : "Falha na Conexão"}</AlertTitle>
                        <AlertDescription className="space-y-1">
                          <p>{testResult.message}</p>
                          {testResult.success && testResult.details && (
                            <div className="text-xs space-y-0.5 mt-2">
                              <p>• Conectores registrados: {testResult.details.connectors}</p>
                              <p>• ID do conector: {testResult.details.connector_id || "Não configurado"}</p>
                              {testResult.details.bot_status && (
                                <p>• Bot Universal: {testResult.details.bot_status.registered ? `Registrado (${testResult.details.bot_status.name})` : "Não registrado"}</p>
                              )}
                              {testResult.details.token_expires_at && (
                                <p>• Token válido até: {new Date(testResult.details.token_expires_at).toLocaleString()}</p>
                              )}
                            </div>
                          )}
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Connector Activation Section */}
                    {bitrixConfig.member_id && bitrixConfig.registered && (
                      <div className="border rounded-lg p-4 space-y-4">
                        <div className="flex items-start gap-3">
                          <Zap className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-medium">Ativação do Conector no Contact Center</p>
                            <p className="text-sm text-muted-foreground">
                              {bitrixConfig.activated 
                                ? "O conector está ativo e pronto para receber mensagens."
                                : "O conector está registrado mas precisa ser ativado para receber mensagens."}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <Label className="text-xs text-muted-foreground">Open Line (Canal Aberto)</Label>
                            <Select value={selectedLineIdForActivation} onValueChange={setSelectedLineIdForActivation}>
                              <SelectTrigger>
                                <SelectValue placeholder="Selecione o canal" />
                              </SelectTrigger>
                              <SelectContent>
                                {bitrixChannels.length > 0 ? (
                                  bitrixChannels.map((ch) => (
                                    <SelectItem key={ch.id} value={String(ch.id)}>
                                      {ch.name} {ch.active && "✓"}
                                    </SelectItem>
                                  ))
                                ) : (
                                  <SelectItem value="1">Canal 1 (Padrão)</SelectItem>
                                )}
                              </SelectContent>
                            </Select>
                          </div>
                          
                          <div className="flex flex-wrap gap-2 mt-5">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleCheckConnector}
                              disabled={checkingConnector}
                              title="Verificar status do conector"
                            >
                              {checkingConnector ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Settings className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              size="sm"
                              onClick={handleActivateConnector}
                              disabled={activatingConnector}
                            >
                              {activatingConnector ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                              ) : (
                                <Zap className="h-4 w-4 mr-1" />
                              )}
                              {bitrixConfig.activated ? "Reativar" : "Ativar Conector"}
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={handleSimulatePlacement}
                              disabled={checkingConnector}
                              title="Simular chamada PLACEMENT do Bitrix24"
                            >
                              {checkingConnector ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                              ) : (
                                <RefreshCw className="h-4 w-4 mr-1" />
                              )}
                              Simular PLACEMENT
                            </Button>
                          </div>
                        </div>

                        {/* Connector Diagnosis */}
                        {connectorDiagnosis && (
                          <Alert variant={connectorDiagnosis.activated ? "default" : "destructive"}>
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>Diagnóstico do Conector</AlertTitle>
                            <AlertDescription>
                              <p className="text-sm">{connectorDiagnosis.diagnosis}</p>
                              <div className="text-xs mt-1 space-y-0.5">
                                <p>• Registrado: {connectorDiagnosis.registered ? "Sim" : "Não"}</p>
                                <p>• Ativado: {connectorDiagnosis.activated ? "Sim" : "Não"}</p>
                              </div>
                            </AlertDescription>
                          </Alert>
                        )}
                      </div>
                    )}

                    {/* Token Expired Alert */}
                    {(tokenExpired || tokenRefreshFailed) && bitrixConfig.member_id && (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>
                          {tokenRefreshFailed ? "Falha ao Renovar Token" : "Token Expirado"}
                        </AlertTitle>
                        <AlertDescription className="space-y-3">
                          <p>
                            {tokenRefreshFailed 
                              ? `Não foi possível renovar o token OAuth. Erro: ${bitrixConfig.token_refresh_error || "desconhecido"}`
                              : "O token de acesso ao Bitrix24 expirou. Mensagens não serão enviadas até reconectar."
                            }
                          </p>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleRefreshToken}
                              disabled={refreshingToken}
                            >
                              {refreshingToken ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                              ) : (
                                <RefreshCw className="h-4 w-4 mr-1" />
                              )}
                              Tentar Renovar
                            </Button>
                          </div>
                          <p className="text-xs">
                            Se a renovação falhar, use a <strong>Configuração OAuth Manual</strong> acima para reconectar.
                          </p>
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}

                {/* Webhook Manual Mode */}
                {bitrixConfigMode === "webhook" && (
                  <div className="space-y-6">
                    {/* Instructions */}
                    <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-3">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="h-5 w-5 text-sky-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium">Como configurar o Bitrix24:</p>
                          <ol className="list-decimal list-inside text-muted-foreground mt-2 space-y-1">
                            <li>Acesse seu Bitrix24 → Aplicativos → Webhooks</li>
                            <li>Crie um webhook de saída com permissões: <code className="bg-muted px-1 rounded">imopenlines, imconnector, im, crm</code></li>
                            <li>Copie a URL do webhook e cole abaixo</li>
                            <li>Clique em "Registrar Conector"</li>
                            <li>No Bitrix24, vá em Open Channels → Adicionar canal → Escolha "Thoth WhatsApp"</li>
                          </ol>
                        </div>
                      </div>
                    </div>

                    {/* Config Form */}
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="bitrix-webhook">Webhook URL do Bitrix24</Label>
                        <Input
                          id="bitrix-webhook"
                          placeholder="https://seudominio.bitrix24.com.br/rest/1/xxxxx/"
                          value={bitrixWebhookUrl}
                          onChange={(e) => setBitrixWebhookUrl(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          Ex: https://seudominio.bitrix24.com.br/rest/1/abcd1234efgh5678/
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="bitrix-connector">ID do Conector</Label>
                        <Input
                          id="bitrix-connector"
                          placeholder="thoth_whatsapp"
                          value={bitrixConnectorId}
                          onChange={(e) => setBitrixConnectorId(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          Identificador único do seu conector (use letras e underscores)
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="bitrix-instance">Instância W-API</Label>
                        <Select value={bitrixInstanceId} onValueChange={setBitrixInstanceId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione uma instância" />
                          </SelectTrigger>
                          <SelectContent>
                            {instances.map((inst) => (
                              <SelectItem key={inst.id} value={inst.id}>
                                {inst.name} {inst.phone_number ? `(${inst.phone_number})` : ""} 
                                {inst.status === "connected" && " ✓"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          Qual número WhatsApp será usado para este Open Channel
                        </p>
                      </div>
                    </div>

                    {/* Status */}
                    {bitrixIntegration?.config && !bitrixConfig.member_id && (
                      <div className="bg-muted/30 rounded-lg p-4 space-y-2">
                        <p className="text-sm font-medium">Status do Conector:</p>
                        <div className="flex flex-wrap gap-3 text-sm">
                          <div className="flex items-center gap-1.5">
                            {bitrixConfig.registered ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
                            ) : (
                              <XCircle className="h-4 w-4 text-muted-foreground" />
                            )}
                            Registrado
                          </div>
                          <div className="flex items-center gap-1.5">
                            {bitrixConfig.events_url ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
                            ) : (
                              <XCircle className="h-4 w-4 text-muted-foreground" />
                            )}
                            Eventos vinculados
                          </div>
                          <div className="flex items-center gap-1.5">
                            {bitrixConfig.instance_id ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
                            ) : (
                              <XCircle className="h-4 w-4 text-muted-foreground" />
                            )}
                            Instância configurada
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex flex-wrap gap-3">
                      <Button onClick={handleRegisterBitrix24} disabled={registeringBitrix}>
                        {registeringBitrix ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Registrando...
                          </>
                        ) : (
                          <>
                            <Building2 className="h-4 w-4 mr-2" />
                            {bitrixIntegration ? "Atualizar Conector" : "Registrar Conector"}
                          </>
                        )}
                      </Button>
                      {bitrixIntegration && (
                        <Button
                          variant="outline"
                          className="text-destructive hover:bg-destructive/10"
                          onClick={handleCleanConnectors}
                          disabled={cleaningConnectors}
                        >
                          {cleaningConnectors ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Limpando...
                            </>
                          ) : (
                            <>
                              <Trash2 className="h-4 w-4 mr-2" />
                              Limpar Conectores Duplicados
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* Documentation Link */}
                <div className="pt-4 border-t">
                  <Button variant="outline" asChild>
                    <a href="https://apidocs.bitrix24.com/api-reference/imopenlines/index.html" target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Documentação Bitrix24
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Contact Sync Card */}
            {bitrixIntegration?.is_active && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                        <Users className="h-6 w-6 text-emerald-500" />
                      </div>
                      <div>
                        <CardTitle>Sincronização de Contatos</CardTitle>
                        <CardDescription>
                          Sincronize contatos entre WhatsApp e Bitrix24 CRM
                        </CardDescription>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Warning if no webhook_url or access_token configured */}
                  {!bitrixConfig.webhook_url && !bitrixConfig.access_token && (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                        <div className="space-y-3 flex-1">
                          <div>
                            <p className="font-medium text-amber-600 dark:text-amber-400">
                              Configuração Incompleta
                            </p>
                            <p className="text-sm text-muted-foreground mt-1">
                              Para sincronizar contatos, você precisa configurar um <strong>Webhook de Entrada (REST)</strong> no Bitrix24.
                            </p>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="sync-webhook-url" className="text-xs">URL do Webhook de Entrada</Label>
                            <div className="flex gap-2">
                              <Input
                                id="sync-webhook-url"
                                placeholder="https://seudominio.bitrix24.com.br/rest/1/xxxxx/"
                                value={bitrixWebhookUrl}
                                onChange={(e) => setBitrixWebhookUrl(e.target.value)}
                                className="text-sm"
                              />
                              <Button 
                                size="sm"
                                disabled={!bitrixWebhookUrl || registeringBitrix}
                                onClick={async () => {
                                  if (!bitrixWebhookUrl) return;
                                  setRegisteringBitrix(true);
                                  try {
                                    const { error } = await supabase
                                      .from("integrations")
                                      .update({
                                        config: { ...bitrixConfig, webhook_url: bitrixWebhookUrl },
                                        updated_at: new Date().toISOString(),
                                      })
                                      .eq("id", bitrixIntegration.id);
                                    
                                    if (error) throw error;
                                    toast.success("Webhook salvo com sucesso!");
                                    fetchIntegrations();
                                  } catch (err) {
                                    console.error(err);
                                    toast.error("Erro ao salvar webhook");
                                  } finally {
                                    setRegisteringBitrix(false);
                                  }
                                }}
                              >
                                {registeringBitrix ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Crie um webhook em Bitrix24 → Aplicativos → Webhooks → Entrada com permissões: crm, user
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {(bitrixConfig.webhook_url || bitrixConfig.access_token) && (
                    <>
                      <div className="bg-muted/50 rounded-lg p-4 text-sm">
                        <div className="flex items-start gap-2">
                          <ArrowLeftRight className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-medium">Sincronização bidirecional:</p>
                            <ul className="text-muted-foreground mt-1 space-y-1">
                              <li>• <strong>Do Bitrix24:</strong> Importa contatos do CRM para o WhatsApp</li>
                              <li>• <strong>Para o Bitrix24:</strong> Exporta contatos do WhatsApp para o CRM</li>
                              <li>• <strong>Ambos:</strong> Sincroniza em ambas as direções</li>
                            </ul>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label>Direção da Sincronização</Label>
                          <Select value={syncDirection} onValueChange={(v) => setSyncDirection(v as typeof syncDirection)}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="both">Bidirecional (recomendado)</SelectItem>
                              <SelectItem value="from_bitrix">Importar do Bitrix24</SelectItem>
                              <SelectItem value="to_bitrix">Exportar para o Bitrix24</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label>Instância WhatsApp</Label>
                          <Select 
                            value={bitrixInstanceId || "__default__"} 
                            onValueChange={(val) => setBitrixInstanceId(val === "__default__" ? "" : val)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Usar instância configurada" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__default__">Usar instância configurada</SelectItem>
                              {instances.map((inst) => (
                                <SelectItem key={inst.id} value={inst.id}>
                                  {inst.name} {inst.phone_number ? `(${inst.phone_number})` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <Button onClick={handleSyncContacts} disabled={syncingContacts} className="gap-2">
                        {syncingContacts ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Sincronizando...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="h-4 w-4" />
                            Sincronizar Contatos
                          </>
                        )}
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Open Lines Status Card */}
            {bitrixIntegration?.is_active && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 rounded-xl bg-cyan-500/10 flex items-center justify-center">
                        <Phone className="h-6 w-6 text-cyan-500" />
                      </div>
                      <div>
                        <CardTitle>Status dos Open Lines</CardTitle>
                        <CardDescription>
                          Visão geral dos canais Bitrix24 e status dos conectores
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => fetchBitrixChannels(true)}
                        disabled={loadingChannels}
                      >
                        {loadingChannels ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <RefreshCw className="h-4 w-4 mr-2" />
                        )}
                        Atualizar Status
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {bitrixChannels.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Phone className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>Nenhum canal encontrado</p>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="mt-3"
                        onClick={() => fetchBitrixChannels(true)}
                        disabled={loadingChannels}
                      >
                        {loadingChannels ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <RefreshCw className="h-4 w-4 mr-2" />
                        )}
                        Carregar Canais
                      </Button>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Canal</TableHead>
                          <TableHead>Status Bitrix</TableHead>
                          <TableHead>Conector</TableHead>
                          <TableHead>WhatsApp Mapeado</TableHead>
                          <TableHead className="w-[180px]">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bitrixChannels.map((channel) => (
                          <TableRow key={channel.id}>
                            <TableCell className="font-medium">
                              {channel.name}
                              <span className="text-xs text-muted-foreground ml-2">(ID: {channel.id})</span>
                            </TableCell>
                            <TableCell>
                              <Badge variant={channel.active ? "default" : "secondary"}>
                                {channel.active ? "Ativo" : "Inativo"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={channel.connector_active ? "default" : "destructive"}>
                                {channel.connector_active ? "Conectado" : "Desconectado"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {channel.mapping ? (
                                <div className="flex items-center gap-1.5">
                                  <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                                  <span className="text-sm">{channel.mapping.instance_name}</span>
                                  {channel.mapping.phone_number && (
                                    <span className="text-xs text-muted-foreground">({channel.mapping.phone_number})</span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-muted-foreground text-sm">Não mapeado</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                {!channel.connector_active ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleActivateConnectorForLine(channel.id, true)}
                                    disabled={activatingLineId === channel.id}
                                  >
                                    {activatingLineId === channel.id ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Zap className="h-3.5 w-3.5 mr-1" />
                                    )}
                                    Ativar
                                  </Button>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleActivateConnectorForLine(channel.id, false)}
                                    disabled={activatingLineId === channel.id}
                                    className="text-destructive hover:bg-destructive/10"
                                  >
                                    {activatingLineId === channel.id ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <XCircle className="h-3.5 w-3.5 mr-1" />
                                    )}
                                    Desativar
                                  </Button>
                                )}
                                {!channel.mapping && (
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => handleQuickMapping(channel.id, channel.name)}
                                  >
                                    <ArrowLeftRight className="h-3.5 w-3.5 mr-1" />
                                    Mapear
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}

                  <div className="bg-muted/50 rounded-lg p-4 text-sm">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-5 w-5 text-cyan-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">Legenda:</p>
                        <ul className="text-muted-foreground mt-1 space-y-1">
                          <li>• <strong>Conector Conectado:</strong> O canal está pronto para receber mensagens do WhatsApp</li>
                          <li>• <strong>Conector Desconectado:</strong> Precisa ativar o conector para vincular ao WhatsApp</li>
                          <li>• <strong>Não mapeado:</strong> Precisa vincular uma instância WhatsApp ao canal</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Channel Mappings Card */}
            {bitrixIntegration?.is_active && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 rounded-xl bg-indigo-500/10 flex items-center justify-center">
                        <ArrowLeftRight className="h-6 w-6 text-indigo-500" />
                      </div>
                      <div>
                        <CardTitle>Mapeamento de Canais</CardTitle>
                        <CardDescription>
                          Vincule cada número W-API a um Canal Aberto do Bitrix24
                        </CardDescription>
                      </div>
                    </div>
                    <Button size="sm" onClick={() => setShowMappingDialog(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Adicionar
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {channelMappings.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <ArrowLeftRight className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>Nenhum mapeamento configurado</p>
                      <p className="text-sm">
                        Adicione mapeamentos para vincular instâncias W-API a canais Bitrix24
                      </p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Instância W-API</TableHead>
                          <TableHead>Telefone</TableHead>
                          <TableHead>Canal Bitrix24</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="w-[50px]"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {channelMappings.map((mapping) => (
                          <TableRow key={mapping.id}>
                            <TableCell className="font-medium">{mapping.instance_name}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                                {mapping.phone_number || "-"}
                              </div>
                            </TableCell>
                            <TableCell>{mapping.line_name || `Linha ${mapping.line_id}`}</TableCell>
                            <TableCell>
                              <Badge variant={mapping.is_active ? "default" : "secondary"}>
                                {mapping.is_active ? "Ativo" : "Inativo"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:bg-destructive/10"
                                onClick={() => handleDeleteMapping(mapping.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}

                  <div className="bg-muted/50 rounded-lg p-4 text-sm">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">Como funciona:</p>
                        <ul className="text-muted-foreground mt-1 space-y-1">
                          <li>• Cada instância W-API pode ser vinculada a um canal Bitrix24 diferente</li>
                          <li>• As mensagens serão roteadas automaticamente para o canal correspondente</li>
                          <li>• O "Line ID" é o número do Canal Aberto no Bitrix24</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* AI Chatbot Card */}
            {bitrixIntegration?.is_active && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 rounded-xl bg-violet-500/10 flex items-center justify-center">
                        <Bot className="h-6 w-6 text-violet-500" />
                      </div>
                      <div>
                        <CardTitle>Chatbot de IA</CardTitle>
                        <CardDescription>
                          Configure um agente de IA para responder automaticamente os clientes no Bitrix24
                        </CardDescription>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between p-4 rounded-lg border">
                    <div className="space-y-0.5">
                      <Label className="text-base">Ativar Chatbot</Label>
                      <p className="text-sm text-muted-foreground">
                        Quando ativado, a IA responderá automaticamente mensagens recebidas no canal
                      </p>
                    </div>
                    <Switch 
                      checked={chatbotEnabled} 
                      onCheckedChange={setChatbotEnabled}
                    />
                  </div>

                  {chatbotEnabled && (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Persona (Agente de IA)</Label>
                        <Select value={selectedPersonaId} onValueChange={setSelectedPersonaId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione uma persona" />
                          </SelectTrigger>
                          <SelectContent>
                            {personas.length === 0 ? (
                              <SelectItem value="__no_personas__" disabled>
                                Nenhuma persona configurada
                              </SelectItem>
                            ) : (
                              personas.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          A persona define o comportamento e personalidade do chatbot. 
                          Crie novas personas na página de Personas.
                        </p>
                      </div>

                      <div className="bg-muted/50 rounded-lg p-4 text-sm">
                        <div className="flex items-start gap-2">
                          <Bot className="h-5 w-5 text-violet-500 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-medium">Como funciona:</p>
                            <ul className="text-muted-foreground mt-1 space-y-1">
                              <li>• Quando um cliente envia mensagem no Canal Aberto do Bitrix24</li>
                              <li>• A IA processa a mensagem usando a persona configurada</li>
                              <li>• A resposta é enviada automaticamente de volta para o cliente</li>
                              <li>• Operadores podem assumir a conversa a qualquer momento</li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <Button 
                    onClick={handleSaveChatbotConfig} 
                    disabled={savingChatbot}
                    className="w-full"
                  >
                    {savingChatbot ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Salvando...
                      </>
                    ) : (
                      "Salvar Configurações do Chatbot"
                    )}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Universal Bot Card */}
            {bitrixIntegration?.is_active && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 rounded-xl bg-purple-500/10 flex items-center justify-center">
                        <MessageSquare className="h-6 w-6 text-purple-500" />
                      </div>
                      <div>
                        <CardTitle>Bot Universal (Todos os Canais)</CardTitle>
                        <CardDescription>
                          Bot de IA que funciona em qualquer chat do Bitrix24 para funcionários
                        </CardDescription>
                      </div>
                    </div>
                    {botRegistered && (
                      <Badge variant="outline" className="gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-green-500" />
                        Registrado
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  {!botRegistered ? (
                    <div className="space-y-4">
                      <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg p-4">
                        <p className="text-sm text-muted-foreground">
                          O Bot Universal aparece na lista de bots do Bitrix24 e pode ser usado por qualquer funcionário 
                          diretamente nos chats internos. Diferente do conector (que atende clientes externos via WhatsApp).
                        </p>
                      </div>
                      <Button onClick={handleRegisterBot} disabled={registeringBot} className="w-full">
                        {registeringBot ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Registrando...
                          </>
                        ) : (
                          <>
                            <Bot className="h-4 w-4 mr-2" />
                            Registrar Bot Universal
                          </>
                        )}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        Bot ID: {botId}
                      </div>

                      <div className="flex items-center justify-between p-4 rounded-lg border">
                        <div className="space-y-0.5">
                          <Label className="text-base">Ativar Respostas Automáticas</Label>
                          <p className="text-sm text-muted-foreground">
                            Quando ativado, o bot responde automaticamente usando IA
                          </p>
                        </div>
                        <Switch checked={botEnabled} onCheckedChange={setBotEnabled} />
                      </div>

                      {botEnabled && (
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label>Persona do Bot</Label>
                            <Select value={botPersonaId} onValueChange={setBotPersonaId}>
                              <SelectTrigger>
                                <SelectValue placeholder="Selecione uma persona" />
                              </SelectTrigger>
                              <SelectContent>
                                {personas.map((p) => (
                                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-2">
                            <Label>Mensagem de Boas-Vindas</Label>
                            <Textarea
                              placeholder="Olá! Sou o assistente de IA da empresa. Como posso ajudar?"
                              value={botWelcomeMessage}
                              onChange={(e) => setBotWelcomeMessage(e.target.value)}
                              rows={3}
                            />
                            <p className="text-xs text-muted-foreground">
                              Enviada automaticamente quando um usuário inicia uma conversa com o bot
                            </p>
                          </div>
                        </div>
                      )}

                      <div className="flex gap-2">
                        <Button onClick={handleSaveBotConfig} disabled={savingBotConfig} className="flex-1">
                          {savingBotConfig ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar Configurações"}
                        </Button>
                        <Button variant="destructive" onClick={handleUnregisterBot} disabled={unregisteringBot}>
                          {unregisteringBot ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Automation Robot Card */}
            {bitrixIntegration?.is_active && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 rounded-xl bg-amber-500/10 flex items-center justify-center">
                        <Zap className="h-6 w-6 text-amber-500" />
                      </div>
                      <div>
                        <CardTitle>Robot de Automação CRM</CardTitle>
                        <CardDescription>
                          Envie mensagens WhatsApp diretamente das automações do Bitrix24
                        </CardDescription>
                      </div>
                    </div>
                    {robotRegistered && (
                      <Badge variant="outline" className="gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-green-500" />
                        Registrado
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  {!robotRegistered ? (
                    <div className="space-y-4">
                      <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-4">
                        <p className="text-sm text-muted-foreground">
                          O Robot de Automação permite enviar mensagens WhatsApp diretamente das automações do Bitrix24 CRM.
                          Após registrado, ele aparecerá como uma <strong>Atividade do Aplicativo</strong> nas regras de automação de Leads, Deals e Contatos.
                        </p>
                      </div>
                      
                      <div className="bg-muted/50 rounded-lg p-4 text-sm">
                        <div className="flex items-start gap-2">
                          <Zap className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-medium">Como funciona:</p>
                            <ul className="text-muted-foreground mt-1 space-y-1">
                              <li>• Registre o robot clicando no botão abaixo</li>
                              <li>• No Bitrix24, vá em CRM → Automação → Regras</li>
                              <li>• Adicione uma ação → Atividades do Aplicativo → <strong>Thoth WhatsApp</strong></li>
                              <li>• Configure o telefone e a mensagem</li>
                              <li>• A mensagem será enviada automaticamente via WhatsApp</li>
                            </ul>
                          </div>
                        </div>
                      </div>

                      <Button onClick={handleRegisterRobot} disabled={registeringRobot} className="w-full">
                        {registeringRobot ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Registrando...
                          </>
                        ) : (
                          <>
                            <Zap className="h-4 w-4 mr-2" />
                            Registrar Robot de Automação
                          </>
                        )}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <Alert>
                        <CheckCircle2 className="h-4 w-4" />
                        <AlertTitle>Robot Registrado</AlertTitle>
                        <AlertDescription>
                          O robot <strong>"Thoth WhatsApp - Enviar Mensagem"</strong> está disponível nas automações do Bitrix24.
                          <br />
                          Acesse CRM → Automação → Regras → Atividades do Aplicativo para usá-lo.
                        </AlertDescription>
                      </Alert>

                      <div className="bg-muted/50 rounded-lg p-4 text-sm">
                        <div className="flex items-start gap-2">
                          <Settings className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                          <div>
                            <p className="font-medium">Parâmetros disponíveis:</p>
                            <ul className="text-muted-foreground mt-1 space-y-1">
                              <li>• <strong>Telefone:</strong> Número do destinatário (pode usar variáveis do CRM)</li>
                              <li>• <strong>Mensagem:</strong> Texto a ser enviado (pode usar variáveis do CRM)</li>
                            </ul>
                          </div>
                        </div>
                      </div>

                      <Button 
                        variant="destructive" 
                        onClick={handleUnregisterRobot} 
                        disabled={unregisteringRobot}
                        className="w-full"
                      >
                        {unregisteringRobot ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Removendo...
                          </>
                        ) : (
                          <>
                            <Trash2 className="h-4 w-4 mr-2" />
                            Remover Robot de Automação
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="ai" className="mt-6 space-y-4">
            {integrationTypes
              .filter((t) => ["openai", "elevenlabs"].includes(t.type))
              .map((intType) => {
                const status = getIntegrationStatus(intType.type);
                return (
                  <Card key={intType.type}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className={`h-12 w-12 rounded-xl ${intType.color}/10 flex items-center justify-center`}>
                            <intType.icon className={`h-6 w-6 text-${intType.color.replace("bg-", "")}`} />
                          </div>
                          <div>
                            <CardTitle>{intType.name}</CardTitle>
                            <CardDescription>{intType.description}</CardDescription>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {status && (
                            <Switch
                              checked={status.is_active}
                              onCheckedChange={() => handleToggleIntegration(status)}
                            />
                          )}
                          {status ? (
                            <Badge variant="outline" className="gap-1.5">
                              <span className="h-2 w-2 rounded-full bg-green-500" />
                              Conectado
                            </Badge>
                          ) : (
                            <Badge variant="secondary">Não configurado</Badge>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <Button variant="outline" onClick={() => handleOpenConfig(intType)}>
                        <Settings className="h-4 w-4 mr-2" />
                        {status ? "Editar" : "Configurar"}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
          </TabsContent>

          <TabsContent value="webhooks" className="mt-6 space-y-4">
            {integrationTypes
              .filter((t) => ["webhook", "n8n"].includes(t.type))
              .map((intType) => {
                const status = getIntegrationStatus(intType.type);
                return (
                  <Card key={intType.type}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className={`h-12 w-12 rounded-xl ${intType.color}/10 flex items-center justify-center`}>
                            <intType.icon className={`h-6 w-6`} />
                          </div>
                          <div>
                            <CardTitle>{intType.name}</CardTitle>
                            <CardDescription>{intType.description}</CardDescription>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {status && (
                            <Switch
                              checked={status.is_active}
                              onCheckedChange={() => handleToggleIntegration(status)}
                            />
                          )}
                          {status ? (
                            <Badge variant="outline" className="gap-1.5">
                              <span className="h-2 w-2 rounded-full bg-green-500" />
                              Ativo
                            </Badge>
                          ) : (
                            <Badge variant="secondary">Não configurado</Badge>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <Button variant="outline" onClick={() => handleOpenConfig(intType)}>
                        <Settings className="h-4 w-4 mr-2" />
                        {status ? "Editar" : "Configurar"}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
          </TabsContent>
        </Tabs>

        {/* Config Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {selectedType && <selectedType.icon className="h-5 w-5" />}
                Configurar {selectedType?.name}
              </DialogTitle>
              <DialogDescription>{selectedType?.description}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {selectedType?.fields.map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={field.key}>{field.label}</Label>
                  <Input
                    id={field.key}
                    type={field.type}
                    placeholder={field.placeholder}
                    value={formData[field.key] || ""}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>

            <DialogFooter>
              {selectedType?.docs && (
                <Button variant="link" asChild className="mr-auto">
                  <a href={selectedType.docs} target="_blank" rel="noopener noreferrer">
                    Ver documentação
                  </a>
                </Button>
              )}
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSaveIntegration} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  "Salvar"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Channel Mapping Dialog */}
        <Dialog open={showMappingDialog} onOpenChange={setShowMappingDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ArrowLeftRight className="h-5 w-5" />
                Adicionar Mapeamento
              </DialogTitle>
              <DialogDescription>
                Vincule uma instância W-API a um Canal Aberto do Bitrix24
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Instância W-API</Label>
                <Select value={newMappingInstanceId} onValueChange={setNewMappingInstanceId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione uma instância" />
                  </SelectTrigger>
                  <SelectContent>
                    {instances
                      .filter((inst) => !channelMappings.some((m) => m.instance_id === inst.id))
                      .map((inst) => (
                        <SelectItem key={inst.id} value={inst.id}>
                          {inst.name} {inst.phone_number ? `(${inst.phone_number})` : ""}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Canal Aberto do Bitrix24</Label>
                <div className="flex gap-2">
                  <Select 
                    value={newMappingLineId} 
                    onValueChange={(val) => {
                      setNewMappingLineId(val);
                      const channel = bitrixChannels.find(ch => ch.id.toString() === val);
                      if (channel) {
                        setNewMappingLineName(channel.name);
                      }
                    }}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder={loadingChannels ? "Carregando canais..." : "Selecione um canal"} />
                    </SelectTrigger>
                    <SelectContent>
                      {bitrixChannels.map((channel) => (
                        <SelectItem key={channel.id} value={channel.id.toString()}>
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${channel.active ? "bg-green-500" : "bg-muted-foreground"}`} />
                            {channel.name} (ID: {channel.id})
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setShowCreateChannelDialog(true)}
                    title="Criar novo canal"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => fetchBitrixChannels(false)}
                    disabled={loadingChannels}
                    title="Atualizar lista"
                  >
                    <RefreshCw className={`h-4 w-4 ${loadingChannels ? "animate-spin" : ""}`} />
                  </Button>
                </div>
                {bitrixChannels.length === 0 && !loadingChannels && (
                  <p className="text-xs text-muted-foreground">
                    Nenhum canal encontrado. Clique em + para criar um novo.
                  </p>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowMappingDialog(false)}>
                Cancelar
              </Button>
              <Button onClick={handleAddMapping} disabled={savingMapping || !newMappingInstanceId || !newMappingLineId}>
                {savingMapping ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  "Adicionar Mapeamento"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Create Channel Dialog */}
        <Dialog open={showCreateChannelDialog} onOpenChange={setShowCreateChannelDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Plus className="h-5 w-5" />
                Criar Novo Canal Aberto
              </DialogTitle>
              <DialogDescription>
                Crie um novo Canal Aberto no Bitrix24 para conectar ao WhatsApp
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nome do Canal</Label>
                <Input
                  placeholder="Ex: WhatsApp Vendas, WhatsApp Suporte..."
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Este nome aparecerá no Contact Center do Bitrix24
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreateChannelDialog(false)}>
                Cancelar
              </Button>
              <Button onClick={handleCreateChannel} disabled={creatingChannel || !newChannelName.trim()}>
                {creatingChannel ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Criando...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Criar Canal
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}

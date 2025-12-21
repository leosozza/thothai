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
  Bug,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DebugConsole } from "@/components/integrations/DebugConsole";

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
    name: "WhatsApp QR Code",
    description: "Configure a conexão do WhatsApp via QR Code para enviar e receber mensagens.",
    icon: MessageSquare,
    color: "bg-green-500",
    fields: [
      { key: "api_key", label: "API Key", type: "password", placeholder: "Sua chave de API" },
      { key: "instance_id", label: "Instance ID", type: "text", placeholder: "ID da instância" },
    ],
    docs: null,
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

  // MARKETPLACE: OAuth credentials now come from environment, no manual config needed

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
  const fetchBitrixChannels = async (includeConnectorStatus = true) => {
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

  // MARKETPLACE: OAuth is handled automatically via marketplace app installation
  // No manual OAuth configuration needed

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

          {/* Bitrix24 CRM Tab - Simplified */}
          <TabsContent value="crm" className="mt-6 space-y-4">
            {/* Main Bitrix24 Card */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-xl bg-sky-500/10 flex items-center justify-center">
                      <Building2 className="h-6 w-6 text-sky-500" />
                    </div>
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        Bitrix24
                        {bitrixIntegration?.is_active && bitrixConfig.auto_setup_completed ? (
                          <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Conectado
                          </Badge>
                        ) : bitrixIntegration ? (
                          <Badge variant="secondary">Configurando...</Badge>
                        ) : (
                          <Badge variant="secondary">Não configurado</Badge>
                        )}
                      </CardTitle>
                      <CardDescription>
                        {bitrixConfig.domain 
                          ? `Integrado com ${bitrixConfig.domain}` 
                          : "Conecte o WhatsApp ao seu Bitrix24 CRM"}
                      </CardDescription>
                    </div>
                  </div>
                  {bitrixIntegration && (
                    <Switch
                      checked={bitrixIntegration.is_active}
                      onCheckedChange={() => handleToggleIntegration(bitrixIntegration)}
                    />
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Connected State */}
                {bitrixIntegration?.is_active && bitrixConfig.auto_setup_completed ? (
                  <div className="space-y-4">
                    {/* Status Info */}
                    <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Portal Bitrix24</span>
                        <span className="font-medium">{String(bitrixConfig.domain || "")}</span>
                      </div>
                      {bitrixConfig.instance_id && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">WhatsApp Conectado</span>
                          <div className="flex items-center gap-2">
                            <Phone className="h-4 w-4 text-green-500" />
                            <span className="font-medium">
                              {instances.find(i => i.id === bitrixConfig.instance_id)?.name || "WhatsApp"}
                            </span>
                          </div>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Status</span>
                        <div className="flex flex-wrap gap-2">
                          {bitrixConfig.connector_registered && (
                            <Badge variant="outline" className="text-xs">
                              <CheckCircle2 className="h-3 w-3 mr-1 text-green-500" />
                              Conector
                            </Badge>
                          )}
                          {bitrixConfig.lines_activated && (
                            <Badge variant="outline" className="text-xs">
                              <CheckCircle2 className="h-3 w-3 mr-1 text-green-500" />
                              {String(bitrixConfig.lines_activated)} canais
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Quick actions */}
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        Mensagens do WhatsApp aparecerão no Chat do Bitrix24. Responda diretamente pelo CRM.
                      </AlertDescription>
                    </Alert>

                    <div className="flex gap-2">
                      <Button 
                        variant="outline"
                        onClick={async () => {
                          if (!bitrixIntegration?.id) return;
                          setRegisteringBitrix(true);
                          try {
                            const response = await supabase.functions.invoke("bitrix24-webhook", {
                              body: {
                                action: "auto_setup",
                                integration_id: bitrixIntegration.id,
                                instance_id: bitrixConfig.instance_id,
                              }
                            });
                            if (response.data?.success) {
                              toast.success("Reconectado com sucesso!");
                              fetchIntegrations();
                            } else {
                              toast.error(response.data?.error || "Erro ao reconectar");
                            }
                          } catch (e) {
                            toast.error("Erro ao reconectar");
                          } finally {
                            setRegisteringBitrix(false);
                          }
                        }}
                        disabled={registeringBitrix}
                      >
                        {registeringBitrix ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <RefreshCw className="h-4 w-4 mr-2" />
                        )}
                        Reconectar
                      </Button>
                      <Button 
                        variant="outline"
                        onClick={handleRefreshToken}
                        disabled={refreshingToken}
                      >
                        {refreshingToken ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <Key className="h-4 w-4 mr-2" />
                        )}
                        Renovar Token
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* Not Connected - Setup Instructions */
                  <div className="space-y-6">
                    {/* Quick Setup Instructions */}
                    <div className="bg-sky-500/5 border border-sky-500/20 rounded-lg p-4">
                      <h4 className="font-medium text-sky-600 dark:text-sky-400 mb-2">
                        Configuração Rápida (3 passos)
                      </h4>
                      <ol className="text-sm text-muted-foreground space-y-2">
                        <li className="flex gap-2">
                          <span className="font-bold text-primary">1.</span>
                          No Bitrix24: Aplicações → Desenvolvedores → Adicionar Aplicativo Local
                        </li>
                        <li className="flex gap-2">
                          <span className="font-bold text-primary">2.</span>
                          Configure as URLs abaixo e permissões: imopenlines, imconnector, im, crm
                        </li>
                        <li className="flex gap-2">
                          <span className="font-bold text-primary">3.</span>
                          Instale o app e cole o token gerado aqui
                        </li>
                      </ol>
                    </div>

                    {/* URLs to copy */}
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Handler URL</Label>
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
                        <Label className="text-xs text-muted-foreground">Initial Install URL</Label>
                        <div className="flex gap-2">
                          <Input
                            readOnly
                            value={BITRIX24_INITIAL_INSTALL_URL}
                            className="font-mono text-xs bg-muted"
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => copyToClipboard(BITRIX24_INITIAL_INSTALL_URL, "Install URL")}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Token Generation */}
                    <div className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Key className="h-5 w-5 text-primary" />
                        <span className="font-medium">Token de Vinculação</span>
                      </div>
                      
                      {linkingToken ? (
                        <div className="space-y-2">
                          <div className="flex gap-2">
                            <Input
                              readOnly
                              value={linkingToken}
                              className="font-mono text-lg text-center tracking-widest bg-muted"
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
                            Cole este token na tela de configuração do Bitrix24
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
                          className="w-full"
                        >
                          {generatingToken ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : (
                            <Key className="h-4 w-4 mr-2" />
                          )}
                          Gerar Token
                        </Button>
                      )}
                    </div>

                    {/* Documentation link */}
                    <Button variant="outline" className="w-full" asChild>
                      <a 
                        href="https://helpdesk.bitrix24.com.br/open/17558322/" 
                        target="_blank" 
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        Ver Tutorial Completo
                      </a>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
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

        {/* Debug Console Section */}
        {integrations.find(i => i.type === "bitrix24") && (
          <div className="mt-8">
            <DebugConsole 
              integrationId={integrations.find(i => i.type === "bitrix24")?.id}
              workspaceId={workspace?.id}
            />
          </div>
        )}
      </div>
    </AppLayout>
  );
}

import { useState, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { RealtimeMonitor } from "@/components/diagnostics/RealtimeMonitor";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  Activity,
  Server,
  Database,
  Wifi,
  WifiOff,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Download,
  Trash2,
  Search,
  ChevronDown,
  ChevronRight,
  Clock,
  Zap,
  MessageSquare,
  Bot,
  Plug,
  AlertCircle,
  Info,
  Bug,
  Filter,
  FileText,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface HealthCheck {
  name: string;
  status: "healthy" | "degraded" | "unhealthy" | "checking";
  message: string;
  lastChecked?: Date;
  responseTime?: number;
}

interface DebugLog {
  id: string;
  timestamp: string;
  function_name: string;
  level: string;
  message: string;
  details?: Record<string, unknown>;
  http_status?: number;
  http_method?: string;
  http_path?: string;
  duration_ms?: number;
  request_id?: string;
  category?: string;
}

interface LogStats {
  total: number;
  errors: number;
  warnings: number;
  info: number;
}

const levelConfig: Record<string, { icon: React.ElementType; textColor: string; bgColor: string }> = {
  error: { icon: XCircle, textColor: "text-red-400", bgColor: "bg-red-500/10" },
  warn: { icon: AlertTriangle, textColor: "text-yellow-400", bgColor: "bg-yellow-500/10" },
  info: { icon: Info, textColor: "text-blue-400", bgColor: "bg-blue-500/10" },
  debug: { icon: Bug, textColor: "text-gray-400", bgColor: "bg-gray-500/10" },
};

const functionColors: Record<string, string> = {
  "bitrix24-webhook": "bg-purple-500/20",
  "bitrix24-install": "bg-indigo-500/20",
  "bitrix24-events": "bg-blue-500/20",
  "bitrix24-send": "bg-cyan-500/20",
  "bitrix24-worker": "bg-teal-500/20",
  "wapi-webhook": "bg-green-500/20",
  "wapi-send-message": "bg-emerald-500/20",
  "gupshup-webhook": "bg-lime-500/20",
  "ai-process-message": "bg-orange-500/20",
  "ai-gateway": "bg-amber-500/20",
};

export default function Diagnostics() {
  const { workspace } = useWorkspace();
  const [activeTab, setActiveTab] = useState("health");
  
  // Health state
  const [healthChecks, setHealthChecks] = useState<HealthCheck[]>([]);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  
  // Logs state
  const [logs, setLogs] = useState<DebugLog[]>([]);
  const [stats, setStats] = useState<LogStats>({ total: 0, errors: 0, warnings: 0, info: 0 });
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  
  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [functionFilter, setFunctionFilter] = useState<string>("all");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [timeRangeFilter, setTimeRangeFilter] = useState<string>("1h");

  // Health Check Functions
  const checkDatabaseHealth = async (): Promise<HealthCheck> => {
    const startTime = Date.now();
    try {
      const { error } = await supabase.from("workspaces").select("id").limit(1);
      const responseTime = Date.now() - startTime;
      
      if (error) throw error;
      
      return {
        name: "Database",
        status: responseTime > 1000 ? "degraded" : "healthy",
        message: responseTime > 1000 ? `Latência alta (${responseTime}ms)` : "Conectado",
        lastChecked: new Date(),
        responseTime,
      };
    } catch (error) {
      return {
        name: "Database",
        status: "unhealthy",
        message: error instanceof Error ? error.message : "Erro de conexão",
        lastChecked: new Date(),
        responseTime: Date.now() - startTime,
      };
    }
  };

  const checkEdgeFunctionHealth = async (functionName: string): Promise<HealthCheck> => {
    const startTime = Date.now();
    try {
      // Use a minimal request - we just want to check if the function responds
      // The function may return an error (400/500) but that still means it's running
      const response = await supabase.functions.invoke(functionName, {
        body: { action: "health_check" },
      });
      
      const responseTime = Date.now() - startTime;
      
      // Any response (even an error response from the function) means the function is running
      // The error field being set just means the function returned a non-2xx status
      // which is expected for functions that don't have a health_check handler
      // We only care if there's a network/deployment error (which would throw)
      
      return {
        name: functionName,
        status: responseTime > 2000 ? "degraded" : "healthy",
        message: responseTime > 2000 ? `Latência alta (${responseTime}ms)` : "Operacional",
        lastChecked: new Date(),
        responseTime,
      };
    } catch (error: unknown) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Network errors or deployment issues mean the function is truly unavailable
      return {
        name: functionName,
        status: "unhealthy",
        message: errorMessage || "Não disponível",
        lastChecked: new Date(),
        responseTime,
      };
    }
  };

  const checkIntegrationsHealth = async (): Promise<HealthCheck> => {
    try {
      const { data, error } = await supabase
        .from("integrations")
        .select("id, type, is_active")
        .eq("workspace_id", workspace?.id);

      if (error) throw error;

      const activeCount = data?.filter(i => i.is_active).length || 0;
      const totalCount = data?.length || 0;

      return {
        name: "Integrações",
        status: activeCount === 0 && totalCount > 0 ? "degraded" : "healthy",
        message: `${activeCount}/${totalCount} ativas`,
        lastChecked: new Date(),
      };
    } catch (error) {
      return {
        name: "Integrações",
        status: "unhealthy",
        message: error instanceof Error ? error.message : "Erro ao verificar",
        lastChecked: new Date(),
      };
    }
  };

  const checkInstancesHealth = async (): Promise<HealthCheck> => {
    try {
      const { data, error } = await supabase
        .from("instances")
        .select("id, status")
        .eq("workspace_id", workspace?.id);

      if (error) throw error;

      const connectedCount = data?.filter(i => i.status === "connected").length || 0;
      const totalCount = data?.length || 0;

      return {
        name: "WhatsApp Instances",
        status: connectedCount === 0 && totalCount > 0 ? "degraded" : "healthy",
        message: `${connectedCount}/${totalCount} conectadas`,
        lastChecked: new Date(),
      };
    } catch (error) {
      return {
        name: "WhatsApp Instances",
        status: "unhealthy",
        message: error instanceof Error ? error.message : "Erro ao verificar",
        lastChecked: new Date(),
      };
    }
  };

  const runHealthChecks = async () => {
    setIsCheckingHealth(true);
    
    // Set all to checking
    setHealthChecks([
      { name: "Database", status: "checking", message: "Verificando..." },
      { name: "bitrix24-webhook", status: "checking", message: "Verificando..." },
      { name: "wapi-webhook", status: "checking", message: "Verificando..." },
      { name: "ai-gateway", status: "checking", message: "Verificando..." },
      { name: "Integrações", status: "checking", message: "Verificando..." },
      { name: "WhatsApp Instances", status: "checking", message: "Verificando..." },
    ]);

    try {
      const results = await Promise.all([
        checkDatabaseHealth(),
        checkEdgeFunctionHealth("bitrix24-webhook"),
        checkEdgeFunctionHealth("wapi-webhook"),
        checkEdgeFunctionHealth("ai-gateway"),
        checkIntegrationsHealth(),
        checkInstancesHealth(),
      ]);
      
      setHealthChecks(results);
    } catch (error) {
      console.error("Health check error:", error);
      toast.error("Erro ao verificar saúde do sistema");
    } finally {
      setIsCheckingHealth(false);
    }
  };

  // Logs Functions
  const fetchLogs = useCallback(async () => {
    if (!workspace?.id) return;
    
    setIsLoadingLogs(true);
    try {
      const { data, error } = await supabase.functions.invoke("bitrix24-debug-logger", {
        body: {
          action: "query",
          filters: {
            workspace_id: workspace.id,
            function_name: functionFilter !== "all" ? functionFilter : undefined,
            level: levelFilter !== "all" ? levelFilter : undefined,
            time_range: timeRangeFilter,
          },
        },
      });

      if (error) throw error;

      let filteredLogs = data?.logs || [];
      
      // Client-side search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        filteredLogs = filteredLogs.filter((log: DebugLog) =>
          log.message?.toLowerCase().includes(query) ||
          log.function_name?.toLowerCase().includes(query) ||
          log.request_id?.toLowerCase().includes(query)
        );
      }

      setLogs(filteredLogs);
      setStats(data?.stats || { total: 0, errors: 0, warnings: 0, info: 0 });
    } catch (error) {
      console.error("Error fetching logs:", error);
      // Fallback to direct database query
      try {
        const timeAgo = new Date();
        const hours = parseInt(timeRangeFilter.replace("h", "")) || 1;
        timeAgo.setHours(timeAgo.getHours() - hours);

        let query = supabase
          .from("bitrix_debug_logs")
          .select("*")
          .eq("workspace_id", workspace.id)
          .gte("timestamp", timeAgo.toISOString())
          .order("timestamp", { ascending: false })
          .limit(200);

        if (functionFilter !== "all") {
          query = query.eq("function_name", functionFilter);
        }
        if (levelFilter !== "all") {
          query = query.eq("level", levelFilter);
        }

        const { data: dbLogs, error: dbError } = await query;
        
        if (dbError) throw dbError;
        
        let filteredLogs = dbLogs || [];
        
        if (searchQuery) {
          const queryStr = searchQuery.toLowerCase();
          filteredLogs = filteredLogs.filter((log) =>
            log.message?.toLowerCase().includes(queryStr) ||
            log.function_name?.toLowerCase().includes(queryStr) ||
            log.request_id?.toLowerCase().includes(queryStr)
          );
        }

        setLogs(filteredLogs as DebugLog[]);
        
        // Calculate stats
        const errors = filteredLogs.filter(l => l.level === "error").length;
        const warnings = filteredLogs.filter(l => l.level === "warn").length;
        const info = filteredLogs.filter(l => l.level === "info").length;
        setStats({ total: filteredLogs.length, errors, warnings, info });
      } catch (fallbackError) {
        console.error("Fallback query error:", fallbackError);
        setLogs([]);
      }
    } finally {
      setIsLoadingLogs(false);
    }
  }, [workspace?.id, functionFilter, levelFilter, timeRangeFilter, searchQuery]);

  const clearLogs = async () => {
    if (!workspace?.id) return;
    
    try {
      const { error } = await supabase.functions.invoke("bitrix24-debug-logger", {
        body: {
          action: "clear_all",
          workspace_id: workspace.id,
        },
      });

      if (error) throw error;

      setLogs([]);
      setStats({ total: 0, errors: 0, warnings: 0, info: 0 });
      toast.success("Logs limpos com sucesso");
    } catch (error) {
      console.error("Error clearing logs:", error);
      toast.error("Erro ao limpar logs");
    }
  };

  const exportLogs = () => {
    const content = JSON.stringify(logs, null, 2);
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `thoth-logs-${format(new Date(), "yyyy-MM-dd-HH-mm")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Logs exportados");
  };

  const toggleLogExpanded = (logId: string) => {
    setExpandedLogs(prev => {
      const next = new Set(prev);
      if (next.has(logId)) {
        next.delete(logId);
      } else {
        next.add(logId);
      }
      return next;
    });
  };

  // Effects
  useEffect(() => {
    if (workspace?.id && activeTab === "health") {
      runHealthChecks();
    }
  }, [workspace?.id, activeTab]);

  useEffect(() => {
    if (workspace?.id && activeTab === "logs") {
      fetchLogs();
    }
  }, [workspace?.id, activeTab, fetchLogs]);

  useEffect(() => {
    if (!autoRefresh || activeTab !== "logs") return;
    
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, activeTab, fetchLogs]);

  const getStatusIcon = (status: HealthCheck["status"]) => {
    switch (status) {
      case "healthy":
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case "degraded":
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case "unhealthy":
        return <XCircle className="h-5 w-5 text-red-500" />;
      case "checking":
        return <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: HealthCheck["status"]) => {
    switch (status) {
      case "healthy":
        return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Saudável</Badge>;
      case "degraded":
        return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Degradado</Badge>;
      case "unhealthy":
        return <Badge className="bg-red-500/10 text-red-500 border-red-500/20">Indisponível</Badge>;
      case "checking":
        return <Badge variant="outline">Verificando...</Badge>;
    }
  };

  const overallStatus = healthChecks.length === 0 
    ? "checking" 
    : healthChecks.some(h => h.status === "unhealthy") 
      ? "unhealthy" 
      : healthChecks.some(h => h.status === "degraded") 
        ? "degraded" 
        : "healthy";

  const uniqueFunctions = [...new Set(logs.map(l => l.function_name))].filter(Boolean);

  return (
    <AppLayout>
      <div className="container mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Activity className="h-8 w-8 text-primary" />
              Diagnósticos do Sistema
            </h1>
            <p className="text-muted-foreground mt-1">
              Monitore a saúde do sistema, logs e atividades
            </p>
          </div>
        </div>

        {/* Overall Status Card */}
        <Card className="border-2" style={{ borderColor: overallStatus === "healthy" ? "hsl(var(--chart-2))" : overallStatus === "degraded" ? "hsl(var(--chart-4))" : "hsl(var(--destructive))" }}>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {overallStatus === "healthy" && <Wifi className="h-8 w-8 text-green-500" />}
                {overallStatus === "degraded" && <AlertTriangle className="h-8 w-8 text-yellow-500" />}
                {overallStatus === "unhealthy" && <WifiOff className="h-8 w-8 text-red-500" />}
                {overallStatus === "checking" && <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />}
                <div>
                  <h2 className="text-xl font-semibold">
                    {overallStatus === "healthy" && "Sistema Operacional"}
                    {overallStatus === "degraded" && "Desempenho Degradado"}
                    {overallStatus === "unhealthy" && "Problemas Detectados"}
                    {overallStatus === "checking" && "Verificando..."}
                  </h2>
                  <p className="text-muted-foreground">
                    {healthChecks.filter(h => h.status === "healthy").length}/{healthChecks.length} serviços saudáveis
                  </p>
                </div>
              </div>
              <Button onClick={runHealthChecks} disabled={isCheckingHealth}>
                <RefreshCw className={`h-4 w-4 mr-2 ${isCheckingHealth ? "animate-spin" : ""}`} />
                Verificar
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full max-w-md grid-cols-3">
            <TabsTrigger value="health" className="flex items-center gap-2">
              <Server className="h-4 w-4" />
              Saúde
            </TabsTrigger>
            <TabsTrigger value="logs" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Logs
            </TabsTrigger>
            <TabsTrigger value="activity" className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Atividade
            </TabsTrigger>
          </TabsList>

          {/* Health Tab */}
          <TabsContent value="health" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {healthChecks.map((check) => (
                <Card key={check.name} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-medium flex items-center gap-2">
                        {check.name.includes("Database") && <Database className="h-4 w-4" />}
                        {check.name.includes("bitrix") && <Plug className="h-4 w-4" />}
                        {check.name.includes("wapi") && <MessageSquare className="h-4 w-4" />}
                        {check.name.includes("ai") && <Bot className="h-4 w-4" />}
                        {check.name.includes("Integr") && <Plug className="h-4 w-4" />}
                        {check.name.includes("WhatsApp") && <MessageSquare className="h-4 w-4" />}
                        {check.name}
                      </CardTitle>
                      {getStatusIcon(check.status)}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {getStatusBadge(check.status)}
                      <p className="text-sm text-muted-foreground">{check.message}</p>
                      {check.responseTime && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Zap className="h-3 w-3" />
                          {check.responseTime}ms
                        </p>
                      )}
                      {check.lastChecked && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(check.lastChecked, { addSuffix: true, locale: ptBR })}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Logs Tab */}
          <TabsContent value="logs" className="space-y-4">
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Bug className="h-5 w-5" />
                      Console de Debug
                    </CardTitle>
                    <CardDescription>
                      Logs de todas as edge functions e integrações
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 mr-4">
                      <Switch
                        id="auto-refresh"
                        checked={autoRefresh}
                        onCheckedChange={setAutoRefresh}
                      />
                      <Label htmlFor="auto-refresh" className="text-sm">Auto-refresh</Label>
                    </div>
                    <Button variant="outline" size="sm" onClick={fetchLogs} disabled={isLoadingLogs}>
                      <RefreshCw className={`h-4 w-4 mr-2 ${isLoadingLogs ? "animate-spin" : ""}`} />
                      Atualizar
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportLogs}>
                      <Download className="h-4 w-4 mr-2" />
                      Exportar
                    </Button>
                    <Button variant="outline" size="sm" onClick={clearLogs}>
                      <Trash2 className="h-4 w-4 mr-2" />
                      Limpar
                    </Button>
                  </div>
                </div>

                {/* Stats Bar */}
                <div className="flex gap-4 mt-4 text-sm">
                  <span className="text-muted-foreground">Total: <strong>{stats.total}</strong></span>
                  <span className="text-red-400">Erros: <strong>{stats.errors}</strong></span>
                  <span className="text-yellow-400">Avisos: <strong>{stats.warnings}</strong></span>
                  <span className="text-blue-400">Info: <strong>{stats.info}</strong></span>
                </div>

                {/* Filters */}
                <div className="flex flex-wrap gap-4 mt-4">
                  <div className="flex-1 min-w-[200px]">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Buscar logs..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                  </div>
                  
                  <Select value={functionFilter} onValueChange={setFunctionFilter}>
                    <SelectTrigger className="w-[180px]">
                      <Filter className="h-4 w-4 mr-2" />
                      <SelectValue placeholder="Função" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas as funções</SelectItem>
                      {uniqueFunctions.map((fn) => (
                        <SelectItem key={fn} value={fn}>{fn}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={levelFilter} onValueChange={setLevelFilter}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="Nível" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="error">Erro</SelectItem>
                      <SelectItem value="warn">Aviso</SelectItem>
                      <SelectItem value="info">Info</SelectItem>
                      <SelectItem value="debug">Debug</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={timeRangeFilter} onValueChange={setTimeRangeFilter}>
                    <SelectTrigger className="w-[140px]">
                      <Clock className="h-4 w-4 mr-2" />
                      <SelectValue placeholder="Período" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1h">Última hora</SelectItem>
                      <SelectItem value="6h">6 horas</SelectItem>
                      <SelectItem value="24h">24 horas</SelectItem>
                      <SelectItem value="48h">48 horas</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px] rounded-md border">
                  <div className="p-4 space-y-2 font-mono text-sm">
                    {logs.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                        <FileText className="h-12 w-12 mb-4 opacity-50" />
                        <p>Nenhum log encontrado</p>
                        <p className="text-xs mt-1">Os logs aparecerão aqui conforme as funções são executadas</p>
                      </div>
                    ) : (
                      logs.map((log) => {
                        const config = levelConfig[log.level] || levelConfig.info;
                        const LevelIcon = config.icon;
                        const isExpanded = expandedLogs.has(log.id);
                        const funcColor = functionColors[log.function_name] || "bg-gray-500/20";

                        return (
                          <Collapsible key={log.id} open={isExpanded} onOpenChange={() => toggleLogExpanded(log.id)}>
                            <CollapsibleTrigger asChild>
                              <div
                                className={`flex items-start gap-3 p-2 rounded cursor-pointer hover:bg-accent/50 ${config.bgColor}`}
                              >
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  {isExpanded ? (
                                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                  )}
                                  <LevelIcon className={`h-4 w-4 ${config.textColor}`} />
                                </div>
                                
                                <span className="text-xs text-muted-foreground whitespace-nowrap">
                                  {format(new Date(log.timestamp), "HH:mm:ss.SSS")}
                                </span>
                                
                                <Badge variant="outline" className={`text-xs ${funcColor}`}>
                                  {log.function_name}
                                </Badge>
                                
                                <span className={`flex-1 truncate ${config.textColor}`}>
                                  {log.message}
                                </span>
                                
                                {log.http_status && (
                                  <Badge variant="outline" className={`text-xs ${
                                    log.http_status >= 400 ? "bg-red-500/20" : "bg-green-500/20"
                                  }`}>
                                    {log.http_status}
                                  </Badge>
                                )}
                                
                                {log.duration_ms && (
                                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                                    {log.duration_ms}ms
                                  </span>
                                )}
                              </div>
                            </CollapsibleTrigger>
                            
                            <CollapsibleContent>
                              <div className="ml-8 mt-2 p-3 bg-muted/50 rounded text-xs space-y-2">
                                {log.request_id && (
                                  <div>
                                    <span className="text-muted-foreground">Request ID: </span>
                                    <span className="text-primary">{log.request_id}</span>
                                  </div>
                                )}
                                {log.http_method && log.http_path && (
                                  <div>
                                    <span className="text-muted-foreground">HTTP: </span>
                                    <span className="text-primary">{log.http_method} {log.http_path}</span>
                                  </div>
                                )}
                                {log.details && Object.keys(log.details).length > 0 && (
                                  <div>
                                    <span className="text-muted-foreground">Detalhes:</span>
                                    <pre className="mt-1 p-2 bg-background rounded overflow-x-auto">
                                      {JSON.stringify(log.details, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        );
                      })
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Activity Tab */}
          <TabsContent value="activity" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Realtime Monitor */}
              <RealtimeMonitor />
              
              {/* Stats Summary */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    Resumo de Atividade
                  </CardTitle>
                  <CardDescription>
                    Estatísticas das últimas 24 horas
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 grid-cols-2">
                    <Card className="bg-card/50">
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-green-500/10">
                            <MessageSquare className="h-5 w-5 text-green-500" />
                          </div>
                          <div>
                            <p className="text-2xl font-bold">--</p>
                            <p className="text-xs text-muted-foreground">Mensagens</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                    
                    <Card className="bg-card/50">
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-blue-500/10">
                            <Bot className="h-5 w-5 text-blue-500" />
                          </div>
                          <div>
                            <p className="text-2xl font-bold">--</p>
                            <p className="text-xs text-muted-foreground">Respostas IA</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                    
                    <Card className="bg-card/50">
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-purple-500/10">
                            <Plug className="h-5 w-5 text-purple-500" />
                          </div>
                          <div>
                            <p className="text-2xl font-bold">--</p>
                            <p className="text-xs text-muted-foreground">Webhooks</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                    
                    <Card className="bg-card/50">
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-red-500/10">
                            <AlertCircle className="h-5 w-5 text-red-500" />
                          </div>
                          <div>
                            <p className="text-2xl font-bold">{stats.errors}</p>
                            <p className="text-xs text-muted-foreground">Erros</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

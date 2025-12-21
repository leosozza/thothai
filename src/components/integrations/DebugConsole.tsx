import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  RefreshCw,
  Trash2,
  Download,
  ChevronRight,
  ChevronDown,
  AlertCircle,
  AlertTriangle,
  Info,
  Bug,
  Globe,
  ArrowRight,
  Clock,
  Filter,
  Search,
  Pause,
  Play,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

interface DebugLog {
  id: string;
  timestamp: string;
  function_name: string;
  integration_id: string | null;
  workspace_id: string | null;
  level: string;
  category: string | null;
  message: string;
  details: Record<string, unknown>;
  request_id: string | null;
  http_method: string | null;
  http_path: string | null;
  http_status: number | null;
  duration_ms: number | null;
}

interface DebugConsoleProps {
  integrationId?: string;
  workspaceId?: string;
}

const levelConfig: Record<string, { icon: React.ElementType; color: string; bgColor: string }> = {
  debug: { icon: Bug, color: "text-gray-500", bgColor: "bg-gray-100 dark:bg-gray-800" },
  info: { icon: Info, color: "text-blue-500", bgColor: "bg-blue-100 dark:bg-blue-900/30" },
  warn: { icon: AlertTriangle, color: "text-yellow-500", bgColor: "bg-yellow-100 dark:bg-yellow-900/30" },
  error: { icon: AlertCircle, color: "text-red-500", bgColor: "bg-red-100 dark:bg-red-900/30" },
  api_call: { icon: ArrowRight, color: "text-purple-500", bgColor: "bg-purple-100 dark:bg-purple-900/30" },
  api_response: { icon: Globe, color: "text-green-500", bgColor: "bg-green-100 dark:bg-green-900/30" },
};

const functionColors: Record<string, string> = {
  "bitrix24-connector-settings": "bg-indigo-500",
  "bitrix24-webhook": "bg-emerald-500",
  "bitrix24-events": "bg-amber-500",
  "bitrix24-worker": "bg-rose-500",
  "bitrix24-install": "bg-cyan-500",
  "bitrix24-send": "bg-violet-500",
  "bitrix24-register": "bg-orange-500",
  "bitrix24-status": "bg-teal-500",
  "bitrix24-debug-logger": "bg-gray-500",
};

export function DebugConsole({ integrationId, workspaceId }: DebugConsoleProps) {
  const [logs, setLogs] = useState<DebugLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  
  // Filters
  const [functionFilter, setFunctionFilter] = useState<string>("all");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [timeRange, setTimeRange] = useState<string>("30m");

  // Stats
  const [stats, setStats] = useState<{
    total: number;
    byLevel: Record<string, number>;
    byFunction: Record<string, number>;
  } | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      // Calculate time range
      const now = new Date();
      let fromTimestamp: string | undefined;
      
      switch (timeRange) {
        case "5m": fromTimestamp = new Date(now.getTime() - 5 * 60 * 1000).toISOString(); break;
        case "15m": fromTimestamp = new Date(now.getTime() - 15 * 60 * 1000).toISOString(); break;
        case "30m": fromTimestamp = new Date(now.getTime() - 30 * 60 * 1000).toISOString(); break;
        case "1h": fromTimestamp = new Date(now.getTime() - 60 * 60 * 1000).toISOString(); break;
        case "6h": fromTimestamp = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString(); break;
        case "24h": fromTimestamp = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(); break;
      }

      const filters: Record<string, unknown> = {
        limit: 200,
      };
      
      if (integrationId) filters.integration_id = integrationId;
      if (workspaceId) filters.workspace_id = workspaceId;
      if (functionFilter !== "all") filters.function_name = functionFilter;
      if (levelFilter !== "all") filters.level = levelFilter;
      if (fromTimestamp) filters.from_timestamp = fromTimestamp;

      const response = await supabase.functions.invoke("bitrix24-debug-logger", {
        body: { action: "query", filters }
      });

      if (response.data?.logs) {
        let filteredLogs = response.data.logs;
        
        // Client-side search filter
        if (searchQuery.trim()) {
          const query = searchQuery.toLowerCase();
          filteredLogs = filteredLogs.filter((log: DebugLog) => 
            log.message.toLowerCase().includes(query) ||
            log.function_name.toLowerCase().includes(query) ||
            log.request_id?.toLowerCase().includes(query) ||
            JSON.stringify(log.details).toLowerCase().includes(query)
          );
        }
        
        setLogs(filteredLogs);
      }

      // Fetch stats
      const statsResponse = await supabase.functions.invoke("bitrix24-debug-logger", {
        body: { 
          action: "stats", 
          filters: { 
            workspace_id: workspaceId,
            from_timestamp: fromTimestamp
          } 
        }
      });

      if (statsResponse.data?.stats) {
        setStats(statsResponse.data.stats);
      }
    } catch (error) {
      console.error("Error fetching logs:", error);
    } finally {
      setLoading(false);
    }
  }, [integrationId, workspaceId, functionFilter, levelFilter, searchQuery, timeRange]);

  // Initial fetch and auto-refresh
  useEffect(() => {
    fetchLogs();
    
    let interval: NodeJS.Timeout | null = null;
    if (autoRefresh) {
      interval = setInterval(fetchLogs, 5000); // Refresh every 5 seconds
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [fetchLogs, autoRefresh]);

  const handleClearLogs = async () => {
    if (!workspaceId) {
      toast.error("Workspace ID necessário para limpar logs");
      return;
    }

    try {
      const response = await supabase.functions.invoke("bitrix24-debug-logger", {
        body: { action: "clear_all", workspace_id: workspaceId }
      });

      if (response.data?.success) {
        toast.success(`${response.data.deleted || 0} logs removidos`);
        fetchLogs();
      } else {
        toast.error("Erro ao limpar logs");
      }
    } catch (error) {
      console.error("Error clearing logs:", error);
      toast.error("Erro ao limpar logs");
    }
  };

  const handleExportLogs = () => {
    const exportData = logs.map(log => ({
      timestamp: log.timestamp,
      function: log.function_name,
      level: log.level,
      category: log.category,
      message: log.message,
      request_id: log.request_id,
      http_method: log.http_method,
      http_status: log.http_status,
      duration_ms: log.duration_ms,
      details: log.details,
    }));

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bitrix24-debug-logs-${format(new Date(), "yyyy-MM-dd-HHmm")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Logs exportados com sucesso");
  };

  const toggleLogExpanded = (id: string) => {
    setExpandedLogs(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const uniqueFunctions = Array.from(new Set(logs.map(l => l.function_name)));

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Bug className="h-5 w-5" />
            Debug Console Bitrix24
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={autoRefresh ? "text-green-600" : "text-muted-foreground"}
            >
              {autoRefresh ? <Pause className="h-4 w-4 mr-1" /> : <Play className="h-4 w-4 mr-1" />}
              {autoRefresh ? "Pausar" : "Auto"}
            </Button>
            <Button variant="outline" size="sm" onClick={fetchLogs} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportLogs}>
              <Download className="h-4 w-4 mr-1" />
              Exportar
            </Button>
            <Button variant="outline" size="sm" onClick={handleClearLogs} className="text-destructive">
              <Trash2 className="h-4 w-4 mr-1" />
              Limpar
            </Button>
          </div>
        </div>

        {/* Stats bar */}
        {stats && (
          <div className="flex gap-4 mt-2 text-sm">
            <span className="text-muted-foreground">Total: <strong>{stats.total}</strong></span>
            {stats.byLevel.error > 0 && (
              <Badge variant="destructive" className="text-xs">
                {stats.byLevel.error} erros
              </Badge>
            )}
            {stats.byLevel.warn > 0 && (
              <Badge variant="outline" className="text-xs border-yellow-500 text-yellow-600">
                {stats.byLevel.warn} avisos
              </Badge>
            )}
            <span className="text-muted-foreground">
              API calls: <strong>{stats.byLevel.api_call || 0}</strong>
            </span>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mt-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar mensagem, request_id, ou dados..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          
          <Select value={functionFilter} onValueChange={setFunctionFilter}>
            <SelectTrigger className="w-[180px] h-9">
              <Filter className="h-4 w-4 mr-1" />
              <SelectValue placeholder="Função" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as funções</SelectItem>
              {uniqueFunctions.map(fn => (
                <SelectItem key={fn} value={fn}>{fn}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={levelFilter} onValueChange={setLevelFilter}>
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue placeholder="Nível" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos níveis</SelectItem>
              <SelectItem value="debug">Debug</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warn">Warn</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="api_call">API Call</SelectItem>
              <SelectItem value="api_response">API Response</SelectItem>
            </SelectContent>
          </Select>

          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-[130px] h-9">
              <Clock className="h-4 w-4 mr-1" />
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="5m">Últimos 5 min</SelectItem>
              <SelectItem value="15m">Últimos 15 min</SelectItem>
              <SelectItem value="30m">Últimos 30 min</SelectItem>
              <SelectItem value="1h">Última hora</SelectItem>
              <SelectItem value="6h">Últimas 6h</SelectItem>
              <SelectItem value="24h">Últimas 24h</SelectItem>
              <SelectItem value="all">Todos</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden p-0">
        <ScrollArea className="h-[500px]">
          <div className="font-mono text-xs">
            {logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Bug className="h-12 w-12 mb-4 opacity-50" />
                <p className="text-sm">Nenhum log encontrado</p>
                <p className="text-xs mt-1">Os logs aparecerão aqui quando houver atividade</p>
              </div>
            ) : (
              logs.map((log) => {
                const config = levelConfig[log.level] || levelConfig.info;
                const LevelIcon = config.icon;
                const isExpanded = expandedLogs.has(log.id);
                const functionColor = functionColors[log.function_name] || "bg-gray-500";
                
                return (
                  <Collapsible key={log.id} open={isExpanded} onOpenChange={() => toggleLogExpanded(log.id)}>
                    <CollapsibleTrigger asChild>
                      <div 
                        className={`flex items-start gap-2 px-3 py-2 border-b border-border/50 hover:bg-muted/50 cursor-pointer transition-colors ${config.bgColor}`}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3 mt-1 flex-shrink-0" />
                        ) : (
                          <ChevronRight className="h-3 w-3 mt-1 flex-shrink-0" />
                        )}
                        
                        <span className="text-muted-foreground whitespace-nowrap">
                          {format(new Date(log.timestamp), "HH:mm:ss.SSS")}
                        </span>
                        
                        <Badge 
                          variant="outline" 
                          className={`text-[10px] px-1 py-0 h-4 ${config.color} border-current`}
                        >
                          <LevelIcon className="h-2.5 w-2.5 mr-0.5" />
                          {log.level.toUpperCase()}
                        </Badge>
                        
                        <Badge 
                          className={`text-[10px] px-1.5 py-0 h-4 text-white ${functionColor}`}
                        >
                          {log.function_name.replace("bitrix24-", "")}
                        </Badge>
                        
                        {log.category && (
                          <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">
                            {log.category}
                          </Badge>
                        )}
                        
                        <span className="text-foreground truncate flex-1">
                          {log.message}
                        </span>
                        
                        {log.duration_ms && (
                          <span className="text-muted-foreground whitespace-nowrap">
                            {log.duration_ms}ms
                          </span>
                        )}
                        
                        {log.http_status && (
                          <Badge 
                            variant={log.http_status >= 400 ? "destructive" : "outline"}
                            className="text-[10px] px-1 py-0 h-4"
                          >
                            {log.http_status}
                          </Badge>
                        )}
                      </div>
                    </CollapsibleTrigger>
                    
                    <CollapsibleContent>
                      <div className="bg-muted/30 border-b border-border px-6 py-3 space-y-2">
                        {log.request_id && (
                          <div className="flex gap-2">
                            <span className="text-muted-foreground w-24">Request ID:</span>
                            <code className="text-xs bg-muted px-1 rounded">{log.request_id}</code>
                          </div>
                        )}
                        
                        {log.http_method && (
                          <div className="flex gap-2">
                            <span className="text-muted-foreground w-24">HTTP:</span>
                            <code className="text-xs">
                              {log.http_method} {log.http_path} → {log.http_status}
                            </code>
                          </div>
                        )}
                        
                        {log.integration_id && (
                          <div className="flex gap-2">
                            <span className="text-muted-foreground w-24">Integration:</span>
                            <code className="text-xs bg-muted px-1 rounded">{log.integration_id}</code>
                          </div>
                        )}
                        
                        {Object.keys(log.details || {}).length > 0 && (
                          <div>
                            <span className="text-muted-foreground">Details:</span>
                            <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-x-auto max-h-[300px]">
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
  );
}

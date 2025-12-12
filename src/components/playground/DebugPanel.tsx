import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, Hash, Bot, Zap } from "lucide-react";

interface Metrics {
  response_time_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface DebugPanelProps {
  metrics: Metrics | null;
  personaName: string;
  messageCount: number;
}

export function DebugPanel({ metrics, personaName, messageCount }: DebugPanelProps) {
  return (
    <Card className="bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Zap className="h-4 w-4" />
          Debug Info
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Persona */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground flex items-center gap-2">
            <Bot className="h-4 w-4" />
            Persona
          </span>
          <Badge variant="secondary">{personaName || "Nenhuma"}</Badge>
        </div>

        {/* Message Count */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground flex items-center gap-2">
            <Hash className="h-4 w-4" />
            Mensagens
          </span>
          <Badge variant="outline">{messageCount}</Badge>
        </div>

        {metrics && (
          <>
            {/* Response Time */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Tempo de resposta
              </span>
              <Badge
                variant={metrics.response_time_ms < 2000 ? "default" : "destructive"}
              >
                {(metrics.response_time_ms / 1000).toFixed(2)}s
              </Badge>
            </div>

            {/* Tokens */}
            <div className="space-y-2 pt-2 border-t">
              <span className="text-xs font-medium text-muted-foreground">
                Tokens Utilizados
              </span>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-muted rounded p-2">
                  <div className="text-xs text-muted-foreground">Prompt</div>
                  <div className="font-mono text-sm">{metrics.prompt_tokens}</div>
                </div>
                <div className="bg-muted rounded p-2">
                  <div className="text-xs text-muted-foreground">Resposta</div>
                  <div className="font-mono text-sm">{metrics.completion_tokens}</div>
                </div>
                <div className="bg-primary/10 rounded p-2">
                  <div className="text-xs text-muted-foreground">Total</div>
                  <div className="font-mono text-sm font-bold">{metrics.total_tokens}</div>
                </div>
              </div>
            </div>
          </>
        )}

        {!metrics && (
          <p className="text-xs text-muted-foreground text-center py-4">
            Envie uma mensagem para ver as métricas
          </p>
        )}
      </CardContent>
    </Card>
  );
}

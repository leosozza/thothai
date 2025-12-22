import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { FileText, Globe, MessageSquare, BookOpen, Loader2 } from "lucide-react";

interface KnowledgeDocument {
  id: string;
  title: string;
  source_type: string;
  status: string;
  chunks_count: number | null;
}

interface KnowledgeSelectorProps {
  selectedDocumentIds: string[];
  onSelectionChange: (documentIds: string[]) => void;
}

const SOURCE_TYPE_ICONS: Record<string, React.ReactNode> = {
  file: <FileText className="h-4 w-4" />,
  url: <Globe className="h-4 w-4" />,
  manual: <BookOpen className="h-4 w-4" />,
  conversation: <MessageSquare className="h-4 w-4" />,
};

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-500/20 text-green-400 border-green-500/30",
  processing: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  pending: "bg-muted text-muted-foreground border-border",
  error: "bg-red-500/20 text-red-400 border-red-500/30",
};

const STATUS_LABELS: Record<string, string> = {
  completed: "Concluído",
  processing: "Processando",
  pending: "Pendente",
  error: "Erro",
};

export function KnowledgeSelector({ selectedDocumentIds, onSelectionChange }: KnowledgeSelectorProps) {
  const { workspace } = useWorkspace();
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspace?.id) return;

    const fetchDocuments = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("knowledge_documents")
        .select("id, title, source_type, status, chunks_count")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false });

      if (!error && data) {
        setDocuments(data);
      }
      setLoading(false);
    };

    fetchDocuments();
  }, [workspace?.id]);

  const handleToggle = (documentId: string) => {
    if (selectedDocumentIds.includes(documentId)) {
      onSelectionChange(selectedDocumentIds.filter((id) => id !== documentId));
    } else {
      onSelectionChange([...selectedDocumentIds, documentId]);
    }
  };

  const handleSelectAll = () => {
    const completedDocs = documents.filter((d) => d.status === "completed");
    if (selectedDocumentIds.length === completedDocs.length) {
      onSelectionChange([]);
    } else {
      onSelectionChange(completedDocs.map((d) => d.id));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">Nenhum documento de treinamento encontrado.</p>
        <p className="text-xs">Adicione documentos em Treinamento para usá-los aqui.</p>
      </div>
    );
  }

  const completedCount = documents.filter((d) => d.status === "completed").length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Base de Conhecimento</Label>
        <button
          type="button"
          onClick={handleSelectAll}
          className="text-xs text-primary hover:underline"
        >
          {selectedDocumentIds.length === completedCount ? "Desmarcar todos" : "Selecionar todos"}
        </button>
      </div>

      <ScrollArea className="h-[200px] rounded-md border border-border bg-background/50 p-2">
        <div className="space-y-1">
          {documents.map((doc) => {
            const isCompleted = doc.status === "completed";
            const isSelected = selectedDocumentIds.includes(doc.id);

            return (
              <div
                key={doc.id}
                className={`flex items-center gap-3 p-2 rounded-md transition-colors ${
                  isCompleted
                    ? "hover:bg-muted/50 cursor-pointer"
                    : "opacity-50 cursor-not-allowed"
                } ${isSelected ? "bg-primary/10" : ""}`}
                onClick={() => isCompleted && handleToggle(doc.id)}
              >
                <Checkbox
                  checked={isSelected}
                  disabled={!isCompleted}
                  onCheckedChange={() => handleToggle(doc.id)}
                  className="pointer-events-none"
                />
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {SOURCE_TYPE_ICONS[doc.source_type] || <FileText className="h-4 w-4" />}
                    </span>
                    <span className="text-sm font-medium truncate">{doc.title}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {doc.chunks_count && doc.chunks_count > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {doc.chunks_count} chunks
                    </span>
                  )}
                  <Badge variant="outline" className={`text-xs ${STATUS_COLORS[doc.status]}`}>
                    {STATUS_LABELS[doc.status] || doc.status}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      <p className="text-xs text-muted-foreground">
        {selectedDocumentIds.length} de {completedCount} documentos selecionados
      </p>
    </div>
  );
}

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import {
  FileText,
  Layers,
  Info,
  Loader2,
  ExternalLink,
  Calendar,
  Hash,
} from "lucide-react";

interface KnowledgeChunk {
  id: string;
  chunk_index: number;
  content: string;
  tokens_count: number | null;
}

interface DocumentDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: {
    id: string;
    title: string;
    content: string | null;
    source_type: string;
    source_url: string | null;
    file_path: string | null;
    file_type: string | null;
    status: string;
    chunks_count: number;
    created_at: string;
  } | null;
}

export function DocumentDetailsDialog({
  open,
  onOpenChange,
  document,
}: DocumentDetailsDialogProps) {
  const [chunks, setChunks] = useState<KnowledgeChunk[]>([]);
  const [loadingChunks, setLoadingChunks] = useState(false);
  const [activeTab, setActiveTab] = useState("content");

  useEffect(() => {
    if (open && document?.id) {
      fetchChunks();
    }
  }, [open, document?.id]);

  const fetchChunks = async () => {
    if (!document?.id) return;
    
    setLoadingChunks(true);
    try {
      const { data, error } = await supabase
        .from("knowledge_chunks")
        .select("id, chunk_index, content, tokens_count")
        .eq("document_id", document.id)
        .order("chunk_index", { ascending: true });

      if (error) throw error;
      setChunks(data || []);
    } catch (error) {
      console.error("Error fetching chunks:", error);
    } finally {
      setLoadingChunks(false);
    }
  };

  if (!document) return null;

  const totalTokens = chunks.reduce((acc, chunk) => acc + (chunk.tokens_count || 0), 0);
  const contentLength = document.content?.length || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {document.title}
          </DialogTitle>
          <DialogDescription>
            Detalhes do documento e chunks processados
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="content" className="gap-1.5">
              <FileText className="h-4 w-4" />
              Conteúdo
            </TabsTrigger>
            <TabsTrigger value="chunks" className="gap-1.5">
              <Layers className="h-4 w-4" />
              Chunks ({document.chunks_count})
            </TabsTrigger>
            <TabsTrigger value="info" className="gap-1.5">
              <Info className="h-4 w-4" />
              Informações
            </TabsTrigger>
          </TabsList>

          <TabsContent value="content" className="mt-4">
            <ScrollArea className="h-[400px] rounded-md border p-4">
              {document.content ? (
                <pre className="whitespace-pre-wrap text-sm font-mono">
                  {document.content}
                </pre>
              ) : document.source_url ? (
                <div className="flex flex-col items-center justify-center h-full text-center gap-4">
                  <ExternalLink className="h-12 w-12 text-muted-foreground" />
                  <p className="text-muted-foreground">
                    Conteúdo extraído de URL externa
                  </p>
                  <Button variant="outline" asChild>
                    <a href={document.source_url} target="_blank" rel="noopener noreferrer">
                      Abrir URL Original
                    </a>
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <FileText className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">
                    Conteúdo extraído de arquivo
                  </p>
                  {document.file_type && (
                    <Badge variant="outline" className="mt-2">
                      {document.file_type}
                    </Badge>
                  )}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="chunks" className="mt-4">
            {loadingChunks ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : chunks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Layers className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  {document.status === "processing"
                    ? "Documento ainda está sendo processado..."
                    : "Nenhum chunk encontrado"}
                </p>
              </div>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="space-y-3">
                  {chunks.map((chunk) => (
                    <div
                      key={chunk.id}
                      className="rounded-lg border p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <Badge variant="secondary" className="gap-1">
                          <Hash className="h-3 w-3" />
                          Chunk {chunk.chunk_index + 1}
                        </Badge>
                        {chunk.tokens_count && (
                          <span className="text-xs text-muted-foreground">
                            {chunk.tokens_count} tokens
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-3">
                        {chunk.content}
                      </p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="info" className="mt-4">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground mb-1">Status</p>
                  <Badge
                    variant={document.status === "completed" ? "default" : "secondary"}
                  >
                    {document.status === "completed"
                      ? "Concluído"
                      : document.status === "processing"
                      ? "Processando"
                      : document.status === "failed"
                      ? "Falhou"
                      : "Pendente"}
                  </Badge>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground mb-1">Tipo de Fonte</p>
                  <p className="font-medium capitalize">{document.source_type}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground mb-1">Total de Chunks</p>
                  <p className="font-medium">{document.chunks_count}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground mb-1">Total de Tokens</p>
                  <p className="font-medium">{totalTokens.toLocaleString()}</p>
                </div>
                {contentLength > 0 && (
                  <div className="rounded-lg border p-4">
                    <p className="text-sm text-muted-foreground mb-1">Caracteres</p>
                    <p className="font-medium">{contentLength.toLocaleString()}</p>
                  </div>
                )}
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    Criado em
                  </p>
                  <p className="font-medium">
                    {new Date(document.created_at).toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                </div>
              </div>

              {document.source_url && (
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground mb-1">URL de Origem</p>
                  <a
                    href={document.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline flex items-center gap-1"
                  >
                    {document.source_url}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}

              {document.file_path && (
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground mb-1">Arquivo</p>
                  <p className="text-sm font-medium">
                    {document.file_path.split("/").pop()}
                  </p>
                  {document.file_type && (
                    <Badge variant="outline" className="mt-2">
                      {document.file_type}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

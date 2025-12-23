import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, RefreshCw, Pencil } from "lucide-react";

interface EditDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: {
    id: string;
    title: string;
    content: string | null;
    source_type: string;
    source_url: string | null;
  } | null;
  onUpdated: () => void;
}

export function EditDocumentDialog({
  open,
  onOpenChange,
  document,
  onUpdated,
}: EditDocumentDialogProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [reprocess, setReprocess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (document) {
      setTitle(document.title);
      setContent(document.content || "");
      setSourceUrl(document.source_url || "");
      setReprocess(false);
    }
  }, [document]);

  const handleSave = async () => {
    if (!document) return;
    if (!title.trim()) {
      toast.error("Título é obrigatório");
      return;
    }

    setIsSubmitting(true);

    try {
      const updates: Record<string, unknown> = {
        title: title.trim(),
      };

      // Only update content for manual documents
      if (document.source_type === "manual") {
        updates.content = content.trim();
      }

      // Update URL for url type
      if (document.source_type === "url") {
        updates.source_url = sourceUrl.trim();
      }

      // If reprocessing, set status back to pending
      if (reprocess) {
        updates.status = "pending";
        updates.chunks_count = 0;
      }

      const { error } = await supabase
        .from("knowledge_documents")
        .update(updates)
        .eq("id", document.id);

      if (error) throw error;

      // If reprocessing, delete old chunks and trigger processing
      if (reprocess) {
        await supabase
          .from("knowledge_chunks")
          .delete()
          .eq("document_id", document.id);

        supabase.functions
          .invoke("process-document", {
            body: { document_id: document.id },
          })
          .then(({ error: processError }) => {
            if (processError) {
              console.error("Process error:", processError);
              toast.error("Erro ao reprocessar documento");
            } else {
              toast.success("Documento reprocessado com sucesso!");
              onUpdated();
            }
          });

        toast.success("Documento salvo! Reprocessando...");
      } else {
        toast.success("Documento atualizado!");
      }

      onOpenChange(false);
      onUpdated();
    } catch (error) {
      console.error("Error updating document:", error);
      toast.error("Erro ao atualizar documento");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!document) return null;

  const isManual = document.source_type === "manual";
  const isUrl = document.source_type === "url";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5" />
            Editar Documento
          </DialogTitle>
          <DialogDescription>
            Atualize as informações do documento
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-title">Título</Label>
            <Input
              id="edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Título do documento"
            />
          </div>

          {isUrl && (
            <div className="space-y-2">
              <Label htmlFor="edit-url">URL</Label>
              <Input
                id="edit-url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://exemplo.com"
              />
            </div>
          )}

          {isManual && (
            <div className="space-y-2">
              <Label htmlFor="edit-content">Conteúdo</Label>
              <Textarea
                id="edit-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Conteúdo do documento"
                rows={10}
              />
            </div>
          )}

          <div className="flex items-center space-x-2 pt-2">
            <Checkbox
              id="reprocess"
              checked={reprocess}
              onCheckedChange={(checked) => setReprocess(checked === true)}
            />
            <Label
              htmlFor="reprocess"
              className="text-sm font-normal cursor-pointer flex items-center gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reprocessar documento (recria todos os chunks)
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={isSubmitting}>
            {isSubmitting ? (
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
  );
}

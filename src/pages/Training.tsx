import { useState, useEffect, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  Plus,
  Upload,
  Globe,
  FileText,
  MessageSquare,
  Trash2,
  RefreshCw,
  Search,
  Brain,
  BookOpen,
  Loader2,
  File,
  Link,
  History,
  CheckCircle,
} from "lucide-react";

interface KnowledgeDocument {
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
}

const sourceTypeConfig: Record<string, { label: string; icon: typeof FileText; color: string }> = {
  document: { label: "Documento", icon: File, color: "bg-blue-500" },
  url: { label: "Website", icon: Globe, color: "bg-green-500" },
  manual: { label: "Manual", icon: FileText, color: "bg-purple-500" },
  conversation: { label: "Conversa", icon: MessageSquare, color: "bg-orange-500" },
};

const statusConfig: Record<string, { label: string; color: string }> = {
  pending: { label: "Pendente", color: "bg-yellow-500" },
  processing: { label: "Processando", color: "bg-blue-500" },
  completed: { label: "Concluído", color: "bg-green-500" },
  failed: { label: "Falhou", color: "bg-red-500" },
};

const ACCEPTED_FILE_TYPES = ".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export default function Training() {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("document");
  const [searchTerm, setSearchTerm] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { workspace } = useWorkspace();

  // File upload states
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Form states
  const [docTitle, setDocTitle] = useState("");
  const [docContent, setDocContent] = useState("");
  const [urlInput, setUrlInput] = useState("");

  useEffect(() => {
    if (workspace) {
      fetchDocuments();
    }
  }, [workspace]);

  const fetchDocuments = async () => {
    try {
      const { data, error } = await supabase
        .from("knowledge_documents")
        .select("*")
        .eq("workspace_id", workspace?.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setDocuments(data || []);
    } catch (error) {
      console.error("Error fetching documents:", error);
    } finally {
      setLoading(false);
    }
  };

  // File upload handlers
  const handleFileSelect = (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      toast.error("Arquivo muito grande. Máximo 10MB.");
      return;
    }
    setSelectedFile(file);
    if (!docTitle.trim()) {
      setDocTitle(file.name.replace(/\.[^/.]+$/, "")); // Remove extension for title
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleAddDocument = async () => {
    if (!docTitle.trim()) {
      toast.error("Digite um título");
      return;
    }

    // For document tab, require file
    if (activeTab === "document" && !selectedFile) {
      toast.error("Selecione um arquivo");
      return;
    }

    setIsSubmitting(true);
    setUploadProgress(0);

    try {
      let filePath: string | null = null;
      let fileType: string | null = null;

      // Upload file if present
      if (selectedFile && workspace) {
        const fileExt = selectedFile.name.split(".").pop();
        const fileName = `${Date.now()}_${selectedFile.name}`;
        filePath = `${workspace.id}/${fileName}`;
        fileType = selectedFile.type || fileExt || null;

        setUploadProgress(30);

        const { error: uploadError } = await supabase.storage
          .from("knowledge-documents")
          .upload(filePath, selectedFile);

        if (uploadError) {
          console.error("Upload error:", uploadError);
          throw new Error("Erro ao fazer upload do arquivo");
        }

        setUploadProgress(70);
      }

      // Insert document record
      const { error } = await supabase.from("knowledge_documents").insert({
        workspace_id: workspace?.id,
        title: docTitle.trim(),
        content: activeTab === "manual" ? docContent.trim() : null,
        source_type: activeTab,
        source_url: activeTab === "url" ? urlInput.trim() : null,
        file_path: filePath,
        file_type: fileType,
        status: "pending",
      });

      if (error) throw error;

      setUploadProgress(100);
      toast.success("Documento adicionado! Processando...");
      
      // Reset form
      setDocTitle("");
      setDocContent("");
      setUrlInput("");
      setSelectedFile(null);
      setUploadProgress(0);
      setDialogOpen(false);
      fetchDocuments();
    } catch (error) {
      console.error("Error adding document:", error);
      toast.error(error instanceof Error ? error.message : "Erro ao adicionar documento");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteDocument = async (id: string) => {
    try {
      const { error } = await supabase.from("knowledge_documents").delete().eq("id", id);

      if (error) throw error;

      toast.success("Documento removido");
      fetchDocuments();
    } catch (error) {
      console.error("Error deleting document:", error);
      toast.error("Erro ao remover documento");
    }
  };

  const filteredDocuments = documents.filter((doc) =>
    doc.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stats = {
    total: documents.length,
    completed: documents.filter((d) => d.status === "completed").length,
    processing: documents.filter((d) => d.status === "processing").length,
    chunks: documents.reduce((acc, d) => acc + (d.chunks_count || 0), 0),
  };

  return (
    <AppLayout title="Treinamento de IA">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Brain className="h-7 w-7 text-primary" />
              Base de Conhecimento
            </h2>
            <p className="text-muted-foreground">
              Adicione documentos, URLs e textos para treinar sua IA.
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Adicionar Conhecimento
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Adicionar Conhecimento</DialogTitle>
                <DialogDescription>
                  Escolha como você quer adicionar informações à base de conhecimento.
                </DialogDescription>
              </DialogHeader>

              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="document" className="gap-1.5">
                    <Upload className="h-4 w-4" />
                    Upload
                  </TabsTrigger>
                  <TabsTrigger value="url" className="gap-1.5">
                    <Globe className="h-4 w-4" />
                    URL
                  </TabsTrigger>
                  <TabsTrigger value="manual" className="gap-1.5">
                    <FileText className="h-4 w-4" />
                    Manual
                  </TabsTrigger>
                  <TabsTrigger value="conversation" className="gap-1.5">
                    <History className="h-4 w-4" />
                    Histórico
                  </TabsTrigger>
                </TabsList>

                <div className="mt-4 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="title">Título</Label>
                    <Input
                      id="title"
                      placeholder="Ex: FAQ de Produtos, Manual de Vendas..."
                      value={docTitle}
                      onChange={(e) => setDocTitle(e.target.value)}
                    />
                  </div>

                  <TabsContent value="document" className="mt-0 space-y-4">
                    {/* Hidden file input */}
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileInputChange}
                      accept={ACCEPTED_FILE_TYPES}
                      className="hidden"
                    />
                    
                    {/* Drop zone */}
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                        isDragging
                          ? "border-primary bg-primary/5"
                          : selectedFile
                          ? "border-green-500 bg-green-500/5"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      {selectedFile ? (
                        <>
                          <CheckCircle className="h-10 w-10 text-green-500 mx-auto mb-4" />
                          <p className="text-sm font-medium mb-1">{selectedFile.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-4"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedFile(null);
                            }}
                          >
                            Trocar Arquivo
                          </Button>
                        </>
                      ) : (
                        <>
                          <Upload className={`h-10 w-10 mx-auto mb-4 ${isDragging ? "text-primary" : "text-muted-foreground"}`} />
                          <p className="text-sm text-muted-foreground mb-2">
                            {isDragging ? "Solte o arquivo aqui" : "Arraste arquivos aqui ou clique para selecionar"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            PDF, Word, Excel, TXT (máx. 10MB)
                          </p>
                          <Button variant="outline" size="sm" className="mt-4">
                            Selecionar Arquivo
                          </Button>
                        </>
                      )}
                    </div>
                    
                    {/* Upload progress */}
                    {isSubmitting && uploadProgress > 0 && (
                      <div className="space-y-2">
                        <Progress value={uploadProgress} className="h-2" />
                        <p className="text-xs text-muted-foreground text-center">
                          {uploadProgress < 70 ? "Enviando arquivo..." : uploadProgress < 100 ? "Salvando..." : "Concluído!"}
                        </p>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="url" className="mt-0 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="url">URL do Website</Label>
                      <div className="relative">
                        <Link className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="url"
                          placeholder="https://exemplo.com/pagina"
                          value={urlInput}
                          onChange={(e) => setUrlInput(e.target.value)}
                          className="pl-9"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        O conteúdo será extraído automaticamente da página.
                      </p>
                    </div>
                  </TabsContent>

                  <TabsContent value="manual" className="mt-0 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="content">Conteúdo</Label>
                      <Textarea
                        id="content"
                        placeholder="Cole ou digite o conteúdo aqui..."
                        value={docContent}
                        onChange={(e) => setDocContent(e.target.value)}
                        rows={8}
                      />
                    </div>
                  </TabsContent>

                  <TabsContent value="conversation" className="mt-0 space-y-4">
                    <div className="space-y-2">
                      <Label>Selecionar Conversas</Label>
                      <Select>
                        <SelectTrigger>
                          <SelectValue placeholder="Escolha as conversas para importar" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todas as conversas</SelectItem>
                          <SelectItem value="last7">Últimos 7 dias</SelectItem>
                          <SelectItem value="last30">Últimos 30 dias</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        A IA aprenderá com padrões de conversas anteriores.
                      </p>
                    </div>
                  </TabsContent>
                </div>
              </Tabs>

              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleAddDocument} disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Adicionando...
                    </>
                  ) : (
                    "Adicionar"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total de Documentos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Processados
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-500">{stats.completed}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Em Processamento
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-500">{stats.processing}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Chunks de Conhecimento
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary">{stats.chunks}</div>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar documentos..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Documents List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filteredDocuments.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <BookOpen className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="font-medium text-lg mb-2">Nenhum documento</h3>
              <p className="text-muted-foreground text-sm max-w-sm mb-4">
                Adicione documentos, URLs ou textos para treinar sua IA.
              </p>
              <Button onClick={() => setDialogOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                Adicionar Conhecimento
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredDocuments.map((doc) => {
              const sourceConfig = sourceTypeConfig[doc.source_type] || sourceTypeConfig.manual;
              const statConfig = statusConfig[doc.status] || statusConfig.pending;
              const SourceIcon = sourceConfig.icon;

              return (
                <Card key={doc.id} className="relative overflow-hidden">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${sourceConfig.color}/10`}>
                          <SourceIcon className={`h-5 w-5 text-${sourceConfig.color.replace("bg-", "")}`} />
                        </div>
                        <div>
                          <CardTitle className="text-base">{doc.title}</CardTitle>
                          <CardDescription className="text-xs">
                            {sourceConfig.label}
                            {doc.source_url && (
                              <span className="ml-1">• {new URL(doc.source_url).hostname}</span>
                            )}
                          </CardDescription>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDeleteDocument(doc.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${statConfig.color}`} />
                        {statConfig.label}
                      </Badge>
                      {doc.chunks_count > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {doc.chunks_count} chunks
                        </span>
                      )}
                    </div>
                    {doc.status === "processing" && (
                      <Progress value={50} className="mt-3 h-1.5" />
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

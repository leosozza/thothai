import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Download, Sparkles, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Link } from "react-router-dom";

export default function GenerateLogo() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);

  const generateLogo = async () => {
    setIsGenerating(true);
    setGeneratedImage(null);

    try {
      const { data, error } = await supabase.functions.invoke('generate-logo');

      if (error) {
        console.error('Error:', error);
        toast.error('Erro ao gerar logo: ' + error.message);
        return;
      }

      if (data?.imageUrl) {
        setGeneratedImage(data.imageUrl);
        toast.success('Logo gerado com sucesso!');
      } else if (data?.error) {
        toast.error(data.error);
      }
    } catch (err) {
      console.error('Error:', err);
      toast.error('Erro ao conectar com o servidor');
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadImage = () => {
    if (!generatedImage) return;

    const link = document.createElement('a');
    link.href = generatedImage;
    link.download = 'thoth24-logo-transparent.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Download iniciado!');
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Link>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Gerar Logo THOTH24
            </CardTitle>
            <CardDescription>
              Use IA para gerar uma nova versão do logo com fundo transparente.
              O design pode ter pequenas variações do original.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Button 
              onClick={generateLogo} 
              disabled={isGenerating}
              className="w-full"
              size="lg"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Gerando com IA...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Gerar Logo com Fundo Transparente
                </>
              )}
            </Button>

            {generatedImage && (
              <div className="space-y-4">
                <div className="relative rounded-lg overflow-hidden border bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImNoZWNrIiB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHBhdHRlcm5Vbml0cz0idXNlclNwYWNlT25Vc2UiPjxyZWN0IGZpbGw9IiNmMGYwZjAiIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCIvPjxyZWN0IGZpbGw9IiNmMGYwZjAiIHg9IjEwIiB5PSIxMCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIi8+PHJlY3QgZmlsbD0iI2ZmZiIgeD0iMTAiIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCIvPjxyZWN0IGZpbGw9IiNmZmYiIHk9IjEwIiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IGZpbGw9InVybCgjY2hlY2spIiB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIi8+PC9zdmc+')] p-8 flex items-center justify-center">
                  <img 
                    src={generatedImage} 
                    alt="Logo Gerado" 
                    className="max-w-full max-h-64 object-contain"
                  />
                </div>
                
                <div className="flex gap-3">
                  <Button onClick={downloadImage} className="flex-1">
                    <Download className="mr-2 h-4 w-4" />
                    Baixar PNG
                  </Button>
                  <Button onClick={generateLogo} variant="outline" className="flex-1">
                    <Sparkles className="mr-2 h-4 w-4" />
                    Gerar Outro
                  </Button>
                </div>

                <p className="text-sm text-muted-foreground text-center">
                  💡 Após baixar, substitua os arquivos em <code className="bg-muted px-1 rounded">src/assets/thoth-logo.png</code> e <code className="bg-muted px-1 rounded">public/thoth-logo.png</code>
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

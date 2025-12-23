import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { OperatorProvider, useOperator } from "@/hooks/useOperator";
import { OperatorHeader } from "@/components/operator/OperatorHeader";
import { OperatorConversationList } from "@/components/operator/OperatorConversationList";
import { OperatorChat } from "@/components/operator/OperatorChat";
import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Contact {
  id: string;
  name: string | null;
  push_name: string | null;
  phone_number: string;
  profile_picture_url: string | null;
}

interface Conversation {
  id: string;
  contact_id: string;
  instance_id: string;
  status: string;
  attendance_mode: string | null;
  last_message_at: string | null;
  unread_count: number;
  assigned_operator_id: string | null;
  contact?: Contact;
}

function OperatorContent() {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const { operator, loading: operatorLoading } = useOperator();
  const navigate = useNavigate();

  if (operatorLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!operator) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <h1 className="text-xl font-semibold">Acesso Negado</h1>
        <p className="text-muted-foreground text-center max-w-md">
          Você não está cadastrado como operador neste workspace. 
          Entre em contato com o administrador.
        </p>
        <Button onClick={() => navigate("/dashboard")}>
          Ir para Dashboard
        </Button>
      </div>
    );
  }

  const handleTransferToAI = () => {
    setSelectedConversation(null);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <OperatorHeader activeConversationsCount={conversations.length} />
      
      <div className="flex-1 flex overflow-hidden">
        {/* Conversation List */}
        <div className="w-80 border-r flex-shrink-0">
          <OperatorConversationList
            selectedConversation={selectedConversation}
            onSelectConversation={setSelectedConversation}
            onConversationsChange={setConversations}
          />
        </div>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col">
          <OperatorChat 
            conversation={selectedConversation} 
            onTransferToAI={handleTransferToAI}
          />
        </div>
      </div>
    </div>
  );
}

export default function Operator() {
  const { user, loading: authLoading } = useAuth();
  const { workspace, loading: workspaceLoading } = useWorkspace();
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  if (authLoading || workspaceLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user || !workspace) {
    return null;
  }

  return (
    <OperatorProvider>
      <OperatorContent />
    </OperatorProvider>
  );
}

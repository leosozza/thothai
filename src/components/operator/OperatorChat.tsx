import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOperator } from "@/hooks/useOperator";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { 
  Send, 
  Bot, 
  User, 
  ArrowLeftRight, 
  Phone, 
  MoreVertical,
  Loader2
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

interface Message {
  id: string;
  content: string | null;
  direction: string;
  is_from_bot: boolean;
  created_at: string;
  message_type: string;
  media_url: string | null;
  status: string;
}

interface OperatorChatProps {
  conversation: Conversation | null;
  onTransferToAI: () => void;
}

export function OperatorChat({ conversation, onTransferToAI }: OperatorChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [instance, setInstance] = useState<{ provider_type: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { operator } = useOperator();

  const fetchMessages = async () => {
    if (!conversation) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("id, content, direction, is_from_bot, created_at, message_type, media_url, status")
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: true });

      if (error) throw error;
      setMessages(data || []);

      // Fetch instance for provider type
      const { data: inst } = await supabase
        .from("instances")
        .select("provider_type")
        .eq("id", conversation.instance_id)
        .single();

      setInstance(inst);

      // Mark as read
      await supabase
        .from("conversations")
        .update({ unread_count: 0 })
        .eq("id", conversation.id);
    } catch (error) {
      console.error("Error fetching messages:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMessages();

    if (!conversation) return;

    // Subscribe to new messages
    const channel = supabase
      .channel(`messages-${conversation.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversation.id}`,
        },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as Message]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversation?.id]);

  useEffect(() => {
    // Scroll to bottom on new messages
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !conversation || !instance) return;

    setSending(true);
    try {
      const providerType = instance.provider_type || "wapi";
      let functionName = "wapi-send-message";
      
      if (providerType === "evolution") {
        functionName = "evolution-send-message";
      } else if (providerType === "gupshup") {
        functionName = "gupshup-send-message";
      }

      const { error } = await supabase.functions.invoke(functionName, {
        body: {
          instance_id: conversation.instance_id,
          contact_id: conversation.contact_id,
          conversation_id: conversation.id,
          message: newMessage,
          is_from_operator: true,
        },
      });

      if (error) throw error;

      setNewMessage("");
    } catch (error) {
      console.error("Error sending message:", error);
      toast.error("Erro ao enviar mensagem");
    } finally {
      setSending(false);
    }
  };

  const handleTransferToAI = async () => {
    if (!conversation) return;

    try {
      const { error } = await supabase
        .from("conversations")
        .update({ 
          attendance_mode: "ai",
          assigned_operator_id: null 
        })
        .eq("id", conversation.id);

      if (error) throw error;

      toast.success("Conversa transferida para IA");
      onTransferToAI();
    } catch (error) {
      console.error("Error transferring to AI:", error);
      toast.error("Erro ao transferir para IA");
    }
  };

  const getContactName = () => {
    if (!conversation?.contact) return "Desconhecido";
    return conversation.contact.name || conversation.contact.push_name || conversation.contact.phone_number;
  };

  const getContactInitials = () => {
    const name = getContactName();
    return name
      .split(" ")
      .slice(0, 2)
      .map((n) => n[0])
      .join("")
      .toUpperCase();
  };

  if (!conversation) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Bot className="h-12 w-12 mb-4" />
        <p className="text-lg">Selecione uma conversa</p>
        <p className="text-sm">Escolha uma conversa na lista para começar</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Chat Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10">
            <AvatarImage src={conversation.contact?.profile_picture_url || ""} />
            <AvatarFallback>{getContactInitials()}</AvatarFallback>
          </Avatar>
          <div>
            <h3 className="font-medium">{getContactName()}</h3>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Phone className="h-3 w-3" />
              {conversation.contact?.phone_number}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={conversation.attendance_mode === "ai" ? "secondary" : "default"}>
            {conversation.attendance_mode === "ai" ? (
              <>
                <Bot className="h-3 w-3 mr-1" />
                IA
              </>
            ) : (
              <>
                <User className="h-3 w-3 mr-1" />
                Humano
              </>
            )}
          </Badge>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleTransferToAI}>
                <ArrowLeftRight className="h-4 w-4 mr-2" />
                Transferir para IA
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <p>Nenhuma mensagem ainda</p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${
                  msg.direction === "outbound" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[70%] rounded-lg px-4 py-2 ${
                    msg.direction === "outbound"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  {msg.is_from_bot && msg.direction === "outbound" && (
                    <div className="flex items-center gap-1 text-xs opacity-70 mb-1">
                      <Bot className="h-3 w-3" />
                      Bot
                    </div>
                  )}
                  
                  {msg.media_url && msg.message_type === "image" && (
                    <img 
                      src={msg.media_url} 
                      alt="Mídia" 
                      className="max-w-full rounded mb-2"
                    />
                  )}
                  
                  {msg.content && (
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  )}
                  
                  <p className="text-xs opacity-70 mt-1">
                    {formatDistanceToNow(new Date(msg.created_at), {
                      addSuffix: true,
                      locale: ptBR,
                    })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Message Input */}
      <div className="p-4 border-t">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex gap-2"
        >
          <Input
            placeholder="Digite sua mensagem..."
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            disabled={sending}
            className="flex-1"
          />
          <Button type="submit" disabled={sending || !newMessage.trim()}>
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}

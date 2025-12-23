import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOperator } from "@/hooks/useOperator";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Search, MessageSquare, Bot, User } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

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

interface OperatorConversationListProps {
  selectedConversation: Conversation | null;
  onSelectConversation: (conversation: Conversation) => void;
  onConversationsChange: (conversations: Conversation[]) => void;
}

export function OperatorConversationList({
  selectedConversation,
  onSelectConversation,
  onConversationsChange,
}: OperatorConversationListProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const { operator } = useOperator();
  const { workspace } = useWorkspace();

  const fetchConversations = async () => {
    if (!operator || !workspace) return;

    try {
      // A RLS já filtra as conversas baseado no access_level do operador
      const { data, error } = await supabase
        .from("conversations")
        .select(`
          id,
          contact_id,
          instance_id,
          status,
          attendance_mode,
          last_message_at,
          unread_count,
          assigned_operator_id
        `)
        .eq("status", "open")
        .order("last_message_at", { ascending: false });

      if (error) throw error;

      // Fetch contacts for conversations
      const contactIds = [...new Set(data?.map(c => c.contact_id) || [])];
      let contactsMap: Record<string, Contact> = {};

      if (contactIds.length > 0) {
        const { data: contacts } = await supabase
          .from("contacts")
          .select("id, name, push_name, phone_number, profile_picture_url")
          .in("id", contactIds);

        if (contacts) {
          contactsMap = contacts.reduce((acc, c) => {
            acc[c.id] = c;
            return acc;
          }, {} as Record<string, Contact>);
        }
      }

      const conversationsWithContacts = (data || []).map(conv => ({
        ...conv,
        contact: contactsMap[conv.contact_id],
      }));

      setConversations(conversationsWithContacts);
      onConversationsChange(conversationsWithContacts);
    } catch (error) {
      console.error("Error fetching conversations:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConversations();

    // Subscribe to realtime updates
    const channel = supabase
      .channel("operator-conversations")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations",
        },
        () => {
          fetchConversations();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [operator, workspace]);

  const getContactName = (conv: Conversation) => {
    if (conv.contact?.name) return conv.contact.name;
    if (conv.contact?.push_name) return conv.contact.push_name;
    return conv.contact?.phone_number || "Desconhecido";
  };

  const getContactInitials = (conv: Conversation) => {
    const name = getContactName(conv);
    return name
      .split(" ")
      .slice(0, 2)
      .map((n) => n[0])
      .join("")
      .toUpperCase();
  };

  const filteredConversations = conversations.filter((conv) => {
    if (!searchQuery) return true;
    const name = getContactName(conv).toLowerCase();
    return name.includes(searchQuery.toLowerCase());
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse text-muted-foreground">Carregando...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar conversa..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        {filteredConversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
            <MessageSquare className="h-8 w-8 mb-2" />
            <p className="text-sm">Nenhuma conversa atribuída</p>
          </div>
        ) : (
          <div className="divide-y">
            {filteredConversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => onSelectConversation(conv)}
                className={`w-full p-3 text-left hover:bg-accent/50 transition-colors ${
                  selectedConversation?.id === conv.id ? "bg-accent" : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={conv.contact?.profile_picture_url || ""} />
                    <AvatarFallback className="text-xs">
                      {getContactInitials(conv)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">
                        {getContactName(conv)}
                      </span>
                      {conv.unread_count > 0 && (
                        <Badge variant="default" className="text-xs">
                          {conv.unread_count}
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-1">
                      {conv.attendance_mode === "ai" ? (
                        <Bot className="h-3 w-3 text-blue-500" />
                      ) : (
                        <User className="h-3 w-3 text-green-500" />
                      )}
                      <span className="text-xs text-muted-foreground truncate">
                        {conv.attendance_mode === "ai" ? "IA" : "Humano"}
                      </span>
                      {conv.last_message_at && (
                        <>
                          <span className="text-muted-foreground">•</span>
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(conv.last_message_at), {
                              addSuffix: true,
                              locale: ptBR,
                            })}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

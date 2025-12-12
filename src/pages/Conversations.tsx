import { useState, useEffect, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Search,
  Send,
  Paperclip,
  Mic,
  MoreVertical,
  Phone,
  Video,
  User,
  Bot,
  Check,
  CheckCheck,
  Clock,
  MessageSquare,
  Filter,
  Loader2,
  Plus,
  RefreshCw,
  ArrowLeftRight,
  UserCheck,
} from "lucide-react";

interface Contact {
  id: string;
  name: string | null;
  push_name: string | null;
  phone_number: string;
  profile_picture_url: string | null;
}

interface Instance {
  id: string;
  name: string;
  status: string;
}

interface Conversation {
  id: string;
  instance_id: string;
  contact_id: string;
  status: string;
  last_message_at: string | null;
  unread_count: number;
  attendance_mode?: string;
  assigned_to?: string | null;
  department?: string | null;
  contact: Contact;
  instance?: Instance;
}

interface Message {
  id: string;
  conversation_id: string;
  direction: string;
  message_type: string;
  content: string | null;
  status: string;
  is_from_bot: boolean;
  created_at: string;
}

export default function Conversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [newPhoneNumber, setNewPhoneNumber] = useState("");
  const [selectedInstanceId, setSelectedInstanceId] = useState("");
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { workspace } = useWorkspace();

  // Reference to selected conversation for use in realtime callbacks
  const selectedConversationRef = useRef<Conversation | null>(null);
  
  useEffect(() => {
    selectedConversationRef.current = selectedConversation;
  }, [selectedConversation]);

  useEffect(() => {
    if (workspace) {
      fetchConversations();

      // Subscribe to conversation changes
      const convChannel = supabase
        .channel("conversations-changes")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "conversations",
          },
          (payload) => {
            if (payload.eventType === "INSERT") {
              fetchConversations();
            } else if (payload.eventType === "UPDATE") {
              const updatedConv = payload.new as any;
              setConversations((prev) =>
                prev.map((conv) =>
                  conv.id === updatedConv.id
                    ? { ...conv, ...updatedConv }
                    : conv
                )
              );
            }
          }
        )
        .subscribe();

      // Subscribe to new messages globally (for updating conversation list)
      const messagesGlobalChannel = supabase
        .channel("messages-global")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
          },
          (payload) => {
            const newMsg = payload.new as any;
            
            // Update conversation's last_message_at and unread_count
            setConversations((prev) =>
              prev.map((conv) => {
                if (conv.id === newMsg.conversation_id) {
                  const isSelected = selectedConversationRef.current?.id === conv.id;
                  return {
                    ...conv,
                    last_message_at: newMsg.created_at,
                    unread_count: isSelected 
                      ? 0 
                      : (newMsg.direction === 'incoming' ? conv.unread_count + 1 : conv.unread_count),
                  };
                }
                return conv;
              })
            );

            // Reorder conversations by last_message_at
            setConversations((prev) =>
              [...prev].sort((a, b) => {
                const dateA = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
                const dateB = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
                return dateB - dateA;
              })
            );

            // Show notification for incoming messages in other conversations
            if (
              newMsg.direction === "incoming" &&
              selectedConversationRef.current?.id !== newMsg.conversation_id
            ) {
              toast.info("Nova mensagem recebida!", {
                description: "Clique em uma conversa para ver",
                duration: 3000,
              });
            }

            // Add message to current conversation if selected
            if (selectedConversationRef.current?.id === newMsg.conversation_id) {
              setMessages((prev) => {
                // Prevent duplicates
                if (prev.find((m) => m.id === newMsg.id)) return prev;
                return [...prev, newMsg as Message];
              });
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "messages",
          },
          (payload) => {
            const updatedMsg = payload.new as Message;
            // Update message status in current conversation
            if (selectedConversationRef.current?.id === updatedMsg.conversation_id) {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === updatedMsg.id ? updatedMsg : msg
                )
              );
            }
          }
        )
        .subscribe();

      // Subscribe to contact changes (for name/photo updates)
      const contactsChannel = supabase
        .channel("contacts-changes")
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "contacts",
          },
          (payload) => {
            const updatedContact = payload.new as Contact;
            setConversations((prev) =>
              prev.map((conv) =>
                conv.contact_id === updatedContact.id
                  ? { ...conv, contact: updatedContact }
                  : conv
              )
            );
            // Update selected conversation contact
            if (selectedConversationRef.current?.contact_id === updatedContact.id) {
              setSelectedConversation((prev) =>
                prev ? { ...prev, contact: updatedContact } : null
              );
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(convChannel);
        supabase.removeChannel(messagesGlobalChannel);
        supabase.removeChannel(contactsChannel);
      };
    }
  }, [workspace]);

  useEffect(() => {
    if (selectedConversation) {
      fetchMessages(selectedConversation.id);

      // Mark as read
      supabase
        .from("conversations")
        .update({ unread_count: 0 })
        .eq("id", selectedConversation.id);

      // Also update local state
      setConversations((prev) =>
        prev.map((conv) =>
          conv.id === selectedConversation.id
            ? { ...conv, unread_count: 0 }
            : conv
        )
      );
    }
  }, [selectedConversation?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const fetchConversations = async () => {
    try {
      const { data: instances } = await supabase
        .from("instances")
        .select("id, name, status")
        .eq("workspace_id", workspace?.id);

      if (!instances?.length) {
        setLoading(false);
        return;
      }

      const instanceIds = instances.map((i) => i.id);
      const instanceMap = new Map(instances.map((i) => [i.id, i]));
      
      setInstances(instances);
      
      // Set default instance for new conversation
      const connectedInstance = instances.find((i) => i.status === "connected");
      if (connectedInstance && !selectedInstanceId) {
        setSelectedInstanceId(connectedInstance.id);
      }

      const { data, error } = await supabase
        .from("conversations")
        .select(`
          *,
          contact:contacts(*)
        `)
        .in("instance_id", instanceIds)
        .order("last_message_at", { ascending: false, nullsFirst: false });

      if (error) throw error;

      const conversationsWithInstance = (data || []).map((conv) => ({
        ...conv,
        instance: instanceMap.get(conv.instance_id),
      }));

      setConversations(conversationsWithInstance);
    } catch (error) {
      console.error("Error fetching conversations:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (conversationId: string) => {
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      setMessages(data || []);
    } catch (error) {
      console.error("Error fetching messages:", error);
    }
  };

  const handleStartNewConversation = async () => {
    if (!newPhoneNumber.trim() || !selectedInstanceId || !workspace) return;

    // Clean phone number - only digits
    const cleanPhone = newPhoneNumber.replace(/\D/g, "");
    if (cleanPhone.length < 10) {
      toast.error("Número de telefone inválido");
      return;
    }

    setCreatingConversation(true);

    try {
      // Check if instance is connected
      const instance = instances.find((i) => i.id === selectedInstanceId);
      if (!instance || instance.status !== "connected") {
        toast.error("Selecione uma instância conectada");
        return;
      }

      // Check if contact already exists
      let { data: contact } = await supabase
        .from("contacts")
        .select("*")
        .eq("instance_id", selectedInstanceId)
        .eq("phone_number", cleanPhone)
        .single();

      // Create contact if doesn't exist
      if (!contact) {
        const { data: newContact, error: contactError } = await supabase
          .from("contacts")
          .insert({
            instance_id: selectedInstanceId,
            phone_number: cleanPhone,
          })
          .select()
          .single();

        if (contactError) throw contactError;
        contact = newContact;
      }

      // Check if conversation already exists
      let { data: conversation } = await supabase
        .from("conversations")
        .select("*, contact:contacts(*)")
        .eq("instance_id", selectedInstanceId)
        .eq("contact_id", contact.id)
        .single();

      // Create conversation if doesn't exist
      if (!conversation) {
        const { data: newConversation, error: convError } = await supabase
          .from("conversations")
          .insert({
            instance_id: selectedInstanceId,
            contact_id: contact.id,
            status: "open",
          })
          .select("*, contact:contacts(*)")
          .single();

        if (convError) throw convError;
        conversation = newConversation;
      }

      // Add instance to conversation
      const conversationWithInstance = {
        ...conversation,
        instance,
      };

      // Select the conversation
      setSelectedConversation(conversationWithInstance);
      
      // Refresh conversations list
      await fetchConversations();

      // Close dialog and reset form
      setNewConversationOpen(false);
      setNewPhoneNumber("");

      toast.success("Conversa iniciada! Envie uma mensagem para começar.");
    } catch (error) {
      console.error("Error creating conversation:", error);
      toast.error("Erro ao iniciar conversa");
    } finally {
      setCreatingConversation(false);
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedConversation || !workspace) return;

    // Check if instance is connected
    if (selectedConversation.instance?.status !== "connected") {
      toast.error("Instância não está conectada");
      return;
    }

    setSendingMessage(true);
    const messageContent = newMessage.trim();
    setNewMessage("");

    try {
      const response = await supabase.functions.invoke("wapi-send-message", {
        body: {
          instanceId: selectedConversation.instance_id,
          conversationId: selectedConversation.id,
          contactId: selectedConversation.contact_id,
          phoneNumber: selectedConversation.contact.phone_number,
          message: messageContent,
          messageType: "text",
          workspaceId: workspace.id,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || "Erro ao enviar mensagem");
      }

      if (response.data?.error) {
        throw new Error(response.data.error);
      }

      // Message will appear via realtime subscription
    } catch (error) {
      console.error("Error sending message:", error);
      toast.error(error instanceof Error ? error.message : "Erro ao enviar mensagem");
      setNewMessage(messageContent); // Restore message on error
    } finally {
      setSendingMessage(false);
    }
  };

  const handleTransferToHuman = async () => {
    if (!selectedConversation) return;
    setTransferring(true);
    
    try {
      const { error } = await supabase
        .from("conversations")
        .update({
          attendance_mode: "human",
          status: "in_progress",
        })
        .eq("id", selectedConversation.id);
      
      if (error) throw error;
      
      // Update local state
      setSelectedConversation({
        ...selectedConversation,
        attendance_mode: "human",
        status: "in_progress",
      });
      
      setConversations((prev) =>
        prev.map((conv) =>
          conv.id === selectedConversation.id
            ? { ...conv, attendance_mode: "human", status: "in_progress" }
            : conv
        )
      );
      
      toast.success("Atendimento assumido! A IA não responderá mais nesta conversa.");
    } catch (error) {
      console.error("Error transferring to human:", error);
      toast.error("Erro ao assumir atendimento");
    } finally {
      setTransferring(false);
    }
  };

  const handleTransferToAI = async () => {
    if (!selectedConversation) return;
    setTransferring(true);
    
    try {
      const { error } = await supabase
        .from("conversations")
        .update({
          attendance_mode: "ai",
          assigned_to: null,
          status: "open",
        })
        .eq("id", selectedConversation.id);
      
      if (error) throw error;
      
      // Update local state
      setSelectedConversation({
        ...selectedConversation,
        attendance_mode: "ai",
        assigned_to: null,
        status: "open",
      });
      
      setConversations((prev) =>
        prev.map((conv) =>
          conv.id === selectedConversation.id
            ? { ...conv, attendance_mode: "ai", assigned_to: null, status: "open" }
            : conv
        )
      );
      
      toast.success("Conversa devolvida para a IA.");
    } catch (error) {
      console.error("Error transferring to AI:", error);
      toast.error("Erro ao transferir para IA");
    } finally {
      setTransferring(false);
    }
  };

  const getContactName = (contact: Contact) => {
    return contact.name || contact.push_name || contact.phone_number;
  };

  const getContactInitials = (contact: Contact) => {
    const name = getContactName(contact);
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "sent":
        return <Check className="h-3 w-3 text-muted-foreground" />;
      case "delivered":
        return <CheckCheck className="h-3 w-3 text-muted-foreground" />;
      case "read":
        return <CheckCheck className="h-3 w-3 text-blue-500" />;
      default:
        return <Clock className="h-3 w-3 text-muted-foreground" />;
    }
  };

  const filteredConversations = conversations.filter((conv) => {
    const name = getContactName(conv.contact).toLowerCase();
    return name.includes(searchTerm.toLowerCase());
  });

  return (
    <AppLayout title="Conversas">
      <div className="flex h-[calc(100vh-3.5rem)]">
        {/* Sidebar - Conversation List */}
        <div className="w-80 border-r border-border flex flex-col bg-card">
          {/* Search Header */}
          <div className="p-4 space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar conversas..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => fetchConversations()}
                title="Atualizar"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex gap-2">
              <Dialog open={newConversationOpen} onOpenChange={setNewConversationOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1.5 flex-1">
                    <Plus className="h-3.5 w-3.5" />
                    Nova Conversa
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Iniciar Nova Conversa</DialogTitle>
                    <DialogDescription>
                      Digite o número de telefone com código do país (ex: 5511999999999)
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="phone">Número de Telefone</Label>
                      <Input
                        id="phone"
                        placeholder="5511999999999"
                        value={newPhoneNumber}
                        onChange={(e) => setNewPhoneNumber(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="instance">Instância</Label>
                      <Select
                        value={selectedInstanceId}
                        onValueChange={setSelectedInstanceId}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione uma instância" />
                        </SelectTrigger>
                        <SelectContent>
                          {instances
                            .filter((i) => i.status === "connected")
                            .map((instance) => (
                              <SelectItem key={instance.id} value={instance.id}>
                                {instance.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      {instances.filter((i) => i.status === "connected").length === 0 && (
                        <p className="text-xs text-destructive">
                          Nenhuma instância conectada
                        </p>
                      )}
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setNewConversationOpen(false)}
                    >
                      Cancelar
                    </Button>
                    <Button
                      onClick={handleStartNewConversation}
                      disabled={
                        creatingConversation ||
                        !newPhoneNumber.trim() ||
                        !selectedInstanceId
                      }
                    >
                      {creatingConversation ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <MessageSquare className="h-4 w-4 mr-2" />
                      )}
                      Iniciar Conversa
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Filter className="h-3.5 w-3.5" />
                Filtros
              </Button>
            </div>
          </div>

          <Separator />

          {/* Conversations List */}
          <ScrollArea className="flex-1">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <MessageSquare className="h-10 w-10 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">
                  {searchTerm ? "Nenhuma conversa encontrada" : "Nenhuma conversa ainda"}
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  Quando alguém enviar mensagem, aparecerá aqui
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {filteredConversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => setSelectedConversation(conv)}
                    className={`w-full p-4 text-left hover:bg-accent/50 transition-colors ${
                      selectedConversation?.id === conv.id ? "bg-accent" : ""
                    }`}
                  >
                    <div className="flex gap-3">
                      <div className="relative">
                        <Avatar className="h-12 w-12">
                          <AvatarImage src={conv.contact.profile_picture_url || ""} />
                          <AvatarFallback className="bg-primary/10 text-primary">
                            {getContactInitials(conv.contact)}
                          </AvatarFallback>
                        </Avatar>
                        {/* Attendance mode indicator dot */}
                        <div className={`absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-card flex items-center justify-center ${
                          conv.attendance_mode === "human" ? "bg-primary" : "bg-muted"
                        }`}>
                          {conv.attendance_mode === "human" ? (
                            <User className="h-2.5 w-2.5 text-primary-foreground" />
                          ) : (
                            <Bot className="h-2.5 w-2.5 text-muted-foreground" />
                          )}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium truncate">
                            {getContactName(conv.contact)}
                          </span>
                          {conv.last_message_at && (
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {formatDistanceToNow(new Date(conv.last_message_at), {
                                addSuffix: true,
                                locale: ptBR,
                              })}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <span className="text-sm text-muted-foreground truncate">
                            {conv.instance?.name || conv.contact.phone_number}
                          </span>
                          {conv.unread_count > 0 && (
                            <Badge className="h-5 min-w-5 rounded-full px-1.5 bg-primary text-primary-foreground text-xs">
                              {conv.unread_count}
                            </Badge>
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

        {/* Chat Area */}
        <div className="flex-1 flex flex-col">
          {selectedConversation ? (
            <>
              {/* Chat Header */}
              <div className="h-16 border-b border-border flex items-center justify-between px-4 bg-card">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={selectedConversation.contact.profile_picture_url || ""} />
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {getContactInitials(selectedConversation.contact)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">
                        {getContactName(selectedConversation.contact)}
                      </h3>
                      {/* Attendance Mode Badge */}
                      <Badge 
                        variant={selectedConversation.attendance_mode === "human" ? "default" : "secondary"}
                        className="text-xs gap-1"
                      >
                        {selectedConversation.attendance_mode === "human" ? (
                          <>
                            <User className="h-3 w-3" />
                            Humano
                          </>
                        ) : (
                          <>
                            <Bot className="h-3 w-3" />
                            IA
                          </>
                        )}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {selectedConversation.contact.phone_number}
                      {selectedConversation.instance && (
                        <span className="ml-2 text-primary">
                          • {selectedConversation.instance.name}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* Transfer Buttons */}
                  {selectedConversation.attendance_mode === "human" ? (
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={handleTransferToAI}
                      disabled={transferring}
                      className="gap-1.5"
                    >
                      {transferring ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Bot className="h-4 w-4" />
                      )}
                      Devolver para IA
                    </Button>
                  ) : (
                    <Button 
                      variant="default" 
                      size="sm"
                      onClick={handleTransferToHuman}
                      disabled={transferring}
                      className="gap-1.5"
                    >
                      {transferring ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <UserCheck className="h-4 w-4" />
                      )}
                      Assumir Atendimento
                    </Button>
                  )}
                  <Button variant="ghost" size="icon">
                    <Phone className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Messages Area */}
              <ScrollArea className="flex-1 p-4 bg-muted/30">
                <div className="space-y-4 max-w-3xl mx-auto">
                  {messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <MessageSquare className="h-10 w-10 text-muted-foreground/50 mb-3" />
                      <p className="text-sm text-muted-foreground">
                        Nenhuma mensagem ainda
                      </p>
                    </div>
                  ) : (
                    messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex ${msg.direction === "outgoing" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[70%] rounded-2xl px-4 py-2 ${
                            msg.direction === "outgoing"
                              ? "bg-primary text-primary-foreground rounded-br-md"
                              : "bg-card border border-border rounded-bl-md"
                          }`}
                        >
                          {msg.is_from_bot && msg.direction === "outgoing" && (
                            <div className="flex items-center gap-1 text-xs opacity-70 mb-1">
                              <Bot className="h-3 w-3" />
                              <span>thoth.AI</span>
                            </div>
                          )}
                          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                          <div
                            className={`flex items-center justify-end gap-1 mt-1 ${
                              msg.direction === "outgoing"
                                ? "text-primary-foreground/70"
                                : "text-muted-foreground"
                            }`}
                          >
                            <span className="text-xs">
                              {new Date(msg.created_at).toLocaleTimeString("pt-BR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                            {msg.direction === "outgoing" && getStatusIcon(msg.status)}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {/* Message Input */}
              <div className="p-4 border-t border-border bg-card">
                <div className="flex items-center gap-2 max-w-3xl mx-auto">
                  <Button variant="ghost" size="icon">
                    <Paperclip className="h-5 w-5" />
                  </Button>
                  <Input
                    placeholder={
                      selectedConversation.instance?.status === "connected"
                        ? "Digite uma mensagem..."
                        : "Instância desconectada"
                    }
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
                    className="flex-1"
                    disabled={selectedConversation.instance?.status !== "connected"}
                  />
                  <Button variant="ghost" size="icon">
                    <Mic className="h-5 w-5" />
                  </Button>
                  <Button
                    size="icon"
                    onClick={handleSendMessage}
                    disabled={
                      !newMessage.trim() ||
                      sendingMessage ||
                      selectedConversation.instance?.status !== "connected"
                    }
                  >
                    {sendingMessage ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Send className="h-5 w-5" />
                    )}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-muted/30">
              <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center mb-6">
                <MessageSquare className="h-10 w-10 text-primary" />
              </div>
              <h2 className="text-2xl font-semibold mb-2">thoth.AI Inbox</h2>
              <p className="text-muted-foreground max-w-md">
                Selecione uma conversa para começar a atender ou aguarde novas mensagens
                dos seus clientes.
              </p>
            </div>
          )}
        </div>

        {/* Contact Info Sidebar - Only show when conversation selected */}
        {selectedConversation && (
          <div className="w-72 border-l border-border bg-card p-4 hidden lg:block">
            <div className="text-center mb-6">
              <Avatar className="h-20 w-20 mx-auto mb-3">
                <AvatarImage src={selectedConversation.contact.profile_picture_url || ""} />
                <AvatarFallback className="bg-primary/10 text-primary text-2xl">
                  {getContactInitials(selectedConversation.contact)}
                </AvatarFallback>
              </Avatar>
              <h3 className="font-semibold text-lg">
                {getContactName(selectedConversation.contact)}
              </h3>
              <p className="text-sm text-muted-foreground">
                {selectedConversation.contact.phone_number}
              </p>
            </div>

            <Separator className="my-4" />

            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">Instância</h4>
                <Badge variant="outline">
                  {selectedConversation.instance?.name || "Não identificada"}
                </Badge>
              </div>

              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">Modo de Atendimento</h4>
                <Badge 
                  variant={selectedConversation.attendance_mode === "human" ? "default" : "secondary"}
                  className="gap-1"
                >
                  {selectedConversation.attendance_mode === "human" ? (
                    <>
                      <User className="h-3 w-3" />
                      Atendimento Humano
                    </>
                  ) : (
                    <>
                      <Bot className="h-3 w-3" />
                      Atendimento IA
                    </>
                  )}
                </Badge>
              </div>

              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">Status</h4>
                <Badge variant="outline" className="capitalize">
                  {selectedConversation.status === "waiting_human" ? "Aguardando Atendente" :
                   selectedConversation.status === "in_progress" ? "Em Atendimento" :
                   selectedConversation.status === "open" ? "Aberta" :
                   selectedConversation.status}
                </Badge>
              </div>

              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">Tags</h4>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="secondary">Cliente</Badge>
                </div>
              </div>

              <Separator className="my-2" />

              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">Transferência</h4>
                <div className="space-y-2">
                  {selectedConversation.attendance_mode === "human" ? (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full justify-start gap-2"
                      onClick={handleTransferToAI}
                      disabled={transferring}
                    >
                      {transferring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                      Devolver para IA
                    </Button>
                  ) : (
                    <Button 
                      variant="default" 
                      size="sm" 
                      className="w-full justify-start gap-2"
                      onClick={handleTransferToHuman}
                      disabled={transferring}
                    >
                      {transferring ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />}
                      Assumir Atendimento
                    </Button>
                  )}
                </div>
              </div>

              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">Ações</h4>
                <div className="space-y-2">
                  <Button variant="outline" size="sm" className="w-full justify-start gap-2">
                    <User className="h-4 w-4" />
                    Ver perfil completo
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

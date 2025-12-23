import { useState, useEffect, createContext, useContext, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useWorkspace } from "./useWorkspace";

interface Operator {
  id: string;
  user_id: string;
  workspace_id: string;
  bitrix24_user_id: number | null;
  bitrix24_department_ids: number[];
  access_level: 'own' | 'department' | 'all';
  department_ids: string[];
  allowed_instance_ids: string[] | null;
  can_transfer_to_ai: boolean;
  max_concurrent_conversations: number;
  is_active: boolean;
  is_online: boolean;
  last_seen_at: string | null;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

interface OperatorContextType {
  operator: Operator | null;
  isOperator: boolean;
  loading: boolean;
  updateOnlineStatus: (isOnline: boolean) => Promise<void>;
  refreshOperator: () => Promise<void>;
}

const OperatorContext = createContext<OperatorContextType | undefined>(undefined);

export function OperatorProvider({ children }: { children: ReactNode }) {
  const [operator, setOperator] = useState<Operator | null>(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { workspace } = useWorkspace();

  const fetchOperator = async () => {
    if (!user || !workspace) {
      setOperator(null);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("operators")
        .select("*")
        .eq("user_id", user.id)
        .eq("workspace_id", workspace.id)
        .eq("is_active", true)
        .maybeSingle();

      if (error) {
        console.error("Error fetching operator:", error);
        setOperator(null);
      } else {
        setOperator(data as Operator | null);
      }
    } catch (error) {
      console.error("Error fetching operator:", error);
      setOperator(null);
    } finally {
      setLoading(false);
    }
  };

  const updateOnlineStatus = async (isOnline: boolean) => {
    if (!operator) return;

    try {
      const { error } = await supabase
        .from("operators")
        .update({ 
          is_online: isOnline, 
          last_seen_at: new Date().toISOString() 
        })
        .eq("id", operator.id);

      if (error) throw error;

      setOperator(prev => prev ? { ...prev, is_online: isOnline } : null);
    } catch (error) {
      console.error("Error updating online status:", error);
    }
  };

  useEffect(() => {
    fetchOperator();
  }, [user, workspace]);

  // Set online status on mount and offline on unmount
  useEffect(() => {
    if (operator) {
      updateOnlineStatus(true);

      const handleBeforeUnload = () => {
        // Use sendBeacon for reliable offline status update
        navigator.sendBeacon && updateOnlineStatus(false);
      };

      window.addEventListener("beforeunload", handleBeforeUnload);

      return () => {
        window.removeEventListener("beforeunload", handleBeforeUnload);
        updateOnlineStatus(false);
      };
    }
  }, [operator?.id]);

  return (
    <OperatorContext.Provider
      value={{
        operator,
        isOperator: !!operator,
        loading,
        updateOnlineStatus,
        refreshOperator: fetchOperator,
      }}
    >
      {children}
    </OperatorContext.Provider>
  );
}

export function useOperator() {
  const context = useContext(OperatorContext);
  if (context === undefined) {
    throw new Error("useOperator must be used within an OperatorProvider");
  }
  return context;
}

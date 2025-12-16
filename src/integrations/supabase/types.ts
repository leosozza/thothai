export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      bitrix_channel_mappings: {
        Row: {
          created_at: string
          id: string
          instance_id: string
          integration_id: string
          is_active: boolean
          line_id: number
          line_name: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          instance_id: string
          integration_id: string
          is_active?: boolean
          line_id: number
          line_name?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          instance_id?: string
          integration_id?: string
          is_active?: boolean
          line_id?: number
          line_name?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bitrix_channel_mappings_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitrix_channel_mappings_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitrix_channel_mappings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_settings: {
        Row: {
          created_at: string
          department_id: string | null
          fallback_message: string | null
          id: string
          instance_id: string
          is_active: boolean
          persona_description: string | null
          persona_name: string | null
          system_prompt: string | null
          temperature: number | null
          updated_at: string
          voice_enabled: boolean
          voice_id: string | null
          welcome_message: string | null
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          fallback_message?: string | null
          id?: string
          instance_id: string
          is_active?: boolean
          persona_description?: string | null
          persona_name?: string | null
          system_prompt?: string | null
          temperature?: number | null
          updated_at?: string
          voice_enabled?: boolean
          voice_id?: string | null
          welcome_message?: string | null
        }
        Update: {
          created_at?: string
          department_id?: string | null
          fallback_message?: string | null
          id?: string
          instance_id?: string
          is_active?: boolean
          persona_description?: string | null
          persona_name?: string | null
          system_prompt?: string | null
          temperature?: number | null
          updated_at?: string
          voice_enabled?: boolean
          voice_id?: string | null
          welcome_message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bot_settings_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_settings_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "instances"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          created_at: string
          id: string
          instance_id: string
          metadata: Json | null
          name: string | null
          phone_number: string
          profile_picture_url: string | null
          push_name: string | null
          tags: string[] | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          instance_id: string
          metadata?: Json | null
          name?: string | null
          phone_number: string
          profile_picture_url?: string | null
          push_name?: string | null
          tags?: string[] | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          instance_id?: string
          metadata?: Json | null
          name?: string | null
          phone_number?: string
          profile_picture_url?: string | null
          push_name?: string | null
          tags?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "instances"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          assigned_to: string | null
          attendance_mode: string | null
          contact_id: string
          created_at: string
          department: string | null
          id: string
          instance_id: string
          last_message_at: string | null
          status: string
          unread_count: number
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          attendance_mode?: string | null
          contact_id: string
          created_at?: string
          department?: string | null
          id?: string
          instance_id: string
          last_message_at?: string | null
          status?: string
          unread_count?: number
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          attendance_mode?: string | null
          contact_id?: string
          created_at?: string
          department?: string | null
          id?: string
          instance_id?: string
          last_message_at?: string | null
          status?: string
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "instances"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "departments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      flows: {
        Row: {
          created_at: string
          description: string | null
          edges: Json
          id: string
          instance_id: string | null
          is_active: boolean
          name: string
          nodes: Json
          trigger_type: string
          trigger_value: string | null
          updated_at: string
          variables: Json | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          edges?: Json
          id?: string
          instance_id?: string | null
          is_active?: boolean
          name: string
          nodes?: Json
          trigger_type: string
          trigger_value?: string | null
          updated_at?: string
          variables?: Json | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          edges?: Json
          id?: string
          instance_id?: string | null
          is_active?: boolean
          name?: string
          nodes?: Json
          trigger_type?: string
          trigger_value?: string | null
          updated_at?: string
          variables?: Json | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flows_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flows_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      instances: {
        Row: {
          created_at: string
          id: string
          instance_key: string | null
          name: string
          phone_number: string | null
          profile_picture_url: string | null
          qr_code: string | null
          status: string
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          instance_key?: string | null
          name: string
          phone_number?: string | null
          profile_picture_url?: string | null
          qr_code?: string | null
          status?: string
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          instance_key?: string | null
          name?: string
          phone_number?: string | null
          profile_picture_url?: string | null
          qr_code?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "instances_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          config: Json | null
          created_at: string
          id: string
          is_active: boolean
          last_sync_at: string | null
          name: string
          type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          config?: Json | null
          created_at?: string
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          name: string
          type: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          config?: Json | null
          created_at?: string
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          name?: string
          type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          id: string
          metadata: Json | null
          tokens_count: number | null
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          document_id: string
          id?: string
          metadata?: Json | null
          tokens_count?: number | null
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          id?: string
          metadata?: Json | null
          tokens_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_documents: {
        Row: {
          chunks_count: number | null
          content: string | null
          created_at: string
          department_id: string | null
          file_path: string | null
          file_type: string | null
          id: string
          metadata: Json | null
          source_type: string
          source_url: string | null
          status: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          chunks_count?: number | null
          content?: string | null
          created_at?: string
          department_id?: string | null
          file_path?: string | null
          file_type?: string | null
          id?: string
          metadata?: Json | null
          source_type: string
          source_url?: string | null
          status?: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          chunks_count?: number | null
          content?: string | null
          created_at?: string
          department_id?: string | null
          file_path?: string | null
          file_type?: string | null
          id?: string
          metadata?: Json | null
          source_type?: string
          source_url?: string | null
          status?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_documents_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_documents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          audio_transcription: string | null
          contact_id: string
          content: string | null
          conversation_id: string
          created_at: string
          direction: string
          id: string
          instance_id: string
          is_from_bot: boolean
          media_mime_type: string | null
          media_url: string | null
          message_type: string
          metadata: Json | null
          status: string
          whatsapp_message_id: string | null
        }
        Insert: {
          audio_transcription?: string | null
          contact_id: string
          content?: string | null
          conversation_id: string
          created_at?: string
          direction: string
          id?: string
          instance_id: string
          is_from_bot?: boolean
          media_mime_type?: string | null
          media_url?: string | null
          message_type?: string
          metadata?: Json | null
          status?: string
          whatsapp_message_id?: string | null
        }
        Update: {
          audio_transcription?: string | null
          contact_id?: string
          content?: string | null
          conversation_id?: string
          created_at?: string
          direction?: string
          id?: string
          instance_id?: string
          is_from_bot?: boolean
          media_mime_type?: string | null
          media_url?: string | null
          message_type?: string
          metadata?: Json | null
          status?: string
          whatsapp_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "instances"
            referencedColumns: ["id"]
          },
        ]
      }
      personas: {
        Row: {
          avatar_url: string | null
          created_at: string
          department_id: string | null
          description: string | null
          fallback_message: string | null
          id: string
          is_default: boolean | null
          name: string
          system_prompt: string
          temperature: number | null
          updated_at: string
          voice_enabled: boolean | null
          voice_id: string | null
          welcome_message: string | null
          workspace_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          department_id?: string | null
          description?: string | null
          fallback_message?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          system_prompt: string
          temperature?: number | null
          updated_at?: string
          voice_enabled?: boolean | null
          voice_id?: string | null
          welcome_message?: string | null
          workspace_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          department_id?: string | null
          description?: string | null
          fallback_message?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          system_prompt?: string
          temperature?: number | null
          updated_at?: string
          voice_enabled?: boolean | null
          voice_id?: string | null
          welcome_message?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "personas_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personas_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          company_name: string | null
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          company_name?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          company_name?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_tokens: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string
          is_used: boolean | null
          token: string
          token_type: string
          used_at: string | null
          used_by_member_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_used?: boolean | null
          token: string
          token_type?: string
          used_at?: string | null
          used_by_member_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_used?: boolean | null
          token?: string
          token_type?: string
          used_at?: string | null
          used_by_member_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_tokens_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          logo_url: string | null
          name: string
          owner_id: string
          plan: string
          settings: Json | null
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          owner_id: string
          plan?: string
          settings?: Json | null
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          owner_id?: string
          plan?: string
          settings?: Json | null
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_workspace_member: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      is_workspace_owner: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

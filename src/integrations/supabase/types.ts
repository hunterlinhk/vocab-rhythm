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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      assistant_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      attempts: {
        Row: {
          book_id: string
          correct: boolean
          created_at: string
          duration_ms: number
          id: string
          is_review: boolean
          mistouch: boolean
          mode: string
          review_word_key: string
          review_mode: string | null
          counted_for_review: boolean | null
          hint_count: number
          review_session_id: string | null
          session_stage: string | null
          time_zone: string | null
          skipped: boolean
          translation: string | null
          typo_count: number
          user_id: string
          word: string
        }
        Insert: {
          book_id?: string
          correct?: boolean
          created_at?: string
          duration_ms?: number
          id?: string
          is_review?: boolean
          mistouch?: boolean
          mode?: string
          review_mode?: string | null
          counted_for_review?: boolean | null
          hint_count?: number
          review_session_id?: string | null
          session_stage?: string | null
          time_zone?: string | null
          skipped?: boolean
          translation?: string | null
          typo_count?: number
          user_id: string
          word: string
        }
        Update: {
          book_id?: string
          correct?: boolean
          created_at?: string
          duration_ms?: number
          id?: string
          is_review?: boolean
          mistouch?: boolean
          mode?: string
          review_mode?: string | null
          counted_for_review?: boolean | null
          hint_count?: number
          review_session_id?: string | null
          session_stage?: string | null
          time_zone?: string | null
          skipped?: boolean
          translation?: string | null
          typo_count?: number
          user_id?: string
          word?: string
        }
        Relationships: []
      }
      book_progress: {
        Row: {
          book_id: string
          cursor_index: number
          mode: string
          revision: number
          session_state: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          book_id: string
          cursor_index?: number
          mode?: string
          revision?: number
          session_state?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          book_id?: string
          cursor_index?: number
          mode?: string
          revision?: number
          session_state?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      lexemes: {
        Row: {
          created_at: string
          id: string
          language: string
          lemma: string
          normalized_word: string
        }
        Insert: {
          created_at?: string
          id?: string
          language?: string
          lemma: string
          normalized_word: string
        }
        Update: {
          created_at?: string
          id?: string
          language?: string
          lemma?: string
          normalized_word?: string
        }
        Relationships: []
      }
      lexicon_entries: {
        Row: {
          created_at: string
          definition_en: string | null
          id: string
          lexeme_id: string
          object: string | null
          part_of_speech: string | null
          phonetic: string | null
          priority: number
          sense_key: string
          sentence: string | null
          sentence_translation: string | null
          source_entry_ref: string | null
          source_id: string
          subject: string | null
          translation: string | null
          verb: string | null
        }
        Insert: {
          created_at?: string
          definition_en?: string | null
          id?: string
          lexeme_id: string
          object?: string | null
          part_of_speech?: string | null
          phonetic?: string | null
          priority?: number
          sense_key?: string
          sentence?: string | null
          sentence_translation?: string | null
          source_entry_ref?: string | null
          source_id: string
          subject?: string | null
          translation?: string | null
          verb?: string | null
        }
        Update: {
          created_at?: string
          definition_en?: string | null
          id?: string
          lexeme_id?: string
          object?: string | null
          part_of_speech?: string | null
          phonetic?: string | null
          priority?: number
          sense_key?: string
          sentence?: string | null
          sentence_translation?: string | null
          source_entry_ref?: string | null
          source_id?: string
          subject?: string | null
          translation?: string | null
          verb?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lexicon_entries_lexeme_id_fkey"
            columns: ["lexeme_id"]
            isOneToOne: false
            referencedRelation: "lexemes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lexicon_entries_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "lexicon_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      lexicon_sources: {
        Row: {
          access_tier: string
          attribution: string
          id: string
          imported_at: string
          license_id: string
          license_notice: string | null
          license_url: string
          source_sha256: string | null
          source_url: string
          title: string
          transformation: string | null
          version: string | null
        }
        Insert: {
          access_tier?: string
          attribution: string
          id: string
          imported_at?: string
          license_id: string
          license_notice?: string | null
          license_url: string
          source_sha256?: string | null
          source_url: string
          title: string
          transformation?: string | null
          version?: string | null
        }
        Update: {
          access_tier?: string
          attribution?: string
          id?: string
          imported_at?: string
          license_id?: string
          license_notice?: string | null
          license_url?: string
          source_sha256?: string | null
          source_url?: string
          title?: string
          transformation?: string | null
          version?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          active_book: string
          daily_goal: number
          memorize_spelling: boolean
          strict_spelling: boolean
          include_spelling_in_review: boolean | null
          include_spelling_in_review_first_choice: boolean | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active_book?: string
          daily_goal?: number
          memorize_spelling?: boolean
          strict_spelling?: boolean
          include_spelling_in_review?: boolean | null
          include_spelling_in_review_first_choice?: boolean | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active_book?: string
          daily_goal?: number
          memorize_spelling?: boolean
          strict_spelling?: boolean
          include_spelling_in_review?: boolean | null
          include_spelling_in_review_first_choice?: boolean | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      review_states: {
        Row: {
          user_id: string
          source_book_id: string | null
          word: string
          word_key: string
          review_mode: string
          last_reviewed_at: string | null
          next_due_at: string | null
          interval_seconds: number | null
          consecutive_correct: number
          total_wrong: number
          hint_count: number
          difficulty: number | null
          scheduler_data: Json
          last_attempt_id: string | null
          last_session_id: string | null
          last_learning_day: string | null
          successful_growth_day: string | null
          pending_action: string
          last_outcome: string | null
          last_decision_reason: string | null
          scheduler_version: string | null
          last_decision_id: string | null
          revision: number
          updated_at: string
        }
        Insert: {
          user_id: string
          source_book_id?: string | null
          word: string
          word_key: string
          review_mode: string
          last_reviewed_at?: string | null
          next_due_at?: string | null
          interval_seconds?: number | null
          consecutive_correct?: number
          total_wrong?: number
          hint_count?: number
          difficulty?: number | null
          scheduler_data?: Json
          last_attempt_id?: string | null
          last_session_id?: string | null
          last_learning_day?: string | null
          successful_growth_day?: string | null
          pending_action?: string
          last_outcome?: string | null
          last_decision_reason?: string | null
          scheduler_version?: string | null
          last_decision_id?: string | null
          revision?: number
          updated_at?: string
        }
        Update: {
          user_id?: string
          source_book_id?: string | null
          word?: string
          word_key?: string
          review_mode?: string
          last_reviewed_at?: string | null
          next_due_at?: string | null
          interval_seconds?: number | null
          consecutive_correct?: number
          total_wrong?: number
          hint_count?: number
          difficulty?: number | null
          scheduler_data?: Json
          last_attempt_id?: string | null
          last_session_id?: string | null
          last_learning_day?: string | null
          successful_growth_day?: string | null
          pending_action?: string
          last_outcome?: string | null
          last_decision_reason?: string | null
          scheduler_version?: string | null
          last_decision_id?: string | null
          revision?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_states_source_book_id_fkey"
            columns: ["source_book_id"]
            isOneToOne: false
            referencedRelation: "word_books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_states_last_attempt_id_fkey"
            columns: ["last_attempt_id"]
            isOneToOne: false
            referencedRelation: "attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_states_last_decision_id_fkey"
            columns: ["last_decision_id"]
            isOneToOne: false
            referencedRelation: "review_schedule_decisions"
            referencedColumns: ["decision_id"]
          },
        ]
      }
      review_session_results: {
        Row: {
          user_id: string
          book_id: string
          word: string
          word_key: string
          review_mode: string
          session_id: string
          outcome: string | null
          counted_for_review: boolean | null
          final_correct: boolean | null
          had_real_error: boolean
          real_wrong_count: number
          used_hint: boolean
          hint_count: number
          attempt_count: number
          valid_attempt_count: number
          last_attempt_id: string | null
          completed_at: string
          time_zone: string
          learning_day: string
          source_fingerprint: string
          revision: number
          updated_at: string
        }
        Insert: {
          user_id: string
          book_id: string
          word: string
          word_key: string
          review_mode: string
          session_id: string
          outcome?: string | null
          counted_for_review?: boolean | null
          final_correct?: boolean | null
          had_real_error?: boolean
          real_wrong_count?: number
          used_hint?: boolean
          hint_count?: number
          attempt_count?: number
          valid_attempt_count?: number
          last_attempt_id?: string | null
          completed_at: string
          time_zone: string
          learning_day: string
          source_fingerprint: string
          revision?: number
          updated_at?: string
        }
        Update: {
          user_id?: string
          book_id?: string
          word?: string
          word_key?: string
          review_mode?: string
          session_id?: string
          outcome?: string | null
          counted_for_review?: boolean | null
          final_correct?: boolean | null
          had_real_error?: boolean
          real_wrong_count?: number
          used_hint?: boolean
          hint_count?: number
          attempt_count?: number
          valid_attempt_count?: number
          last_attempt_id?: string | null
          completed_at?: string
          time_zone?: string
          learning_day?: string
          source_fingerprint?: string
          revision?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_session_results_last_attempt_id_fkey"
            columns: ["last_attempt_id"]
            isOneToOne: false
            referencedRelation: "attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      review_schedule_decisions: {
        Row: {
          decision_id: string
          user_id: string
          book_id: string
          word: string
          word_key: string
          review_mode: string
          session_id: string
          decision_revision: number
          supersedes_decision_id: string | null
          learning_day: string
          session_outcome: string | null
          effective_inclusion: boolean | null
          is_initial_learning: boolean
          state_advanced: boolean
          interval_advanced: boolean
          schedule_action: string
          decision_reason: string
          scheduler_version: string
          input_fingerprint: string
          before_state: Json
          after_state: Json
          created_at: string
        }
        Insert: {
          decision_id?: string
          user_id: string
          book_id: string
          word: string
          word_key: string
          review_mode: string
          session_id: string
          decision_revision: number
          supersedes_decision_id?: string | null
          learning_day: string
          session_outcome?: string | null
          effective_inclusion?: boolean | null
          is_initial_learning?: boolean
          state_advanced: boolean
          interval_advanced: boolean
          schedule_action: string
          decision_reason: string
          scheduler_version: string
          input_fingerprint: string
          before_state: Json
          after_state: Json
          created_at?: string
        }
        Update: {
          decision_id?: string
          user_id?: string
          book_id?: string
          word?: string
          word_key?: string
          review_mode?: string
          session_id?: string
          decision_revision?: number
          supersedes_decision_id?: string | null
          learning_day?: string
          session_outcome?: string | null
          effective_inclusion?: boolean | null
          is_initial_learning?: boolean
          state_advanced?: boolean
          interval_advanced?: boolean
          schedule_action?: string
          decision_reason?: string
          scheduler_version?: string
          input_fingerprint?: string
          before_state?: Json
          after_state?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_schedule_decisions_supersedes_decision_id_fkey"
            columns: ["supersedes_decision_id"]
            isOneToOne: false
            referencedRelation: "review_schedule_decisions"
            referencedColumns: ["decision_id"]
          },
        ]
      }
      word_books: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          owner_user_id: string | null
          source: string
          updated_at: string
          word_count: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          owner_user_id?: string | null
          source?: string
          updated_at?: string
          word_count?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          owner_user_id?: string | null
          source?: string
          updated_at?: string
          word_count?: number
        }
        Relationships: []
      }
      word_entries: {
        Row: {
          book_id: string
          created_at: string
          id: string
          lexeme_id: string | null
          object: string | null
          part_of_speech: string | null
          phonetic: string | null
          position: number
          sentence: string | null
          sentence_translation: string | null
          source_frequency_per_million: number | null
          source_rank: number | null
          source_sfi: number | null
          subject: string | null
          translation: string | null
          verb: string | null
          word: string
        }
        Insert: {
          book_id: string
          created_at?: string
          id?: string
          lexeme_id?: string | null
          object?: string | null
          part_of_speech?: string | null
          phonetic?: string | null
          position?: number
          sentence?: string | null
          sentence_translation?: string | null
          source_frequency_per_million?: number | null
          source_rank?: number | null
          source_sfi?: number | null
          subject?: string | null
          translation?: string | null
          verb?: string | null
          word: string
        }
        Update: {
          book_id?: string
          created_at?: string
          id?: string
          lexeme_id?: string | null
          object?: string | null
          part_of_speech?: string | null
          phonetic?: string | null
          position?: number
          sentence?: string | null
          sentence_translation?: string | null
          source_frequency_per_million?: number | null
          source_rank?: number | null
          source_sfi?: number | null
          subject?: string | null
          translation?: string | null
          verb?: string | null
          word?: string
        }
        Relationships: [
          {
            foreignKeyName: "word_entries_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "word_books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "word_entries_lexeme_id_fkey"
            columns: ["lexeme_id"]
            isOneToOne: false
            referencedRelation: "lexemes"
            referencedColumns: ["id"]
          },
        ]
      }
      word_mastery: {
        Row: {
          book_id: string
          context_ok: boolean
          recall_ok: boolean
          reinforced_at: string | null
          rounds: number
          spell_ok: boolean
          translation: string | null
          updated_at: string
          user_id: string
          word: string
        }
        Insert: {
          book_id?: string
          context_ok?: boolean
          recall_ok?: boolean
          reinforced_at?: string | null
          rounds?: number
          spell_ok?: boolean
          translation?: string | null
          updated_at?: string
          user_id: string
          word: string
        }
        Update: {
          book_id?: string
          context_ok?: boolean
          recall_ok?: boolean
          reinforced_at?: string | null
          rounds?: number
          spell_ok?: boolean
          translation?: string | null
          updated_at?: string
          user_id?: string
          word?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_read_book: { Args: { _book_id: string }; Returns: boolean }
      owns_book: { Args: { _book_id: string }; Returns: boolean }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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

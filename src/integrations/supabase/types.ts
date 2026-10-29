export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      lumetra_projects: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          objective: string | null;
          status: "no-data" | "data-loaded" | "analysed";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          description?: string | null;
          objective?: string | null;
          status?: "no-data" | "data-loaded" | "analysed";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          description?: string | null;
          objective?: string | null;
          status?: "no-data" | "data-loaded" | "analysed";
          created_at?: string;
          updated_at?: string;
        };
      };
      datasets: {
        Row: {
          id: string;
          project_id: string;
          user_id: string;
          name: string;
          source: "upload" | "sample";
          row_count: number;
          column_count: number;
          columns: Json;
          delimiter: string | null;
          type_overrides: Json | null;
          cleaning_steps: Json;
          csv_content: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          user_id: string;
          name: string;
          source?: "upload" | "sample";
          row_count?: number;
          column_count?: number;
          columns?: Json;
          delimiter?: string | null;
          type_overrides?: Json | null;
          cleaning_steps?: Json;
          csv_content?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          user_id?: string;
          name?: string;
          source?: "upload" | "sample";
          row_count?: number;
          column_count?: number;
          columns?: Json;
          delimiter?: string | null;
          type_overrides?: Json | null;
          cleaning_steps?: Json;
          csv_content?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      saved_analyses: {
        Row: {
          id: string;
          project_id: string;
          user_id: string;
          name: string;
          type: string;
          dataset_id: string | null;
          dataset_name: string | null;
          dataset_signature: string;
          variables: Json;
          configuration: Json;
          sample_size: number;
          missing_count: number;
          missing_handling: string | null;
          results: Json;
          interpretation: Json;
          method_notes: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          user_id: string;
          name: string;
          type: string;
          dataset_id?: string | null;
          dataset_name?: string | null;
          dataset_signature: string;
          variables?: Json;
          configuration?: Json;
          sample_size?: number;
          missing_count?: number;
          missing_handling?: string | null;
          results?: Json;
          interpretation?: Json;
          method_notes?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          user_id?: string;
          name?: string;
          type?: string;
          dataset_id?: string | null;
          dataset_name?: string | null;
          dataset_signature?: string;
          variables?: Json;
          configuration?: Json;
          sample_size?: number;
          missing_count?: number;
          missing_handling?: string | null;
          results?: Json;
          interpretation?: Json;
          method_notes?: Json;
          created_at?: string;
          updated_at?: string;
        };
      };
      reports: {
        Row: {
          id: string;
          project_id: string;
          user_id: string;
          title: string;
          objective: string | null;
          content_markdown: string;
          summary: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          user_id: string;
          title: string;
          objective?: string | null;
          content_markdown: string;
          summary?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          user_id?: string;
          title?: string;
          objective?: string | null;
          content_markdown?: string;
          summary?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}

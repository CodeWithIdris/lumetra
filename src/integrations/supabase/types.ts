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
          revision: number;
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
          revision?: number;
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
          revision?: number;
        };
        Relationships: [];
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
          revision: number;
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
          revision?: number;
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
          revision?: number;
        };
        Relationships: [
          {
            foreignKeyName: "datasets_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "lumetra_projects";
            referencedColumns: ["id"];
          },
        ];
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
          revision: number;
          dataset_version: number | null;
          dataset_version_id: string | null;
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
          revision?: number;
          dataset_version?: number | null;
          dataset_version_id?: string | null;
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
          revision?: number;
          dataset_version?: number | null;
          dataset_version_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "saved_analyses_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "lumetra_projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "saved_analyses_dataset_version_project_fkey";
            columns: ["project_id", "dataset_version_id"];
            isOneToOne: false;
            referencedRelation: "dataset_versions";
            referencedColumns: ["project_id", "id"];
          },
        ];
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
          revision: number;
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
          revision?: number;
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
          revision?: number;
        };
        Relationships: [
          {
            foreignKeyName: "reports_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "lumetra_projects";
            referencedColumns: ["id"];
          },
        ];
      };
      dataset_versions: {
        Row: {
          id: string;
          project_id: string;
          dataset_id: string;
          user_id: string;
          version_number: number;
          content_hash: string;
          content_path: string;
          cleaning_steps: Json;
          change_description: string;
          created_at: string;
        };
        Insert: {
          id: string;
          project_id: string;
          dataset_id: string;
          user_id: string;
          version_number: number;
          content_hash: string;
          content_path: string;
          cleaning_steps?: Json;
          change_description: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          dataset_id?: string;
          user_id?: string;
          version_number?: number;
          content_hash?: string;
          content_path?: string;
          cleaning_steps?: Json;
          change_description?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "dataset_versions_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "lumetra_projects";
            referencedColumns: ["id"];
          },
        ];
      };
      project_history: {
        Row: {
          id: string;
          project_id: string;
          user_id: string;
          entity_type: "project" | "analysis" | "report";
          entity_id: string;
          revision: number;
          change_description: string;
          snapshot: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          user_id: string;
          entity_type: "project" | "analysis" | "report";
          entity_id: string;
          revision: number;
          change_description: string;
          snapshot: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          user_id?: string;
          entity_type?: "project" | "analysis" | "report";
          entity_id?: string;
          revision?: number;
          change_description?: string;
          snapshot?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_history_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "lumetra_projects";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}

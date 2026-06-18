// Tipos do banco. Gere a versão completa com:
//   npx supabase gen types typescript --project-id odpcgeiaikdvpoydcfyu > src/lib/types.ts
// Por enquanto, um stub mínimo para o projeto compilar.

export type Role = "admin" | "consultor" | "colaborador" | "pending";
export type TaskKind = "unica" | "diaria";
export type TaskStatus = "a_fazer" | "iniciada" | "finalizada" | "cancelada";

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: Role;
}

export interface Company {
  id: string;
  name: string;
  whatsapp_contact_id: string | null;
  whatsapp_group_name: string | null;
}

export interface TaskInstance {
  id: string;
  template_id: string | null;
  company_id: string;
  collaborator_id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  status: TaskStatus;
  due_at: string | null;
  task_date: string;
  total_seconds: number;
  completion_note: string | null;
  note_sent_whatsapp: boolean;
  started_at: string | null;
  finished_at: string | null;
}

// Stub para o supabase-js aceitar generics sem o arquivo gerado completo.
export type Database = any;

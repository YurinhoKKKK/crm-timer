"use server";

import { createClient } from "@/lib/supabase-server";
import { avatarUrl } from "@/lib/avatar";
import type { TaskStatus } from "@/lib/types";

// "Ver mais" dentro de um grupo de tarefas (agrupamento por template): as
// listas carregam só as fechadas recentes; o restante do histórico é buscado
// aqui sob demanda, página a página. A RLS de task_instances (ti_select)
// escopa o que cada cargo pode ler — mesma regra das listas.

const PAGE = 20;

export type GroupHistoryEntry = {
  id: string;
  title: string;
  status: TaskStatus;
  due_at: string | null;
  task_date: string;
  total_seconds: number;
  collaboratorName?: string;
  collaboratorAvatarUrl?: string | null;
};

type Joined<T> = T | T[] | null;
function first<T>(value: Joined<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

// Fechadas (finalizada/cancelada) do template, da mais recente para trás.
// O cursor é task_date (única por template — unique(template_id, task_date)).
export async function loadGroupHistory(
  templateId: string,
  beforeDate: string | null
): Promise<{
  error: string | null;
  items: GroupHistoryEntry[];
  hasMore: boolean;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sessão expirada. Faça login novamente.", items: [], hasMore: false };
  }

  let q = supabase
    .from("task_instances")
    .select(
      "id, title, status, due_at, task_date, total_seconds, collaborator:profiles!task_instances_collaborator_id_fkey(full_name, email, avatar_path)"
    )
    .eq("template_id", templateId)
    .in("status", ["finalizada", "cancelada"])
    .order("task_date", { ascending: false })
    .limit(PAGE + 1);
  if (beforeDate) q = q.lt("task_date", beforeDate);

  const { data, error } = await q;
  if (error) return { error: error.message, items: [], hasMore: false };

  type Row = {
    id: string;
    title: string;
    status: TaskStatus;
    due_at: string | null;
    task_date: string;
    total_seconds: number;
    collaborator: Joined<{
      full_name: string | null;
      email: string;
      avatar_path: string | null;
    }>;
  };
  const allRows = (data as Row[]) ?? [];
  const hasMore = allRows.length > PAGE;
  const rows = hasMore ? allRows.slice(0, PAGE) : allRows;

  const items: GroupHistoryEntry[] = rows.map((r) => {
    const collab = first(r.collaborator);
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      due_at: r.due_at,
      task_date: r.task_date,
      total_seconds: r.total_seconds,
      collaboratorName: collab?.full_name || collab?.email || undefined,
      collaboratorAvatarUrl: avatarUrl(collab?.avatar_path),
    };
  });

  return { error: null, items, hasMore };
}

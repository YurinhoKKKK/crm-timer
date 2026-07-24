"use server";

import { createClient } from "@/lib/supabase-server";
import type { TaskStatus } from "@/lib/types";
import { avatarUrl } from "@/lib/avatar";
import { periodStart } from "@/lib/period";
import type { Period } from "./PeriodFilter";

export type BreakdownTask = {
  id: string;
  title: string;
  status: TaskStatus;
  collaboratorName: string;
  collaboratorAvatarUrl: string | null;
  seconds: number;
};

type Joined<T> = T | T[] | null;
function first<T>(value: Joined<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

type Row = {
  id: string;
  title: string;
  status: TaskStatus;
  collaborator: Joined<{
    full_name: string | null;
    email: string;
    avatar_path: string | null;
  }>;
};

// Passo 17 — tarefas que compõem o tempo de uma empresa no período, ordenadas
// da que mais consumiu para a que menos. O tempo por tarefa é o TRABALHADO no
// período (time_entries por started_at, via RPC time_by_task), não o
// total_seconds da tarefa — assim a soma bate exatamente com a barra do
// gráfico, que também vem de time_entries. `collaboratorId` opcional escopa o
// detalhamento a um único responsável (gráfico da tela do colaborador). A RLS
// (ti_select / te_select) protege o acesso.
export async function getCompanyTimeBreakdown(
  companyId: string,
  period: Period,
  collaboratorId?: string
): Promise<{
  error: string | null;
  tasks?: BreakdownTask[];
  totalSeconds?: number;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const start = periodStart(period);

  // 1) Tempo por tarefa no período (fonte de verdade: time_entries).
  const { data: timeData, error: timeError } = await supabase.rpc(
    "time_by_task",
    { p_company: companyId, p_start: start, p_collaborator: collaboratorId ?? null }
  );
  if (timeError) return { error: timeError.message };

  const secondsByTask = new Map(
    ((timeData as { task_id: string; seconds: number }[]) ?? []).map((r) => [
      r.task_id,
      Number(r.seconds),
    ])
  );
  const ids = Array.from(secondsByTask.keys());
  if (ids.length === 0) return { error: null, tasks: [], totalSeconds: 0 };

  // 2) Metadados das tarefas com tempo no período (título, status, responsável).
  const { data, error } = await supabase
    .from("task_instances")
    .select(
      "id, title, status, collaborator:profiles!task_instances_collaborator_id_fkey(full_name, email, avatar_path)"
    )
    .in("id", ids);
  if (error) return { error: error.message };

  const tasks: BreakdownTask[] = ((data as Row[]) ?? [])
    .map((r) => {
      const collab = first(r.collaborator);
      return {
        id: r.id,
        title: r.title,
        status: r.status,
        collaboratorName:
          collab?.full_name || collab?.email || "(sem responsável)",
        collaboratorAvatarUrl: avatarUrl(collab?.avatar_path),
        seconds: secondsByTask.get(r.id) ?? 0,
      };
    })
    .filter((t) => t.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);

  const totalSeconds = tasks.reduce((sum, t) => sum + t.seconds, 0);
  return { error: null, tasks, totalSeconds };
}

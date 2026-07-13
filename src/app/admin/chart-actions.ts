"use server";

import { createClient } from "@/lib/supabase-server";
import type { TaskStatus } from "@/lib/types";
import { avatarUrl } from "@/lib/avatar";
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

// Início do período (YYYY-MM-DD) — mesma regra do dashboard, para que a soma
// do detalhamento bata exatamente com a altura da barra.
function periodStart(period: Period): string | null {
  if (period === "tudo") return null;
  const d = new Date();
  if (period === "7d") d.setDate(d.getDate() - 6);
  else if (period === "30d") d.setDate(d.getDate() - 29);
  return d.toISOString().slice(0, 10);
}

type Row = {
  id: string;
  title: string;
  status: TaskStatus;
  total_seconds: number;
  collaborator: Joined<{
    full_name: string | null;
    email: string;
    avatar_path: string | null;
  }>;
};

// Passo 17 — tarefas que compõem o tempo de uma empresa no período, ordenadas
// da que mais consumiu para a que menos. A RLS (ti_select / is_admin) protege.
// `collaboratorId` opcional escopa o detalhamento a um único responsável: usado
// no gráfico da página do colaborador, cuja barra já é só o tempo dele naquela
// empresa — assim a soma do painel bate exatamente com a altura da barra.
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
  let query = supabase
    .from("task_instances")
    .select(
      "id, title, status, total_seconds, collaborator:profiles!task_instances_collaborator_id_fkey(full_name, email, avatar_path)"
    )
    .eq("company_id", companyId);
  if (collaboratorId) query = query.eq("collaborator_id", collaboratorId);
  if (start) query = query.gte("task_date", start);

  const { data, error } = await query;
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
        seconds: r.total_seconds,
      };
    })
    .filter((t) => t.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);

  const totalSeconds = tasks.reduce((sum, t) => sum + t.seconds, 0);
  return { error: null, tasks, totalSeconds };
}

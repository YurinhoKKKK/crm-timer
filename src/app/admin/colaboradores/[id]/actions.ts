"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase-server";
import { addDays } from "@/lib/period";
import type { TaskStatus } from "@/lib/types";
import type { Adjustment, CollaboratorTask, TaskOrder } from "./collaborator-tasks";

// Passo 16 — Correção de tempo pelo admin (com auditoria).
// Chama admin_adjust_time, que valida is_admin() no banco, reconcilia os
// time_entries, grava o novo total_seconds e registra em time_adjustments.
export async function adjustTaskTime(
  taskId: string,
  collaboratorId: string,
  newSeconds: number,
  reason: string,
  // Opcional: permite revalidar a central da empresa afetada (quando conhecida).
  companyId?: string
): Promise<{ error: string | null }> {
  if (!Number.isFinite(newSeconds) || newSeconds < 0) {
    return { error: "Informe um tempo válido." };
  }
  // Teto de sanidade: 1000 horas.
  if (newSeconds > 1000 * 3600) {
    return { error: "Tempo acima do limite permitido." };
  }
  // Justificativa OBRIGATÓRIA (a RPC também recusa vazia — esta é a 1ª barreira).
  if (!reason.trim()) {
    return { error: "A justificativa do ajuste é obrigatória." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.rpc("admin_adjust_time", {
    p_task: taskId,
    p_new_seconds: Math.round(newSeconds),
    p_reason: reason.trim(),
  });

  if (error) return { error: error.message };

  // Reflete nas telas afetadas: dashboard, detalhe do responsável, instâncias,
  // central da empresa (lista de empresas e, se conhecida, a tela da empresa) e
  // as listas de tarefas.
  revalidatePath("/admin");
  revalidatePath(`/admin/colaboradores/${collaboratorId}`);
  revalidatePath("/admin/instancias");
  revalidatePath("/admin/empresas");
  if (companyId) {
    revalidatePath(`/admin/empresas/${companyId}`);
    revalidatePath(`/consultor/${companyId}`);
    revalidatePath(`/colaborador/${companyId}`);
  }
  return { error: null };
}

// --- Ausências do colaborador (migration 0162) ------------------------------
// Dias úteis de ausência saem dos pontos E das chances do Aproveitamento (o
// cálculo exclui na leitura, então vale retroativamente). A RLS ca_admin_all já
// barra não-admin; aqui só validamos a entrada e revalidamos as telas afetadas.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function addAbsence(
  collaboratorId: string,
  startDate: string,
  endDate: string
): Promise<{ error: string | null }> {
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    return { error: "Informe datas válidas (início e fim)." };
  }
  if (endDate < startDate) {
    return { error: "A data de fim não pode ser antes do início." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.from("collaborator_absences").insert({
    collaborator_id: collaboratorId,
    start_date: startDate,
    end_date: endDate,
    created_by: user.id,
  });
  if (error) return { error: error.message };

  revalidatePath(`/admin/colaboradores/${collaboratorId}`);
  revalidatePath("/acompanhamento");
  return { error: null };
}

export async function removeAbsence(
  collaboratorId: string,
  absenceId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("collaborator_absences")
    .delete()
    .eq("id", absenceId)
    .eq("collaborator_id", collaboratorId);
  if (error) return { error: error.message };

  revalidatePath(`/admin/colaboradores/${collaboratorId}`);
  revalidatePath("/acompanhamento");
  return { error: null };
}

// --- Lista de tarefas paginada no banco (migration 0163) --------------------
// Busca/filtros/ordenação/paginação moram na RPC collaborator_tasks_page
// (DEFINER + gate is_admin()), com o MESMO critério de período das contagens. A
// action só repassa os parâmetros e normaliza o retorno para a UI.

type PageRow = {
  id: string;
  title: string;
  status: TaskStatus;
  due_at: string | null;
  task_date: string;
  finished_at: string | null;
  total_seconds: number;
  company_id: string;
  company_name: string | null;
  type_key: string;
  type_label: string;
  only_by_work: boolean;
  adjustment_count: number;
  adjustments: Adjustment[] | null;
  total_count: number;
};

export type LoadTasksInput = {
  collaboratorId: string;
  start: string | null;
  end: string | null;
  status: string;
  companyId: string;
  type: string;
  search: string;
  order: TaskOrder;
  limit: number;
  offset: number;
};

export async function loadCollaboratorTasks(
  input: LoadTasksInput
): Promise<{ error: string | null; tasks: CollaboratorTask[]; total: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente.", tasks: [], total: 0 };

  const { data, error } = await supabase.rpc("collaborator_tasks_page", {
    p_collaborator: input.collaboratorId,
    p_start: input.start,
    p_end: input.end,
    p_status: input.status || null,
    p_company: input.companyId || null,
    p_type: input.type || null,
    p_search: input.search.trim() || null,
    p_order: input.order,
    p_limit: input.limit,
    p_offset: input.offset,
  });
  if (error) return { error: error.message, tasks: [], total: 0 };

  const rows = (data as PageRow[]) ?? [];
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
  const tasks: CollaboratorTask[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    dueAt: r.due_at,
    taskDate: r.task_date,
    finishedAt: r.finished_at,
    totalSeconds: r.total_seconds,
    companyId: r.company_id,
    companyName: r.company_name ?? "(empresa removida)",
    typeKey: r.type_key,
    typeLabel: r.type_label,
    onlyByWork: r.only_by_work,
    adjustments: r.adjustments ?? [],
  }));
  return { error: null, tasks, total };
}

// --- Atividades recentes com "Ver mais" (30 por vez) ------------------------
// Respeita início E fim do período (BRT): >= início 00:00 e < (fim+1) 00:00 BRT.
// BRT é UTC-3 (sem horário de verão desde 2019) — o offset fixo basta.
export type ActivityItem = {
  id: string;
  message: string;
  seconds_spent: number;
  sent_whatsapp: boolean;
  created_at: string;
  companyName: string;
};

function brtStartInstant(ymd: string | null): string | null {
  return ymd ? `${ymd}T00:00:00-03:00` : null;
}
function brtEndExclusiveInstant(ymd: string | null): string | null {
  return ymd ? `${addDays(ymd, 1)}T00:00:00-03:00` : null;
}

type ActivityDbRow = {
  id: string;
  message: string;
  seconds_spent: number;
  sent_whatsapp: boolean;
  created_at: string;
  company: { name: string } | { name: string }[] | null;
};

export async function loadCollaboratorActivities(input: {
  collaboratorId: string;
  start: string | null;
  end: string | null;
  offset: number;
  limit: number;
}): Promise<{ error: string | null; activities: ActivityItem[]; hasMore: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada.", activities: [], hasMore: false };

  const startIso = brtStartInstant(input.start);
  const endIso = brtEndExclusiveInstant(input.end);

  let query = supabase
    .from("activity_log")
    .select(
      "id, message, seconds_spent, sent_whatsapp, created_at, company:companies!activity_log_company_id_fkey(name)"
    )
    .eq("collaborator_id", input.collaboratorId)
    .order("created_at", { ascending: false })
    // +1 para detectar se há mais sem uma segunda consulta.
    .range(input.offset, input.offset + input.limit);
  if (startIso) query = query.gte("created_at", startIso);
  if (endIso) query = query.lt("created_at", endIso);

  const { data, error } = await query;
  if (error) return { error: error.message, activities: [], hasMore: false };

  const rows = (data as ActivityDbRow[]) ?? [];
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const activities: ActivityItem[] = page.map((a) => {
    const company = Array.isArray(a.company) ? a.company[0] : a.company;
    return {
      id: a.id,
      message: a.message,
      seconds_spent: a.seconds_spent,
      sent_whatsapp: a.sent_whatsapp,
      created_at: a.created_at,
      companyName: company?.name ?? "(empresa removida)",
    };
  });
  return { error: null, activities, hasMore };
}

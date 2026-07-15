import type { createClient } from "@/lib/supabase-server";
import type { TaskStatus } from "@/lib/types";
import { STATUS_META } from "@/lib/status";
import { loadLabelsByCompany, type Label } from "@/lib/labels";
import { avatarUrl } from "@/lib/avatar";
import type { InstanceItem } from "@/app/admin/instancias/InstanceStatusList";

// Núcleo das TELAS DE LISTA POR STATUS (drill-down dos funis): o dashboard
// (/admin/instancias) e as centrais de empresa (admin e consultor) usam a
// mesma leitura — recorte por status/atrasadas + período, teto de escala e
// etiquetas em lote — mudando só o escopo (empresa) e o guard/RLS de cada
// rota. A lista renderiza com InstanceStatusList (cada tarefa abre o painel
// de detalhe unificado).

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

// "atrasadas" é um recorte derivado (aberta + prazo vencido), não um status.
export type StatusFilter = TaskStatus | "atrasadas";

// Teto de itens carregados do banco por vez (Passo 18 — escala); buscamos
// CAP+1 para saber se há mais.
const CAP = 300;

const FILTER_TITLE: Record<StatusFilter, string> = {
  a_fazer: "Tarefas a fazer",
  iniciada: "Tarefas iniciadas",
  finalizada: "Tarefas finalizadas",
  cancelada: "Tarefas canceladas",
  atrasadas: "Tarefas atrasadas",
};

export function normalizeStatusFilter(
  value: string | string[] | undefined
): StatusFilter | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === "atrasadas") return "atrasadas";
  if (v && v in STATUS_META) return v as TaskStatus;
  return null;
}

// Sem filtro = todas as tarefas do escopo (o card "Total" da central).
export function statusListTitle(filter: StatusFilter | null): string {
  return filter ? FILTER_TITLE[filter] : "Todas as tarefas";
}

type Joined<T> = T | T[] | null;
function first<T>(value: Joined<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

type InstanceRow = {
  id: string;
  title: string;
  status: TaskStatus;
  due_at: string | null;
  task_date: string;
  template_id: string | null;
  total_seconds: number;
  company_id: string;
  company: Joined<{ name: string }>;
  collaborator: Joined<{
    full_name: string;
    email: string;
    avatar_path: string | null;
  }>;
};

export async function loadStatusInstances(
  supabase: SupabaseServer,
  opts: {
    filter: StatusFilter | null;
    // Início do período (YYYY-MM-DD) já resolvido; null = todo o período.
    start: string | null;
    // Escopa a uma empresa (telas da central). Sem ele, vale o escopo da RLS.
    companyId?: string;
  }
): Promise<{
  error: string | null;
  items: InstanceItem[];
  truncated: boolean;
  labelsByCompany: Record<string, Label[]>;
}> {
  let query = supabase
    .from("task_instances")
    .select(
      "id, title, status, due_at, task_date, template_id, total_seconds, company_id, company:companies!task_instances_company_id_fkey(name), collaborator:profiles!task_instances_collaborator_id_fkey(full_name, email, avatar_path)"
    )
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(CAP + 1);

  if (opts.companyId) query = query.eq("company_id", opts.companyId);
  if (opts.start) query = query.gte("task_date", opts.start);

  if (opts.filter === "atrasadas") {
    query = query
      .in("status", ["a_fazer", "iniciada"])
      .lt("due_at", new Date().toISOString());
  } else if (opts.filter) {
    query = query.eq("status", opts.filter);
  }

  const { data, error } = await query;
  if (error) {
    return { error: error.message, items: [], truncated: false, labelsByCompany: {} };
  }

  const allRows = (data as InstanceRow[]) ?? [];
  const truncated = allRows.length > CAP;
  const rows = truncated ? allRows.slice(0, CAP) : allRows;

  const items: InstanceItem[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    due_at: r.due_at,
    task_date: r.task_date,
    templateId: r.template_id,
    total_seconds: r.total_seconds,
    companyId: r.company_id,
    companyName: first(r.company)?.name ?? "(empresa removida)",
    collaboratorName:
      first(r.collaborator)?.full_name ||
      first(r.collaborator)?.email ||
      "(colaborador removido)",
    collaboratorAvatarUrl: avatarUrl(first(r.collaborator)?.avatar_path),
  }));

  // Etiquetas herdadas por empresa (exibidas em cada tarefa da lista).
  const labelsMap = await loadLabelsByCompany(
    supabase,
    items.map((i) => i.companyId)
  );

  return {
    error: null,
    items,
    truncated,
    labelsByCompany: Object.fromEntries(labelsMap) as Record<string, Label[]>,
  };
}

import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { TaskStatus } from "@/lib/types";
import { STATUS_META } from "@/lib/status";
import InstanceStatusList, { type InstanceItem } from "./InstanceStatusList";
import { loadLabelsByCompany, type Label } from "@/lib/labels";
import { avatarUrl } from "@/lib/avatar";

type Period = "hoje" | "7d" | "30d" | "tudo";
type Filter = TaskStatus | "atrasadas";

const PERIODS: Period[] = ["hoje", "7d", "30d", "tudo"];

// Teto de itens carregados do banco por vez (Passo 18 — escala). A lista de
// instâncias cresce sem limite; buscamos CAP+1 para saber se há mais.
const CAP = 300;

const FILTER_TITLE: Record<Filter, string> = {
  a_fazer: "Tarefas a fazer",
  iniciada: "Tarefas iniciadas",
  finalizada: "Tarefas finalizadas",
  cancelada: "Tarefas canceladas",
  atrasadas: "Tarefas atrasadas",
};

type Joined<T> = T | T[] | null;

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
  collaborator: Joined<{ full_name: string; email: string; avatar_path: string | null }>;
};

function first<T>(value: Joined<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function normalizePeriod(value: string | string[] | undefined): Period {
  const v = Array.isArray(value) ? value[0] : value;
  return PERIODS.includes(v as Period) ? (v as Period) : "30d";
}

function normalizeFilter(value: string | string[] | undefined): Filter | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === "atrasadas") return "atrasadas";
  if (v && v in STATUS_META) return v as TaskStatus;
  return null;
}

function periodStart(period: Period): string | null {
  if (period === "tudo") return null;
  const d = new Date();
  if (period === "7d") d.setDate(d.getDate() - 6);
  else if (period === "30d") d.setDate(d.getDate() - 29);
  return d.toISOString().slice(0, 10);
}

export default async function InstanciasPage({
  searchParams,
}: {
  searchParams: { status?: string; periodo?: string };
}) {
  const { supabase, profile } = await guardRole(["admin"]);

  const filter = normalizeFilter(searchParams?.status);
  const period = normalizePeriod(searchParams?.periodo);
  const start = periodStart(period);

  let query = supabase
    .from("task_instances")
    .select(
      "id, title, status, due_at, task_date, template_id, total_seconds, company_id, company:companies!task_instances_company_id_fkey(name), collaborator:profiles!task_instances_collaborator_id_fkey(full_name, email, avatar_path)"
    )
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(CAP + 1);

  if (start) query = query.gte("task_date", start);

  if (filter === "atrasadas") {
    query = query
      .in("status", ["a_fazer", "iniciada"])
      .lt("due_at", new Date().toISOString());
  } else if (filter) {
    query = query.eq("status", filter);
  }

  const { data, error } = await query;
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
  const labelsByCompany = Object.fromEntries(labelsMap) as Record<
    string,
    Label[]
  >;

  const title = filter ? FILTER_TITLE[filter] : "Tarefas";

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title={title}
      subtitle={`${truncated ? `${CAP}+` : rows.length} tarefa${
        rows.length === 1 ? "" : "s"
      }`}
      back={{ href: `/admin?periodo=${period}`, label: "Dashboard" }}
    >
      {!filter ? (
        <div className="rounded-2xl border border-line bg-surface p-12 text-center text-fg-subtle shadow-card">
          Selecione um status no painel.
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-300/60 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Erro ao carregar tarefas: {error.message}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-12 text-center text-fg-subtle shadow-card">
          Nenhuma tarefa neste status no período selecionado.
        </div>
      ) : (
        <InstanceStatusList
          items={items}
          truncated={truncated}
          labelsByCompany={labelsByCompany}
        />
      )}
    </AppShell>
  );
}

import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { TaskStatus } from "@/lib/types";
import { STATUS_META } from "@/lib/status";
import { formatDuration, formatDue } from "@/lib/format";

type Period = "hoje" | "7d" | "30d" | "tudo";
type Filter = TaskStatus | "atrasadas";

const PERIODS: Period[] = ["hoje", "7d", "30d", "tudo"];

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
  total_seconds: number;
  company: Joined<{ name: string }>;
  collaborator: Joined<{ full_name: string; email: string }>;
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
      "id, title, status, due_at, task_date, total_seconds, company:companies!task_instances_company_id_fkey(name), collaborator:profiles!task_instances_collaborator_id_fkey(full_name, email)"
    )
    .order("due_at", { ascending: true, nullsFirst: false });

  if (start) query = query.gte("task_date", start);

  if (filter === "atrasadas") {
    query = query
      .in("status", ["a_fazer", "iniciada"])
      .lt("due_at", new Date().toISOString());
  } else if (filter) {
    query = query.eq("status", filter);
  }

  const { data, error } = await query;
  const rows = (data as InstanceRow[]) ?? [];

  const title = filter ? FILTER_TITLE[filter] : "Tarefas";

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title={title}
      subtitle={`${rows.length} tarefa${rows.length === 1 ? "" : "s"}`}
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
        <ul className="space-y-3">
          {rows.map((r) => {
            const company = first(r.company);
            const collaborator = first(r.collaborator);
            const meta = STATUS_META[r.status];
            return (
              <li
                key={r.id}
                className="rounded-xl border border-line bg-surface p-4 shadow-card"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-fg">{r.title}</span>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${meta.badge}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                    {meta.label}
                  </span>
                </div>
                <p className="mt-1 text-sm text-fg-muted">
                  {company?.name ?? "(empresa removida)"} ·{" "}
                  {collaborator?.full_name ||
                    collaborator?.email ||
                    "(colaborador removido)"}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-fg-subtle">
                  <span>Prazo: {formatDue(r.due_at)}</span>
                  <span>
                    Tempo:{" "}
                    <span className="font-mono tabular-nums">
                      {formatDuration(r.total_seconds)}
                    </span>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}

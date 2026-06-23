import Link from "next/link";
import { guardRole } from "@/components/guardRole";
import LogoutButton from "@/components/LogoutButton";
import type { TaskStatus } from "@/lib/types";

type Period = "hoje" | "7d" | "30d" | "tudo";
type Filter = TaskStatus | "atrasadas";

const PERIODS: Period[] = ["hoje", "7d", "30d", "tudo"];

const STATUS_META: Record<
  TaskStatus,
  { label: string; className: string }
> = {
  a_fazer: { label: "A fazer", className: "border border-platinum bg-paper text-gunmetal/70" },
  iniciada: { label: "Iniciada", className: "bg-brand-soft text-risd" },
  finalizada: { label: "Finalizada", className: "bg-green-100 text-green-700" },
  cancelada: { label: "Cancelada", className: "bg-platinum text-gunmetal/50" },
};

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
  if (v && (v in STATUS_META)) return v as TaskStatus;
  return null;
}

function periodStart(period: Period): string | null {
  if (period === "tudo") return null;
  const d = new Date();
  if (period === "7d") d.setDate(d.getDate() - 6);
  else if (period === "30d") d.setDate(d.getDate() - 29);
  return d.toISOString().slice(0, 10);
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours === 0 && minutes === 0) return "0min";
  if (hours === 0) return `${minutes}min`;
  return `${hours}h ${minutes}min`;
}

function formatDue(due: string | null): string {
  if (!due) return "Sem prazo";
  return new Date(due).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function InstanciasPage({
  searchParams,
}: {
  searchParams: { status?: string; periodo?: string };
}) {
  const { supabase } = await guardRole(["admin"]);

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
    <main className="min-h-screen bg-paper p-4 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Link
              href={`/admin?periodo=${period}`}
              className="rounded text-sm text-gunmetal/60 transition hover:text-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2"
            >
              ← Painel
            </Link>
            <h1 className="mt-1 text-2xl font-semibold text-gunmetal">{title}</h1>
            <p className="text-sm text-gunmetal/60">
              {rows.length} tarefa{rows.length === 1 ? "" : "s"}
            </p>
          </div>
          <LogoutButton />
        </header>

        {!filter ? (
          <div className="rounded-xl border border-platinum bg-white p-12 text-center text-gunmetal/50 shadow-sm">
            Selecione um status no painel.
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            Erro ao carregar tarefas: {error.message}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-platinum bg-white p-12 text-center text-gunmetal/50 shadow-sm">
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
                  className="rounded-xl border border-platinum bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gunmetal">{r.title}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}
                    >
                      {meta.label}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gunmetal/60">
                    {company?.name ?? "(empresa removida)"} ·{" "}
                    {collaborator?.full_name ||
                      collaborator?.email ||
                      "(colaborador removido)"}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gunmetal/50">
                    <span>Prazo: {formatDue(r.due_at)}</span>
                    <span>Tempo: {formatDuration(r.total_seconds)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}

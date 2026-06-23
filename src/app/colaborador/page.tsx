import Link from "next/link";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { TaskStatus } from "@/lib/types";

type InstanceRow = {
  id: string;
  company_id: string;
  status: TaskStatus;
  due_at: string | null;
  company: { name: string } | { name: string }[] | null;
};

type CompanySummary = {
  id: string;
  name: string;
  total: number;
  done: number;
  pending: number;
  overdue: number;
  dueSoon: number;
};

function first<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export default async function ColaboradorPage() {
  const { supabase, profile } = await guardRole(["colaborador"]);

  const { data, error } = await supabase
    .from("task_instances")
    .select(
      "id, company_id, status, due_at, company:companies!task_instances_company_id_fkey(name)"
    )
    .eq("collaborator_id", profile.id);

  const rows = (data as InstanceRow[]) ?? [];

  const now = Date.now();
  const SOON_MS = 24 * 60 * 60 * 1000;

  // Agrupa as instâncias do colaborador por empresa.
  const byCompany = new Map<string, CompanySummary>();
  for (const r of rows) {
    const summary = byCompany.get(r.company_id) ?? {
      id: r.company_id,
      name: first(r.company)?.name ?? "(empresa)",
      total: 0,
      done: 0,
      pending: 0,
      overdue: 0,
      dueSoon: 0,
    };

    summary.total += 1;
    if (r.status === "finalizada") {
      summary.done += 1;
    } else if (r.status !== "cancelada") {
      summary.pending += 1;
      if (r.due_at) {
        const due = new Date(r.due_at).getTime();
        if (due < now) summary.overdue += 1;
        else if (due - now <= SOON_MS) summary.dueSoon += 1;
      }
    }

    byCompany.set(r.company_id, summary);
  }

  const companies = Array.from(byCompany.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR")
  );

  return (
    <AppShell
      user={{ name: profile.full_name, role: "colaborador" }}
      title="Minhas empresas"
      subtitle={`Bem-vindo, ${profile.full_name}`}
    >
      {error ? (
        <div className="rounded-xl border border-red-300/60 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Erro ao carregar suas tarefas: {error.message}
        </div>
      ) : companies.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-12 text-center text-fg-subtle shadow-card">
          Você ainda não tem tarefas atribuídas.
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {companies.map((c) => {
            const percent =
              c.total > 0 ? Math.round((c.done / c.total) * 100) : 0;
            return (
              <li key={c.id}>
                <Link
                  href={`/colaborador/${c.id}`}
                  className="group block rounded-xl border border-line bg-surface p-5 shadow-card transition hover:-translate-y-0.5 hover:border-risd/40 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-semibold text-fg group-hover:text-risd">
                      {c.name}
                    </h2>
                    <span className="text-fg-subtle transition group-hover:translate-x-0.5 group-hover:text-risd">
                      →
                    </span>
                  </div>

                  <div className="mt-4">
                    <div className="mb-1.5 flex items-center justify-between text-xs text-fg-muted">
                      <span className="font-mono tabular-nums">
                        {percent}% concluído
                      </span>
                      <span className="font-mono tabular-nums">
                        {c.done}/{c.total}
                      </span>
                    </div>
                    <div
                      className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
                      role="progressbar"
                      aria-valuenow={percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="h-full rounded-full bg-risd transition-all"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-fg-muted">
                      {c.pending} pendente{c.pending === 1 ? "" : "s"}
                    </span>
                    {c.overdue > 0 && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300">
                        {c.overdue} atrasada{c.overdue === 1 ? "" : "s"}
                      </span>
                    )}
                    {c.dueSoon > 0 && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                        {c.dueSoon} vencendo em 24h
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}

import Link from "next/link";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { TaskStatus } from "@/lib/types";
import NewTaskForm from "@/app/admin/tarefas/NewTaskForm";

type Option = { id: string; name: string };
type PersonOption = { id: string; full_name: string; email: string };

type InstanceRow = {
  company_id: string;
  status: TaskStatus;
  due_at: string | null;
};

type CompanySummary = {
  id: string;
  name: string;
  total: number;
  done: number;
  pending: number;
  overdue: number;
};

export default async function ConsultorPage() {
  const { supabase, profile } = await guardRole(["consultor"]);

  const [{ data: companiesData }, { data: collaboratorsData }, { data: instancesData, error }] =
    await Promise.all([
      // RLS (companies_select) limita às empresas atribuídas a este consultor.
      supabase.from("companies").select("id, name").order("name", { ascending: true }),
      supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("role", "colaborador")
        .order("full_name", { ascending: true }),
      // RLS (ti_select) limita às instâncias das empresas dele.
      supabase.from("task_instances").select("company_id, status, due_at"),
    ]);

  const companies = (companiesData as Option[]) ?? [];
  const collaborators = (collaboratorsData as PersonOption[]) ?? [];
  const instances = (instancesData as InstanceRow[]) ?? [];

  const now = Date.now();

  const summaries = new Map<string, CompanySummary>();
  for (const c of companies) {
    summaries.set(c.id, {
      id: c.id,
      name: c.name,
      total: 0,
      done: 0,
      pending: 0,
      overdue: 0,
    });
  }
  for (const r of instances) {
    const s = summaries.get(r.company_id);
    if (!s) continue;
    s.total += 1;
    if (r.status === "finalizada") {
      s.done += 1;
    } else if (r.status !== "cancelada") {
      s.pending += 1;
      if (r.due_at && new Date(r.due_at).getTime() < now) s.overdue += 1;
    }
  }

  const companyList = Array.from(summaries.values());
  const canCreate = companies.length > 0 && collaborators.length > 0;

  return (
    <AppShell
      user={{ name: profile.full_name, role: "consultor", avatarUrl: profile.avatarUrl }}
      title="Painel do Consultor"
      subtitle={`Bem-vindo, ${profile.full_name}`}
    >
      {companies.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-12 text-center text-fg-subtle shadow-card">
          Você ainda não tem empresas atribuídas. Peça ao administrador para
          vincular você a uma empresa.
        </div>
      ) : (
        <>
          {!canCreate && collaborators.length === 0 && (
            <div className="mb-6 rounded-xl border border-risd/30 bg-brand-tint px-4 py-3 text-sm text-fg">
              Ainda não há colaboradores cadastrados para atribuir tarefas. Peça
              ao administrador para liberar pelo menos um colaborador.
            </div>
          )}

          {canCreate && (
            <NewTaskForm companies={companies} collaborators={collaborators} />
          )}

          <h2 className="mb-3 mt-2 text-sm font-medium text-fg-muted">
            Minhas empresas
          </h2>

          {error ? (
            <div className="rounded-xl border border-red-300/60 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              Erro ao carregar o progresso: {error.message}
            </div>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {companyList.map((c) => {
                const percent =
                  c.total > 0 ? Math.round((c.done / c.total) * 100) : 0;
                return (
                  <li key={c.id}>
                    <Link
                      href={`/consultor/${c.id}`}
                      className="group block rounded-xl border border-line bg-surface p-5 shadow-card transition hover:-translate-y-0.5 hover:border-risd/40 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-semibold text-fg group-hover:text-risd">
                          {c.name}
                        </h3>
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
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </AppShell>
  );
}

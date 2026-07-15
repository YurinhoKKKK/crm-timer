import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { TaskStatus } from "@/lib/types";
import NewTaskForm from "@/app/admin/tarefas/NewTaskForm";
import CompanySummaryGrid, {
  type CompanyCardItem,
} from "@/components/CompanySummaryGrid";
import { withSelf } from "@/lib/people";

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
        // Admins também podem ser responsáveis de tarefas.
        .in("role", ["colaborador", "admin"])
        .order("full_name", { ascending: true }),
      // RLS (ti_select) limita às instâncias das empresas dele.
      supabase.from("task_instances").select("company_id, status, due_at"),
    ]);

  const companies = (companiesData as Option[]) ?? [];
  // O consultor também pode se atribuir como responsável de tarefas (Passo 14).
  const collaborators = withSelf(
    (collaboratorsData as PersonOption[]) ?? [],
    profile
  );
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
            <CompanySummaryGrid
              items={companyList.map(
                (c): CompanyCardItem => ({
                  id: c.id,
                  name: c.name,
                  href: `/consultor/${c.id}`,
                  done: c.done,
                  total: c.total,
                  pending: c.pending,
                  overdue: c.overdue,
                })
              )}
            />
          )}
        </>
      )}
    </AppShell>
  );
}

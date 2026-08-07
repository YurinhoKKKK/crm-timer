import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import NewTaskForm from "@/app/admin/tarefas/NewTaskForm";
import CompanySummaryGrid, {
  type CompanyCardItem,
} from "@/components/CompanySummaryGrid";
import { withSelf } from "@/lib/people";
import { perfRoute } from "@/lib/perf";

type Option = { id: string; name: string };
type PersonOption = { id: string; full_name: string; email: string };

type CompanyCountRow = {
  company_id: string;
  total: number;
  done: number;
  pending: number;
  overdue: number;
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

  // O acompanhamento vem JUNTO das consultas que já existiam, em paralelo (uma
  // ida a mais ao banco no total, nunca uma por card). A MESMA RPC da página
  // /acompanhamento (fonte única): SECURITY INVOKER escopada por companies_select
  // ⇒ devolve só as empresas deste consultor. Período/sentido não afetam o
  // days_since da badge; usamos os padrões.
  const perf = perfRoute("/consultor (painel)");
  const [
    { data: companiesData },
    { data: collaboratorsData },
    { data: countData, error },
    { data: followupData },
  ] = await Promise.all([
    // RLS (companies_select) limita às empresas atribuídas a este consultor.
    perf.timed(
      "companies",
      supabase.from("companies").select("id, name").order("name", { ascending: true })
    ),
    perf.timed(
      "profiles",
      supabase
        .from("profiles")
        .select("id, full_name, email")
        // Admins também podem ser responsáveis de tarefas.
        .in("role", ["colaborador", "admin"])
        .order("full_name", { ascending: true })
    ),
    // Contagens por empresa AGREGADAS NO BANCO (não contando linhas em JS, que
    // trunca em 1000 do PostgREST — carteira grande zeraria empresas em
    // silêncio). RLS (ti_select) limita às empresas dele. Sem período aqui.
    perf.timed(
      "rpc company_task_counts",
      supabase.rpc("company_task_counts", { p_start: null })
    ),
    // Semáforo de contato por empresa (mesma fonte da /acompanhamento).
    perf.timed(
      "rpc client_followup (badge de contato)",
      supabase.rpc("client_followup", { p_period_days: 30, p_desc: true })
    ),
  ]);
  perf.done();

  const companies = (companiesData as Option[]) ?? [];

  // Mapa empresa → dias desde o último contato (null = nunca). A RPC já é
  // escopada pela RLS, então nunca traz empresa fora da carteira do consultor.
  const contactDays = new Map<string, number | null>(
    ((followupData as { company_id: string; days_since: number | null }[]) ?? []).map(
      (r) => [r.company_id, r.days_since]
    )
  );
  // O consultor também pode se atribuir como responsável de tarefas (Passo 14).
  const collaborators = withSelf(
    (collaboratorsData as PersonOption[]) ?? [],
    profile
  );
  // Cada empresa da carteira começa zerada (mesmo as sem tarefa) e recebe as
  // contagens do banco. Empresas sem tarefa simplesmente ficam em 0.
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
  for (const r of (countData as CompanyCountRow[]) ?? []) {
    const s = summaries.get(r.company_id);
    if (!s) continue;
    s.total = Number(r.total);
    s.done = Number(r.done);
    s.pending = Number(r.pending);
    s.overdue = Number(r.overdue);
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
                  contact: { days: contactDays.get(c.id) ?? null },
                })
              )}
            />
          )}
        </>
      )}
    </AppShell>
  );
}

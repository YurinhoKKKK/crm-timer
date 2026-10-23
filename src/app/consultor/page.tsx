import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import NewTaskForm from "@/app/admin/tarefas/NewTaskForm";
import CompanySummaryGrid, {
  type CompanyCardItem,
} from "@/components/CompanySummaryGrid";
import {
  withSelf,
  loadResponsiblesByCompany,
  loadResponsibleChipsByCompany,
} from "@/lib/people";
import { loadCompanyNoteCounts } from "@/lib/notes";
import { loadStartedOnByCompany } from "@/lib/company-details";
import {
  loadCompanyGroups,
  pausedGroupNamesByCompany,
  resolveCompanyGroupId,
} from "@/lib/company-groups";
import { perfRoute } from "@/lib/perf";
import { currentMonth, monthToDate, type DayColor } from "@/lib/followup";

type PersonOption = { id: string; full_name: string; email: string };

// Empresa como vem do banco para este painel: id + nome + grupo (para as seções).
type CompanyRow = { id: string; name: string; group_id: string | null };

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
  // /acompanhamento (fonte única): followup_board é SECURITY DEFINER escopado por
  // dentro ⇒ devolve só as empresas de grupo ATIVO deste consultor, com a COR DO
  // DIA pronta. Empresa fora de grupo ativo não vem (⇒ card sem badge).
  const perf = perfRoute("/consultor (painel)");
  const [
    { data: companiesData },
    { data: collaboratorsData },
    { data: countData, error },
    { data: followupData },
    noteCounts,
    startedOnByCompany,
    responsiblesByCompany,
    groups,
  ] = await Promise.all([
    // RLS (companies_select) limita às empresas atribuídas a este consultor.
    // group_id alimenta as seções por grupo (resolveCompanyGroupId).
    perf.timed(
      "companies",
      supabase
        .from("companies")
        .select("id, name, group_id")
        .order("name", { ascending: true })
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
    // Semáforo de contato por empresa (cor do dia; mesma fonte da /acompanhamento).
    // O badge usa sempre o MÊS ATUAL (cor do dia relevante).
    perf.timed(
      "rpc followup_board (badge de contato)",
      supabase.rpc("followup_board", { p_month: monthToDate(currentMonth()) })
    ),
    // Contagem de anotações por empresa (balão de atalho), agregada no banco.
    perf.timed("rpc company_note_counts", loadCompanyNoteCounts(supabase)),
    // Início do contrato por empresa (etiqueta derivada "Cliente Novo"), numa
    // consulta só. RLS cd_select limita à carteira do consultor — mesmo conjunto.
    perf.timed("company_details started_on", loadStartedOnByCompany(supabase)),
    // Âncora (0090): responsáveis por empresa (RLS limita à carteira do consultor).
    perf.timed(
      "company_collaborators (responsáveis por empresa)",
      loadResponsiblesByCompany(supabase)
    ),
    // Grupos (0059 + kind 0095) — legíveis pelo consultor desde a 0099. Dão a
    // ordem, a cor e o kind das seções (grupo parado nasce recolhido e avisa ao
    // criar tarefa). A RLS de companies NÃO muda: só deixa de esconder as paradas.
    perf.timed("company_groups (seções)", loadCompanyGroups(supabase)),
  ]);
  perf.done();

  const companyRows = (companiesData as CompanyRow[]) ?? [];
  // Balões de responsáveis (consultores + colaboradores) por empresa — uma ida
  // agregada (RPC company_responsibles), escopada às empresas que o consultor
  // alcança. Depende dos ids, por isso vem após o Promise.all.
  const responsibleChips = await loadResponsibleChipsByCompany(
    supabase,
    companyRows.map((c) => c.id)
  );
  // Empresa → grupo (ponto único de leitura de group_id) e empresa → nome do
  // grupo PARADO (alimenta o aviso de nova tarefa). Nenhuma empresa some: as
  // paradas agora aparecem na sua seção em vez de serem escondidas.
  const groupByCompany = new Map<string, string | null>();
  for (const c of companyRows) groupByCompany.set(c.id, resolveCompanyGroupId(c));
  const pausedGroupByCompany = pausedGroupNamesByCompany(groupByCompany, groups);

  // Lista para o seletor de "Nova tarefa" (id + nome).
  const companies = companyRows.map((c) => ({ id: c.id, name: c.name }));

  // Mapa empresa → COR DO DIA relevante. A RPC já é escopada por dentro, e só
  // traz empresas de grupo ativo da carteira do consultor; as demais ficam de
  // fora do mapa ⇒ o card não mostra badge de contato.
  const contactColor = new Map<string, DayColor>(
    ((followupData as { company_id: string; color: DayColor }[]) ?? []).map((r) => [
      r.company_id,
      r.color,
    ])
  );
  // O consultor também pode se atribuir como responsável de tarefas (Passo 14).
  const collaborators = withSelf(
    (collaboratorsData as PersonOption[]) ?? [],
    profile
  );
  // Cada empresa da carteira começa zerada (mesmo as sem tarefa) e recebe as
  // contagens do banco. Empresas sem tarefa simplesmente ficam em 0.
  const summaries = new Map<string, CompanySummary>();
  for (const c of companyRows) {
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
            <NewTaskForm
              companies={companies}
              collaborators={collaborators}
              responsiblesByCompany={responsiblesByCompany}
              pausedGroupByCompany={pausedGroupByCompany}
            />
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
              viewerId={profile.id}
              groups={groups}
              collapseKey="crm:consultor:grupos-recolhidos"
              items={companyList.map(
                (c): CompanyCardItem => ({
                  id: c.id,
                  name: c.name,
                  href: `/consultor/${c.id}`,
                  done: c.done,
                  total: c.total,
                  pending: c.pending,
                  overdue: c.overdue,
                  contact: contactColor.has(c.id)
                    ? { color: contactColor.get(c.id)! }
                    : undefined,
                  noteCount: noteCounts.get(c.id) ?? 0,
                  startedOn: startedOnByCompany.get(c.id) ?? null,
                  groupId: groupByCompany.get(c.id) ?? null,
                  consultants: responsibleChips.get(c.id)?.consultants ?? [],
                  collaborators: responsibleChips.get(c.id)?.collaborators ?? [],
                })
              )}
            />
          )}
        </>
      )}
    </AppShell>
  );
}

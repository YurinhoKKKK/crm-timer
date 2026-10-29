import { notFound } from "next/navigation";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import Avatar from "@/components/Avatar";
import { avatarUrl } from "@/lib/avatar";
import { formatDuration, formatDue } from "@/lib/format";
import { STATUS_META } from "@/lib/status";
import type { SelectOption } from "@/components/ListControls";
import TaskDetailLink from "@/components/TaskDetailLink";
import CollaboratorTaskList from "./CollaboratorTaskList";
import RecentActivities from "./RecentActivities";
import CollaboratorAbsences from "./CollaboratorAbsences";
import {
  loadCollaboratorTasks,
  loadCollaboratorActivities,
} from "./actions";
import { normalizeOrder, type TypeOption } from "./collaborator-tasks";
import { type CompanyCategoryTime } from "../../CategoryTimeByCompanyChart";
import CategoryTimeByCompanyChartLazy from "../../CategoryTimeByCompanyChartLazy";
import PeriodPicker from "@/components/PeriodPicker";
import {
  resolvePeriodValue,
  periodValueQuery,
  periodPhrase,
  brtToday,
  brtYesterday,
  DASHBOARD_PERIOD_CONFIG,
} from "@/lib/period";
import { STANDARD_KEY } from "@/lib/task-category";

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrador",
  consultor: "Consultor",
  colaborador: "Colaborador",
  pending: "Pendente",
};

function firstOf(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function CollaboratorDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { supabase, profile } = await guardRole(["admin"]);

  const sp = searchParams ?? {};
  const period = resolvePeriodValue(sp, DASHBOARD_PERIOD_CONFIG);
  const start = period.start;
  const end = period.end;

  // Filtros da LISTA (namespaced na URL; ver CollaboratorTaskList). Lidos aqui
  // para a primeira página renderizar já coerente com o link (reload/voltar).
  const listFilters = {
    status: firstOf(sp.fstatus),
    companyId: firstOf(sp.fempresa),
    type: firstOf(sp.ftipo),
    search: firstOf(sp.fbusca),
    order: normalizeOrder(firstOf(sp.fordem) || undefined),
  };

  // Perfil do colaborador (RLS: is_admin() libera leitura de qualquer perfil).
  const { data: personData } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, avatar_path")
    .eq("id", params.id)
    .single();

  if (!personData) notFound();
  const person = personData as {
    id: string;
    full_name: string | null;
    email: string;
    role: string;
    avatar_path: string | null;
  };
  const personName = person.full_name || person.email;

  const [
    firstPage,
    facetsRes,
    pendingRes,
    activitiesRes,
    { data: timeByCompanyData },
    { data: countData },
    { data: companyCategoryData },
    { data: companyStandardData },
    { data: absencesData },
  ] = await Promise.all([
    // Primeira página da lista de tarefas (paginada no banco, migration 0163).
    loadCollaboratorTasks({
      collaboratorId: params.id,
      start,
      end,
      ...listFilters,
      limit: 50,
      offset: 0,
    }),
    // Empresas e tipos para os filtros (não derivados da página).
    supabase.rpc("collaborator_task_facets", {
      p_collaborator: params.id,
      p_start: start,
      p_end: end,
    }),
    // Atrasadas e pendentes (consulta própria, sem teto).
    supabase.rpc("collaborator_pending_tasks", {
      p_collaborator: params.id,
      p_start: start,
      p_end: end,
    }),
    // Atividades recentes (início E fim do período respeitados).
    loadCollaboratorActivities({
      collaboratorId: params.id,
      start,
      end,
      offset: 0,
      limit: 30,
    }),
    // Tempo TRABALHADO no período por empresa (time_entries por started_at BRT).
    supabase.rpc("time_by_company", { p_start: start, p_collaborator: params.id, p_end: end }),
    // Contagens do cabeçalho (total/concluídas/atrasadas) agregadas no banco.
    supabase.rpc("task_status_counts", { p_start: start, p_collaborator: params.id, p_end: end }),
    // Tempo por (empresa, categoria) — fonte do gráfico "Tempo por empresa".
    supabase.rpc("time_by_company_category", {
      p_start: start,
      p_collaborator: params.id,
      p_end: end,
    }),
    // Tempo das tarefas padrão (diárias) — a faixa opcional do gráfico.
    supabase.rpc("time_by_company_standard", {
      p_start: start,
      p_collaborator: params.id,
      p_end: end,
    }),
    // Ausências do colaborador (admin-only; afetam o Aproveitamento).
    supabase
      .from("collaborator_absences")
      .select("id, start_date, end_date")
      .eq("collaborator_id", params.id)
      .order("start_date", { ascending: false }),
  ]);

  const headerCounts = (countData as
    | { total: number; finalizada: number; overdue: number }[]
    | null)?.[0];
  const timeRows =
    (timeByCompanyData as { company_id: string; seconds: number }[]) ?? [];

  // --- Métricas do cabeçalho (inalteradas: contagens no banco, tempo por time_entries) ---
  const total = Number(headerCounts?.total ?? 0);
  const done = Number(headerCounts?.finalizada ?? 0);
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const totalSeconds = timeRows.reduce((s, r) => s + Number(r.seconds), 0);

  // Filtros da lista: empresas + tipos.
  const facets = (facetsRes.data as {
    companies: { id: string; name: string }[];
    types: TypeOption[];
  } | null) ?? { companies: [], types: [] };
  const companyOptions: SelectOption[] = (facets.companies ?? []).map((c) => ({
    value: c.id,
    label: c.name,
  }));
  const typeOptions: TypeOption[] = facets.types ?? [];

  // --- Tempo por empresa QUEBRADO POR CATEGORIA (mesmo gráfico da dashboard) ---
  // Nomes das empresas referenciadas pelo tempo (inclui empresas com trabalho no
  // período mas sem tarefa DATADA nele — o caso do bug histórico).
  const neededCompanyIds = new Set<string>();
  for (const r of timeRows) neededCompanyIds.add(r.company_id);
  for (const r of (companyCategoryData as { company_id: string }[] | null) ?? [])
    neededCompanyIds.add(r.company_id);
  for (const r of (companyStandardData as { company_id: string }[] | null) ?? [])
    neededCompanyIds.add(r.company_id);

  const companyNames = new Map<string, string>();
  if (neededCompanyIds.size > 0) {
    const { data: companyRows } = await supabase
      .from("companies")
      .select("id, name")
      .in("id", Array.from(neededCompanyIds));
    for (const c of (companyRows as { id: string; name: string }[]) ?? []) {
      companyNames.set(c.id, c.name);
    }
  }

  const catByCompany = new Map<
    string,
    { category: string; seconds: number }[]
  >();
  for (const r of (companyCategoryData as
    | { company_id: string; category: string; seconds: number }[]
    | null) ?? []) {
    const s = Number(r.seconds);
    if (s <= 0) continue;
    const list = catByCompany.get(r.company_id) ?? [];
    list.push({ category: r.category, seconds: s });
    catByCompany.set(r.company_id, list);
  }
  const toChartData = (
    byCompany: Map<string, { category: string; seconds: number }[]>
  ): CompanyCategoryTime[] =>
    Array.from(byCompany.entries())
      .map(([id, byCategory]) => ({
        id,
        name: companyNames.get(id) ?? "(empresa)",
        total: byCategory.reduce((sum, c) => sum + c.seconds, 0),
        byCategory,
      }))
      .filter((d) => d.total > 0)
      .sort((a, b) => b.total - a.total);

  const categoryChartData = toChartData(catByCompany);

  const standardByCompany = new Map<string, number>(
    ((companyStandardData as { company_id: string; seconds: number }[]) ?? [])
      .map((r) => [r.company_id, Number(r.seconds)])
  );
  const catWithStandard = new Map<
    string,
    { category: string; seconds: number }[]
  >();
  for (const [id, list] of Array.from(catByCompany.entries())) {
    catWithStandard.set(id, [...list]);
  }
  for (const [id, secs] of Array.from(standardByCompany.entries())) {
    if (secs <= 0) continue;
    const list = catWithStandard.get(id) ?? [];
    list.push({ category: STANDARD_KEY, seconds: secs });
    catWithStandard.set(id, list);
  }
  const categoryChartDataWithStandard = toChartData(catWithStandard);

  // --- Atrasadas / pendentes (consulta própria, sem teto — contador bate) ---
  type PendingRow = {
    id: string;
    title: string;
    status: "a_fazer" | "iniciada";
    due_at: string | null;
    company_name: string | null;
    overdue: boolean;
  };
  const pending = (pendingRes.data as PendingRow[] | null) ?? [];
  const overdueCount = pending.filter((p) => p.overdue).length;

  const absences = (
    (absencesData as { id: string; start_date: string; end_date: string }[]) ?? []
  ).map((a) => ({ id: a.id, startDate: a.start_date, endDate: a.end_date }));

  const todayYmd = brtToday();
  const yesterdayYmd = brtYesterday();

  const loadError = firstPage.error;

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title="Detalhe do colaborador"
      subtitle={personName}
      back={{ href: `/admin?${periodValueQuery(period)}`, label: "Dashboard" }}
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-fg-muted">
          Visão geral · {periodPhrase(period)}
        </h2>
        <PeriodPicker value={period} config={DASHBOARD_PERIOD_CONFIG} />
      </div>

      {loadError ? (
        <div className="rounded-xl border border-red-300/60 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Erro ao carregar os dados: {loadError}
        </div>
      ) : (
        <>
          {/* Cabeçalho: identidade + números gerais */}
          <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <Avatar
                  name={personName}
                  url={avatarUrl(person.avatar_path)}
                  size={56}
                />
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold text-fg">
                    {personName}
                  </p>
                  <p className="truncate text-sm text-fg-muted">{person.email}</p>
                  <span className="mt-1 inline-block rounded-full bg-brand-tint px-2 py-0.5 text-xs font-medium text-risd">
                    {ROLE_LABEL[person.role] ?? person.role}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:gap-6">
                <div className="rounded-xl border border-line bg-surface-2/40 p-4 sm:border-0 sm:bg-transparent sm:p-0 sm:text-right">
                  <p className="text-xs text-fg-muted">
                    Tempo trabalhado no período
                  </p>
                  <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-fg">
                    {formatDuration(totalSeconds)}
                  </p>
                </div>
                <div className="rounded-xl border border-line bg-surface-2/40 p-4 sm:border-0 sm:bg-transparent sm:p-0 sm:text-right">
                  <p className="text-xs text-fg-muted">Tarefas concluídas</p>
                  <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-risd">
                    {percent}%
                  </p>
                  <p className="text-xs text-fg-subtle">
                    {done}/{total} tarefas
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Ausências (afetam o Aproveitamento do Acompanhamento) */}
          <CollaboratorAbsences
            collaboratorId={params.id}
            absences={absences}
          />

          {/* Atrasadas / pendentes em destaque */}
          <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
            <div className="mb-4 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-fg">
                Atrasadas e pendentes
              </h3>
              {overdueCount > 0 && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300">
                  {overdueCount} atrasada{overdueCount === 1 ? "" : "s"}
                </span>
              )}
            </div>
            {pending.length === 0 ? (
              <p className="py-4 text-center text-sm text-fg-subtle">
                Nenhuma tarefa pendente no período. 🎉
              </p>
            ) : (
              <ul className="space-y-2">
                {pending.map((t) => {
                  const meta = STATUS_META[t.status];
                  return (
                    <li key={t.id}>
                      <TaskDetailLink
                        taskId={t.id}
                        className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-left transition hover:border-risd/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${
                          t.overdue
                            ? "border-red-300/60 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10"
                            : "border-line bg-surface-2/40"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-fg">{t.title}</span>
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${meta.badge}`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${meta.dot}`}
                              />
                              {meta.label}
                            </span>
                            {t.overdue && (
                              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300">
                                Atrasada
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-sm text-fg-muted">
                            {t.company_name ?? "(empresa removida)"}
                          </p>
                        </div>
                        <span
                          className={`text-xs ${
                            t.overdue
                              ? "font-medium text-red-600 dark:text-red-400"
                              : "text-fg-subtle"
                          }`}
                        >
                          Prazo: {formatDue(t.due_at)}
                        </span>
                      </TaskDetailLink>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Tempo por empresa */}
          <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
            <h3 className="mb-4 text-sm font-semibold text-fg">
              Tempo por empresa
            </h3>
            <CategoryTimeByCompanyChartLazy
              data={categoryChartData}
              dataWithStandard={categoryChartDataWithStandard}
              start={start}
              end={end}
              collaboratorId={person.id}
            />
          </section>

          {/* Lista de tarefas: paginada no banco, busca/filtros no servidor */}
          <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
            <h3 className="mb-1 text-sm font-semibold text-fg">
              Tarefas do período (prazo, trabalho ou atraso)
            </h3>
            <p className="mb-4 text-xs text-fg-subtle">
              Entram as tarefas com prazo no período, as trabalhadas no período
              (algum tempo lançado nele, mesmo com prazo à frente) e as atrasadas
              em aberto de antes dele — o tempo de cada uma é o total gasto nela. O &ldquo;Tempo trabalhado no período&rdquo; acima conta o
              trabalho pelo dia em que foi feito, então uma tarefa com prazo hoje
              pode ter sido trabalhada em outro dia. Como admin, você pode corrigir
              o tempo de uma tarefa (ex.: alguém esqueceu de pausar); toda correção
              fica registrada.
            </p>
            <CollaboratorTaskList
              collaboratorId={person.id}
              start={start}
              end={end}
              companies={companyOptions}
              types={typeOptions}
              initialTasks={firstPage.tasks}
              initialTotal={firstPage.total}
              todayYmd={todayYmd}
              yesterdayYmd={yesterdayYmd}
            />
          </section>

          {/* Histórico de atividades recentes */}
          <section className="mb-2 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
            <h3 className="mb-4 text-sm font-semibold text-fg">
              Atividades recentes
            </h3>
            <RecentActivities
              collaboratorId={person.id}
              start={start}
              end={end}
              initialActivities={activitiesRes.activities}
              initialHasMore={activitiesRes.hasMore}
            />
          </section>
        </>
      )}
    </AppShell>
  );
}

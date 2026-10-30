import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import PeriodPicker from "@/components/PeriodPicker";
import { resolvePeople } from "@/lib/creator";
import type { SelectOption } from "@/components/ListControls";
import {
  resolvePeriodValue,
  periodValueQuery,
  periodPhrase,
  DASHBOARD_PERIOD_CONFIG,
} from "@/lib/period";
import {
  normalizeListOrder,
  type SummaryPerson,
} from "./atrasos-shared";
import { loadAtrasosList } from "./actions";
import AtrasosTotals from "./AtrasosTotals";
import AtrasosSummary from "./AtrasosSummary";
import AtrasosList from "./AtrasosList";

function firstOf(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

// Linha crua dos blocos de resumo (atrasos_summary).
type RawSummaryPerson = {
  id: string;
  total: number;
  late: number;
  on_time_pct: number;
  completed_late: number;
  open_overdue: number;
  expired: number;
  median_delay_seconds: number;
  under24_late?: number;
};

export default async function AtrasosPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { supabase, profile } = await guardRole(["admin"]);

  const sp = searchParams ?? {};
  const period = resolvePeriodValue(sp, DASHBOARD_PERIOD_CONFIG);
  const start = period.start;
  const end = period.end;

  const filters = {
    status: firstOf(sp.fstatus),
    creatorId: firstOf(sp.fcriador),
    responsibleId: firstOf(sp.fresp),
    companyId: firstOf(sp.fempresa),
    type: firstOf(sp.ftipo),
    search: firstOf(sp.fbusca),
    order: normalizeListOrder(firstOf(sp.fordem) || undefined),
    includeStandard: firstOf(sp.fpadrao) === "1",
  };

  const [firstPage, { data: summaryData }, { data: facetsData }] = await Promise.all([
    loadAtrasosList({ start, end, ...filters, limit: 50, offset: 0 }),
    supabase.rpc("atrasos_summary", {
      p_start: start,
      p_end: end,
      p_include_standard: filters.includeStandard,
      p_status: filters.status || null,
      p_creator: filters.creatorId || null,
      p_responsible: filters.responsibleId || null,
      p_company: filters.companyId || null,
      p_type: filters.type || null,
      p_search: filters.search.trim() || null,
    }),
    supabase.rpc("atrasos_facets", {
      p_start: start,
      p_end: end,
      p_include_standard: filters.includeStandard,
    }),
  ]);

  const summary = (summaryData as {
    creators: RawSummaryPerson[];
    responsibles: RawSummaryPerson[];
  } | null) ?? { creators: [], responsibles: [] };

  // Foto/nome de quem aparece nos blocos (DEFINER display_profiles em lote).
  const people = await resolvePeople(supabase, [
    ...summary.creators.map((r) => r.id),
    ...summary.responsibles.map((r) => r.id),
  ]);

  const enrich = (r: RawSummaryPerson): SummaryPerson => {
    const p = people.get(r.id);
    return {
      id: r.id,
      name: p?.name ?? "(sem nome)",
      avatarUrl: p?.avatarUrl ?? null,
      total: Number(r.total),
      late: Number(r.late),
      onTimePct: Number(r.on_time_pct ?? 0),
      completedLate: Number(r.completed_late),
      openOverdue: Number(r.open_overdue),
      expired: Number(r.expired),
      medianDelaySeconds: Number(r.median_delay_seconds ?? 0),
      under24Late: r.under24_late == null ? undefined : Number(r.under24_late),
    };
  };
  const creators = summary.creators.map(enrich);
  const responsibles = summary.responsibles.map(enrich);

  // Três totais do recorte (cada tarefa tem exatamente um responsável → somar o
  // bloco de responsáveis dá os totais do universo filtrado).
  const totals = responsibles.reduce(
    (acc, r) => ({
      completedLate: acc.completedLate + r.completedLate,
      openOverdue: acc.openOverdue + r.openOverdue,
      expired: acc.expired + r.expired,
    }),
    { completedLate: 0, openOverdue: 0, expired: 0 }
  );

  // Opções dos filtros (facets do universo de atrasos no período).
  const facets = (facetsData as {
    companies: { id: string; name: string }[];
    types: { key: string; label: string }[];
    creators: { id: string; name: string }[];
    responsibles: { id: string; name: string }[];
  } | null) ?? { companies: [], types: [], creators: [], responsibles: [] };

  const companyOptions: SelectOption[] = (facets.companies ?? []).map((c) => ({
    value: c.id,
    label: c.name,
  }));
  const typeOptions: SelectOption[] = (facets.types ?? []).map((t) => ({
    value: t.key,
    label: t.label,
  }));
  const creatorOpts = (facets.creators ?? []).map((c) => ({ id: c.id, name: c.name }));
  const responsibleOpts = (facets.responsibles ?? []).map((c) => ({ id: c.id, name: c.name }));

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title="Atrasos"
      subtitle="Auditoria de atrasos por criador e responsável"
      back={{ href: `/admin?${periodValueQuery(period)}`, label: "Dashboard" }}
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-fg-muted">
          Atrasos · {periodPhrase(period)}
        </h2>
        <PeriodPicker value={period} config={DASHBOARD_PERIOD_CONFIG} />
      </div>

      {firstPage.error ? (
        <div className="rounded-xl border border-red-300/60 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Erro ao carregar os dados: {firstPage.error}
        </div>
      ) : (
        <>
          {/* Totais do recorte (clicáveis → drill-down global) */}
          <AtrasosTotals
            completedLate={totals.completedLate}
            openOverdue={totals.openOverdue}
            expired={totals.expired}
            includeStandard={filters.includeStandard}
            start={start}
            end={end}
          />

          {/* Blocos de resumo */}
          <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
            <h3 className="mb-4 text-sm font-semibold text-fg">Quem mais atrasa</h3>
            <AtrasosSummary
              creators={creators}
              responsibles={responsibles}
              start={start}
              end={end}
              includeStandard={filters.includeStandard}
            />
          </section>

          {/* Lista */}
          <section className="mb-2 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
            <h3 className="mb-1 text-sm font-semibold text-fg">Atrasos no período</h3>
            <p className="mb-4 text-xs text-fg-subtle">
              Tarefas que entraram pelo prazo no período e estão em atraso:
              concluídas fora do prazo, atrasadas em aberto ou expiradas. As
              tarefas padrão diárias ficam de fora até ligar o filtro. Clique numa
              tarefa para ver o detalhe e ajustar o tempo.
            </p>
            <AtrasosList
              start={start}
              end={end}
              companies={companyOptions}
              types={typeOptions}
              creators={creatorOpts}
              responsibles={responsibleOpts}
              initialRows={firstPage.rows}
              initialTotal={firstPage.total}
            />
          </section>
        </>
      )}
    </AppShell>
  );
}

"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { btnPrimary, btnSecondary } from "@/lib/ui";
import {
  fetchRevenueOverview,
  fetchRevenueInsights,
  fetchRevenueMonthDetail,
  setCompanyChannels,
} from "@/app/revenue-actions";
import RevenueForm from "@/components/company-central/RevenueForm";
import {
  SALES_CHANNELS,
  CHANNEL_LABEL,
  formatBRL,
  formatPercentBR,
  monthLabel,
  rangeLabel,
  yearOf,
  monthNumberOf,
  type RevenueInsights,
  type RevenueMonthDetail,
  type RevenueOverview,
  type RevenueRange,
  type SalesChannel,
  type Variation,
} from "@/lib/revenue";

// Estado do detalhe de um mês carregado sob demanda (autoria + histórico).
type DetailState = RevenueMonthDetail | "loading" | "error";

// Data/hora em Brasília (mesmo padrão do resto do sistema).
function formatDateTimeBR(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const RevenueChart = dynamic(
  () => import("@/components/company-central/RevenueChart"),
  {
    ssr: false,
    loading: () => (
      <div className="h-72 rounded-2xl border border-line bg-surface shadow-card" />
    ),
  }
);

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

// Aba "Faturamento" da central da empresa. Fatia 1 = canais + tabela + lançamento;
// Fatia 2 = cartões + gráfico + variação; e agora o filtro por período (mês de
// início/fim, persistido na URL). Só admin e consultor da empresa chegam aqui
// (rotas guardadas + RLS); o cliente NUNCA vê. Todo cálculo vem do banco.
export default function CompanyRevenue({
  companyId,
  initial,
  initialInsights,
  range,
  filterInvalid = false,
}: {
  companyId: string;
  initial: RevenueOverview;
  initialInsights: RevenueInsights;
  // Intervalo aplicado (validado no servidor). null/null = Tudo.
  range: RevenueRange;
  // Parâmetro de URL inválido (intervalo invertido/corrompido) → caiu em Tudo.
  filterInvalid?: boolean;
}) {
  const [overview, setOverview] = useState(initial);
  const [insights, setInsights] = useState(initialInsights);
  const [, startTransition] = useTransition();
  const [formOpen, setFormOpen] = useState(false);
  const [formMonth, setFormMonth] = useState(initial.currentMonth);
  const [openDetail, setOpenDetail] = useState<string | null>(null);
  // Autoria + histórico por mês, buscados sob demanda ao abrir o detalhe.
  const [details, setDetails] = useState<Record<string, DetailState>>({});

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeChannels = overview.activeChannels;
  const filtered = overview.filtered;
  const recordsInView = insights.summary.accumulated.monthsWithRecord;
  const rangeLbl = rangeLabel(overview.rangeStart, overview.rangeEnd);

  const displayChannels = useMemo<SalesChannel[]>(() => {
    const withHistory = new Set<SalesChannel>(
      Object.keys(overview.channelTotals) as SalesChannel[]
    );
    return SALES_CHANNELS.map((c) => c.value).filter(
      (c) => activeChannels.includes(c) || withHistory.has(c)
    );
  }, [activeChannels, overview.channelTotals]);

  const refresh = () => {
    // Uma correção muda a autoria/histórico: invalida o cache de detalhes para
    // que reabrir o mês refaça a busca.
    setDetails({});
    startTransition(async () => {
      const [nextOverview, nextInsights] = await Promise.all([
        fetchRevenueOverview(companyId, range),
        fetchRevenueInsights(companyId, range),
      ]);
      if (nextOverview) setOverview(nextOverview);
      if (nextInsights) setInsights(nextInsights);
    });
  };

  // Abre/fecha o detalhe de um mês e busca autoria + histórico na primeira
  // abertura (nunca no render inicial da tabela).
  const toggleDetail = (iso: string) => {
    const willOpen = openDetail !== iso;
    setOpenDetail(willOpen ? iso : null);
    if (willOpen && details[iso] === undefined) {
      setDetails((d) => ({ ...d, [iso]: "loading" }));
      fetchRevenueMonthDetail(companyId, iso).then((res) =>
        setDetails((d) => ({ ...d, [iso]: res ?? "error" }))
      );
    }
  };

  // Persistência do filtro na URL (padrão da página da empresa). Preserva os
  // demais parâmetros (aba, periodo) e mantém a aba em Faturamento.
  const pushParams = (mut: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(Array.from(searchParams.entries()));
    p.set("aba", "faturamento");
    mut(p);
    const qs = p.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const applyRange = (de: string, ate: string) =>
    pushParams((p) => {
      p.set("fatDe", de);
      p.set("fatAte", ate);
    });
  const clearRange = () =>
    pushParams((p) => {
      p.delete("fatDe");
      p.delete("fatAte");
    });

  const openLaunch = () => {
    setFormMonth(overview.currentMonth);
    setFormOpen(true);
  };
  const openEdit = (monthIso: string) => {
    setFormMonth(monthIso);
    setFormOpen(true);
  };

  const showData = !(filtered && recordsInView === 0);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-sm text-fg-muted">
          Faturamento <strong className="font-semibold text-fg">bruto</strong>{" "}
          por canal, mês a mês (antes de taxas e comissões).
        </p>
        <button
          type="button"
          onClick={openLaunch}
          disabled={activeChannels.length === 0}
          className={btnPrimary}
          title={
            activeChannels.length === 0
              ? "Marque ao menos um canal antes de lançar"
              : undefined
          }
        >
          Lançar mês
        </button>
      </div>

      {filterInvalid && (
        <p className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          O período informado no link é inválido — mostrando tudo.
        </p>
      )}

      <PeriodFilter
        overview={overview}
        range={range}
        filtered={filtered}
        onApply={applyRange}
        onClear={clearRange}
      />

      {recordsInView > 0 && (
        <>
          <SummaryCards insights={insights} filtered={filtered} rangeLbl={rangeLbl} />
          <RevenueChart overview={overview} />
        </>
      )}

      <ChannelConfig
        companyId={companyId}
        config={overview.channelConfig}
        onSaved={refresh}
      />

      {filtered && recordsInView === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-8 text-center shadow-card">
          <p className="text-fg-muted">
            Nenhum lançamento no período{" "}
            <strong className="font-semibold text-fg">{rangeLbl}</strong>.
          </p>
          <button
            type="button"
            onClick={clearRange}
            className={`${btnSecondary} mt-4`}
          >
            Limpar filtro
          </button>
        </div>
      ) : (
        <>
          {recordsInView === 0 && !filtered && (
            <div className="rounded-2xl border border-line bg-surface p-8 text-center shadow-card">
              <p className="text-fg-muted">
                {activeChannels.length === 0
                  ? "Marque os canais em que esta empresa vende e lance o primeiro mês para ver os insights."
                  : "Lance o primeiro mês de faturamento para ver o resumo e a progressão."}
              </p>
            </div>
          )}
          {showData &&
            (activeChannels.length > 0 || displayChannels.length > 0) && (
              <RevenueTable
                overview={overview}
                insights={insights}
                displayChannels={displayChannels}
                filtered={filtered}
                openDetail={openDetail}
                details={details}
                onToggleDetail={toggleDetail}
                onEdit={openEdit}
              />
            )}
        </>
      )}

      <RevenueForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        companyId={companyId}
        activeChannels={activeChannels}
        months={overview.months}
        currentMonth={overview.currentMonth}
        initialMonth={formMonth}
        onSaved={refresh}
      />
    </section>
  );
}

// --- Filtro por período ------------------------------------------------------
function PeriodFilter({
  overview,
  range,
  filtered,
  onApply,
  onClear,
}: {
  overview: RevenueOverview;
  range: RevenueRange;
  filtered: boolean;
  onApply: (de: string, ate: string) => void;
  onClear: () => void;
}) {
  // Defaults dos seletores: o intervalo aplicado, ou (em Tudo) todo o intervalo
  // de dados que o banco devolveu.
  const defStart = range.start ?? overview.rangeStart;
  const defEnd = range.end ?? overview.rangeEnd;
  const [sy, setSy] = useState(yearOf(defStart));
  const [sm, setSm] = useState(monthNumberOf(defStart));
  const [ey, setEy] = useState(yearOf(defEnd));
  const [em, setEm] = useState(monthNumberOf(defEnd));

  const years = useMemo(() => {
    const set = new Set<number>();
    const cy = yearOf(overview.currentMonth);
    for (let y = cy - 5; y <= cy + 1; y++) set.add(y);
    for (const m of overview.months) set.add(yearOf(m.month));
    set.add(yearOf(defStart));
    set.add(yearOf(defEnd));
    return Array.from(set).sort((a, b) => b - a);
  }, [overview.currentMonth, overview.months, defStart, defEnd]);

  const pad = (n: number) => String(n).padStart(2, "0");
  const apply = () => onApply(`${sy}-${pad(sm)}`, `${ey}-${pad(em)}`);
  // Intervalo invertido é barrado aqui também (o servidor já cairia em Tudo).
  const inverted = `${sy}-${pad(sm)}` > `${ey}-${pad(em)}`;

  const sel =
    "rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-fg shadow-sm transition focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-fg-subtle">
            De
          </label>
          <div className="flex gap-2">
            <select aria-label="Mês de início" value={sm} onChange={(e) => setSm(Number(e.target.value))} className={sel}>
              {MONTH_NAMES.map((n, i) => (
                <option key={i} value={i + 1}>{n}</option>
              ))}
            </select>
            <select aria-label="Ano de início" value={sy} onChange={(e) => setSy(Number(e.target.value))} className={sel}>
              {years.map((y) => (<option key={y} value={y}>{y}</option>))}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-fg-subtle">
            Até
          </label>
          <div className="flex gap-2">
            <select aria-label="Mês de fim" value={em} onChange={(e) => setEm(Number(e.target.value))} className={sel}>
              {MONTH_NAMES.map((n, i) => (
                <option key={i} value={i + 1}>{n}</option>
              ))}
            </select>
            <select aria-label="Ano de fim" value={ey} onChange={(e) => setEy(Number(e.target.value))} className={sel}>
              {years.map((y) => (<option key={y} value={y}>{y}</option>))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={apply}
            disabled={inverted}
            className={btnPrimary}
            title={inverted ? "O início não pode ser depois do fim" : undefined}
          >
            Aplicar
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={!filtered}
            className={btnSecondary}
          >
            Tudo
          </button>
        </div>

        <p className="ml-auto self-center text-sm text-fg-muted">
          {filtered ? (
            <>
              Período: <strong className="font-medium text-fg">{rangeLabel(overview.rangeStart, overview.rangeEnd)}</strong>
            </>
          ) : (
            <>Mostrando <strong className="font-medium text-fg">tudo</strong></>
          )}
        </p>
      </div>
      {inverted && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          O mês de início não pode ser depois do mês de fim.
        </p>
      )}
    </div>
  );
}

// --- Variação: texto SEMPRE junto da cor (verde sobe, vermelho desce) --------
function VariationText({
  variation,
  className = "",
  big = false,
}: {
  variation?: Variation | null;
  className?: string;
  big?: boolean;
}) {
  const phrase = (text: string) => (
    <span className={`text-fg-subtle ${big ? "text-base" : ""} ${className}`}>
      {text}
    </span>
  );

  if (!variation)
    return <span className={`text-fg-subtle ${big ? "text-2xl" : ""}`}>—</span>;
  if (variation.kind === "current") return phrase("mês em andamento");
  if (variation.kind === "no_base") return phrase("sem base de comparação");
  if (variation.kind === "first_positive")
    return phrase("primeiro mês com faturamento");

  const p = variation.percent ?? 0;
  const color =
    p > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : p < 0
      ? "text-red-600 dark:text-red-400"
      : "text-fg-muted";
  const arrow = big ? 18 : 12;
  return (
    <span
      className={`inline-flex items-center gap-1 font-semibold tabular-nums ${
        big ? "text-2xl" : "font-medium"
      } ${color} ${className}`}
    >
      {p !== 0 && (
        <svg
          width={arrow}
          height={arrow}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={p > 0 ? "" : "rotate-180"}
        >
          <path d="M12 19V5" />
          <path d="m5 12 7-7 7 7" />
        </svg>
      )}
      {formatPercentBR(p)}
    </span>
  );
}

// --- Cartões de resumo (com rótulo que acompanha o filtro) -------------------
function SummaryCards({
  insights,
  filtered,
  rangeLbl,
}: {
  insights: RevenueInsights;
  filtered: boolean;
  rangeLbl: string;
}) {
  const { lastClosed, variation, accumulated } = insights.summary;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
        <p className="text-xs uppercase tracking-wide text-fg-subtle">
          {filtered ? "Último mês fechado do período" : "Último mês fechado"}
        </p>
        {lastClosed ? (
          <>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-fg">
              {formatBRL(lastClosed.total)}
            </p>
            <p className="mt-0.5 text-sm text-fg-muted">
              {monthLabel(lastClosed.month)}
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-fg-subtle">Nenhum mês fechado ainda.</p>
        )}
      </div>

      <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
        <p className="text-xs uppercase tracking-wide text-fg-subtle">
          {filtered ? "Variação no período" : "Variação vs. mês anterior"}
        </p>
        <div className="mt-1">
          <VariationText variation={variation} big />
        </div>
        {lastClosed && (
          <p className="mt-0.5 text-sm text-fg-muted">
            {monthLabel(lastClosed.month)}
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
        <p className="text-xs uppercase tracking-wide text-fg-subtle">
          {filtered ? "Acumulado do período" : "Acumulado do projeto"}
        </p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-fg">
          {formatBRL(accumulated.total)}
        </p>
        <p className="mt-0.5 text-sm text-fg-muted">
          {filtered && <span className="text-fg">{rangeLbl} · </span>}
          {accumulated.monthsWithRecord}{" "}
          {accumulated.monthsWithRecord === 1
            ? "mês com registro"
            : "meses com registro"}
          {!filtered && " · inclui o mês em andamento"}
        </p>
      </div>
    </div>
  );
}

// --- Controle de canais da empresa (Fatia 1) --------------------------------
function ChannelConfig({
  companyId,
  config,
  onSaved,
}: {
  companyId: string;
  config: Partial<Record<SalesChannel, boolean>>;
  onSaved: () => void;
}) {
  const initialActive = useMemo(
    () =>
      new Set(SALES_CHANNELS.filter((c) => config[c.value]).map((c) => c.value)),
    [config]
  );
  const [draft, setDraft] = useState<Set<SalesChannel>>(initialActive);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(new Set(initialActive));
  }, [initialActive]);

  const dirty = useMemo(() => {
    if (draft.size !== initialActive.size) return true;
    return Array.from(draft).some((c) => !initialActive.has(c));
  }, [draft, initialActive]);

  const toggle = (channel: SalesChannel) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(channel)) next.delete(channel);
      else next.add(channel);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const res = await setCompanyChannels(companyId, Array.from(draft));
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onSaved();
  };

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-fg">Canais da empresa</h3>
          <p className="text-xs text-fg-muted">
            Marque onde esta empresa vende. Desmarcar só tira o canal do
            formulário — o histórico lançado continua na tabela e no gráfico.
          </p>
        </div>
        {dirty && (
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className={btnPrimary}
          >
            {saving ? "Salvando…" : "Salvar canais"}
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {SALES_CHANNELS.map((c) => {
          const on = draft.has(c.value);
          return (
            <button
              key={c.value}
              type="button"
              onClick={() => toggle(c.value)}
              aria-pressed={on}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${
                on
                  ? "border-risd bg-brand-tint text-fg"
                  : "border-line bg-surface text-fg-muted hover:border-risd/50"
              }`}
            >
              <span
                aria-hidden="true"
                className={`grid h-4 w-4 place-items-center rounded border ${
                  on ? "border-risd bg-risd text-white" : "border-line"
                }`}
              >
                {on && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </span>
              {c.label}
            </button>
          );
        })}
      </div>

      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

// --- Tabela dos meses --------------------------------------------------------
function RevenueTable({
  overview,
  insights,
  displayChannels,
  filtered,
  openDetail,
  details,
  onToggleDetail,
  onEdit,
}: {
  overview: RevenueOverview;
  insights: RevenueInsights;
  displayChannels: SalesChannel[];
  filtered: boolean;
  openDetail: string | null;
  details: Record<string, DetailState>;
  onToggleDetail: (iso: string) => void;
  onEdit: (iso: string) => void;
}) {
  const colCount = 3 + displayChannels.length; // Mês + canais + Total + Variação

  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card">
      <table className="w-full min-w-[680px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
            <th className="px-4 py-3 font-medium">Mês</th>
            {displayChannels.map((c) => (
              <th key={c} className="px-4 py-3 text-right font-medium">
                {CHANNEL_LABEL[c]}
              </th>
            ))}
            <th className="px-4 py-3 text-right font-medium">Total</th>
            <th className="px-4 py-3 text-right font-medium">Variação</th>
          </tr>
        </thead>
        <tbody>
          {overview.months.map((m) => (
            <MonthRows
              key={m.month}
              iso={m.month}
              isCurrent={m.month === overview.currentMonth}
              hasRecord={m.hasRecord}
              total={m.total}
              note={m.note}
              channels={m.channels}
              displayChannels={displayChannels}
              totalVariation={insights.totalVariations[m.month]}
              channelVariations={insights.channelVariations[m.month] ?? {}}
              detailOpen={openDetail === m.month}
              detail={details[m.month]}
              colCount={colCount}
              onToggleDetail={onToggleDetail}
              onEdit={onEdit}
            />
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-line-strong bg-surface-2/40 font-semibold text-fg">
            <td className="px-4 py-3">
              {filtered ? "Total do período por canal" : "Total por canal"}
            </td>
            {displayChannels.map((c) => (
              <td key={c} className="px-4 py-3 text-right tabular-nums">
                {overview.channelTotals[c] === undefined
                  ? "—"
                  : formatBRL(overview.channelTotals[c]!)}
              </td>
            ))}
            <td className="px-4 py-3 text-right tabular-nums">
              {formatBRL(overview.grandTotal)}
            </td>
            <td className="px-4 py-3" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function MonthRows({
  iso,
  isCurrent,
  hasRecord,
  total,
  note,
  channels,
  displayChannels,
  totalVariation,
  channelVariations,
  detailOpen,
  detail,
  colCount,
  onToggleDetail,
  onEdit,
}: {
  iso: string;
  isCurrent: boolean;
  hasRecord: boolean;
  total: number;
  note: string | null;
  channels: Partial<Record<SalesChannel, number>>;
  displayChannels: SalesChannel[];
  totalVariation?: Variation;
  channelVariations: Partial<Record<SalesChannel, Variation>>;
  detailOpen: boolean;
  detail: DetailState | undefined;
  colCount: number;
  onToggleDetail: (iso: string) => void;
  onEdit: (iso: string) => void;
}) {
  const detailChannels = displayChannels.filter(
    (c) => channels[c] !== undefined
  );
  const hasVariation = hasRecord && !isCurrent && detailChannels.length > 0;
  // Todo mês COM registro é expansível (para ver autoria e histórico), mesmo
  // sem variação (mês corrente) e sem observação.
  const canDetail = hasRecord;

  return (
    <>
      <tr className="border-b border-line last:border-0 hover:bg-surface-2/40">
        <td className="px-4 py-3 align-top">
          <div className="flex items-center gap-2">
            {hasRecord ? (
              <button
                type="button"
                onClick={() => onEdit(iso)}
                className="font-medium text-fg underline decoration-line underline-offset-2 transition hover:text-risd hover:decoration-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                {monthLabel(iso)}
              </button>
            ) : (
              <span className="font-medium text-fg-muted">{monthLabel(iso)}</span>
            )}
            {isCurrent && (
              <span className="rounded-full bg-brand-tint px-2 py-0.5 text-[11px] font-medium text-risd">
                em andamento
              </span>
            )}
          </div>
        </td>

        {hasRecord ? (
          <>
            {displayChannels.map((c) => (
              <td key={c} className="px-4 py-3 text-right tabular-nums text-fg">
                {channels[c] === undefined ? (
                  <span className="text-fg-subtle">—</span>
                ) : (
                  formatBRL(channels[c]!)
                )}
              </td>
            ))}
            <td className="px-4 py-3 text-right align-top">
              <div className="flex items-center justify-end gap-1.5">
                <span className="font-semibold tabular-nums text-fg">
                  {formatBRL(total)}
                </span>
                {note && (
                  <span
                    aria-hidden="true"
                    title="Tem observação"
                    className="text-fg-subtle"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </span>
                )}
              </div>
            </td>
            <td className="px-4 py-3 text-right align-top">
              {canDetail ? (
                <button
                  type="button"
                  onClick={() => onToggleDetail(iso)}
                  aria-expanded={detailOpen}
                  className="inline-flex items-center gap-1 rounded transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                  title="Ver autoria, histórico e variação do mês"
                >
                  <VariationText variation={totalVariation} />
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className={`text-fg-subtle transition ${detailOpen ? "rotate-180" : ""}`}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              ) : (
                <VariationText variation={totalVariation} />
              )}
            </td>
          </>
        ) : (
          <td colSpan={colCount - 1} className="px-4 py-3 text-right">
            <span className="mr-3 text-fg-subtle">sem registro</span>
            <button
              type="button"
              onClick={() => onEdit(iso)}
              className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-fg transition hover:border-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              Lançar
            </button>
          </td>
        )}
      </tr>

      {detailOpen && hasRecord && (
        <tr className="border-b border-line bg-surface-2/30">
          <td colSpan={colCount} className="px-4 py-4">
            <div className="space-y-4">
              {/* Autoria (Parte 1) — quem lançou e quem alterou por último. */}
              <MonthAuthorship detail={detail} />

              {hasVariation && (
                <div>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-fg-subtle">
                    Variação por canal
                  </p>
                  <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                    {detailChannels.map((c) => (
                      <span key={c} className="inline-flex items-center gap-1.5 text-sm">
                        <span className="text-fg-muted">{CHANNEL_LABEL[c]}:</span>
                        <VariationText variation={channelVariations[c]} />
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {note && (
                <p className="text-sm text-fg-muted">
                  <span className="font-medium text-fg">Observação:</span> {note}
                </p>
              )}

              {/* Histórico de alterações (Parte 4). */}
              <MonthHistory detail={detail} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// Autoria do mês: quem lançou/quando e quem alterou por último/quando (BRT).
// Lançamento antigo sem autor → "autor não registrado", nunca em branco.
function MonthAuthorship({ detail }: { detail: DetailState | undefined }) {
  if (detail === undefined || detail === "loading") {
    return <p className="text-xs text-fg-subtle">Carregando autoria…</p>;
  }
  if (detail === "error") {
    return (
      <p className="text-xs text-red-600 dark:text-red-400">
        Não foi possível carregar a autoria.
      </p>
    );
  }
  const created = detail.createdByName ?? "autor não registrado";
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-fg-muted">
      <span>
        <span className="font-medium text-fg">Lançado por</span> {created}
        {detail.createdAtISO ? ` em ${formatDateTimeBR(detail.createdAtISO)}` : ""}
      </span>
      {detail.updatedAtISO && (
        <span>
          <span className="font-medium text-fg">Última alteração por</span>{" "}
          {detail.updatedByName ?? "autor não registrado"} em{" "}
          {formatDateTimeBR(detail.updatedAtISO)}
        </span>
      )}
    </div>
  );
}

// Um valor de auditoria formatado; null vira o marcador do caso.
function auditAmount(value: number | null, whenNull: string): string {
  return value === null ? whenNull : formatBRL(value);
}

// Histórico de alterações do mês (append-only): uma linha por alteração, mais
// recente primeiro. Mês sem alteração nenhuma NÃO mostra bloco (evita vazio).
function MonthHistory({ detail }: { detail: DetailState | undefined }) {
  if (
    detail === undefined ||
    detail === "loading" ||
    detail === "error" ||
    detail.audit.length === 0
  ) {
    return null;
  }
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-fg-subtle">
        Histórico de alterações
      </p>
      <ul className="space-y-2">
        {detail.audit.map((a) => (
          <li
            key={a.id}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="tabular-nums text-fg-muted">
                {formatDateTimeBR(a.changedAtISO)}
              </span>
              <span className="text-fg-subtle">·</span>
              <span className="font-medium text-fg">
                {a.changedByName ?? "autor não registrado"}
              </span>
              <span className="text-fg-subtle">·</span>
              <span className="text-fg-muted">{CHANNEL_LABEL[a.channel]}</span>
            </div>
            <div className="mt-0.5 tabular-nums text-fg">
              de {auditAmount(a.oldAmount, "—")} para{" "}
              {auditAmount(a.newAmount, "removido")}
            </div>
            {a.reason && (
              <p className="mt-0.5 text-fg-muted">
                <span className="font-medium text-fg">Motivo:</span> {a.reason}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

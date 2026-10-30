"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Avatar from "@/components/Avatar";
import {
  formatSpan,
  type CellMetric,
  type SummaryPerson,
  type SummarySort,
} from "./atrasos-shared";
import AtrasosCellPanel, { type CellTarget } from "./AtrasosCellPanel";

// Resumo em ABAS (Por criador | Por responsável), uma tabela por vez em largura
// total. Aba na URL (aba=criador|responsavel, scroll:false). Células numéricas
// (Tarefas, Concluídas com atraso, Atrasadas em aberto, Expiradas e Prazo < 24h)
// abrem o painel de drill-down com exatamente aquelas tarefas; células com 0 não
// são clicáveis. Ordenação por coluna (padrão: Concluídas com atraso desc).

type Col = {
  key: SummarySort;
  label: string;
  metric?: CellMetric; // se definido, a célula é clicável e abre o painel
  creatorOnly?: boolean;
  standardOnly?: boolean; // Expiradas: só com o toggle ligado
};

const COLS: Col[] = [
  { key: "total", label: "Tarefas", metric: "total" },
  { key: "onTimePct", label: "No prazo (%)" },
  { key: "completedLate", label: "Concluídas com atraso", metric: "completed_late" },
  { key: "openOverdue", label: "Atrasadas em aberto", metric: "open_overdue" },
  { key: "expired", label: "Expiradas", metric: "expired", standardOnly: true },
  { key: "medianDelaySeconds", label: "Atraso mediano" },
  { key: "under24Late", label: "Prazo menor que 24 h", metric: "under24", creatorOnly: true },
];

function valueOf(p: SummaryPerson, key: SummarySort): number {
  switch (key) {
    case "total": return p.total;
    case "onTimePct": return p.onTimePct;
    case "completedLate": return p.completedLate;
    case "openOverdue": return p.openOverdue;
    case "expired": return p.expired;
    case "medianDelaySeconds": return p.medianDelaySeconds;
    case "under24Late": return p.under24Late ?? 0;
    case "late": return p.late;
  }
}

export default function AtrasosSummary({
  creators,
  responsibles,
  start,
  end,
  includeStandard,
}: {
  creators: SummaryPerson[];
  responsibles: SummaryPerson[];
  start: string | null;
  end: string | null;
  includeStandard: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const tab = searchParams.get("aba") === "responsavel" ? "responsavel" : "criador";
  const isCreator = tab === "criador";
  const people = isCreator ? creators : responsibles;

  // Ordenação local (padrão: concluídas com atraso desc).
  const [sort, setSort] = useState<SummarySort>("completedLate");
  const [asc, setAsc] = useState(false);

  const [panel, setPanel] = useState<CellTarget | null>(null);

  const setTab = useCallback(
    (next: "criador" | "responsavel") => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("aba", next);
      startTransition(() => {
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      });
    },
    [router, pathname, searchParams]
  );

  const cols = useMemo(
    () =>
      COLS.filter(
        (c) => (!c.creatorOnly || isCreator) && (!c.standardOnly || includeStandard)
      ),
    [isCreator, includeStandard]
  );

  const sorted = useMemo(() => {
    const rows = [...people];
    rows.sort((a, b) => {
      const d = valueOf(a, sort) - valueOf(b, sort);
      return asc ? d : -d;
    });
    return rows;
  }, [people, sort, asc]);

  function toggleSort(key: SummarySort) {
    if (key === sort) setAsc((v) => !v);
    else { setSort(key); setAsc(false); }
  }
  const arrow = (key: SummarySort) => (key === sort ? (asc ? " ↑" : " ↓") : "");

  function openCell(p: SummaryPerson, metric: CellMetric, value: number) {
    if (value <= 0) return;
    setPanel({
      dimension: isCreator ? "creator" : "responsible",
      person: { id: p.id, name: p.name, avatarUrl: p.avatarUrl },
      metric,
    });
  }

  const tabBtn = (key: "criador" | "responsavel", label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      aria-pressed={tab === key}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
        tab === key
          ? "bg-brand-tint text-risd"
          : "text-fg-muted hover:bg-surface-2/60 hover:text-fg"
      }`}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        {tabBtn("criador", "Por criador")}
        {tabBtn("responsavel", "Por responsável")}
        {isPending && <span className="text-xs text-fg-subtle">atualizando…</span>}
      </div>

      {people.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface-2/40 px-3 py-6 text-center text-sm text-fg-subtle">
          Ninguém com atrasos neste recorte.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                <th className="pb-2 pr-4 font-medium">
                  {isCreator ? "Criador" : "Responsável"}
                </th>
                {cols.map((c) => (
                  <th key={c.key} className="whitespace-nowrap pb-2 pl-4 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className="transition hover:text-risd"
                    >
                      {c.label}{arrow(c.key)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.id} className="border-b border-line/60 transition last:border-0 hover:bg-surface-2/40">
                  <td className="py-2.5 pr-4">
                    <span className="inline-flex items-center gap-2 whitespace-nowrap font-medium text-fg">
                      <Avatar name={p.name} url={p.avatarUrl} size={24} />
                      {p.name}
                    </span>
                  </td>
                  {cols.map((c) => {
                    const v = valueOf(p, c.key);
                    const alignRight = "py-2.5 pl-4 text-right font-mono tabular-nums whitespace-nowrap";
                    // Colunas não numéricas de exibição (percentual e mediana).
                    if (c.key === "onTimePct") {
                      return <td key={c.key} className={`${alignRight} text-fg-muted`}>{p.onTimePct}%</td>;
                    }
                    if (c.key === "medianDelaySeconds") {
                      return (
                        <td key={c.key} className={`${alignRight} text-fg-muted`}>
                          {p.completedLate > 0 ? formatSpan(p.medianDelaySeconds) : "—"}
                        </td>
                      );
                    }
                    // Colunas clicáveis (abrem o painel) quando > 0.
                    const tone =
                      c.key === "completedLate" ? "text-amber-600 dark:text-amber-400"
                      : c.key === "openOverdue" ? "text-red-600 dark:text-red-400"
                      : "text-fg";
                    if (c.metric && v > 0) {
                      return (
                        <td key={c.key} className={alignRight}>
                          <button
                            type="button"
                            onClick={() => openCell(p, c.metric!, v)}
                            className={`rounded font-semibold underline-offset-2 transition hover:underline hover:text-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${tone}`}
                            title="Ver estas tarefas"
                          >
                            {v}
                          </button>
                        </td>
                      );
                    }
                    return <td key={c.key} className={`${alignRight} text-fg-subtle`}>{v}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {panel && (
        <AtrasosCellPanel
          target={panel}
          start={start}
          end={end}
          onClose={() => setPanel(null)}
        />
      )}
    </>
  );
}

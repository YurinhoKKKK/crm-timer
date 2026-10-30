"use client";

import { useState } from "react";
import AtrasosCellPanel, { type CellTarget } from "./AtrasosCellPanel";
import type { CellMetric } from "./atrasos-shared";

// Três números do cabeçalho (totais do recorte). Clicáveis como as células do
// resumo: abrem o painel de drill-down no modo GLOBAL ('all' — sem pessoa fixa,
// a linha mostra responsável e criador). Expiradas só aparece com o toggle de
// tarefas padrão ligado. Valor 0 não é clicável.
type Total = { label: string; value: number; metric: CellMetric; tone: string; dot: string };

export default function AtrasosTotals({
  completedLate,
  openOverdue,
  expired,
  includeStandard,
  start,
  end,
}: {
  completedLate: number;
  openOverdue: number;
  expired: number;
  includeStandard: boolean;
  start: string | null;
  end: string | null;
}) {
  const [panel, setPanel] = useState<CellTarget | null>(null);

  const totals: Total[] = [
    { label: "Concluídas com atraso", value: completedLate, metric: "completed_late", tone: "text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
    { label: "Atrasadas em aberto", value: openOverdue, metric: "open_overdue", tone: "text-red-600 dark:text-red-400", dot: "bg-red-500" },
    ...(includeStandard
      ? [{ label: "Expiradas", value: expired, metric: "expired" as CellMetric, tone: "text-fg", dot: "bg-fg-subtle" }]
      : []),
  ];

  function open(metric: CellMetric, value: number) {
    if (value <= 0) return;
    setPanel({ dimension: "all", person: null, metric });
  }

  return (
    <>
      <div className={`mb-6 grid gap-4 ${totals.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        {totals.map((t) => {
          const clickable = t.value > 0;
          const inner = (
            <>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${t.dot}`} />
                <p className="text-sm text-fg-muted">{t.label}</p>
              </div>
              <p className={`mt-2 font-mono text-3xl font-semibold tabular-nums ${t.tone}`}>{t.value}</p>
              {clickable && (
                <p className="mt-2 text-xs text-fg-subtle transition group-hover:text-risd">Ver tarefas →</p>
              )}
            </>
          );
          return clickable ? (
            <button
              key={t.label}
              type="button"
              onClick={() => open(t.metric, t.value)}
              className="group rounded-xl border border-line bg-surface p-5 text-left shadow-card transition hover:-translate-y-0.5 hover:border-risd/40 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              {inner}
            </button>
          ) : (
            <div key={t.label} className="rounded-xl border border-line bg-surface p-5 shadow-card">
              {inner}
            </div>
          );
        })}
      </div>

      {panel && (
        <AtrasosCellPanel target={panel} start={start} end={end} onClose={() => setPanel(null)} />
      )}
    </>
  );
}

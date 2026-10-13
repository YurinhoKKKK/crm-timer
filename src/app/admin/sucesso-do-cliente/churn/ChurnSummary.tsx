import { formatBRL } from "@/lib/money-br";
import { CHURN_REASON_SUMMARY_ORDER, churnReasonLabel } from "@/lib/churn";

// Resumo do topo do Controle de Churn — do conjunto FILTRADO, agregado no banco
// (churn_summary). Dinheiro vem como texto decimal; aqui só se formata em BRL.

export type ChurnSummaryData = {
  total: number;
  cancelados: number;
  finalizados: number;
  mrrTotal: string;
  mrrCancelados: string;
  mrrFinalizados: string;
  lostRevenueTotal: string;
  reasons: Record<string, number>;
  nSemMrr: number;
  nSemPeriodo: number;
  nMotivoNaoInformado: number;
  nSemData: number;
};

function brl(text: string): string {
  return formatBRL(text) ?? "R$ 0,00";
}

function Tile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-fg">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-fg-muted">{sub}</p>}
    </div>
  );
}

export default function ChurnSummary({
  summary,
  showNoDate,
}: {
  summary: ChurnSummaryData;
  // Aviso "{n} sem data" só faz sentido em "Todos" (com período, os sem data ficam
  // de fora do conjunto).
  showNoDate: boolean;
}) {
  const s = summary;

  const reasonChips = CHURN_REASON_SUMMARY_ORDER.map((r) => ({
    label: churnReasonLabel(r),
    count: s.reasons[r] ?? 0,
  })).filter((r) => r.count > 0);

  const warnings: string[] = [];
  if (s.nSemMrr > 0) warnings.push(`${s.nSemMrr} sem MRR`);
  if (s.nSemPeriodo > 0) warnings.push(`${s.nSemPeriodo} sem período de contrato`);
  if (s.nMotivoNaoInformado > 0)
    warnings.push(`${s.nMotivoNaoInformado} com motivo não informado`);
  if (showNoDate && s.nSemData > 0) warnings.push(`${s.nSemData} sem data`);

  return (
    <section className="mb-4 space-y-3" aria-label="Resumo do período">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile
          label="Churns"
          value={String(s.total)}
          sub={`${s.cancelados} cancelado${s.cancelados === 1 ? "" : "s"} · ${s.finalizados} finalizado${s.finalizados === 1 ? "" : "s"}`}
        />
        <Tile
          label="MRR que saiu"
          value={brl(s.mrrTotal)}
          sub={`Cancelados ${brl(s.mrrCancelados)} · Finalizados ${brl(s.mrrFinalizados)}`}
        />
        <Tile
          label="Receita perdida"
          value={brl(s.lostRevenueTotal)}
          sub="Soma dos cancelados calculáveis"
        />
      </div>

      {reasonChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
            Por motivo:
          </span>
          {reasonChips.map((r) => (
            <span
              key={r.label}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-xs text-fg"
            >
              {r.label}
              <span className="font-semibold tabular-nums text-fg-muted">{r.count}</span>
            </span>
          ))}
        </div>
      )}

      {warnings.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          <span className="font-medium">Completude:</span> {warnings.join(" · ")}. O total ainda
          pode não ser confiável.
        </p>
      )}
    </section>
  );
}

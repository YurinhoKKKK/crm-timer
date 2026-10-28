"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import PeriodPicker from "@/components/PeriodPicker";
import { resolvePeriodValue } from "@/lib/period";
import {
  EXPORT_PERIOD_CONFIG,
  EXPORT_PERIOD_PARAM_KEYS,
  PDF_INCLUDE_ACTIVITIES,
  PDF_INCLUDE_NOTES,
} from "@/lib/historico-pdf";

// Botão "Exportar PDF" no cabeçalho do Histórico + modal de opções. Abre um
// modal do próprio app: período (PeriodPicker PADRÃO, params x* próprios, padrão
// "Tudo"), o que incluir (Atividades/Anotações) e "Gerar PDF". A geração roda no
// servidor (rota nodejs) com a sessão do usuário. O download é por fetch → blob
// para dar feedback e mostrar o aviso quando o período passa do teto (400).

export default function HistoricoPdfButton({
  companyId,
}: {
  companyId: string;
}) {
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [includeActivities, setIncludeActivities] = useState(true);
  const [includeNotes, setIncludeNotes] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Período do modal (params x* na URL) — não colide com os outros seletores.
  const periodValue = useMemo(
    () =>
      resolvePeriodValue(
        {
          xperiodo: searchParams.get("xperiodo") ?? undefined,
          xde: searchParams.get("xde") ?? undefined,
          xate: searchParams.get("xate") ?? undefined,
          xmes: searchParams.get("xmes") ?? undefined,
        },
        EXPORT_PERIOD_CONFIG
      ),
    [searchParams]
  );

  const canGenerate = includeActivities || includeNotes;

  async function generate() {
    if (!canGenerate || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      for (const k of EXPORT_PERIOD_PARAM_KEYS) {
        const v = searchParams.get(k);
        if (v) qs.set(k, v);
      }
      const inc = [
        includeActivities ? PDF_INCLUDE_ACTIVITIES : null,
        includeNotes ? PDF_INCLUDE_NOTES : null,
      ]
        .filter(Boolean)
        .join(",");
      qs.set("inc", inc);

      const res = await fetch(
        `/api/admin/empresas/${companyId}/historico-pdf?${qs.toString()}`
      );
      if (!res.ok) {
        let msg = "Não foi possível gerar o PDF.";
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
        } catch {
          /* resposta sem corpo JSON */
        }
        setError(msg);
        return;
      }

      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const match = cd.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] ?? "historico.pdf";

      const urlObj = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = urlObj;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(urlObj);
      setOpen(false);
    } catch {
      setError("Falha de rede ao gerar o PDF. Tente de novo.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-fg-muted transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="M7 10l5 5 5-5" />
          <path d="M12 15V3" />
        </svg>
        Exportar PDF
      </button>

      {open && (
        <div
          className="fixed inset-0 z-sheet flex items-center justify-center bg-black/40 p-4"
          onClick={() => !generating && setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Exportar histórico em PDF"
            className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-fg">
                  Exportar histórico em PDF
                </h4>
                <p className="mt-1 text-xs text-fg-subtle">
                  Linha do tempo única (atividades e anotações) em ordem
                  cronológica.
                </p>
              </div>
              <button
                type="button"
                onClick={() => !generating && setOpen(false)}
                aria-label="Fechar"
                className="rounded-lg p-1 text-fg-subtle transition hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Período */}
            <div className="mb-4">
              <span className="mb-2 block text-xs font-medium text-fg-muted">
                Período
              </span>
              <PeriodPicker value={periodValue} config={EXPORT_PERIOD_CONFIG} />
            </div>

            {/* O que incluir */}
            <div className="mb-5">
              <span className="mb-2 block text-xs font-medium text-fg-muted">
                O que incluir
              </span>
              <label className="mb-1.5 flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={includeActivities}
                  onChange={(e) => setIncludeActivities(e.target.checked)}
                  className="h-4 w-4 rounded border-line text-risd focus-visible:ring-risd"
                />
                Atividades
              </label>
              <label className="flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={includeNotes}
                  onChange={(e) => setIncludeNotes(e.target.checked)}
                  className="h-4 w-4 rounded border-line text-risd focus-visible:ring-risd"
                />
                Anotações
              </label>
              {!canGenerate && (
                <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                  Selecione ao menos um.
                </p>
              )}
            </div>

            {error && (
              <div className="mb-4 rounded-lg border border-red-300/60 bg-red-50 p-3 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => !generating && setOpen(false)}
                className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-fg-muted transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void generate()}
                disabled={!canGenerate || generating}
                className="inline-flex items-center gap-2 rounded-lg bg-risd px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-risd/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-1 focus-visible:ring-offset-surface disabled:opacity-60"
              >
                {generating ? "Gerando…" : "Gerar PDF"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

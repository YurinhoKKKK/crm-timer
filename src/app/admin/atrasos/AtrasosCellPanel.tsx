"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { Download, Loader2, X } from "lucide-react";
import Person from "@/components/Person";
import TaskDetailLink from "@/components/TaskDetailLink";
import { formatDue } from "@/lib/format";
import {
  CELL_SITUATION_META,
  METRIC_LABEL,
  PARAM,
  formatSpan,
  type CellMetric,
  type CellRow,
  type PanelDimension,
} from "./atrasos-shared";
import { loadCellTasks } from "./actions";

const PAGE_SIZE = 50;

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type CellTarget = {
  dimension: PanelDimension;
  // null quando dimension = 'all' (totais do cabeçalho, sem pessoa fixa).
  person: { id: string; name: string; avatarUrl: string | null } | null;
  metric: CellMetric;
};

export default function AtrasosCellPanel({
  target,
  start,
  end,
  onClose,
}: {
  target: CellTarget;
  start: string | null;
  end: string | null;
  onClose: () => void;
}) {
  const searchParams = useSearchParams();

  // Contexto da tela (mesmos filtros) lido da URL.
  const ctx = useMemo(() => {
    const sp = new URLSearchParams(searchParams.toString());
    return {
      includeStandard: sp.get(PARAM.standard) === "1",
      status: sp.get(PARAM.status) ?? "",
      creatorId: sp.get(PARAM.creator) ?? "",
      responsibleId: sp.get(PARAM.responsible) ?? "",
      companyId: sp.get(PARAM.company) ?? "",
      type: sp.get(PARAM.type) ?? "",
      search: sp.get(PARAM.search) ?? "",
    };
  }, [searchParams]);

  const [rows, setRows] = useState<CellRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    (offset: number) =>
      loadCellTasks({
        start,
        end,
        dimension: target.dimension,
        person: target.person?.id ?? "",
        metric: target.metric,
        ...ctx,
        limit: PAGE_SIZE,
        offset,
      }),
    [start, end, target.dimension, target.person?.id, target.metric, ctx]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPage(0).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.error) { setError(res.error); return; }
      setRows(res.rows);
      setTotal(res.total);
    });
    return () => { cancelled = true; };
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    setLoadingMore(true);
    fetchPage(rows.length).then((res) => {
      setLoadingMore(false);
      if (res.error) { setError(res.error); return; }
      setRows((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...res.rows.filter((r) => !seen.has(r.id))];
      });
      setTotal(res.total);
    });
  }, [fetchPage, rows.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  // "O outro lado" da relação: aba de criador → mostra o responsável, aba de
  // responsável → mostra o criador. No modo global ('all', totais do cabeçalho)
  // não há lado fixo, então a linha mostra OS DOIS.
  const dim = target.dimension;

  // Exportar exatamente este recorte: filtros atuais + alvo da célula.
  const exportParams = new URLSearchParams(searchParams.toString());
  exportParams.set("cdim", target.dimension);
  if (target.person) exportParams.set("cpers", target.person.id);
  else exportParams.delete("cpers");
  exportParams.set("cmet", target.metric);
  const exportHref = `/api/admin/atrasos/export?${exportParams.toString()}`;

  const hasMore = rows.length < total;

  return createPortal(
    <div className="fixed inset-0 z-sheet flex justify-end">
      <div className="absolute inset-0 bg-gunmetal/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${target.person ? target.person.name + " — " : ""}${METRIC_LABEL[target.metric]}`}
        className="relative flex h-full w-full max-w-xl flex-col overflow-hidden bg-surface shadow-pop"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line p-5">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-fg-subtle">
              {dim === "all"
                ? "Total do recorte"
                : `${dim === "creator" ? "Criador" : "Responsável"} · ${METRIC_LABEL[target.metric]}`}
            </p>
            <div className="mt-1 flex items-center gap-2 text-lg font-semibold text-fg">
              {target.person ? (
                <Person name={target.person.name} avatarUrl={target.person.avatarUrl} size={26} />
              ) : (
                <span>{METRIC_LABEL[target.metric]}</span>
              )}
              <span className="font-mono tabular-nums text-fg-muted">({total})</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ExportButton href={exportHref} />
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="rounded-lg p-1.5 text-fg-subtle transition hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {error ? (
            <p className="rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </p>
          ) : loading ? (
            <p className="py-10 text-center text-sm text-fg-subtle">Carregando…</p>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-fg-subtle">Nenhuma tarefa.</p>
          ) : (
            <ul className="space-y-3">
              {rows.map((r) => {
                const meta = CELL_SITUATION_META[r.situation];
                return (
                  <li key={r.id} className="rounded-xl border border-line bg-surface-2/30 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <TaskDetailLink
                          taskId={r.id}
                          className="font-medium text-fg transition hover:text-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                        >
                          {r.typeLabel}
                        </TaskDetailLink>
                        <p className="mt-0.5 text-sm text-fg-muted">{r.companyName}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
                          {(dim === "all" || dim === "creator") && (
                            <span className="inline-flex items-center gap-1">
                              Resp.:
                              <Person name={r.responsible.name} avatarUrl={r.responsible.avatarUrl} size={16} />
                            </span>
                          )}
                          {(dim === "all" || dim === "responsible") && (
                            <span className="inline-flex items-center gap-1">
                              Criador:
                              {r.creator.name ? (
                                <Person name={r.creator.name} avatarUrl={r.creator.avatarUrl} size={16} />
                              ) : (
                                <span>sistema</span>
                              )}
                            </span>
                          )}
                          <span>Criada {formatDateTime(r.createdAt)}</span>
                          <span>Prazo {formatDue(r.dueAt)}</span>
                          <span>Concedido {formatSpan(r.grantedSeconds)}</span>
                          {r.finishedAt && <span>Concluída {formatDateTime(r.finishedAt)}</span>}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${meta.badge}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                          {meta.label}
                        </span>
                        {r.delaySeconds != null && (
                          <p className="mt-1 whitespace-nowrap font-mono text-sm font-semibold tabular-nums text-fg">
                            {formatSpan(r.delaySeconds)}
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {hasMore && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg shadow-sm transition hover:border-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd disabled:opacity-60"
              >
                {loadingMore ? "Carregando…" : "Carregar mais"}{" "}
                <span className="text-fg-subtle">({total - rows.length} restante{total - rows.length === 1 ? "" : "s"})</span>
              </button>
            </div>
          )}
        </div>
      </aside>
    </div>,
    document.body
  );
}

function ExportButton({ href }: { href: string }) {
  const [loading, setLoading] = useState(false);
  async function handleExport() {
    setLoading(true);
    try {
      const res = await fetch(href);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] ?? "atrasos.xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      /* silencioso: o botão volta ao normal */
    } finally {
      setLoading(false);
    }
  }
  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-fg shadow-sm transition hover:border-risd/60 hover:text-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd disabled:opacity-60"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      Exportar estas tarefas
    </button>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// Painel lateral de HISTÓRICO — casca compartilhada pelos quadros CS e Tráfego.
// Genérico sobre o tipo da entrada E: quem chama injeta `load` (paginado, mais
// recente primeiro), e as funções puras que extraem chave, texto e horário de
// cada entrada. Aqui moram só a navegação (carregar/ carregar mais), o Esc, o
// portal e o layout — a descrição de cada registro é responsabilidade do chamador.

export type HistoryLoad<E> = (
  offset: number
) => Promise<{ entries: E[]; hasMore: boolean }>;

// 'AAAA-MM-DDTHH...' (ISO) → data+hora em horário de Brasília.
function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function HistoryPanel<E>({
  eyebrow,
  companyName,
  onClose,
  load,
  describe,
  getKey,
  getWhenISO,
  pageSize,
}: {
  eyebrow: string; // ex.: "Histórico — Tráfego"
  companyName: string;
  onClose: () => void;
  load: HistoryLoad<E>;
  describe: (entry: E) => string;
  getKey: (entry: E) => string | number;
  getWhenISO: (entry: E) => string;
  pageSize: number;
}) {
  const [entries, setEntries] = useState<E[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doLoad = useCallback((offset: number) => load(offset), [load]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    doLoad(0)
      .then((res) => {
        if (!active) return;
        setEntries(res.entries);
        setHasMore(res.hasMore);
      })
      .catch(() => active && setError("Não foi possível carregar o histórico."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [doLoad]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const res = await doLoad(entries.length);
      setEntries((prev) => [...prev, ...res.entries]);
      setHasMore(res.hasMore);
    } catch {
      setError("Não foi possível carregar mais.");
    } finally {
      setLoadingMore(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-overlay flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Histórico de ${companyName}`}
        className="relative flex h-full w-full flex-col overflow-hidden bg-surface shadow-pop sm:w-[34rem] sm:max-w-[90vw]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line p-5">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-fg-subtle">{eyebrow}</p>
            <h2 className="truncate text-lg font-semibold text-fg">{companyName}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar histórico"
            className="shrink-0 rounded-lg border border-line bg-surface px-2.5 py-1 text-fg-muted transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-fg-subtle">Carregando…</p>
          ) : error ? (
            <p role="alert" className="py-8 text-center text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : entries.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line bg-surface-2/30 p-6 text-center text-sm text-fg-subtle">
              Nenhuma alteração registrada ainda.
            </p>
          ) : (
            <>
              <ol className="space-y-2">
                {entries.map((e) => (
                  <li
                    key={getKey(e)}
                    className="rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-fg shadow-card"
                  >
                    <span>{describe(e)}</span>
                    <span className="mt-0.5 block text-xs tabular-nums text-fg-subtle">
                      {fmtWhen(getWhenISO(e))}
                    </span>
                  </li>
                ))}
              </ol>
              {hasMore && (
                <div className="mt-3 flex justify-center">
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg-muted transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd disabled:opacity-60"
                  >
                    {loadingMore ? "Carregando…" : `Carregar mais ${pageSize}`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </div>,
    document.body
  );
}

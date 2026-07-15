"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { STATUS_META, isOverdue } from "@/lib/status";
import { formatDuration } from "@/lib/format";
import Person from "@/components/Person";
import { loadGroupHistory, type GroupHistoryEntry } from "@/app/group-actions";
import type { GroupEntry, TaskGroup } from "@/lib/task-grouping";

// Linha de GRUPO das listas de tarefa: as ocorrências da mesma tarefa (mesmo
// template) condensadas num cabeçalho expansível. O cabeçalho carrega o resumo
// — total, "⚠ N atrasadas" (vermelho, impossível de passar despercebido),
// pendentes, finalizadas — e o período. Expandir mostra as instâncias por data;
// "ver mais" busca o histórico antigo sob demanda (server action, RLS).

// As linhas buscadas sob demanda (GroupHistoryEntry) não carregam templateId;
// para renderizar/linkar, basta o restante do formato.
type EntryLike = Omit<GroupEntry, "templateId">;

function formatTaskDate(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

// Linha compacta de uma ocorrência dentro do grupo (data · status · tempo).
function CompactEntry({
  entry,
  href,
}: {
  entry: EntryLike;
  href?: string;
}) {
  const meta = STATUS_META[entry.status];
  const overdue = isOverdue(entry.status, entry.due_at);
  const inner = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
      <span className="font-mono text-xs tabular-nums text-fg-muted">
        {formatTaskDate(entry.task_date)}
      </span>
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${meta.badge}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
        {meta.label}
      </span>
      {overdue && (
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300">
          Atrasada
        </span>
      )}
      <span className="text-xs text-fg-subtle">
        <span className="font-mono tabular-nums">
          {formatDuration(entry.total_seconds)}
        </span>
      </span>
      {entry.collaboratorName && (
        <Person
          name={entry.collaboratorName}
          avatarUrl={entry.collaboratorAvatarUrl}
          size={16}
        />
      )}
    </div>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="block transition hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-risd"
      >
        {inner}
      </Link>
    );
  }
  return inner;
}

export default function TaskGroupRow<T extends GroupEntry>({
  group,
  subtitle,
  hrefFor,
  renderItem,
  canLoadMore = true,
}: {
  group: TaskGroup<T>;
  // Ex.: nome da empresa, nas listas que misturam várias empresas.
  subtitle?: ReactNode;
  // Torna as ocorrências clicáveis (rota da instância no painel da lista).
  hrefFor?: (entry: EntryLike) => string;
  // Renderização customizada das instâncias CARREGADAS (ex.: linha com ajuste
  // de tempo no admin). As buscadas sob demanda usam sempre a linha compacta.
  renderItem?: (item: T) => ReactNode;
  canLoadMore?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [extra, setExtra] = useState<GroupHistoryEntry[]>([]);
  const [exhausted, setExhausted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadedClosed = group.items.filter(
    (i) => i.status === "finalizada" || i.status === "cancelada"
  );
  const remaining = Math.max(
    0,
    group.finalizadas +
      group.canceladas -
      loadedClosed.length -
      extra.length
  );
  const showLoadMore =
    canLoadMore && !exhausted && group.hasMore && remaining > 0;

  async function loadMore() {
    if (loading) return;
    setLoading(true);
    setError(null);
    // Cursor: a data mais antiga já exibida entre as fechadas (task_date é
    // única por template, então não há empates).
    const dates = [...loadedClosed, ...extra].map((i) => i.task_date);
    const cursor = dates.length > 0 ? dates.sort()[0] : null;
    const res = await loadGroupHistory(group.templateId, cursor);
    setLoading(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setExtra((prev) => [...prev, ...res.items]);
    if (!res.hasMore) setExhausted(true);
  }

  return (
    <div className="rounded-xl border border-line bg-surface shadow-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 rounded-xl p-4 text-left transition hover:border-risd/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {/* Ícone de pilha: sinaliza "várias ocorrências" */}
            <svg
              className="shrink-0 text-fg-subtle"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m12 2 9 4.9-9 4.9-9-4.9L12 2Z" />
              <path d="m3 11.9 9 4.9 9-4.9" />
              <path d="m3 16.9 9 4.9 9-4.9" />
            </svg>
            <span className="font-medium text-fg">{group.title}</span>
            <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-xs font-medium text-fg-muted">
              {group.total} ocorrência{group.total === 1 ? "" : "s"}
            </span>
            {group.atrasadas > 0 && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-300">
                ⚠ {group.atrasadas} atrasada{group.atrasadas === 1 ? "" : "s"}
              </span>
            )}
            {group.pendentes > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                {group.pendentes} pendente{group.pendentes === 1 ? "" : "s"}
              </span>
            )}
          </div>
          {subtitle && (
            <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>
          )}
          <p className="mt-1.5 text-xs text-fg-subtle">
            {formatTaskDate(group.firstDate)} – {formatTaskDate(group.lastDate)}
            {group.finalizadas > 0 && <> · {group.finalizadas} finalizada{group.finalizadas === 1 ? "" : "s"}</>}
            {group.canceladas > 0 && <> · {group.canceladas} cancelada{group.canceladas === 1 ? "" : "s"}</>}
          </p>
        </div>
        <svg
          className={`mt-1 shrink-0 text-fg-subtle transition-transform ${
            open ? "rotate-180" : ""
          }`}
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-line">
          {renderItem ? (
            <ul className="space-y-2 p-3">
              {group.items.map((it) => renderItem(it))}
            </ul>
          ) : (
            <div className="divide-y divide-line/60">
              {group.items.map((it) => (
                <CompactEntry
                  key={it.id}
                  entry={it}
                  href={hrefFor?.(it)}
                />
              ))}
            </div>
          )}

          {extra.length > 0 && (
            <div className="divide-y divide-line/60 border-t border-line/60">
              {extra.map((it) => (
                <CompactEntry key={it.id} entry={it} href={hrefFor?.(it)} />
              ))}
            </div>
          )}

          {error && (
            <p className="px-4 py-2 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          {showLoadMore && (
            <div className="border-t border-line/60 p-3 text-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loading}
                className="w-full rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg shadow-sm transition hover:border-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas sm:w-auto"
              >
                {loading ? (
                  "Carregando…"
                ) : (
                  <>
                    Ver mais no histórico{" "}
                    <span className="text-fg-subtle">
                      ({remaining} restante{remaining === 1 ? "" : "s"})
                    </span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

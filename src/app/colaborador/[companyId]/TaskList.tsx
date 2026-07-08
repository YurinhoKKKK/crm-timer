"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { TaskStatus } from "@/lib/types";
import { STATUS_META } from "@/lib/status";
import { formatDuration, formatDue } from "@/lib/format";
import { ShowMore, usePaged } from "@/components/ListControls";
import LabelChips from "@/components/LabelChips";
import type { Label } from "@/lib/labels";

export type TaskItem = {
  id: string;
  title: string;
  status: TaskStatus;
  due_at: string | null;
  total_seconds: number;
  created_at: string;
};

type SortKey = "antiga" | "recente" | "prazo";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "antiga", label: "Mais antiga" },
  { value: "recente", label: "Mais recente" },
  { value: "prazo", label: "Próximas do prazo" },
];

export default function TaskList({
  companyId,
  tasks,
  labels = [],
}: {
  companyId: string;
  tasks: TaskItem[];
  // Etiquetas da empresa — herdadas por todas as tarefas dela.
  labels?: Label[];
}) {
  const [sort, setSort] = useState<SortKey>("prazo");

  const now = Date.now();
  const SOON_MS = 24 * 60 * 60 * 1000;

  const sorted = useMemo(() => {
    const copy = [...tasks];
    copy.sort((a, b) => {
      if (sort === "antiga") {
        return a.created_at.localeCompare(b.created_at);
      }
      if (sort === "recente") {
        return b.created_at.localeCompare(a.created_at);
      }
      // prazo: due_at ascendente, sem prazo por último
      if (!a.due_at && !b.due_at) return 0;
      if (!a.due_at) return 1;
      if (!b.due_at) return -1;
      return a.due_at.localeCompare(b.due_at);
    });
    return copy;
  }, [tasks, sort]);

  const { visible, hasMore, remaining, showMore } = usePaged(sorted);

  if (tasks.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-12 text-center text-fg-subtle shadow-card">
        Nenhuma tarefa nesta empresa.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-fg-muted">
          {tasks.length} tarefa{tasks.length === 1 ? "" : "s"}
        </h2>
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          Ordenar:
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-fg shadow-sm transition focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ul className="space-y-3">
        {visible.map((t) => {
          const meta = STATUS_META[t.status];
          const open = t.status !== "finalizada" && t.status !== "cancelada";
          const dueMs = t.due_at ? new Date(t.due_at).getTime() : null;
          const overdue = open && dueMs !== null && dueMs < now;
          const dueSoon =
            open && !overdue && dueMs !== null && dueMs - now <= SOON_MS;

          return (
            <li key={t.id}>
              <Link
                href={`/colaborador/${companyId}/${t.id}`}
                className="group block rounded-xl border border-line bg-surface p-4 shadow-card transition hover:-translate-y-0.5 hover:border-risd/40 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-fg group-hover:text-risd">
                    {t.title}
                  </span>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${meta.badge}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                    {meta.label}
                  </span>
                </div>

                {labels.length > 0 && (
                  <LabelChips labels={labels} className="mt-2" />
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
                  <span>Prazo: {formatDue(t.due_at)}</span>
                  <span>
                    Tempo:{" "}
                    <span className="font-mono tabular-nums">
                      {formatDuration(t.total_seconds)}
                    </span>
                  </span>
                  {overdue && (
                    <span className="font-medium text-red-600 dark:text-red-400">
                      Atrasada
                    </span>
                  )}
                  {dueSoon && (
                    <span className="font-medium text-amber-600 dark:text-amber-400">
                      Vence em breve
                    </span>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {hasMore && <ShowMore remaining={remaining} onClick={showMore} />}
    </div>
  );
}

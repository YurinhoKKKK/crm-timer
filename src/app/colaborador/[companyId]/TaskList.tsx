"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { TaskStatus } from "@/lib/types";

export type TaskItem = {
  id: string;
  title: string;
  status: TaskStatus;
  due_at: string | null;
  total_seconds: number;
  created_at: string;
};

type SortKey = "antiga" | "recente" | "prazo";

const STATUS_META: Record<
  TaskStatus,
  { label: string; className: string }
> = {
  a_fazer: { label: "A fazer", className: "border border-platinum bg-paper text-gunmetal/70" },
  iniciada: { label: "Iniciada", className: "bg-brand-soft text-risd" },
  finalizada: { label: "Finalizada", className: "bg-green-100 text-green-700" },
  cancelada: { label: "Cancelada", className: "bg-platinum text-gunmetal/50" },
};

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "antiga", label: "Mais antiga" },
  { value: "recente", label: "Mais recente" },
  { value: "prazo", label: "Próximas do prazo" },
];

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours === 0 && minutes === 0) return "0min";
  if (hours === 0) return `${minutes}min`;
  return `${hours}h ${minutes}min`;
}

function formatDue(due: string | null): string {
  if (!due) return "Sem prazo";
  return new Date(due).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TaskList({
  companyId,
  tasks,
}: {
  companyId: string;
  tasks: TaskItem[];
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

  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-platinum bg-white p-12 text-center text-gunmetal/50 shadow-sm">
        Nenhuma tarefa nesta empresa.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-gunmetal/70">
          {tasks.length} tarefa{tasks.length === 1 ? "" : "s"}
        </h2>
        <label className="flex items-center gap-2 text-sm text-gunmetal/60">
          Ordenar:
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-lg border border-platinum bg-white px-2 py-1.5 text-sm text-gunmetal shadow-sm transition focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2"
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
        {sorted.map((t) => {
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
                className="group block rounded-xl border border-platinum bg-white p-4 shadow-sm transition hover:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-gunmetal group-hover:text-risd">
                    {t.title}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}
                  >
                    {meta.label}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gunmetal/60">
                  <span>Prazo: {formatDue(t.due_at)}</span>
                  <span>Tempo: {formatDuration(t.total_seconds)}</span>
                  {overdue && (
                    <span className="font-medium text-red-600">Atrasada</span>
                  )}
                  {dueSoon && (
                    <span className="font-medium text-amber-600">
                      Vence em breve
                    </span>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

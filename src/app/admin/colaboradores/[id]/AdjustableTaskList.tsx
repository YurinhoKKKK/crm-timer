"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { STATUS_META } from "@/lib/status";
import { formatDuration } from "@/lib/format";
import type { TaskStatus } from "@/lib/types";
import {
  FilterBar,
  SearchBox,
  SelectFilter,
  EmptyState,
  ShowMore,
  usePaged,
  norm,
  type SelectOption,
} from "@/components/ListControls";
import { inputClass, labelClass, btnPrimary, btnSecondary } from "@/lib/ui";
import { adjustTaskTime } from "./actions";

export type Adjustment = {
  oldSeconds: number;
  newSeconds: number;
  reason: string | null;
  at: string;
  by: string;
};

export type AdjustItem = {
  id: string;
  title: string;
  status: TaskStatus;
  companyId: string;
  companyName: string;
  total_seconds: number;
  adjustments: Adjustment[]; // mais recente primeiro
};

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AdjustRow({
  item,
  collaboratorId,
}: {
  item: AdjustItem;
  collaboratorId: string;
}) {
  const router = useRouter();
  const meta = STATUS_META[item.status];

  const [editing, setEditing] = useState(false);
  const [hours, setHours] = useState(Math.floor(item.total_seconds / 3600));
  const [minutes, setMinutes] = useState(
    Math.floor((item.total_seconds % 3600) / 60)
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setHours(Math.floor(item.total_seconds / 3600));
    setMinutes(Math.floor((item.total_seconds % 3600) / 60));
    setReason("");
    setError(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const newSeconds = hours * 3600 + minutes * 60;
    const { error: actionError } = await adjustTaskTime(
      item.id,
      collaboratorId,
      newSeconds,
      reason
    );
    if (actionError) {
      setError(actionError);
      return;
    }
    setEditing(false);
    setReason("");
    startTransition(() => router.refresh());
  }

  const hasAdjustments = item.adjustments.length > 0;
  const historyTitle = hasAdjustments
    ? item.adjustments
        .map(
          (a) =>
            `${formatDateTime(a.at)} · ${formatDuration(a.oldSeconds)} → ${formatDuration(
              a.newSeconds
            )} · ${a.by}${a.reason ? ` · ${a.reason}` : ""}`
        )
        .join("\n")
    : undefined;

  return (
    <li className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-fg">{item.title}</span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${meta.badge}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
              {meta.label}
            </span>
            {hasAdjustments && (
              <span
                className="cursor-help rounded-full border border-amber-300/60 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
                title={historyTitle}
              >
                tempo ajustado
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-fg-muted">{item.companyName}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-sm tabular-nums text-fg">
            {formatDuration(item.total_seconds)}
          </span>
          {!editing && (
            <button
              type="button"
              onClick={() => {
                reset();
                setEditing(true);
              }}
              className={btnSecondary}
            >
              Ajustar tempo
            </button>
          )}
        </div>
      </div>

      {editing && (
        <form
          onSubmit={save}
          className="mt-4 space-y-4 rounded-lg border border-risd/40 bg-surface-2/40 p-4"
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-24">
              <label htmlFor={`h-${item.id}`} className={labelClass}>
                Horas
              </label>
              <input
                id={`h-${item.id}`}
                type="number"
                min={0}
                max={999}
                value={hours}
                onChange={(e) =>
                  setHours(Math.max(0, Number(e.target.value) || 0))
                }
                className={inputClass}
              />
            </div>
            <div className="w-24">
              <label htmlFor={`m-${item.id}`} className={labelClass}>
                Minutos
              </label>
              <input
                id={`m-${item.id}`}
                type="number"
                min={0}
                max={59}
                value={minutes}
                onChange={(e) =>
                  setMinutes(
                    Math.min(59, Math.max(0, Number(e.target.value) || 0))
                  )
                }
                className={inputClass}
              />
            </div>
            <p className="pb-2 text-xs text-fg-subtle">
              Atual: {formatDuration(item.total_seconds)}
            </p>
          </div>

          <div>
            <label htmlFor={`r-${item.id}`} className={labelClass}>
              Motivo <span className="font-normal text-fg-subtle">(opcional)</span>
            </label>
            <input
              id={`r-${item.id}`}
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: esqueceu de pausar o timer"
              className={inputClass}
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="flex items-center gap-2">
            <button type="submit" disabled={isPending} className={btnPrimary}>
              {isPending ? "Salvando…" : "Salvar ajuste"}
            </button>
            <button
              type="button"
              onClick={() => {
                reset();
                setEditing(false);
              }}
              className={btnSecondary}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

export default function AdjustableTaskList({
  items,
  collaboratorId,
  companies,
}: {
  items: AdjustItem[];
  collaboratorId: string;
  companies: SelectOption[];
}) {
  const [query, setQuery] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [status, setStatus] = useState("");

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    return items.filter((t) => {
      if (q && !norm(t.title).includes(q)) return false;
      if (companyId && t.companyId !== companyId) return false;
      if (status && t.status !== status) return false;
      return true;
    });
  }, [items, query, companyId, status]);

  const { visible, hasMore, remaining, showMore } = usePaged(filtered);

  return (
    <>
      <FilterBar>
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Buscar por título…"
        />
        <SelectFilter
          value={companyId}
          onChange={setCompanyId}
          allLabel="Todas as empresas"
          ariaLabel="Filtrar por empresa"
          options={companies}
        />
        <SelectFilter
          value={status}
          onChange={setStatus}
          allLabel="Todos os status"
          ariaLabel="Filtrar por status"
          options={[
            { value: "a_fazer", label: "A fazer" },
            { value: "iniciada", label: "Iniciada" },
            { value: "finalizada", label: "Finalizada" },
            { value: "cancelada", label: "Cancelada" },
          ]}
        />
      </FilterBar>

      {items.length === 0 ? (
        <EmptyState>Nenhuma tarefa no período.</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>Nenhuma tarefa corresponde aos filtros.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {visible.map((t) => (
            <AdjustRow key={t.id} item={t} collaboratorId={collaboratorId} />
          ))}
        </ul>
      )}

      {hasMore && <ShowMore remaining={remaining} onClick={showMore} />}
    </>
  );
}

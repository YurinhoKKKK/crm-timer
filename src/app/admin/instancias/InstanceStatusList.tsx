"use client";

import { useMemo } from "react";
import type { TaskStatus } from "@/lib/types";
import { STATUS_META, isOverdue } from "@/lib/status";
import { formatDuration, formatDue } from "@/lib/format";
import {
  ShowMore,
  TruncationNotice,
  usePaged,
} from "@/components/ListControls";
import LabelChips from "@/components/LabelChips";
import Person from "@/components/Person";
import TaskDetailLink from "@/components/TaskDetailLink";
import TaskGroupRow from "@/components/TaskGroupRow";
import { groupTasks, type GroupedRow } from "@/lib/task-grouping";
import type { Label } from "@/lib/labels";

export type InstanceItem = {
  id: string;
  title: string;
  status: TaskStatus;
  due_at: string | null;
  task_date: string;
  templateId: string | null;
  total_seconds: number;
  companyId: string;
  companyName: string;
  collaboratorName: string;
  collaboratorAvatarUrl?: string | null;
};

// Lista de instâncias por status (drill-down do dashboard), com AGRUPAMENTO
// por tarefa: as ocorrências do mesmo template condensam numa linha expansível
// (a pilha de "Bom dia" finalizadas ou atrasadas vira um grupo com contagem).
// A tela já é um recorte por status, então as contagens dos grupos vêm do que
// foi carregado (o aviso de teto cobre o excedente).
export default function InstanceStatusList({
  items,
  truncated = false,
  labelsByCompany,
}: {
  items: InstanceItem[];
  truncated?: boolean;
  // Etiquetas herdadas da empresa (company_id -> etiquetas).
  labelsByCompany?: Record<string, Label[]>;
}) {
  const rows = useMemo(() => {
    const { active, history } = groupTasks(items, undefined, {
      useDbCounts: false,
    });
    const out: GroupedRow<InstanceItem>[] = [
      ...active.map((item) => ({ kind: "item" as const, item })),
      ...history,
    ];
    return out;
  }, [items]);

  const { visible, hasMore, remaining, showMore } = usePaged(rows);

  function renderItem(r: InstanceItem) {
    const meta = STATUS_META[r.status];
    const overdue = isOverdue(r.status, r.due_at);
    return (
      <TaskDetailLink
        taskId={r.id}
        className="group block w-full rounded-xl border border-line bg-surface p-4 text-left shadow-card transition hover:-translate-y-0.5 hover:border-risd/40 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-fg group-hover:text-risd">
            {r.title}
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
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-fg-muted">
          <span>{r.companyName}</span>
          <span aria-hidden="true">·</span>
          <Person
            name={r.collaboratorName}
            avatarUrl={r.collaboratorAvatarUrl}
            size={18}
          />
        </p>
        {labelsByCompany?.[r.companyId]?.length ? (
          <LabelChips labels={labelsByCompany[r.companyId]} className="mt-1.5" />
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-fg-subtle">
          <span>Prazo: {formatDue(r.due_at)}</span>
          <span>
            Tempo:{" "}
            <span className="font-mono tabular-nums">
              {formatDuration(r.total_seconds)}
            </span>
          </span>
        </div>
      </TaskDetailLink>
    );
  }

  return (
    <>
      {truncated && <TruncationNotice count={items.length} />}
      <ul className="space-y-3">
        {visible.map((row) =>
          row.kind === "item" ? (
            <li key={row.item.id}>{renderItem(row.item)}</li>
          ) : (
            <li key={`g-${row.group.templateId}`}>
              <TaskGroupRow
                group={row.group}
                subtitle={row.group.items[0]?.companyName}
                canLoadMore={false}
              />
            </li>
          )
        )}
      </ul>

      {hasMore && <ShowMore remaining={remaining} onClick={showMore} />}
    </>
  );
}

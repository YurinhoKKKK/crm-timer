"use client";

import { useMemo, useState } from "react";
import {
  STATUS_META,
  STATUS_FILTER_OPTIONS,
  matchesStatusFilter,
  isOverdue,
} from "@/lib/status";
import { formatDuration, formatDue } from "@/lib/format";
import LabelChips from "@/components/LabelChips";
import Person from "@/components/Person";
import TaskDetailLink from "@/components/TaskDetailLink";
import TaskGroupRow from "@/components/TaskGroupRow";
import {
  groupTasks,
  type GroupStats,
  type GroupedRow,
} from "@/lib/task-grouping";
import type { Label } from "@/lib/labels";
import type { CentralTaskItem } from "@/lib/company-central";
import {
  FilterBar,
  SearchBox,
  SelectFilter,
  EmptyState,
  ShowMore,
  TruncationNotice,
  usePaged,
  norm,
} from "@/components/ListControls";

type SortKey = "prazo" | "antiga" | "recente";
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "prazo", label: "Próximas do prazo" },
  { value: "antiga", label: "Mais antiga" },
  { value: "recente", label: "Mais recente" },
];

// Lista de tarefas da central da empresa (Passo 19) com AGRUPAMENTO por tarefa:
// as ocorrências diárias do mesmo template condensam numa linha expansível; as
// abertas mais recentes seguem soltas e destacadas. Busca por título, filtro
// por status (incl. Atrasada) e ordenação — controles compartilhados. Clicar
// numa tarefa abre o painel de detalhe unificado (TaskDetailSheet).
export default function CompanyTaskList({
  tasks,
  truncated,
  labels = [],
  groupStats,
}: {
  tasks: CentralTaskItem[];
  truncated: boolean;
  // Etiquetas da empresa — herdadas por todas as tarefas (mesma empresa).
  labels?: Label[];
  // Contagens por template (banco) para os cabeçalhos dos grupos.
  groupStats?: GroupStats[];
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<SortKey>("prazo");

  const now = Date.now();

  const rows = useMemo(() => {
    const q = norm(query.trim());
    const filtered = tasks.filter((t) => {
      if (q && !norm(t.title).includes(q)) return false;
      if (!matchesStatusFilter(status, t.status, t.due_at, now)) return false;
      return true;
    });

    const { active, history } = groupTasks(filtered, groupStats, {
      useDbCounts: !status,
      nowMs: now,
    });

    // A ordenação escolhida vale para as tarefas soltas; o histórico agrupado
    // segue cronológico (invertido em "Mais antiga").
    active.sort((a, b) => {
      if (sort === "antiga") return a.created_at.localeCompare(b.created_at);
      if (sort === "recente") return b.created_at.localeCompare(a.created_at);
      if (!a.due_at && !b.due_at) return 0;
      if (!a.due_at) return 1;
      if (!b.due_at) return -1;
      return a.due_at.localeCompare(b.due_at);
    });
    if (sort === "antiga") history.reverse();

    const out: GroupedRow<CentralTaskItem>[] = [
      ...active.map((item) => ({ kind: "item" as const, item })),
      ...history,
    ];
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, groupStats, query, status, sort]);

  const { visible, hasMore, remaining, showMore } = usePaged(rows);

  function renderTask(t: CentralTaskItem) {
    const meta = STATUS_META[t.status];
    const overdue = isOverdue(t.status, t.due_at, now);
    return (
      <TaskDetailLink
        taskId={t.id}
        className="group block w-full rounded-xl border border-line bg-surface p-4 text-left shadow-card transition hover:-translate-y-0.5 hover:border-risd/40 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-fg group-hover:text-risd">
            {t.title}
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
        {labels.length > 0 && <LabelChips labels={labels} className="mt-2" />}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-subtle">
          <Person
            name={t.collaboratorName}
            avatarUrl={t.collaboratorAvatarUrl}
            size={16}
          />
          <span>Prazo: {formatDue(t.due_at)}</span>
          <span>
            Tempo:{" "}
            <span className="font-mono tabular-nums">
              {formatDuration(t.total_seconds)}
            </span>
          </span>
        </div>
      </TaskDetailLink>
    );
  }

  return (
    <>
      {truncated && <TruncationNotice count={tasks.length} />}
      <FilterBar>
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Buscar por título…"
        />
        <SelectFilter
          value={status}
          onChange={setStatus}
          allLabel="Todos os status"
          ariaLabel="Filtrar por status"
          options={STATUS_FILTER_OPTIONS}
        />
        <SelectFilter
          value={sort}
          onChange={(v) => setSort(v as SortKey)}
          allLabel="Ordenar"
          ariaLabel="Ordenar tarefas"
          options={SORT_OPTIONS}
        />
      </FilterBar>

      {tasks.length === 0 ? (
        <EmptyState>Nenhuma tarefa nesta empresa no período.</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState>Nenhuma tarefa corresponde aos filtros.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {visible.map((row) =>
            row.kind === "item" ? (
              <li key={row.item.id}>{renderTask(row.item)}</li>
            ) : (
              <li key={`g-${row.group.templateId}`}>
                <TaskGroupRow group={row.group} />
              </li>
            )
          )}
        </ul>
      )}

      {hasMore && <ShowMore remaining={remaining} onClick={showMore} />}
    </>
  );
}

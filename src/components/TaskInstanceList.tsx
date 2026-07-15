"use client";

import { useMemo, useState } from "react";
import type { TaskKind, TaskStatus } from "@/lib/types";
import {
  STATUS_META,
  STATUS_FILTER_OPTIONS,
  matchesStatusFilter,
  isOverdue,
} from "@/lib/status";
import { formatDuration, formatDue } from "@/lib/format";
import { ComboFilter } from "@/components/Combobox";
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
import {
  FilterBar,
  SearchBox,
  SelectFilter,
  EmptyState,
  ShowMore,
  TruncationNotice,
  usePaged,
  norm,
  type SelectOption,
} from "@/components/ListControls";

export type TaskInstanceItem = {
  id: string;
  title: string;
  status: TaskStatus;
  due_at: string | null;
  task_date: string;
  templateId: string | null;
  total_seconds: number;
  kind: TaskKind | null;
  companyId: string;
  companyName: string;
  collaboratorId: string;
  collaboratorName: string;
  collaboratorAvatarUrl?: string | null;
};

// Lista de tarefas (instâncias) com busca, filtros e AGRUPAMENTO por tarefa
// (template): as ocorrências diárias da mesma tarefa condensam numa linha
// expansível — as abertas mais recentes continuam soltas e destacadas no topo.
// O escopo dos dados é garantido pela query/RLS de cada página; aqui só
// filtramos/agrupamos em memória. `panel` define se o nome do colaborador
// aparece. TODO item abre o painel de detalhe unificado (TaskDetailSheet).
export default function TaskInstanceList({
  items,
  panel,
  companies,
  collaborators,
  truncated = false,
  labelsByCompany,
  groupStats,
}: {
  items: TaskInstanceItem[];
  panel: "consultor" | "colaborador" | "admin";
  companies: SelectOption[];
  collaborators?: SelectOption[];
  // Quando true, a query limitou a lista à janela mais recente (Passo 18).
  truncated?: boolean;
  // Etiquetas herdadas da empresa (company_id -> etiquetas). A tarefa não copia:
  // exibe as da empresa em tempo real.
  labelsByCompany?: Record<string, Label[]>;
  // Contagens verdadeiras por template (RPC task_group_stats, agregadas no banco).
  groupStats?: GroupStats[];
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [collaboratorId, setCollaboratorId] = useState("");
  const [kind, setKind] = useState("");

  const showCollaborator = panel === "consultor" && !!collaborators?.length;
  const showCompany = companies.length > 1;

  const rows = useMemo(() => {
    const q = norm(query.trim());
    const now = Date.now();
    const filtered = items.filter((t) => {
      if (q && !norm(t.title).includes(q)) return false;
      if (!matchesStatusFilter(status, t.status, t.due_at, now)) return false;
      if (companyId && t.companyId !== companyId) return false;
      if (collaboratorId && t.collaboratorId !== collaboratorId) return false;
      if (kind && t.kind !== kind) return false;
      return true;
    });
    // Filtro de status recorta DENTRO dos grupos → contagens do banco não
    // valeriam; caímos para as contagens do que foi carregado e casou.
    const { active, history } = groupTasks(filtered, groupStats, {
      useDbCounts: !status,
      nowMs: now,
    });
    const out: GroupedRow<TaskInstanceItem>[] = [
      ...active.map((item) => ({ kind: "item" as const, item })),
      ...history,
    ];
    return out;
  }, [items, groupStats, query, status, companyId, collaboratorId, kind]);

  const { visible, hasMore, remaining, showMore } = usePaged(rows);

  function renderItem(t: TaskInstanceItem) {
    const meta = STATUS_META[t.status];
    const overdue = isOverdue(t.status, t.due_at);
    const inner = (
      <>
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
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-fg-muted">
          <span>{t.companyName}</span>
          {panel === "consultor" && (
            <>
              <span aria-hidden="true">·</span>
              <Person
                name={t.collaboratorName}
                avatarUrl={t.collaboratorAvatarUrl}
                size={18}
              />
            </>
          )}
        </p>
        {labelsByCompany?.[t.companyId]?.length ? (
          <LabelChips
            labels={labelsByCompany[t.companyId]}
            className="mt-1.5"
          />
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-fg-subtle">
          <span>Prazo: {formatDue(t.due_at)}</span>
          <span>
            Tempo:{" "}
            <span className="font-mono tabular-nums">
              {formatDuration(t.total_seconds)}
            </span>
          </span>
        </div>
      </>
    );
    return (
      <TaskDetailLink
        taskId={t.id}
        className="group block w-full rounded-xl border border-line bg-surface p-4 text-left shadow-card transition hover:-translate-y-0.5 hover:border-risd/40 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      >
        {inner}
      </TaskDetailLink>
    );
  }

  return (
    <>
      {truncated && <TruncationNotice count={items.length} />}
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
        {showCompany && (
          <ComboFilter
            value={companyId}
            onChange={setCompanyId}
            allLabel="Todas as empresas"
            ariaLabel="Filtrar por empresa"
            searchPlaceholder="Buscar empresa…"
            options={companies}
          />
        )}
        {showCollaborator && (
          <SelectFilter
            value={collaboratorId}
            onChange={setCollaboratorId}
            allLabel="Todos os colaboradores"
            ariaLabel="Filtrar por colaborador"
            options={collaborators!}
          />
        )}
        <SelectFilter
          value={kind}
          onChange={setKind}
          allLabel="Todos os tipos"
          ariaLabel="Filtrar por tipo"
          options={[
            { value: "unica", label: "Única" },
            { value: "diaria", label: "Diária" },
          ]}
        />
      </FilterBar>

      {items.length === 0 ? (
        <EmptyState>Nenhuma tarefa por aqui ainda.</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState>Nenhuma tarefa corresponde aos filtros.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {visible.map((row) => {
            if (row.kind === "item") {
              return <li key={row.item.id}>{renderItem(row.item)}</li>;
            }
            // Todas as ocorrências de um template são da mesma empresa.
            const sample = row.group.items[0];
            return (
              <li key={`g-${row.group.templateId}`}>
                <TaskGroupRow group={row.group} subtitle={sample?.companyName} />
              </li>
            );
          })}
        </ul>
      )}

      {hasMore && <ShowMore remaining={remaining} onClick={showMore} />}
    </>
  );
}

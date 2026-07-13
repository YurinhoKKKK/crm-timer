"use client";

import { useMemo, useState } from "react";
import type { TaskStatus } from "@/lib/types";
import { STATUS_META } from "@/lib/status";
import { formatDuration, formatDue } from "@/lib/format";
import CreatorMeta from "@/components/CreatorMeta";
import LabelChips from "@/components/LabelChips";
import Person from "@/components/Person";
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
  type SelectOption,
} from "@/components/ListControls";

const STATUS_OPTIONS: SelectOption[] = (
  Object.keys(STATUS_META) as TaskStatus[]
).map((s) => ({ value: s, label: STATUS_META[s].label }));

type SortKey = "prazo" | "antiga" | "recente";
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "prazo", label: "Próximas do prazo" },
  { value: "antiga", label: "Mais antiga" },
  { value: "recente", label: "Mais recente" },
];

// Lista de tarefas da central da empresa (Passo 19). Busca por título, filtro
// por status e ordenação — reaproveitando os controles compartilhados. Cada
// item abre em acordeão o detalhe (responsável, tempo e o resumo escrito na
// finalização). Sem navegação, funciona igual para admin e consultor.
export default function CompanyTaskList({
  tasks,
  truncated,
  labels = [],
}: {
  tasks: CentralTaskItem[];
  truncated: boolean;
  // Etiquetas da empresa — herdadas por todas as tarefas (mesma empresa).
  labels?: Label[];
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<SortKey>("prazo");
  const [openId, setOpenId] = useState<string | null>(null);

  const now = Date.now();

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    const list = tasks.filter((t) => {
      if (q && !norm(t.title).includes(q)) return false;
      if (status && t.status !== status) return false;
      return true;
    });
    list.sort((a, b) => {
      if (sort === "antiga") return a.created_at.localeCompare(b.created_at);
      if (sort === "recente") return b.created_at.localeCompare(a.created_at);
      if (!a.due_at && !b.due_at) return 0;
      if (!a.due_at) return 1;
      if (!b.due_at) return -1;
      return a.due_at.localeCompare(b.due_at);
    });
    return list;
  }, [tasks, query, status, sort]);

  const { visible, hasMore, remaining, showMore } = usePaged(filtered);

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
          options={STATUS_OPTIONS}
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
      ) : filtered.length === 0 ? (
        <EmptyState>Nenhuma tarefa corresponde aos filtros.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {visible.map((t) => {
            const meta = STATUS_META[t.status];
            const open = openId === t.id;
            const isOpen = t.status !== "finalizada" && t.status !== "cancelada";
            const overdue =
              isOpen && !!t.due_at && new Date(t.due_at).getTime() < now;
            return (
              <li
                key={t.id}
                className="rounded-xl border border-line bg-surface shadow-card"
              >
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : t.id)}
                  aria-expanded={open}
                  className="flex w-full items-start justify-between gap-3 rounded-xl p-4 text-left transition hover:border-risd/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-fg">{t.title}</span>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${meta.badge}`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${meta.dot}`}
                        />
                        {meta.label}
                      </span>
                      {overdue && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300">
                          Atrasada
                        </span>
                      )}
                    </div>
                    {labels.length > 0 && (
                      <LabelChips labels={labels} className="mt-2" />
                    )}
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
                  <div className="border-t border-line px-4 py-3 text-sm">
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                      <div>
                        <dt className="text-xs text-fg-subtle">Responsável</dt>
                        <dd className="text-fg">
                          <Person
                            name={t.collaboratorName}
                            avatarUrl={t.collaboratorAvatarUrl}
                            size={18}
                          />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-fg-subtle">Prazo</dt>
                        <dd className="text-fg">{formatDue(t.due_at)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-fg-subtle">Tempo total</dt>
                        <dd className="font-mono tabular-nums text-fg">
                          {formatDuration(t.total_seconds)}
                        </dd>
                      </div>
                    </dl>
                    {t.status === "finalizada" && (
                      <div className="mt-3 rounded-lg border border-line bg-surface-2/50 p-3">
                        <p className="text-xs font-medium text-fg-muted">
                          Resumo da finalização
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-fg">
                          {t.completionNote?.trim() || "(sem resumo registrado)"}
                        </p>
                      </div>
                    )}
                    <div className="mt-3 border-t border-line pt-3">
                      <CreatorMeta
                        label="Criada por"
                        who={t.creator.who}
                        whoAvatarUrl={t.creator.whoAvatarUrl}
                        whenISO={t.creator.whenISO}
                        fromStandard={t.creator.fromStandard}
                        systemGenerated={t.creator.systemGenerated}
                        hasOrigin={t.creator.hasOrigin}
                      />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {hasMore && <ShowMore remaining={remaining} onClick={showMore} />}
    </>
  );
}

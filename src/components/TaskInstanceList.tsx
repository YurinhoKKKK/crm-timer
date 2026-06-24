"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { TaskStatus, TaskKind } from "@/lib/types";
import { STATUS_META } from "@/lib/status";
import { formatDuration, formatDue } from "@/lib/format";
import {
  FilterBar,
  SearchBox,
  SelectFilter,
  EmptyState,
  norm,
  type SelectOption,
} from "@/components/ListControls";

export type TaskInstanceItem = {
  id: string;
  title: string;
  status: TaskStatus;
  due_at: string | null;
  total_seconds: number;
  kind: TaskKind | null;
  companyId: string;
  companyName: string;
  collaboratorId: string;
  collaboratorName: string;
};

const STATUS_OPTIONS: SelectOption[] = (
  Object.keys(STATUS_META) as TaskStatus[]
).map((s) => ({ value: s, label: STATUS_META[s].label }));

// Lista de tarefas (instâncias) com busca e filtros, compartilhada pelos
// painéis. O escopo dos dados é garantido pela query/RLS de cada página; aqui
// só filtramos em memória (instantâneo). `panel` define a rota ao clicar e se
// o nome do colaborador aparece (no painel do colaborador é sempre ele mesmo).
export default function TaskInstanceList({
  items,
  panel,
  companies,
  collaborators,
}: {
  items: TaskInstanceItem[];
  panel: "consultor" | "colaborador";
  companies: SelectOption[];
  collaborators?: SelectOption[];
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [collaboratorId, setCollaboratorId] = useState("");
  const [kind, setKind] = useState("");

  const showCollaborator = panel === "consultor" && !!collaborators?.length;
  const showCompany = companies.length > 1;

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    return items.filter((t) => {
      if (q && !norm(t.title).includes(q)) return false;
      if (status && t.status !== status) return false;
      if (companyId && t.companyId !== companyId) return false;
      if (collaboratorId && t.collaboratorId !== collaboratorId) return false;
      if (kind && t.kind !== kind) return false;
      return true;
    });
  }, [items, query, status, companyId, collaboratorId, kind]);

  return (
    <>
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
        {showCompany && (
          <SelectFilter
            value={companyId}
            onChange={setCompanyId}
            allLabel="Todas as empresas"
            ariaLabel="Filtrar por empresa"
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
      ) : filtered.length === 0 ? (
        <EmptyState>Nenhuma tarefa corresponde aos filtros.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {filtered.map((t) => {
            const meta = STATUS_META[t.status];
            return (
              <li key={t.id}>
                <Link
                  href={`/${panel}/${t.companyId}/${t.id}`}
                  className="group block rounded-xl border border-line bg-surface p-4 shadow-card transition hover:-translate-y-0.5 hover:border-risd/40 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
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
                  </div>
                  <p className="mt-1 text-sm text-fg-muted">
                    {t.companyName}
                    {panel === "consultor" ? ` · ${t.collaboratorName}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-fg-subtle">
                    <span>Prazo: {formatDue(t.due_at)}</span>
                    <span>
                      Tempo:{" "}
                      <span className="font-mono tabular-nums">
                        {formatDuration(t.total_seconds)}
                      </span>
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

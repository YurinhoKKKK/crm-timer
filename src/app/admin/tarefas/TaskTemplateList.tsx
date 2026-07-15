"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { TaskKind, TemplateType } from "@/lib/types";
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
import { ComboFilter } from "@/components/Combobox";
import LabelChips from "@/components/LabelChips";
import Person from "@/components/Person";
import type { Label } from "@/lib/labels";

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export type TemplateItem = {
  id: string;
  title: string;
  kind: TaskKind;
  templateType: TemplateType;
  due_time: string | null;
  weekdays: number[] | null;
  start_date: string;
  active: boolean;
  companyId: string;
  collaboratorId: string;
  companyName: string;
  collaboratorName: string;
  collaboratorAvatarUrl?: string | null;
};

function formatTime(time: string | null): string | null {
  return time ? time.slice(0, 5) : null;
}

// Tipo "efetivo" da tarefa para filtro/rótulo: a listagem tem kind='unica' por
// baixo, então usamos template_type para distingui-la.
function effectiveType(t: TemplateItem): "unica" | "diaria" | "listagem" {
  return t.templateType === "listagem" ? "listagem" : t.kind;
}

function describeSchedule(t: TemplateItem): string {
  const time = formatTime(t.due_time);
  if (t.kind === "diaria") {
    const days = (t.weekdays ?? [])
      .slice()
      .sort((a, b) => a - b)
      .map((d) => WEEKDAY_LABELS[d])
      .join(", ");
    return `Diária · ${days || "sem dias"}${time ? ` · até ${time}` : ""}`;
  }
  const date = new Date(`${t.start_date}T00:00:00`).toLocaleDateString("pt-BR");
  const prefix = t.templateType === "listagem" ? "Listagem" : "Única";
  return `${prefix} · ${date}${time ? ` · até ${time}` : ""}`;
}

export default function TaskTemplateList({
  templates,
  companies,
  collaborators,
  labelsByCompany,
}: {
  templates: TemplateItem[];
  companies: SelectOption[];
  collaborators: SelectOption[];
  // Etiquetas herdadas da empresa (company_id -> etiquetas).
  labelsByCompany?: Record<string, Label[]>;
}) {
  const [query, setQuery] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [collaboratorId, setCollaboratorId] = useState("");
  const [kind, setKind] = useState("");

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    return templates.filter((t) => {
      if (q && !norm(t.title).includes(q)) return false;
      if (companyId && t.companyId !== companyId) return false;
      if (collaboratorId && t.collaboratorId !== collaboratorId) return false;
      if (kind && effectiveType(t) !== kind) return false;
      return true;
    });
  }, [templates, query, companyId, collaboratorId, kind]);

  const { visible, hasMore, remaining, showMore } = usePaged(filtered);

  return (
    <>
      <FilterBar>
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Buscar por título…"
        />
        <ComboFilter
          value={companyId}
          onChange={setCompanyId}
          allLabel="Todas as empresas"
          ariaLabel="Filtrar por empresa"
          searchPlaceholder="Buscar empresa…"
          options={companies}
        />
        <SelectFilter
          value={collaboratorId}
          onChange={setCollaboratorId}
          allLabel="Todos os colaboradores"
          ariaLabel="Filtrar por colaborador"
          options={collaborators}
        />
        <SelectFilter
          value={kind}
          onChange={setKind}
          allLabel="Todos os tipos"
          ariaLabel="Filtrar por tipo"
          options={[
            { value: "unica", label: "Única" },
            { value: "diaria", label: "Diária" },
            { value: "listagem", label: "Listagem de marcas" },
          ]}
        />
      </FilterBar>

      {templates.length === 0 ? (
        <EmptyState>Nenhuma tarefa cadastrada ainda.</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>Nenhuma tarefa corresponde aos filtros.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {visible.map((t) => (
            <li key={t.id}>
              <Link
                href={`/admin/tarefas/${t.id}`}
                className="group block rounded-xl border border-line bg-surface p-4 shadow-card transition hover:-translate-y-0.5 hover:border-risd/40 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-fg group-hover:text-risd">
                    {t.title}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      t.templateType === "listagem"
                        ? "bg-brand-tint text-chrysler"
                        : t.kind === "diaria"
                          ? "bg-brand-tint text-risd"
                          : "border border-line bg-surface-2 text-fg-muted"
                    }`}
                  >
                    {t.templateType === "listagem"
                      ? "Listagem de marcas"
                      : t.kind === "diaria"
                        ? "Diária"
                        : "Única"}
                  </span>
                  {!t.active && (
                    <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-xs text-fg-subtle">
                      inativa
                    </span>
                  )}
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-fg-muted">
                  <span>{t.companyName}</span>
                  <span aria-hidden="true">·</span>
                  <Person
                    name={t.collaboratorName}
                    avatarUrl={t.collaboratorAvatarUrl}
                    size={18}
                  />
                </p>
                {labelsByCompany?.[t.companyId]?.length ? (
                  <LabelChips
                    labels={labelsByCompany[t.companyId]}
                    className="mt-1.5"
                  />
                ) : null}
                <p className="mt-1 text-xs text-fg-subtle">
                  {describeSchedule(t)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {hasMore && <ShowMore remaining={remaining} onClick={showMore} />}
    </>
  );
}

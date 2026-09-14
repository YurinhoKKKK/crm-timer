"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { setTaskTemplatesActive } from "@/app/admin/actions";

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

// Filtro por situação. Padrão "ativos" para os modelos desativados na
// reestruturação não poluírem a tela.
type StatusFilter = "ativos" | "inativos" | "todos";

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
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [collaboratorId, setCollaboratorId] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ativos");

  // Seleção múltipla (por id) para a ação em lote. Persiste entre paginações e
  // mudanças de filtro; as ações só atuam sobre os ids realmente selecionados.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const byId = useMemo(
    () => new Map(templates.map((t) => [t.id, t] as const)),
    [templates]
  );

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    return templates.filter((t) => {
      if (q && !norm(t.title).includes(q)) return false;
      if (companyId && t.companyId !== companyId) return false;
      if (collaboratorId && t.collaboratorId !== collaboratorId) return false;
      if (kind && effectiveType(t) !== kind) return false;
      if (status === "ativos" && !t.active) return false;
      if (status === "inativos" && t.active) return false;
      return true;
    });
  }, [templates, query, companyId, collaboratorId, kind, status]);

  const { visible, hasMore, remaining, showMore } = usePaged(filtered);

  // Contagens do que está selecionado, por situação — decidem quais botões da
  // barra de ações ficam disponíveis e a mensagem de confirmação.
  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const selActive = selectedIds.filter((id) => byId.get(id)?.active).length;
  const selInactive = selectedIds.length - selActive;

  // "Selecionar todos" atua sobre o conjunto FILTRADO (o que está à vista após os
  // filtros), não só a página renderizada — para desativar em massa de fato.
  const filteredIds = filtered.map((t) => t.id);
  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));
  const someFilteredSelected = filteredIds.some((id) => selected.has(id));

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setFeedback(null);
  }

  function toggleAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filteredIds.forEach((id) => next.delete(id));
      else filteredIds.forEach((id) => next.add(id));
      return next;
    });
    setFeedback(null);
  }

  function clearSelection() {
    setSelected(new Set());
    setConfirming(false);
  }

  function runBulk(active: boolean, ids: string[]) {
    setError(null);
    startTransition(async () => {
      const res = await setTaskTemplatesActive(ids, active);
      if (res.error) {
        setError(res.error);
        return;
      }
      setConfirming(false);
      setSelected(new Set());
      setFeedback(
        active
          ? `${res.count} modelo${res.count === 1 ? "" : "s"} reativado${
              res.count === 1 ? "" : "s"
            }.`
          : `${res.count} modelo${res.count === 1 ? "" : "s"} desativado${
              res.count === 1 ? "" : "s"
            } — nada foi perdido.`
      );
      router.refresh();
    });
  }

  // Só desativa os que estão ATIVOS entre os selecionados (e vice-versa), para a
  // ação ser idempotente e a contagem confirmada bater com o efeito real.
  const activeSelectedIds = selectedIds.filter((id) => byId.get(id)?.active);
  const inactiveSelectedIds = selectedIds.filter((id) => !byId.get(id)?.active);

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
        {/* Situação: seletor próprio (não usa SelectFilter porque o padrão é
            "ativos", não "todos"). */}
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          aria-label="Filtrar por situação"
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm transition focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <option value="ativos">Ativos</option>
          <option value="inativos">Inativos</option>
          <option value="todos">Todos</option>
        </select>
      </FilterBar>

      {feedback && (
        <p className="mb-3 rounded-lg border border-emerald-300/60 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          {feedback}
        </p>
      )}

      {templates.length === 0 ? (
        <EmptyState>Nenhuma tarefa cadastrada ainda.</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>Nenhuma tarefa corresponde aos filtros.</EmptyState>
      ) : (
        <>
          {/* Cabeçalho de seleção: selecionar todos (do conjunto filtrado) +
              barra de ações em lote quando há algo marcado. */}
          <div className="mb-3 flex flex-col gap-2 rounded-xl border border-line bg-surface-2/40 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                ref={(el) => {
                  if (el) el.indeterminate = !allFilteredSelected && someFilteredSelected;
                }}
                onChange={toggleAllFiltered}
                aria-label="Selecionar todos os modelos filtrados"
                className="h-4 w-4 cursor-pointer rounded border-line text-risd focus-visible:ring-2 focus-visible:ring-risd"
              />
              {selected.size > 0 ? (
                <span>
                  <span className="font-medium text-fg">{selected.size}</span>{" "}
                  selecionado{selected.size === 1 ? "" : "s"}
                </span>
              ) : (
                <span>Selecionar todos ({filtered.length})</span>
              )}
            </label>

            {selected.size > 0 && !confirming && (
              <div className="flex flex-wrap items-center gap-2">
                {selActive > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setConfirming(true);
                    }}
                    disabled={isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300/70 bg-surface px-3 py-1.5 text-sm font-medium text-amber-700 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-500/40 dark:text-amber-300 dark:hover:bg-amber-500/10"
                  >
                    Desativar ({selActive})
                  </button>
                )}
                {selInactive > 0 && (
                  <button
                    type="button"
                    onClick={() => runBulk(true, inactiveSelectedIds)}
                    disabled={isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg-muted transition hover:border-risd/40 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isPending ? "Reativando…" : `Reativar (${selInactive})`}
                  </button>
                )}
                <button
                  type="button"
                  onClick={clearSelection}
                  disabled={isPending}
                  className="rounded-lg px-2 py-1.5 text-sm text-fg-subtle transition hover:text-fg disabled:opacity-50"
                >
                  Limpar
                </button>
              </div>
            )}

            {/* Confirmação da desativação — diz QUANTOS e deixa claro que nada é
                perdido. Só atua sobre os selecionados que estão ativos. */}
            {confirming && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <p className="text-sm text-fg-muted">
                  Desativar{" "}
                  <span className="font-semibold text-fg">{selActive}</span>{" "}
                  modelo{selActive === 1 ? "" : "s"}? Eles param de gerar novas
                  tarefas. Nenhuma instância, hora registrada ou relato é perdido —
                  o histórico e as tarefas de hoje continuam intactos.
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => runBulk(false, activeSelectedIds)}
                    disabled={isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200"
                  >
                    {isPending ? "Desativando…" : "Sim, desativar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    disabled={isPending}
                    className="rounded-lg px-2 py-1.5 text-sm text-fg-subtle transition hover:text-fg disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>

          {error && (
            <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <ul className="space-y-3">
            {visible.map((t) => {
              const checked = selected.has(t.id);
              return (
                <li key={t.id} className="flex items-stretch gap-2">
                  <label className="flex cursor-pointer items-center pl-1">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOne(t.id)}
                      aria-label={`Selecionar ${t.title}`}
                      className="h-4 w-4 cursor-pointer rounded border-line text-risd focus-visible:ring-2 focus-visible:ring-risd"
                    />
                  </label>
                  <Link
                    href={`/admin/tarefas/${t.id}`}
                    className={`group block min-w-0 flex-1 rounded-xl border bg-surface p-4 shadow-card transition hover:-translate-y-0.5 hover:border-risd/40 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${
                      checked ? "border-risd/50" : "border-line"
                    } ${t.active ? "" : "opacity-70"}`}
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
              );
            })}
          </ul>
        </>
      )}

      {hasMore && <ShowMore remaining={remaining} onClick={showMore} />}
    </>
  );
}

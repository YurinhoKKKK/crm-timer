"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TaskKind } from "@/lib/types";
import {
  updateStandardTask,
  deleteStandardTask,
  setStandardTaskCompanies,
  setStandardTasksActive,
  deleteStandardTasks,
} from "./standard-actions";
import StandardFields, { type StandardFormValue } from "./StandardFields";
import {
  FilterBar,
  SearchBox,
  SelectFilter,
  EmptyState,
  ShowMore,
  usePaged,
  norm,
} from "@/components/ListControls";
import { btnPrimary, btnSecondary } from "@/lib/ui";
import ConfirmDialog from "@/components/ConfirmDialog";
import AssignmentPicker, {
  collectAssignments,
  type PickerItem,
  type PickerRow,
} from "@/components/AssignmentPicker";

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

type CompanyOption = { id: string; name: string };
type PersonOption = { id: string; full_name: string; email: string };

// Filtro por situação. Padrão "ativos" para os moldes desativados na
// reestruturação não poluírem o catálogo.
type StatusFilter = "ativos" | "inativos" | "todos";

export type StandardItem = {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  kind: TaskKind;
  due_time: string | null;
  weekdays: number[] | null;
  active: boolean;
  usageCount: number; // em quantas empresas está atribuída (templates ativos)
  // Empresas onde está atribuída, com o responsável — para o seletor na edição.
  assignments: { companyId: string; collaboratorId: string }[];
};

function formatTime(time: string | null): string | null {
  return time ? time.slice(0, 5) : null;
}

function describe(t: StandardItem): string {
  const time = formatTime(t.due_time);
  if (t.kind === "diaria") {
    const days = (t.weekdays ?? [])
      .slice()
      .sort((a, b) => a - b)
      .map((d) => WEEKDAY_LABELS[d])
      .join(", ");
    return `Diária · ${days || "sem dias"}${time ? ` · até ${time}` : ""}`;
  }
  return `Única${time ? ` · até ${time}` : ""}`;
}

function usageLabel(count: number): string {
  return count === 0
    ? "Não atribuída a nenhuma empresa"
    : `Em uso em ${count} empresa${count === 1 ? "" : "s"}`;
}

function toForm(t: StandardItem): StandardFormValue {
  return {
    title: t.title,
    description: t.description ?? "",
    instructions: t.instructions ?? "",
    kind: t.kind,
    dueTime: t.due_time ? t.due_time.slice(0, 5) : "",
    weekdays: new Set(t.weekdays ?? []),
  };
}

// Linhas do seletor de empresas pré-marcadas conforme onde a padrão já está.
function initCompanyRows(t: StandardItem): Map<string, PickerRow> {
  const map = new Map<string, PickerRow>();
  for (const a of t.assignments) {
    map.set(a.companyId, { enabled: true, collaboratorId: a.collaboratorId });
  }
  return map;
}

// Texto da EXCLUSÃO de um molde. O FK standard_task_id é ON DELETE SET NULL: as
// tarefas que usam o molde permanecem com todo o histórico — só perdem o vínculo
// vivo (deixam de ser atualizadas por um molde novo). Não assusta nem é vago.
function deleteDescription(usageCount: number): string {
  if (usageCount === 0) {
    return "O molde sai do catálogo. Nenhuma empresa o usa. Ação irreversível.";
  }
  return `As tarefas nas ${usageCount} empresa${
    usageCount === 1 ? "" : "s"
  } que usam este molde continuam existindo, com todo o histórico (horas e relatos). Elas só deixam de ficar vinculadas ao molde — editar um molde novo não vai mais atualizá-las. Ação irreversível.`;
}

function StandardRow({
  item,
  companies,
  collaborators,
  selected,
  onToggleSelect,
}: {
  item: StandardItem;
  companies: CompanyOption[];
  collaborators: PersonOption[];
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<StandardFormValue>(toForm(item));
  const [companyRows, setCompanyRows] = useState<Map<string, PickerRow>>(() =>
    initCompanyRows(item)
  );
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  const companyItems: PickerItem[] = companies.map((c) => ({
    id: c.id,
    label: c.name,
  }));

  function patch(p: Partial<StandardFormValue>) {
    setForm((prev) => ({ ...prev, ...p }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const { assignments, missing } = collectAssignments(
      companyItems,
      companyRows
    );
    if (missing) {
      setError(`Escolha o responsável da empresa "${missing.label}".`);
      return;
    }

    // Primeiro o molde (propaga às instâncias a_fazer das empresas atuais),
    // depois os vínculos de empresa (cria/atualiza/desativa). Preserva a situação
    // ativa/inativa atual do molde (a edição não é o lugar de reativar).
    const { error: actionError } = await updateStandardTask(item.id, {
      title: form.title,
      description: form.description,
      instructions: form.instructions,
      kind: form.kind,
      dueTime: form.dueTime,
      weekdays: Array.from(form.weekdays),
      active: item.active,
    });
    if (actionError) {
      setError(actionError);
      return;
    }

    const { error: linkError } = await setStandardTaskCompanies(
      item.id,
      assignments.map((a) => ({
        companyId: a.id,
        collaboratorId: a.collaboratorId,
      }))
    );
    if (linkError) {
      setError(linkError);
      return;
    }

    setEditing(false);
    startTransition(() => router.refresh());
  }

  async function remove() {
    const { error: actionError } = await deleteStandardTask(item.id);
    if (actionError) return { error: actionError };
    startTransition(() => router.refresh());
  }

  if (editing) {
    return (
      <li>
        <form
          onSubmit={save}
          className="space-y-4 rounded-xl border border-risd/40 bg-surface p-4 shadow-card"
        >
          <StandardFields
            idPrefix={`edit-${item.id}`}
            value={form}
            onChange={patch}
          />

          {companies.length > 0 && collaborators.length > 0 && (
            <fieldset className="border-t border-line pt-4">
              <legend className="mb-1 text-sm font-medium text-fg">
                Empresas que usam esta tarefa
              </legend>
              <p className="mb-3 text-xs text-fg-subtle">
                Marque as empresas e o responsável de cada uma. Desmarcar remove a
                tarefa das em aberto daquela empresa; as finalizadas ficam
                intactas.
              </p>
              <AssignmentPicker
                items={companyItems}
                collaborators={collaborators}
                rows={companyRows}
                onChange={setCompanyRows}
                searchPlaceholder="Buscar empresa…"
                showDefaultResponsible
                idPrefix={`edit-std-co-${item.id}`}
              />
            </fieldset>
          )}

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
          <div className="flex items-center gap-2">
            <button type="submit" disabled={isPending} className={btnPrimary}>
              {isPending ? "Salvando…" : "Salvar alterações"}
            </button>
            <button
              type="button"
              onClick={() => {
                setForm(toForm(item));
                setCompanyRows(initCompanyRows(item));
                setError(null);
                setEditing(false);
              }}
              className={btnSecondary}
            >
              Cancelar
            </button>
          </div>
          {item.usageCount > 0 && (
            <p className="text-xs text-fg-subtle">
              Ao salvar, as alterações valem para as {item.usageCount} empresa
              {item.usageCount === 1 ? "" : "s"} que usam esta padrão — nas
              tarefas ainda não finalizadas. As já finalizadas ficam intactas.
            </p>
          )}
        </form>
      </li>
    );
  }

  return (
    <li>
      <div
        className={`rounded-xl border bg-surface p-4 shadow-card ${
          selected ? "border-risd/50" : "border-line"
        } ${item.active ? "" : "opacity-70"}`}
      >
        <div className="flex items-start gap-3">
          <label className="flex cursor-pointer items-center pt-0.5">
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              aria-label={`Selecionar ${item.title}`}
              className="h-4 w-4 cursor-pointer rounded border-line text-risd focus-visible:ring-2 focus-visible:ring-risd"
            />
          </label>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-fg">{item.title}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  item.kind === "diaria"
                    ? "bg-brand-tint text-risd"
                    : "border border-line bg-surface-2 text-fg-muted"
                }`}
              >
                {item.kind === "diaria" ? "Diária" : "Única"}
              </span>
              {!item.active && (
                <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-xs text-fg-subtle">
                  inativa
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-fg-subtle">{describe(item)}</p>
            <p className="mt-1 text-xs text-fg-subtle">
              {usageLabel(item.usageCount)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg shadow-sm transition hover:border-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              Editar
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-lg border border-red-300/60 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
            >
              Excluir
            </button>
          </div>
        </div>

            {error && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Excluir o molde "${item.title}"?`}
        confirmLabel="Confirmar exclusão"
        description={deleteDescription(item.usageCount)}
        onConfirm={remove}
      />
    </li>
  );
}

export default function StandardTaskList({
  items,
  companies,
  collaborators,
}: {
  items: StandardItem[];
  companies: CompanyOption[];
  collaborators: PersonOption[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ativos");

  // Seleção múltipla (por id) para as ações em lote. Persiste entre paginações e
  // filtros; as ações só atuam sobre os ids realmente selecionados.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<null | "deactivate" | "delete">(
    null
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const byId = useMemo(
    () => new Map(items.map((t) => [t.id, t] as const)),
    [items]
  );

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    return items.filter((t) => {
      if (q && !norm(t.title).includes(q)) return false;
      if (kind && t.kind !== kind) return false;
      if (status === "ativos" && !t.active) return false;
      if (status === "inativos" && t.active) return false;
      return true;
    });
  }, [items, query, kind, status]);

  const { visible, hasMore, remaining, showMore } = usePaged(filtered);

  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const selActive = selectedIds.filter((id) => byId.get(id)?.active).length;
  const selInactive = selectedIds.length - selActive;
  const activeSelectedIds = selectedIds.filter((id) => byId.get(id)?.active);
  const inactiveSelectedIds = selectedIds.filter((id) => !byId.get(id)?.active);
  // Total de vínculos de empresa afetados pela exclusão (soma do "Em uso em N").
  const affectedCompanies = selectedIds.reduce(
    (sum, id) => sum + (byId.get(id)?.usageCount ?? 0),
    0
  );

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
    setConfirming(null);
  }

  function runSetActive(active: boolean, ids: string[]) {
    setError(null);
    startTransition(async () => {
      const res = await setStandardTasksActive(ids, active);
      if (res.error) return setError(res.error);
      setConfirming(null);
      setSelected(new Set());
      setFeedback(
        active
          ? `${res.count} molde${res.count === 1 ? "" : "s"} reativado${
              res.count === 1 ? "" : "s"
            }.`
          : `${res.count} molde${res.count === 1 ? "" : "s"} desativado${
              res.count === 1 ? "" : "s"
            } — nenhuma tarefa existente foi alterada.`
      );
      router.refresh();
    });
  }

  function runDelete(ids: string[]) {
    setError(null);
    startTransition(async () => {
      const res = await deleteStandardTasks(ids);
      if (res.error) return setError(res.error);
      setConfirming(null);
      setSelected(new Set());
      setFeedback(
        `${res.count} molde${
          res.count === 1 ? "" : "s"
        } excluído${res.count === 1 ? "" : "s"} do catálogo — as tarefas que os usavam continuam intactas.`
      );
      router.refresh();
    });
  }

  return (
    <>
      <FilterBar>
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Buscar por título…"
        />
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
        {/* Situação: seletor próprio (padrão "ativos", não "todos"). */}
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

      {items.length === 0 ? (
        <EmptyState>Nenhuma tarefa padrão cadastrada ainda.</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>Nenhuma tarefa padrão corresponde aos filtros.</EmptyState>
      ) : (
        <>
          {/* Seleção + ações em lote. "Selecionar todos" atua sobre o conjunto
              FILTRADO (o que está à vista), não só a página renderizada. */}
          <div className="mb-3 flex flex-col gap-2 rounded-xl border border-line bg-surface-2/40 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                ref={(el) => {
                  if (el)
                    el.indeterminate =
                      !allFilteredSelected && someFilteredSelected;
                }}
                onChange={toggleAllFiltered}
                aria-label="Selecionar todos os moldes filtrados"
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
                      setConfirming("deactivate");
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
                    onClick={() => runSetActive(true, inactiveSelectedIds)}
                    disabled={isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg-muted transition hover:border-risd/40 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isPending ? "Reativando…" : `Reativar (${selInactive})`}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setConfirming("delete");
                  }}
                  disabled={isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-300/60 bg-surface px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10"
                >
                  Excluir ({selected.size})
                </button>
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

            {/* Confirmação da DESATIVAÇÃO — diz quantos e que nada existente muda. */}
            {confirming === "deactivate" && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <p className="text-sm text-fg-muted">
                  Desativar{" "}
                  <span className="font-semibold text-fg">{selActive}</span> molde
                  {selActive === 1 ? "" : "s"}? Somem dos seletores de criar tarefa
                  e de cadastro da empresa. As tarefas que já os usam continuam
                  iguais — nenhum histórico, hora ou relato é perdido.
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => runSetActive(false, activeSelectedIds)}
                    disabled={isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200"
                  >
                    {isPending ? "Desativando…" : "Sim, desativar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    disabled={isPending}
                    className="rounded-lg px-2 py-1.5 text-sm text-fg-subtle transition hover:text-fg disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {/* Confirmação da EXCLUSÃO — SET NULL: diz o que realmente acontece e
                quantas empresas são afetadas. */}
            {confirming === "delete" && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <p className="text-sm text-fg-muted">
                  Excluir{" "}
                  <span className="font-semibold text-fg">{selected.size}</span>{" "}
                  molde{selected.size === 1 ? "" : "s"} do catálogo?{" "}
                  {affectedCompanies > 0 ? (
                    <>
                      As tarefas nas{" "}
                      <span className="font-semibold text-fg">
                        {affectedCompanies}
                      </span>{" "}
                      atribuição{affectedCompanies === 1 ? "" : "ões"} de empresa
                      continuam existindo com todo o histórico; só deixam de estar
                      vinculadas ao molde.
                    </>
                  ) : (
                    <>Nenhuma empresa usa esses moldes.</>
                  )}{" "}
                  Ação irreversível.
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => runDelete(selectedIds)}
                    disabled={isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-300/70 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-300"
                  >
                    {isPending ? "Excluindo…" : "Sim, excluir"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
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
            {visible.map((t) => (
              <StandardRow
                key={t.id}
                item={t}
                companies={companies}
                collaborators={collaborators}
                selected={selected.has(t.id)}
                onToggleSelect={() => toggleOne(t.id)}
              />
            ))}
          </ul>
        </>
      )}

      {hasMore && <ShowMore remaining={remaining} onClick={showMore} />}
    </>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TaskKind } from "@/lib/types";
import {
  updateStandardTask,
  deleteStandardTask,
  setStandardTaskCompanies,
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

export type StandardItem = {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  kind: TaskKind;
  due_time: string | null;
  weekdays: number[] | null;
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

function StandardRow({
  item,
  companies,
  collaborators,
}: {
  item: StandardItem;
  companies: CompanyOption[];
  collaborators: PersonOption[];
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
    // depois os vínculos de empresa (cria/atualiza/desativa).
    const { error: actionError } = await updateStandardTask(item.id, {
      title: form.title,
      description: form.description,
      instructions: form.instructions,
      kind: form.kind,
      dueTime: form.dueTime,
      weekdays: Array.from(form.weekdays),
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
    <li className="rounded-xl border border-line bg-surface p-4 shadow-card">
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
          </div>
          <p className="mt-1 text-xs text-fg-subtle">{describe(item)}</p>
          <p className="mt-1 text-xs text-fg-subtle">
            {item.usageCount === 0
              ? "Não atribuída a nenhuma empresa"
              : `Em uso em ${item.usageCount} empresa${
                  item.usageCount === 1 ? "" : "s"
                }`}
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
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Excluir a tarefa padrão "${item.title}"?`}
        confirmLabel="Confirmar exclusão"
        description={
          item.usageCount > 0
            ? `As tarefas já atribuídas às ${item.usageCount} empresa${
                item.usageCount === 1 ? "" : "s"
              } permanecem, mas deixam de receber atualizações desta padrão.`
            : "A tarefa padrão sai do catálogo. Esta ação não pode ser desfeita."
        }
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
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    return items.filter((t) => {
      if (q && !norm(t.title).includes(q)) return false;
      if (kind && t.kind !== kind) return false;
      return true;
    });
  }, [items, query, kind]);

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
        <EmptyState>Nenhuma tarefa padrão cadastrada ainda.</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>Nenhuma tarefa padrão corresponde aos filtros.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {visible.map((t) => (
            <StandardRow
              key={t.id}
              item={t}
              companies={companies}
              collaborators={collaborators}
            />
          ))}
        </ul>
      )}

      {hasMore && <ShowMore remaining={remaining} onClick={showMore} />}
    </>
  );
}

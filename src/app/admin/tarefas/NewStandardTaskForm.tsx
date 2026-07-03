"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createStandardTask } from "./standard-actions";
import StandardFields, {
  emptyStandardForm,
  type StandardFormValue,
} from "./StandardFields";
import { btnPrimary, btnSecondary } from "@/lib/ui";
import AssignmentPicker, {
  collectAssignments,
  emptyRows,
  type PickerItem,
  type PickerRow,
} from "@/components/AssignmentPicker";

type CompanyOption = { id: string; name: string };
type PersonOption = { id: string; full_name: string; email: string };

// Cria uma tarefa padrão (molde do catálogo) e, opcionalmente, já a atribui às
// empresas escolhidas com seus responsáveis (Direção 1).
export default function NewStandardTaskForm({
  companies,
  collaborators,
}: {
  companies: CompanyOption[];
  collaborators: PersonOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<StandardFormValue>(emptyStandardForm());
  const [companyRows, setCompanyRows] = useState<Map<string, PickerRow>>(
    emptyRows()
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const companyItems: PickerItem[] = companies.map((c) => ({
    id: c.id,
    label: c.name,
  }));

  function patch(p: Partial<StandardFormValue>) {
    setForm((prev) => ({ ...prev, ...p }));
  }

  function reset() {
    setForm(emptyStandardForm());
    setCompanyRows(emptyRows());
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
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

    const { error: actionError } = await createStandardTask(
      {
        title: form.title,
        description: form.description,
        instructions: form.instructions,
        kind: form.kind,
        dueTime: form.dueTime,
        weekdays: Array.from(form.weekdays),
      },
      assignments.map((a) => ({
        companyId: a.id,
        collaboratorId: a.collaboratorId,
      }))
    );

    if (actionError) {
      setError(actionError);
      return;
    }

    reset();
    setOpen(false);
    startTransition(() => router.refresh());
  }

  if (!open) {
    return (
      <div className="mb-6">
        <button type="button" onClick={() => setOpen(true)} className={btnPrimary}>
          Nova tarefa padrão
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6"
    >
      <h2 className="font-semibold text-fg">Nova tarefa padrão</h2>

      <StandardFields idPrefix="new-std" value={form} onChange={patch} autoFocus />

      {companies.length > 0 && collaborators.length > 0 && (
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-fg">
            Empresas que usam esta tarefa{" "}
            <span className="font-normal text-fg-subtle">(opcional)</span>
          </legend>
          <p className="mb-3 text-xs text-fg-subtle">
            Marque as empresas e escolha o responsável de cada uma. Use o
            responsável padrão para preencher todas de uma vez.
          </p>
          <AssignmentPicker
            items={companyItems}
            collaborators={collaborators}
            rows={companyRows}
            onChange={setCompanyRows}
            searchPlaceholder="Buscar empresa…"
            showDefaultResponsible
            idPrefix="new-std-co"
          />
        </fieldset>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex items-center gap-2">
        <button type="submit" disabled={isPending} className={btnPrimary}>
          {isPending ? "Salvando…" : "Salvar padrão"}
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className={btnSecondary}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

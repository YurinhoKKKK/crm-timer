"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createStandardTask } from "./standard-actions";
import StandardFields, {
  emptyStandardForm,
  type StandardFormValue,
} from "./StandardFields";
import { btnPrimary, btnSecondary } from "@/lib/ui";

// Cria uma tarefa padrão (molde do catálogo). Ainda não ligada a empresa —
// a atribuição acontece no cadastro/edição da empresa.
export default function NewStandardTaskForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<StandardFormValue>(emptyStandardForm());
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function patch(p: Partial<StandardFormValue>) {
    setForm((prev) => ({ ...prev, ...p }));
  }

  function reset() {
    setForm(emptyStandardForm());
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const { error: actionError } = await createStandardTask({
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

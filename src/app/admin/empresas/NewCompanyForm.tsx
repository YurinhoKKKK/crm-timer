"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCompany } from "../actions";
import GroupSelect from "./GroupSelect";
import { inputClass, labelClass, btnPrimary, btnSecondary } from "@/lib/ui";
import type { TaskKind } from "@/lib/types";
import AssignmentPicker, {
  KindBadge,
  collectAssignments,
  emptyRows,
  type PickerItem,
  type PickerRow,
} from "@/components/AssignmentPicker";

type ConsultantOption = { id: string; full_name: string; email: string };
type PersonOption = { id: string; full_name: string; email: string };
type StandardOption = { id: string; title: string; kind: TaskKind };

export default function NewCompanyForm({
  consultores,
  standards,
  collaborators,
}: {
  consultores: ConsultantOption[];
  // Direção 2 — escolher tarefas padrão (com responsável) já na criação.
  standards: StandardOption[];
  collaborators: PersonOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [contactId, setContactId] = useState("");
  const [groupName, setGroupName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [stdRows, setStdRows] = useState<Map<string, PickerRow>>(emptyRows());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();

  const stdItems: PickerItem[] = standards.map((s) => ({
    id: s.id,
    label: s.title,
    badge: <KindBadge kind={s.kind} />,
  }));

  function reset() {
    setName("");
    setContactId("");
    setGroupName("");
    setSelected(new Set());
    setStdRows(emptyRows());
    setError(null);
  }

  function toggleConsultant(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return; // trava reentrância (clique repetido)
    setError(null);

    const { assignments, missing } = collectAssignments(stdItems, stdRows);
    if (missing) {
      setError(`Escolha o responsável da tarefa padrão "${missing.label}".`);
      return;
    }

    setSubmitting(true);
    try {
      const { error: actionError } = await createCompany(
        {
          name,
          whatsappContactId: contactId,
          whatsappGroupName: groupName,
          consultantIds: Array.from(selected),
        },
        assignments.map((a) => ({
          standardId: a.id,
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
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <div className="mb-6">
        <button type="button" onClick={() => setOpen(true)} className={btnPrimary}>
          Nova empresa
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6"
    >
      <h2 className="font-semibold text-fg">Nova empresa</h2>

      <div>
        <label htmlFor="company-name" className={labelClass}>
          Nome da empresa
        </label>
        <input
          id="company-name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
          autoFocus
        />
      </div>

      <GroupSelect
        contactId={contactId}
        groupName={groupName}
        onChange={(id, name) => {
          setContactId(id);
          setGroupName(name);
        }}
      />

      {consultores.length > 0 && (
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-fg">
            Consultores responsáveis
          </legend>
          <div className="flex flex-wrap gap-2">
            {consultores.map((c) => {
              const checked = selected.has(c.id);
              return (
                <label
                  key={c.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition ${
                    checked
                      ? "border-risd bg-brand-tint text-fg"
                      : "border-line bg-surface text-fg-muted hover:border-risd/50"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="accent-risd"
                    checked={checked}
                    onChange={() => toggleConsultant(c.id)}
                  />
                  {c.full_name || c.email}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {standards.length > 0 && collaborators.length > 0 && (
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-fg">
            Tarefas padrão desta empresa{" "}
            <span className="font-normal text-fg-subtle">(opcional)</span>
          </legend>
          <p className="mb-3 text-xs text-fg-subtle">
            Marque as tarefas do catálogo que esta empresa usa e escolha o
            responsável de cada uma. Elas são atribuídas junto ao salvar.
          </p>
          <AssignmentPicker
            items={stdItems}
            collaborators={collaborators}
            rows={stdRows}
            onChange={setStdRows}
            searchPlaceholder="Buscar tarefa padrão…"
            idPrefix="new-co-std"
          />
        </fieldset>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={submitting || isPending}
          className={btnPrimary}
        >
          {submitting || isPending ? "Salvando…" : "Salvar empresa"}
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

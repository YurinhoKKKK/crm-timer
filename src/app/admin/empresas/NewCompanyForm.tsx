"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCompany } from "../actions";
import GroupSelect from "./GroupSelect";
import { inputClass, labelClass, btnPrimary, btnSecondary } from "@/lib/ui";

type ConsultantOption = { id: string; full_name: string; email: string };

export default function NewCompanyForm({
  consultores,
}: {
  consultores: ConsultantOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [contactId, setContactId] = useState("");
  const [groupName, setGroupName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setName("");
    setContactId("");
    setGroupName("");
    setSelected(new Set());
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
    setError(null);

    const { error: actionError } = await createCompany({
      name,
      whatsappContactId: contactId,
      whatsappGroupName: groupName,
      consultantIds: Array.from(selected),
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

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex items-center gap-2">
        <button type="submit" disabled={isPending} className={btnPrimary}>
          {isPending ? "Salvando…" : "Salvar empresa"}
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

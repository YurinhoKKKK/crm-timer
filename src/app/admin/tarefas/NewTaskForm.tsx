"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTaskTemplate } from "../actions";
import Combobox from "@/components/Combobox";
import ListingFields, {
  emptyListingForm,
  type ListingFormValue,
} from "./ListingFields";
import {
  inputClass,
  labelClass,
  hintClass,
  btnPrimary,
  btnSecondary,
  chipClass,
} from "@/lib/ui";

type Option = { id: string; name: string };
type PersonOption = { id: string; full_name: string; email: string };

// Modo do formulário: os dois tipos comuns (única/diária) + a listagem de
// marcas (passo 22), que é sempre pontual e tem campos próprios.
type FormMode = "unica" | "diaria" | "listagem";

const TYPE_OPTIONS: { value: FormMode; label: string }[] = [
  { value: "unica", label: "Única" },
  { value: "diaria", label: "Diária" },
  { value: "listagem", label: "Listagem de marcas" },
];

const WEEKDAYS = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function NewTaskForm({
  companies,
  collaborators,
  lockedCompany,
}: {
  companies: Option[];
  collaborators: PersonOption[];
  // Quando definido, a empresa vem pré-selecionada e travada (uso dentro da
  // tela de detalhe da empresa). O usuário não escolhe a empresa.
  lockedCompany?: Option;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [companyId, setCompanyId] = useState(lockedCompany?.id ?? "");
  const [collaboratorId, setCollaboratorId] = useState("");
  const [mode, setMode] = useState<FormMode>("unica");
  const [startDate, setStartDate] = useState(todayISO());
  const [dueTime, setDueTime] = useState("");
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set());
  const [endDate, setEndDate] = useState("");
  const [listing, setListing] = useState<ListingFormValue>(emptyListingForm());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setTitle("");
    setDescription("");
    setInstructions("");
    setCompanyId(lockedCompany?.id ?? "");
    setCollaboratorId("");
    setMode("unica");
    setStartDate(todayISO());
    setDueTime("");
    setWeekdays(new Set());
    setEndDate("");
    setListing(emptyListingForm());
    setError(null);
  }

  function toggleWeekday(value: number) {
    setWeekdays((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return; // trava reentrância (clique repetido)
    setError(null);
    setSubmitting(true);
    try {
      const isListing = mode === "listagem";
      const { error: actionError } = await createTaskTemplate({
        title,
        description,
        instructions,
        companyId,
        collaboratorId,
        kind: mode === "diaria" ? "diaria" : "unica",
        startDate,
        dueTime,
        weekdays: Array.from(weekdays),
        endDate,
        templateType: isListing ? "listagem" : "padrao",
        brands: isListing ? listing.brands : [],
        marketplaces: isListing ? Array.from(listing.marketplaces) : [],
        needsMargin: isListing ? listing.needsMargin : false,
        taxRate:
          isListing && listing.needsMargin && listing.taxRate.trim() !== ""
            ? Number(listing.taxRate)
            : null,
      });

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
          Nova tarefa
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6"
    >
      <h2 className="font-semibold text-fg">Nova tarefa</h2>

      <div>
        <label htmlFor="task-title" className={labelClass}>
          Título
        </label>
        <input
          id="task-title"
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
          autoFocus
        />
      </div>

      <div>
        <label htmlFor="task-description" className={labelClass}>
          Descrição <span className={hintClass}>(opcional)</span>
        </label>
        <textarea
          id="task-description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="task-instructions" className={labelClass}>
          Instruções <span className={hintClass}>(opcional)</span>
        </label>
        <textarea
          id="task-instructions"
          rows={3}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="task-company" className={labelClass}>
            Empresa
          </label>
          {lockedCompany ? (
            <div
              id="task-company"
              className={`${inputClass} flex items-center justify-between bg-surface-2 text-fg-muted`}
            >
              <span className="truncate">{lockedCompany.name}</span>
              <span className="ml-2 shrink-0 text-xs text-fg-subtle">
                empresa atual
              </span>
            </div>
          ) : (
            <Combobox
              id="task-company"
              value={companyId}
              onChange={setCompanyId}
              options={companies.map((c) => ({ value: c.id, label: c.name }))}
              ariaLabel="Empresa"
              searchPlaceholder="Buscar empresa…"
            />
          )}
        </div>
        <div>
          <label htmlFor="task-collaborator" className={labelClass}>
            Colaborador
          </label>
          <Combobox
            id="task-collaborator"
            value={collaboratorId}
            onChange={setCollaboratorId}
            options={collaborators.map((p) => ({
              value: p.id,
              label: p.full_name || p.email,
            }))}
            ariaLabel="Colaborador"
            searchPlaceholder="Buscar colaborador…"
          />
        </div>
      </div>

      <fieldset>
        <legend className={labelClass}>Tipo</legend>
        <div className="flex flex-wrap gap-2">
          {TYPE_OPTIONS.map((opt) => {
            const active = mode === opt.value;
            return (
              <label key={opt.value} className={chipClass(active)}>
                <input
                  type="radio"
                  name="kind"
                  className="accent-risd"
                  checked={active}
                  onChange={() => setMode(opt.value)}
                />
                {opt.label}
              </label>
            );
          })}
        </div>
      </fieldset>

      {mode === "unica" || mode === "listagem" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="task-start" className={labelClass}>
              Data
            </label>
            <input
              id="task-start"
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="task-due-unica" className={labelClass}>
              Horário <span className={hintClass}>(opcional)</span>
            </label>
            <input
              id="task-due-unica"
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <fieldset>
            <legend className={labelClass}>Dias da semana</legend>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((d) => {
                const checked = weekdays.has(d.value);
                return (
                  <label key={d.value} className={chipClass(checked)}>
                    <input
                      type="checkbox"
                      className="accent-risd"
                      checked={checked}
                      onChange={() => toggleWeekday(d.value)}
                    />
                    {d.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="task-due-diaria" className={labelClass}>
                Horário-limite <span className={hintClass}>(opcional)</span>
              </label>
              <input
                id="task-due-diaria"
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="task-end" className={labelClass}>
                Encerra em <span className={hintClass}>(opcional)</span>
              </label>
              <input
                id="task-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
        </div>
      )}

      {mode === "listagem" && (
        <ListingFields
          idPrefix="new-listing"
          value={listing}
          onChange={(patch) => setListing((prev) => ({ ...prev, ...patch }))}
        />
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={submitting || isPending}
          className={btnPrimary}
        >
          {submitting || isPending ? "Salvando…" : "Salvar tarefa"}
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

"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTaskTemplate } from "../actions";
import type { TaskCategory } from "@/lib/types";
import { TASK_CATEGORIES } from "@/lib/task-category";
import Combobox from "@/components/Combobox";
import { DateField } from "@/components/DateField";
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

// Tipo (única/diária) — só o ADMIN escolhe. A listagem deixou de ser um "tipo":
// virou a categoria "Listagem", que abre o layout próprio.
type Kind = "unica" | "diaria";
const KIND_OPTIONS: { value: Kind; label: string }[] = [
  { value: "unica", label: "Única" },
  { value: "diaria", label: "Diária" },
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
  responsiblesByCompany = {},
  lockedCompany,
  isAdmin = false,
}: {
  companies: Option[];
  collaborators: PersonOption[];
  // Âncora (0090): mapa empresa → ids dos responsáveis. O seletor de colaborador
  // só oferece quem é responsável pela empresa escolhida; o servidor também
  // valida. Ausente/vazio ⇒ nenhuma opção até vincular alguém à empresa.
  responsiblesByCompany?: Record<string, string[]>;
  // Quando definido, a empresa vem pré-selecionada e travada (uso dentro da
  // tela de detalhe da empresa). O usuário não escolhe a empresa.
  lockedCompany?: Option;
  // Só o admin escolhe o tipo (única/diária). Consultor: o campo não aparece e
  // a tarefa nasce ÚNICA (o servidor também garante isso).
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<TaskCategory | "">("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [companyId, setCompanyId] = useState(lockedCompany?.id ?? "");
  const [collaboratorId, setCollaboratorId] = useState("");
  const [kind, setKind] = useState<Kind>("unica");
  const [startDate, setStartDate] = useState(todayISO());
  const [dueTime, setDueTime] = useState("");
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set());
  const [endDate, setEndDate] = useState("");
  const [listing, setListing] = useState<ListingFormValue>(emptyListingForm());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Âncora (0090): as opções de colaborador dependem da empresa escolhida —
  // só os responsáveis por ela. Sem empresa, sem opções.
  const allowedCollaborators = useMemo(() => {
    if (!companyId) return [];
    const allowed = new Set(responsiblesByCompany[companyId] ?? []);
    return collaborators.filter((c) => allowed.has(c.id));
  }, [companyId, collaborators, responsiblesByCompany]);

  // Se a empresa muda e o colaborador escolhido deixa de ser responsável, limpa.
  useEffect(() => {
    if (collaboratorId && !allowedCollaborators.some((c) => c.id === collaboratorId)) {
      setCollaboratorId("");
    }
  }, [allowedCollaborators, collaboratorId]);

  // A categoria é a PRIMEIRA decisão e muda o resto do formulário.
  const isListing = category === "listagem";
  // Pontual quando: listagem (sempre), ou tipo "única" (consultor sempre cai
  // aqui, pois o campo de tipo nem aparece).
  const isPunctual = isListing || kind === "unica";

  function reset() {
    setCategory("");
    setDescription("");
    setInstructions("");
    setCompanyId(lockedCompany?.id ?? "");
    setCollaboratorId("");
    setKind("unica");
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
    if (!category) {
      setError("Selecione a categoria da tarefa.");
      return;
    }
    // O seletor de data do projeto não valida no navegador — garantimos aqui.
    if (isPunctual && !startDate.trim()) {
      setError("Informe a data da tarefa.");
      return;
    }
    setSubmitting(true);
    try {
      const { error: actionError } = await createTaskTemplate({
        category,
        description,
        instructions,
        companyId,
        collaboratorId,
        // Só o admin gera diária; o servidor reforça (consultor → única).
        kind: isAdmin && !isListing && kind === "diaria" ? "diaria" : "unica",
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

  const sectionTitle =
    "text-xs font-semibold uppercase tracking-wide text-fg-subtle";

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 space-y-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6"
    >
      <h2 className="font-semibold text-fg">Nova tarefa</h2>

      {/* Grupo TAREFA: categoria (a primeira decisão), descrição, instruções. */}
      <div className="space-y-4">
        <p className={sectionTitle}>Tarefa</p>

        {/* Categoria em destaque — muda o resto do formulário. */}
        <fieldset className="rounded-xl border border-line bg-surface-2/50 p-4">
          <legend className="px-1 text-sm font-semibold text-fg">
            Categoria
          </legend>
          <div className="flex flex-wrap gap-2">
            {TASK_CATEGORIES.map((c) => {
              const active = category === c.value;
              return (
                <label key={c.value} className={chipClass(active)}>
                  <input
                    type="radio"
                    name="task-category"
                    className="accent-risd"
                    checked={active}
                    onChange={() => setCategory(c.value)}
                  />
                  {c.label}
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* O resto do formulário só aparece depois de escolher a categoria. */}
        {category && (
          <>
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

            {isListing && (
              <ListingFields
                idPrefix="new-listing"
                value={listing}
                onChange={(patch) =>
                  setListing((prev) => ({ ...prev, ...patch }))
                }
              />
            )}
          </>
        )}
      </div>

      {/* Grupo EXECUÇÃO: quem, onde e quando. */}
      {category && (
        <div className="space-y-4 border-t border-line pt-6">
          <p className={sectionTitle}>Execução</p>

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
              {!companyId ? (
                <p className={`${hintClass} mt-1`}>Selecione a empresa primeiro.</p>
              ) : allowedCollaborators.length === 0 ? (
                <p className={`${hintClass} mt-1`}>
                  Nenhum responsável vinculado a esta empresa. Vincule alguém em
                  Editar empresa antes de criar a tarefa.
                </p>
              ) : (
                <Combobox
                  id="task-collaborator"
                  value={collaboratorId}
                  onChange={setCollaboratorId}
                  options={allowedCollaborators.map((p) => ({
                    value: p.id,
                    label: p.full_name || p.email,
                  }))}
                  ariaLabel="Colaborador"
                  searchPlaceholder="Buscar colaborador…"
                />
              )}
            </div>
          </div>

          {/* Tipo (única/diária) — só admin, e não se aplica a Listagem. */}
          {isAdmin && !isListing && (
            <fieldset>
              <legend className={labelClass}>Tipo</legend>
              <div className="flex flex-wrap gap-2">
                {KIND_OPTIONS.map((opt) => {
                  const active = kind === opt.value;
                  return (
                    <label key={opt.value} className={chipClass(active)}>
                      <input
                        type="radio"
                        name="task-kind"
                        className="accent-risd"
                        checked={active}
                        onChange={() => setKind(opt.value)}
                      />
                      {opt.label}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          {/* Quando: pontual (data + horário) OU diária (dias + limite + fim). */}
          {isPunctual ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Data</label>
                <DateField
                  value={startDate}
                  onChange={setStartDate}
                  ariaLabel="Data da tarefa"
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
                  <label className={labelClass}>
                    Encerra em <span className={hintClass}>(opcional)</span>
                  </label>
                  <DateField
                    value={endDate}
                    onChange={setEndDate}
                    ariaLabel="Data em que a tarefa diária encerra"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
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

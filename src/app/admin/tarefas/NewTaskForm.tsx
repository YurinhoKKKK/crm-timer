"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TaskKind } from "@/lib/types";
import { createTaskTemplate } from "../actions";

type Option = { id: string; name: string };
type PersonOption = { id: string; full_name: string; email: string };

const WEEKDAYS = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
];

const inputClass =
  "w-full rounded-lg border border-platinum bg-white px-3 py-2 text-sm text-gunmetal shadow-sm transition focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2";

const labelClass = "mb-1 block text-sm font-medium text-gunmetal";

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
  const [kind, setKind] = useState<TaskKind>("unica");
  const [startDate, setStartDate] = useState(todayISO());
  const [dueTime, setDueTime] = useState("");
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set());
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setTitle("");
    setDescription("");
    setInstructions("");
    setCompanyId(lockedCompany?.id ?? "");
    setCollaboratorId("");
    setKind("unica");
    setStartDate(todayISO());
    setDueTime("");
    setWeekdays(new Set());
    setEndDate("");
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
    setError(null);

    const { error: actionError } = await createTaskTemplate({
      title,
      description,
      instructions,
      companyId,
      collaboratorId,
      kind,
      startDate,
      dueTime,
      weekdays: Array.from(weekdays),
      endDate,
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
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg bg-risd px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-chrysler focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2"
        >
          Nova tarefa
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 space-y-4 rounded-xl border border-platinum bg-white p-5 shadow-sm"
    >
      <h2 className="font-medium text-gunmetal">Nova tarefa</h2>

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
          Descrição{" "}
          <span className="font-normal text-gunmetal/40">(opcional)</span>
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
          Instruções{" "}
          <span className="font-normal text-gunmetal/40">(opcional)</span>
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
              className={`${inputClass} flex items-center justify-between bg-paper text-gunmetal/70`}
            >
              <span className="truncate">{lockedCompany.name}</span>
              <span className="ml-2 shrink-0 text-xs text-gunmetal/40">
                empresa atual
              </span>
            </div>
          ) : (
            <select
              id="task-company"
              required
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className={inputClass}
            >
              <option value="">Selecione…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div>
          <label htmlFor="task-collaborator" className={labelClass}>
            Colaborador
          </label>
          <select
            id="task-collaborator"
            required
            value={collaboratorId}
            onChange={(e) => setCollaboratorId(e.target.value)}
            className={inputClass}
          >
            <option value="">Selecione…</option>
            {collaborators.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || p.email}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset>
        <legend className={labelClass}>Tipo</legend>
        <div className="flex gap-2">
          {(["unica", "diaria"] as TaskKind[]).map((k) => {
            const active = kind === k;
            return (
              <label
                key={k}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition ${
                  active
                    ? "border-risd bg-brand-soft text-gunmetal"
                    : "border-platinum bg-white text-gunmetal/70 hover:border-risd/50"
                }`}
              >
                <input
                  type="radio"
                  name="kind"
                  className="accent-risd"
                  checked={active}
                  onChange={() => setKind(k)}
                />
                {k === "unica" ? "Única" : "Diária"}
              </label>
            );
          })}
        </div>
      </fieldset>

      {kind === "unica" ? (
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
              Horário-limite{" "}
              <span className="font-normal text-gunmetal/40">(opcional)</span>
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
                  <label
                    key={d.value}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition ${
                      checked
                        ? "border-risd bg-brand-soft text-gunmetal"
                        : "border-platinum bg-white text-gunmetal/70 hover:border-risd/50"
                    }`}
                  >
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
                Horário-limite{" "}
                <span className="font-normal text-gunmetal/40">(opcional)</span>
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
                Encerra em{" "}
                <span className="font-normal text-gunmetal/40">(opcional)</span>
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

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-risd px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-chrysler focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Salvando…" : "Salvar tarefa"}
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="rounded-lg border border-platinum bg-white px-4 py-2 text-sm text-gunmetal/70 transition hover:border-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

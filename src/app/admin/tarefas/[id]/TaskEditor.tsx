"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TaskKind, TaskTemplate } from "@/lib/types";
import { updateTaskTemplate } from "../../actions";
import Combobox from "@/components/Combobox";
import {
  inputClass,
  labelClass,
  hintClass,
  btnPrimary,
  chipClass,
} from "@/lib/ui";

type Option = { id: string; name: string };
type PersonOption = { id: string; full_name: string; email: string };
type Status = "idle" | "saving" | "saved" | "error";

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

export default function TaskEditor({
  template,
  companies,
  collaborators,
}: {
  template: TaskTemplate;
  companies: Option[];
  collaborators: PersonOption[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(template.title);
  const [description, setDescription] = useState(template.description ?? "");
  const [instructions, setInstructions] = useState(template.instructions ?? "");
  const [companyId, setCompanyId] = useState(template.company_id);
  const [collaboratorId, setCollaboratorId] = useState(template.collaborator_id);
  const [kind, setKind] = useState<TaskKind>(template.kind);
  const [startDate, setStartDate] = useState(template.start_date ?? todayISO());
  const [dueTime, setDueTime] = useState(template.due_time?.slice(0, 5) ?? "");
  const [weekdays, setWeekdays] = useState<Set<number>>(
    new Set(template.weekdays ?? [])
  );
  const [endDate, setEndDate] = useState(template.end_date ?? "");
  const [active, setActive] = useState(template.active);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();

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
    setStatus("saving");
    setErrorMsg(null);

    const { error } = await updateTaskTemplate(template.id, {
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
      active,
    });

    if (error) {
      setStatus("error");
      setErrorMsg(error);
      return;
    }

    setStatus("saved");
    startTransition(() => router.refresh());
    window.setTimeout(() => setStatus("idle"), 1500);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="t-title" className={labelClass}>
          Título
        </label>
        <input
          id="t-title"
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="t-description" className={labelClass}>
          Descrição <span className={hintClass}>(opcional)</span>
        </label>
        <textarea
          id="t-description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="t-instructions" className={labelClass}>
          Instruções <span className={hintClass}>(opcional)</span>
        </label>
        <textarea
          id="t-instructions"
          rows={3}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="t-company" className={labelClass}>
            Empresa
          </label>
          <Combobox
            id="t-company"
            value={companyId}
            onChange={setCompanyId}
            options={companies.map((c) => ({ value: c.id, label: c.name }))}
            ariaLabel="Empresa"
            searchPlaceholder="Buscar empresa…"
          />
        </div>
        <div>
          <label htmlFor="t-collaborator" className={labelClass}>
            Colaborador
          </label>
          <Combobox
            id="t-collaborator"
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
        <div className="flex gap-2">
          {(["unica", "diaria"] as TaskKind[]).map((k) => {
            const isActive = kind === k;
            return (
              <label key={k} className={chipClass(isActive)}>
                <input
                  type="radio"
                  name="t-kind"
                  className="accent-risd"
                  checked={isActive}
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
            <label htmlFor="t-start" className={labelClass}>
              Data
            </label>
            <input
              id="t-start"
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="t-due-unica" className={labelClass}>
              Horário-limite <span className={hintClass}>(opcional)</span>
            </label>
            <input
              id="t-due-unica"
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
              <label htmlFor="t-due-diaria" className={labelClass}>
                Horário-limite <span className={hintClass}>(opcional)</span>
              </label>
              <input
                id="t-due-diaria"
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="t-end" className={labelClass}>
                Encerra em <span className={hintClass}>(opcional)</span>
              </label>
              <input
                id="t-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
        </div>
      )}

      <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="accent-risd"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        Tarefa ativa{" "}
        <span className="text-fg-subtle">
          (desmarque para parar a geração diária)
        </span>
      </label>

      {status === "error" && errorMsg && (
        <p className="text-sm text-red-600 dark:text-red-400">{errorMsg}</p>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={status === "saving"} className={btnPrimary}>
          {status === "saving" ? "Salvando…" : "Salvar alterações"}
        </button>
        <span className="text-xs" aria-live="polite">
          {status === "saved" && <span className="text-risd">Salvo</span>}
        </span>
      </div>
    </form>
  );
}

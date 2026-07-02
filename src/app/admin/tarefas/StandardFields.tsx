"use client";

import type { TaskKind } from "@/lib/types";
import { inputClass, labelClass, hintClass, chipClass } from "@/lib/ui";

const WEEKDAYS = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
];

export type StandardFormValue = {
  title: string;
  description: string;
  instructions: string;
  kind: TaskKind;
  dueTime: string;
  weekdays: Set<number>;
};

export function emptyStandardForm(): StandardFormValue {
  return {
    title: "",
    description: "",
    instructions: "",
    kind: "unica",
    dueTime: "",
    weekdays: new Set(),
  };
}

// Campos comuns do molde de tarefa padrão (sem empresa, responsável ou data —
// esses são definidos na atribuição). Reutilizado por criar e editar.
export default function StandardFields({
  idPrefix,
  value,
  onChange,
  autoFocus,
}: {
  idPrefix: string;
  value: StandardFormValue;
  onChange: (patch: Partial<StandardFormValue>) => void;
  autoFocus?: boolean;
}) {
  function toggleWeekday(day: number) {
    const next = new Set(value.weekdays);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    onChange({ weekdays: next });
  }

  return (
    <>
      <div>
        <label htmlFor={`${idPrefix}-title`} className={labelClass}>
          Título
        </label>
        <input
          id={`${idPrefix}-title`}
          type="text"
          required
          value={value.title}
          onChange={(e) => onChange({ title: e.target.value })}
          className={inputClass}
          autoFocus={autoFocus}
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-description`} className={labelClass}>
          Descrição <span className={hintClass}>(opcional)</span>
        </label>
        <textarea
          id={`${idPrefix}-description`}
          rows={2}
          value={value.description}
          onChange={(e) => onChange({ description: e.target.value })}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-instructions`} className={labelClass}>
          Instruções <span className={hintClass}>(opcional)</span>
        </label>
        <textarea
          id={`${idPrefix}-instructions`}
          rows={3}
          value={value.instructions}
          onChange={(e) => onChange({ instructions: e.target.value })}
          className={inputClass}
        />
      </div>

      <fieldset>
        <legend className={labelClass}>Tipo</legend>
        <div className="flex gap-2">
          {(["unica", "diaria"] as TaskKind[]).map((k) => {
            const active = value.kind === k;
            return (
              <label key={k} className={chipClass(active)}>
                <input
                  type="radio"
                  name={`${idPrefix}-kind`}
                  className="accent-risd"
                  checked={active}
                  onChange={() => onChange({ kind: k })}
                />
                {k === "unica" ? "Única" : "Diária"}
              </label>
            );
          })}
        </div>
      </fieldset>

      {value.kind === "diaria" && (
        <fieldset>
          <legend className={labelClass}>Dias da semana</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => {
              const checked = value.weekdays.has(d.value);
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
      )}

      <div className="sm:max-w-[50%]">
        <label htmlFor={`${idPrefix}-due`} className={labelClass}>
          Horário-limite <span className={hintClass}>(opcional)</span>
        </label>
        <input
          id={`${idPrefix}-due`}
          type="time"
          value={value.dueTime}
          onChange={(e) => onChange({ dueTime: e.target.value })}
          className={inputClass}
        />
      </div>
    </>
  );
}

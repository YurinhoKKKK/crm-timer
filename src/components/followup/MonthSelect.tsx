"use client";

import type { MonthOption } from "@/lib/followup";

// Seletor de mês compartilhado pelas duas abas do /acompanhamento (quadro e
// Pontuação) — mesmo componente e mesmo estilo. Vai de setembro/2026 até o mês
// corrente; o corrente aparece como "(em andamento)".
export default function MonthSelect({
  id,
  month,
  options,
  onChange,
  ariaLabel,
}: {
  id: string;
  month: string;
  options: MonthOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  return (
    <select
      id={id}
      value={month}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm transition focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
    >
      {options.map((m) => (
        <option key={m.value} value={m.value}>
          {m.label}
          {m.current ? " (em andamento)" : ""}
        </option>
      ))}
    </select>
  );
}

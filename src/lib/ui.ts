// Classes de UI compartilhadas entre formulários, para manter consistência
// visual (e dark mode) em todas as telas.

export const inputClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm transition placeholder:text-fg-subtle focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

export const labelClass = "mb-1 block text-sm font-medium text-fg";

export const hintClass = "font-normal text-fg-subtle";

export const btnPrimary =
  "rounded-lg bg-risd px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-chrysler focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60";

export const btnSecondary =
  "rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg shadow-sm transition hover:border-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60";

export const cardClass =
  "rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6";

// "Chip" selecionável (tipo de tarefa, dias da semana, consultores).
export function chipClass(active: boolean): string {
  return `flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition ${
    active
      ? "border-risd bg-brand-tint text-fg"
      : "border-line bg-surface text-fg-muted hover:border-risd/50"
  }`;
}

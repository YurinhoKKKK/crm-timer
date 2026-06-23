import type { TaskStatus } from "@/lib/types";

// Metadados de exibição dos status de tarefa. Classes preparadas para os
// temas claro e escuro (tokens semânticos + variantes dark dos coloridos).
export const STATUS_META: Record<
  TaskStatus,
  { label: string; badge: string; dot: string }
> = {
  a_fazer: {
    label: "A fazer",
    badge: "border border-line bg-surface-2 text-fg-muted",
    dot: "bg-fg-subtle",
  },
  iniciada: {
    label: "Iniciada",
    badge: "bg-brand-tint text-risd",
    dot: "bg-risd",
  },
  finalizada: {
    label: "Finalizada",
    badge:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  cancelada: {
    label: "Cancelada",
    badge: "bg-surface-2 text-fg-subtle",
    dot: "bg-fg-subtle",
  },
};

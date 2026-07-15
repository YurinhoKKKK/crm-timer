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

// Valor do filtro "Atrasada" nas listas. Não é um TaskStatus real (é um recorte
// derivado: em aberto + prazo vencido), então convive com os status nos selects.
export const OVERDUE_FILTER = "atrasada";

// Opções do filtro de status compartilhado pelas listas: os 4 status + Atrasada.
export const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  ...(Object.keys(STATUS_META) as TaskStatus[]).map((s) => ({
    value: s,
    label: STATUS_META[s].label,
  })),
  { value: OVERDUE_FILTER, label: "Atrasada" },
];

// Atrasada = tarefa em aberto (a fazer/iniciada) com prazo vencido. due_at é
// timestamptz gravado no fuso de Brasília (migration 0019) — instante absoluto,
// então a comparação por epoch vale em qualquer fuso.
export function isOverdue(
  status: TaskStatus,
  dueAt: string | null,
  nowMs: number = Date.now()
): boolean {
  return (
    (status === "a_fazer" || status === "iniciada") &&
    !!dueAt &&
    new Date(dueAt).getTime() < nowMs
  );
}

// Aplica o valor escolhido no filtro de status (um TaskStatus ou "atrasada").
export function matchesStatusFilter(
  filter: string,
  status: TaskStatus,
  dueAt: string | null,
  nowMs?: number
): boolean {
  if (!filter) return true;
  if (filter === OVERDUE_FILTER) return isOverdue(status, dueAt, nowMs);
  return status === filter;
}

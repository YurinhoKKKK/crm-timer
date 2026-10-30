// Tipos e helpers PUROS da auditoria de Atrasos (tela /admin/atrasos + export).
// Sem diretiva "use client"/"use server": só tipos e funções sem efeito,
// seguras no servidor e no cliente.

import { categoryLabel } from "@/lib/task-category";

// Situações do universo de atrasos (mutuamente exclusivas).
export type SituationKey = "completed_late" | "open_overdue" | "expired";

export const SITUATION_META: Record<
  SituationKey,
  { label: string; badge: string; dot: string }
> = {
  completed_late: {
    label: "Concluída com atraso",
    badge:
      "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  open_overdue: {
    label: "Atrasada em aberto",
    badge: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
    dot: "bg-red-500",
  },
  expired: {
    label: "Expirada",
    badge: "bg-surface-2 text-fg-subtle",
    dot: "bg-fg-subtle",
  },
};

// Opções do filtro de situação (os três recortes do universo de atrasos).
export const SITUATION_FILTER_OPTIONS: { value: string; label: string }[] = (
  ["completed_late", "open_overdue", "expired"] as SituationKey[]
).map((s) => ({ value: s, label: SITUATION_META[s].label }));

// Ordenações da lista (ver RPC atrasos_list).
export type ListOrder = "atraso" | "recentes" | "prazo";

export const LIST_ORDER_OPTIONS: { value: ListOrder; label: string }[] = [
  { value: "atraso", label: "Mais atrasadas" },
  { value: "recentes", label: "Mais recentes" },
  { value: "prazo", label: "Prazo concedido" },
];

export function normalizeListOrder(value: string | undefined): ListOrder {
  return value === "recentes" || value === "prazo" ? value : "atraso";
}

// Nomes dos parâmetros de URL desta tela (namespaced p/ conviver com os do
// período — periodo/de/ate/mes — e serem lidos no servidor e nos dois clientes).
export const PARAM = {
  status: "fstatus", // situação
  creator: "fcriador",
  responsible: "fresp",
  company: "fempresa",
  type: "ftipo",
  order: "fordem",
  search: "fbusca",
  standard: "fpadrao", // "1" = incluir tarefas padrão diárias
} as const;

// Linha da lista, já no formato que a UI consome.
export type AtrasoRow = {
  id: string;
  title: string;
  companyId: string;
  companyName: string;
  typeKey: string;
  typeLabel: string;
  responsible: { id: string | null; name: string; avatarUrl: string | null };
  creator: { id: string | null; name: string | null; avatarUrl: string | null };
  createdAt: string | null;
  dueAt: string | null;
  grantedSeconds: number | null;
  finishedAt: string | null;
  delaySeconds: number;
  situation: SituationKey;
};

// --- Drill-down (painel de uma célula do resumo) ---------------------------
export type CellDimension = "creator" | "responsible";
// Dimensão do painel: por pessoa (criador/responsável) ou GLOBAL ('all' — os
// números do cabeçalho, sem pessoa fixa; a linha mostra os dois lados).
export type PanelDimension = CellDimension | "all";
export type CellMetric =
  | "total"
  | "completed_late"
  | "open_overdue"
  | "expired"
  | "under24";

export const METRIC_LABEL: Record<CellMetric, string> = {
  total: "Tarefas",
  completed_late: "Concluídas com atraso",
  open_overdue: "Atrasadas em aberto",
  expired: "Expiradas",
  under24: "Prazo menor que 24 h",
};

// Situação no painel: as 3 de atraso + as não-atrasadas (métrica "Tarefas").
export type CellSituation = SituationKey | "on_time" | "pending";

export const CELL_SITUATION_META: Record<
  CellSituation,
  { label: string; badge: string; dot: string }
> = {
  ...SITUATION_META,
  on_time: {
    label: "No prazo",
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  pending: {
    label: "Em andamento",
    badge: "bg-brand-tint text-risd",
    dot: "bg-risd",
  },
};

// Linha do painel: como AtrasoRow, mas atraso pode não existir (não-atrasadas).
export type CellRow = Omit<AtrasoRow, "situation" | "delaySeconds"> & {
  situation: CellSituation;
  delaySeconds: number | null;
};

// Pessoa dos blocos de resumo (criador tem under24Late; responsável não).
export type SummaryPerson = {
  id: string;
  name: string;
  avatarUrl: string | null;
  total: number;
  late: number;
  onTimePct: number;
  completedLate: number;
  openOverdue: number;
  expired: number;
  medianDelaySeconds: number;
  under24Late?: number;
};

// Colunas ordenáveis dos blocos de resumo.
export type SummarySort =
  | "late"
  | "total"
  | "onTimePct"
  | "completedLate"
  | "openOverdue"
  | "expired"
  | "medianDelaySeconds"
  | "under24Late";

// Rótulo de exibição do "tipo": categorias viram o rótulo PT; modelos padrão
// mantêm o próprio título (a chave carrega a origem 'cat:'/'title:').
export function displayTypeLabel(key: string, rawLabel: string): string {
  return key.startsWith("cat:") ? categoryLabel(key.slice(4)) : rawLabel;
}

// Duração "humana" compacta p/ atraso e prazo concedido: "2 d 4 h", "5 h 10 min",
// "35 min", "<1 min". Nunca negativa (piso em 0).
export function formatSpan(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return "—";
  let s = Math.max(0, Math.round(totalSeconds));
  const days = Math.floor(s / 86400);
  s -= days * 86400;
  const hours = Math.floor(s / 3600);
  s -= hours * 3600;
  const minutes = Math.floor(s / 60);

  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  if (minutes > 0) return `${minutes} min`;
  return "<1 min";
}

// Query string só com os filtros desta tela (sem o período), p/ anexar ao export.
export function atrasosFilterQuery(params: URLSearchParams): string {
  const out = new URLSearchParams();
  for (const key of Object.values(PARAM)) {
    const v = params.get(key);
    if (v) out.set(key, v);
  }
  return out.toString();
}

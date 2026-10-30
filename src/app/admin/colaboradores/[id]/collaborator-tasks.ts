// Tipos e helpers PUROS do detalhe do colaborador (lista paginada no banco).
// Compartilhado pela server action (actions.ts) e pelo client component
// (CollaboratorTaskList.tsx) — sem diretiva "use client"/"use server", só tipos
// e funções sem efeito, seguras nos dois lados.

import type { TaskStatus } from "@/lib/types";
import { categoryLabel } from "@/lib/task-category";

// Ordenações da lista (ver RPC collaborator_tasks_page).
export type TaskOrder = "recentes" | "antigas" | "proximo";

export const TASK_ORDER_OPTIONS: { value: TaskOrder; label: string }[] = [
  { value: "recentes", label: "Mais recentes" },
  { value: "antigas", label: "Mais antigas" },
  { value: "proximo", label: "Prazo mais próximo" },
];

export function normalizeOrder(value: string | undefined): TaskOrder {
  return value === "antigas" || value === "proximo" ? value : "recentes";
}

export type Adjustment = {
  oldSeconds: number;
  newSeconds: number;
  reason: string | null;
  at: string;
  by: string;
};

// Linha da lista, já no formato que a UI consome.
export type CollaboratorTask = {
  id: string;
  title: string;
  status: TaskStatus;
  dueAt: string | null;
  taskDate: string;
  finishedAt: string | null;
  totalSeconds: number;
  companyId: string;
  companyName: string;
  typeKey: string;
  typeLabel: string; // rótulo cru vindo do banco (enum p/ categorias, título p/ padrão)
  // Entrou na lista SÓ pelo trabalho no período (prazo fora do período e não
  // atrasada) → recebe o selo "Trabalhada no período · prazo DD/MM".
  onlyByWork: boolean;
  // Criador da tarefa (task_templates.created_by) — mesma fonte/regras do
  // describeInstanceCreator. name/id nulos = criada pelo sistema.
  creator: {
    id: string | null;
    name: string | null;
    avatarUrl: string | null;
    fromStandard: boolean;
    systemGenerated: boolean;
    hasOrigin: boolean;
  };
  adjustments: Adjustment[]; // mais recente primeiro
};

// Opção de filtro de tipo (categoria/modelo).
export type TypeOption = { key: string; label: string };

// Opção de filtro de criador (foto + nome vêm do facet).
export type CreatorOption = { id: string; name: string; avatarUrl: string | null };

// Sufixo de origem do criador, igual ao detalhe da tarefa: tarefa padrão →
// "· Padrão diária"; gerada pela recorrência → "· Recorrente"; senão vazio.
export function creatorOriginSuffix(c: {
  fromStandard: boolean;
  systemGenerated: boolean;
}): string {
  if (c.fromStandard) return "· Padrão diária";
  if (c.systemGenerated) return "· Recorrente";
  return "";
}

// Rótulo de exibição do "tipo": categorias viram o rótulo PT (via categoryLabel);
// modelos padrão mantêm o próprio título. Vale tanto para a linha quanto para o
// seletor de tipo — a chave carrega a origem ('cat:'/'title:').
export function displayTypeLabel(key: string, rawLabel: string): string {
  return key.startsWith("cat:") ? categoryLabel(key.slice(4)) : rawLabel;
}

const BRT = "America/Sao_Paulo";

const ymdFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: BRT,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const weekdayFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: BRT,
  weekday: "short",
});
const dayMonthFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: BRT,
  day: "2-digit",
  month: "2-digit",
});

// Data BRT (YYYY-MM-DD) de um instante; "" para prazo nulo.
export function brtDateOf(iso: string | null): string {
  if (!iso) return "";
  return ymdFmt.format(new Date(iso));
}

// "DD/MM" BRT do prazo (para o selo "Trabalhada no período · prazo DD/MM").
export function dueDayMonth(iso: string | null): string {
  return iso ? dayMonthFmt.format(new Date(iso)) : "sem prazo";
}

// Cabeçalho do grupo de DIA do prazo: "Hoje", "Ontem", "Seg 27/10" ou "Sem prazo".
export function dayHeaderLabel(iso: string | null, todayYmd: string, yesterdayYmd: string): string {
  if (!iso) return "Sem prazo";
  const ymd = brtDateOf(iso);
  if (ymd === todayYmd) return "Hoje";
  if (ymd === yesterdayYmd) return "Ontem";
  const d = new Date(iso);
  const wd = weekdayFmt.format(d).replace(".", "");
  const cap = wd.charAt(0).toUpperCase() + wd.slice(1);
  return `${cap} ${dayMonthFmt.format(d)}`;
}

// Agrupa uma lista JÁ ORDENADA por dia do prazo, preservando a ordem do servidor.
export type DayGroup = { key: string; label: string; items: CollaboratorTask[] };

export function groupByDueDay(
  tasks: CollaboratorTask[],
  todayYmd: string,
  yesterdayYmd: string
): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const t of tasks) {
    const key = brtDateOf(t.dueAt) || "__none__";
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(t);
    } else {
      groups.push({
        key,
        label: dayHeaderLabel(t.dueAt, todayYmd, yesterdayYmd),
        items: [t],
      });
    }
  }
  return groups;
}

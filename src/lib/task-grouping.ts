import type { TaskStatus } from "@/lib/types";
import { isOverdue } from "@/lib/status";

// Núcleo do AGRUPAMENTO das listas de tarefa. As diárias (principalmente as
// vindas de tarefas padrão) acumulam uma instância por dia; aqui as ocorrências
// da mesma tarefa (mesmo template) viram uma linha expansível, SEM esconder o
// que exige ação:
//
//  - ATIVAS ficam soltas ("active"): até MAX_OPEN_FLAT instâncias abertas
//    (a fazer/iniciada) mais recentes de cada template — cobre a de hoje e as
//    urgentes. O excedente (pilha de atrasadas antigas) dobra para dentro do
//    grupo, que sinaliza "⚠ N atrasadas" no cabeçalho.
//  - HISTÓRICO agrupa ("history"): finalizadas/canceladas + o excedente acima.
//    Instâncias sem template (órfãs) e templates de ocorrência única não
//    agrupam — seguem como linhas normais.
//
// As contagens verdadeiras vêm do banco (RPC task_group_stats) quando a lista
// não está sub-filtrada por status; senão, das instâncias carregadas que
// casaram com o filtro. Puro e genérico: cada lista passa seus itens (que
// estendem GroupEntry) e renderiza os grupos com TaskGroupRow.

export type GroupEntry = {
  id: string;
  title: string;
  status: TaskStatus;
  due_at: string | null;
  task_date: string; // YYYY-MM-DD (única por template — unique no banco)
  templateId: string | null;
  total_seconds: number;
  collaboratorName?: string;
  collaboratorAvatarUrl?: string | null;
};

// Linha da RPC task_group_stats (contagens agregadas no banco, sob RLS).
export type GroupStats = {
  template_id: string;
  total: number;
  finalizadas: number;
  canceladas: number;
  abertas: number;
  atrasadas: number;
  seconds: number;
  first_date: string;
  last_date: string;
};

export type TaskGroup<T extends GroupEntry> = {
  templateId: string;
  title: string;
  // Instâncias carregadas do grupo (abertas dobradas + fechadas), data desc.
  items: T[];
  total: number;
  finalizadas: number;
  canceladas: number;
  pendentes: number; // abertas sem prazo vencido
  atrasadas: number;
  firstDate: string;
  lastDate: string;
  // O banco tem mais fechadas além das carregadas ("ver mais" sob demanda).
  hasMore: boolean;
};

export type GroupedRow<T extends GroupEntry> =
  | { kind: "item"; item: T }
  | { kind: "group"; group: TaskGroup<T> };

// Quantas abertas de um mesmo template ficam soltas antes de dobrar no grupo.
export const MAX_OPEN_FLAT = 3;

export function isOpenStatus(status: TaskStatus): boolean {
  return status === "a_fazer" || status === "iniciada";
}

const byDateDesc = (a: GroupEntry, b: GroupEntry) =>
  b.task_date.localeCompare(a.task_date);

export function groupTasks<T extends GroupEntry>(
  items: T[],
  stats?: GroupStats[],
  opts?: {
    // false quando a lista está filtrada por status (as contagens do banco
    // não refletiriam o recorte); as contagens caem para as carregadas.
    useDbCounts?: boolean;
    nowMs?: number;
  }
): { active: T[]; history: GroupedRow<T>[] } {
  const useDbCounts = opts?.useDbCounts ?? true;
  const now = opts?.nowMs ?? Date.now();

  const statsMap = new Map<string, GroupStats>();
  if (useDbCounts) for (const s of stats ?? []) statsMap.set(s.template_id, s);

  const active: T[] = [];
  const history: GroupedRow<T>[] = [];

  const buckets = new Map<string, T[]>();
  for (const it of items) {
    if (!it.templateId) {
      // Órfã (template removido) — nunca agrupa.
      if (isOpenStatus(it.status)) active.push(it);
      else history.push({ kind: "item", item: it });
      continue;
    }
    const list = buckets.get(it.templateId) ?? [];
    list.push(it);
    buckets.set(it.templateId, list);
  }

  buckets.forEach((bucket, templateId) => {
    const st = statsMap.get(templateId);
    const knownTotal = st?.total ?? bucket.length;

    // Ocorrência única: linha normal (sem grupo de 1).
    if (knownTotal <= 1 && bucket.length <= 1) {
      const only = bucket[0];
      if (!only) return;
      if (isOpenStatus(only.status)) active.push(only);
      else history.push({ kind: "item", item: only });
      return;
    }

    const open = bucket.filter((i) => isOpenStatus(i.status)).sort(byDateDesc);
    const closed = bucket
      .filter((i) => !isOpenStatus(i.status))
      .sort(byDateDesc);

    // As abertas mais recentes ficam visíveis e destacadas fora do grupo.
    active.push(...open.slice(0, MAX_OPEN_FLAT));
    const folded = open.slice(MAX_OPEN_FLAT);

    const groupItems = [...folded, ...closed].sort(byDateDesc);
    const closedInDb = st ? st.finalizadas + st.canceladas : closed.length;
    const hasMore = closedInDb > closed.length;

    if (groupItems.length === 0 && !hasMore) return; // tudo já está solto

    const loadedOverdue = open.filter((i) =>
      isOverdue(i.status, i.due_at, now)
    ).length;

    const group: TaskGroup<T> = st
      ? {
          templateId,
          title: bucket[0].title,
          items: groupItems,
          total: st.total,
          finalizadas: st.finalizadas,
          canceladas: st.canceladas,
          pendentes: st.abertas - st.atrasadas,
          atrasadas: st.atrasadas,
          firstDate: st.first_date,
          lastDate: st.last_date,
          hasMore,
        }
      : {
          templateId,
          title: bucket[0].title,
          items: groupItems,
          total: bucket.length,
          finalizadas: bucket.filter((i) => i.status === "finalizada").length,
          canceladas: bucket.filter((i) => i.status === "cancelada").length,
          pendentes: open.length - loadedOverdue,
          atrasadas: loadedOverdue,
          firstDate: bucket.reduce(
            (min, i) => (i.task_date < min ? i.task_date : min),
            bucket[0].task_date
          ),
          lastDate: bucket.reduce(
            (max, i) => (i.task_date > max ? i.task_date : max),
            bucket[0].task_date
          ),
          hasMore: false,
        };

    history.push({ kind: "group", group });
  });

  // Ativas: mais urgente primeiro (prazo asc; sem prazo por último).
  active.sort((a, b) => {
    if (!a.due_at && !b.due_at) return byDateDesc(a, b);
    if (!a.due_at) return 1;
    if (!b.due_at) return -1;
    return a.due_at.localeCompare(b.due_at);
  });

  // Histórico: mais recente primeiro (grupos pela última ocorrência).
  history.sort((a, b) => {
    const da = a.kind === "group" ? a.group.lastDate : a.item.task_date;
    const db = b.kind === "group" ? b.group.lastDate : b.item.task_date;
    return db.localeCompare(da);
  });

  return { active, history };
}

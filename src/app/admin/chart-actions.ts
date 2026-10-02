"use server";

import { createClient } from "@/lib/supabase-server";
import type { TaskStatus } from "@/lib/types";
import { avatarUrl } from "@/lib/avatar";

// Uma OCORRÊNCIA (instância) que compôs o tempo — o segundo nível do painel.
export type BreakdownOccurrence = {
  id: string; // id da instância (abre o detalhe da tarefa)
  taskDate: string | null; // dia da ocorrência (task_date)
  status: TaskStatus;
  collaboratorName: string;
  collaboratorAvatarUrl: string | null;
  seconds: number;
};

// Uma TAREFA (molde) — o primeiro nível do painel: tempo TOTAL somado no período
// e quantas ocorrências o compõem. Uma tarefa pontual tem 1 ocorrência; uma
// diária tem N (uma por dia trabalhado).
export type BreakdownTaskGroup = {
  key: string; // template_id (ou id da instância quando não há molde)
  title: string;
  totalSeconds: number;
  count: number;
  occurrences: BreakdownOccurrence[]; // ordenadas por data (mais recente primeiro)
};

type Joined<T> = T | T[] | null;
function first<T>(value: Joined<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

type Row = {
  id: string;
  title: string;
  status: TaskStatus;
  template_id: string | null;
  task_date: string | null;
  collaborator: Joined<{
    full_name: string | null;
    email: string;
    avatar_path: string | null;
  }>;
};

// Passo 17 (+ correção do agrupamento) — as TAREFAS que compõem o tempo de uma
// empresa no período, AGRUPADAS por molde (uma linha por tarefa, com o tempo
// total e o nº de ocorrências); as ocorrências individuais (data/status/
// responsável/tempo) ficam no segundo nível. O tempo por ocorrência é o
// TRABALHADO no período (time_entries por started_at), não o total_seconds da
// instância — assim a soma bate com a barra do gráfico, que também vem de
// time_entries. `collaboratorId` opcional escopa a um único responsável (tela do
// colaborador). `category` escopa a UMA categoria (ou ao bucket '__diaria__' das
// tarefas padrão). A RLS (ti_select / te_select) protege o acesso.
export async function getCompanyTimeBreakdown(
  companyId: string,
  // Intervalo RESOLVIDO (datas puras BRT). start null = sem início; end null =
  // aberto até hoje. Mesmo intervalo das barras do gráfico, para a soma bater.
  start: string | null,
  end: string | null,
  collaboratorId?: string,
  category?: string
): Promise<{
  error: string | null;
  groups?: BreakdownTaskGroup[];
  totalSeconds?: number;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  // 1) Tempo por OCORRÊNCIA no período (fonte de verdade: time_entries). Com
  // categoria, restringe às tarefas daquela categoria (o bucket '__diaria__'
  // cobre as tarefas padrão sem categoria).
  const { data: timeData, error: timeError } = category
    ? await supabase.rpc("time_by_task_category", {
        p_company: companyId,
        p_category: category,
        p_start: start,
        p_collaborator: collaboratorId ?? null,
        p_end: end,
      })
    : await supabase.rpc("time_by_task", {
        p_company: companyId,
        p_start: start,
        p_collaborator: collaboratorId ?? null,
        p_end: end,
      });
  if (timeError) return { error: timeError.message };

  const secondsByTask = new Map(
    ((timeData as { task_id: string; seconds: number }[]) ?? []).map((r) => [
      r.task_id,
      Number(r.seconds),
    ])
  );
  const ids = Array.from(secondsByTask.keys());
  // Total = soma do que a RPC (agregada no banco) devolveu, NÃO da leitura de
  // metadados abaixo — esta pode ser truncada/lotada e subestimaria o total.
  const totalSeconds = Array.from(secondsByTask.values()).reduce(
    (sum, s) => sum + s,
    0
  );
  if (ids.length === 0) return { error: null, groups: [], totalSeconds: 0 };

  // 2) Metadados das ocorrências com tempo no período (título, status, molde,
  // dia, responsável). O `.in(...)` do PostgREST trunca em 1000 linhas; buscamos
  // em lotes para não perder nenhuma em silêncio.
  const CHUNK = 500;
  const metaById = new Map<string, Row>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase
      .from("task_instances")
      .select(
        "id, title, status, template_id, task_date, collaborator:profiles!task_instances_collaborator_id_fkey(full_name, email, avatar_path)"
      )
      .in("id", ids.slice(i, i + CHUNK));
    if (error) return { error: error.message };
    for (const r of (data as Row[]) ?? []) metaById.set(r.id, r);
  }

  // 3) Agrupa por MOLDE (template_id). Sem molde (raro), cada ocorrência é seu
  // próprio grupo (chave = id da instância). O título do grupo vem da ocorrência
  // mais recente (títulos podem ter mudado ao longo do tempo).
  type Acc = {
    key: string;
    title: string;
    titleDate: string; // task_date que definiu o título (o mais recente)
    totalSeconds: number;
    occurrences: BreakdownOccurrence[];
  };
  const groups = new Map<string, Acc>();
  for (const id of ids) {
    const seconds = secondsByTask.get(id) ?? 0;
    if (seconds <= 0) continue;
    const r = metaById.get(id);
    const key = r?.template_id ?? id;
    const collab = r ? first(r.collaborator) : null;
    const occ: BreakdownOccurrence = {
      id,
      taskDate: r?.task_date ?? null,
      status: (r?.status ?? "a_fazer") as TaskStatus,
      collaboratorName:
        collab?.full_name || collab?.email || "(sem responsável)",
      collaboratorAvatarUrl: avatarUrl(collab?.avatar_path),
      seconds,
    };
    const title = r?.title ?? "(tarefa)";
    const date = r?.task_date ?? "";
    const g = groups.get(key);
    if (!g) {
      groups.set(key, {
        key,
        title,
        titleDate: date,
        totalSeconds: seconds,
        occurrences: [occ],
      });
    } else {
      g.totalSeconds += seconds;
      g.occurrences.push(occ);
      if (date > g.titleDate) {
        g.title = title;
        g.titleDate = date;
      }
    }
  }

  const result: BreakdownTaskGroup[] = Array.from(groups.values())
    .map((g) => ({
      key: g.key,
      title: g.title,
      totalSeconds: g.totalSeconds,
      count: g.occurrences.length,
      // Ocorrências: mais recentes primeiro (data desc; sem data por último).
      occurrences: g.occurrences.sort((a, b) =>
        (b.taskDate ?? "").localeCompare(a.taskDate ?? "")
      ),
    }))
    // Mantém a ordenação por tempo, da maior para a menor.
    .sort((a, b) => b.totalSeconds - a.totalSeconds);

  return { error: null, groups: result, totalSeconds };
}

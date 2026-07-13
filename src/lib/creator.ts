import type { createClient } from "@/lib/supabase-server";
import { avatarUrl } from "@/lib/avatar";

// Resolução de "quem é" para exibição (nome + foto). A RLS de profiles
// restringe leitura (colaborador só vê o próprio perfil), então usamos a função
// display_profiles (SECURITY DEFINER) que devolve apenas nome e avatar de
// qualquer id — em UMA chamada agrupada para N ids (escala).

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

export type PersonRef = { name: string; avatarUrl: string | null };

export async function resolvePeople(
  supabase: SupabaseServer,
  ids: (string | null | undefined)[]
): Promise<Map<string, PersonRef>> {
  const unique = Array.from(
    new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))
  );
  if (unique.length === 0) return new Map();

  const { data } = await supabase.rpc("display_profiles", { p_ids: unique });
  const map = new Map<string, PersonRef>();
  for (const r of (data as
    | { id: string; name: string | null; avatar_path: string | null }[]
    | null) ?? []) {
    const n = (r.name ?? "").trim();
    if (n) map.set(r.id, { name: n, avatarUrl: avatarUrl(r.avatar_path) });
  }
  return map;
}

export type InstanceTemplate = {
  created_by: string | null;
  created_at: string | null;
  standard_task_id: string | null;
} | null;

export type CreatorInfo = {
  who: string | null; // nome de quem definiu a tarefa (null = desconhecido)
  whoAvatarUrl: string | null; // foto de quem definiu (null = sem foto)
  whenISO: string | null; // quando a tarefa foi definida
  fromStandard: boolean; // veio de uma tarefa padrão
  systemGenerated: boolean; // ESTA ocorrência foi materializada pela recorrência
  hasOrigin: boolean; // existe template de origem
};

// Uma ocorrência criada bem depois do template foi gerada pelo job diário
// (recorrência). A original (única, ou a "de hoje" na atribuição) nasce junto
// do template — poucos segundos de diferença.
const RECURRENCE_MARGIN_MS = 5 * 60 * 1000;

export function describeInstanceCreator(
  template: InstanceTemplate,
  instanceCreatedAt: string | null,
  people: Map<string, PersonRef>
): CreatorInfo {
  if (!template) {
    return {
      who: null,
      whoAvatarUrl: null,
      whenISO: instanceCreatedAt,
      fromStandard: false,
      systemGenerated: true,
      hasOrigin: false,
    };
  }

  const person = template.created_by
    ? people.get(template.created_by) ?? null
    : null;
  const who = person?.name ?? null;
  const tMs = template.created_at ? new Date(template.created_at).getTime() : null;
  const iMs = instanceCreatedAt ? new Date(instanceCreatedAt).getTime() : null;
  const systemGenerated =
    tMs !== null && iMs !== null && iMs - tMs > RECURRENCE_MARGIN_MS;

  return {
    who,
    whoAvatarUrl: person?.avatarUrl ?? null,
    whenISO: template.created_at,
    fromStandard: !!template.standard_task_id,
    systemGenerated,
    hasOrigin: true,
  };
}

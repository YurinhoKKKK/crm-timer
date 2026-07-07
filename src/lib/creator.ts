import type { createClient } from "@/lib/supabase-server";

// Resolução de "quem criou" para exibição (transparência). A RLS de profiles
// restringe leitura (colaborador só vê o próprio perfil), então usamos a função
// display_names (SECURITY DEFINER) que devolve apenas o nome de qualquer id.

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

export async function resolvePersonNames(
  supabase: SupabaseServer,
  ids: (string | null | undefined)[]
): Promise<Map<string, string>> {
  const unique = Array.from(
    new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))
  );
  if (unique.length === 0) return new Map();

  const { data } = await supabase.rpc("display_names", { p_ids: unique });
  const map = new Map<string, string>();
  for (const r of (data as { id: string; name: string | null }[]) ?? []) {
    const n = (r.name ?? "").trim();
    if (n) map.set(r.id, n);
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
  names: Map<string, string>
): CreatorInfo {
  if (!template) {
    return {
      who: null,
      whenISO: instanceCreatedAt,
      fromStandard: false,
      systemGenerated: true,
      hasOrigin: false,
    };
  }

  const who = template.created_by ? names.get(template.created_by) ?? null : null;
  const tMs = template.created_at ? new Date(template.created_at).getTime() : null;
  const iMs = instanceCreatedAt ? new Date(instanceCreatedAt).getTime() : null;
  const systemGenerated =
    tMs !== null && iMs !== null && iMs - tMs > RECURRENCE_MARGIN_MS;

  return {
    who,
    whenISO: template.created_at,
    fromStandard: !!template.standard_task_id,
    systemGenerated,
    hasOrigin: true,
  };
}

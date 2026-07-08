import type { createClient } from "@/lib/supabase-server";

// Etiquetas de empresa (Passo 20). As tarefas HERDAM as etiquetas da empresa em
// tempo real — nada é copiado. Por isso a leitura é sempre "buscar as etiquetas
// das empresas envolvidas" e casar por company_id. Para escala, nunca 1 query
// por tarefa: uma única consulta em lote cobre todas as empresas de uma tela.

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

export type Label = {
  id: string;
  name: string;
  bg_color: string;
  text_color: string;
};

type Joined<T> = T | T[] | null;
function first<T>(value: Joined<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

// Catálogo completo de etiquetas (ordenado por nome). Usado na gestão e nos
// seletores de atribuição da empresa.
export async function loadLabelCatalog(
  supabase: SupabaseServer
): Promise<Label[]> {
  const { data } = await supabase
    .from("labels")
    .select("id, name, bg_color, text_color")
    .order("name", { ascending: true });
  return (data as Label[]) ?? [];
}

// Etiquetas de UMA empresa (para o cabeçalho da central e a tela de edição).
export async function loadCompanyLabels(
  supabase: SupabaseServer,
  companyId: string
): Promise<Label[]> {
  const { data } = await supabase
    .from("company_labels")
    .select("label:labels(id, name, bg_color, text_color)")
    .eq("company_id", companyId);
  const out: Label[] = [];
  for (const row of (data as { label: Joined<Label> }[]) ?? []) {
    const l = first(row.label);
    if (l) out.push(l);
  }
  return sortLabels(out);
}

// Etiquetas de VÁRIAS empresas de uma vez (herança em listas). Retorna um mapa
// company_id -> Label[]. Uma única query, indexada por company_labels(company_id).
export async function loadLabelsByCompany(
  supabase: SupabaseServer,
  companyIds: string[]
): Promise<Map<string, Label[]>> {
  const map = new Map<string, Label[]>();
  const ids = Array.from(new Set(companyIds.filter(Boolean)));
  if (ids.length === 0) return map;

  const { data } = await supabase
    .from("company_labels")
    .select("company_id, label:labels(id, name, bg_color, text_color)")
    .in("company_id", ids);

  for (const row of (data as { company_id: string; label: Joined<Label> }[]) ??
    []) {
    const l = first(row.label);
    if (!l) continue;
    const list = map.get(row.company_id) ?? [];
    list.push(l);
    map.set(row.company_id, list);
  }
  map.forEach((list, key) => map.set(key, sortLabels(list)));
  return map;
}

function sortLabels(list: Label[]): Label[] {
  return list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

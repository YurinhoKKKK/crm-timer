import type { createClient } from "@/lib/supabase-server";

// Etiquetas de empresa (Passo 20). As tarefas HERDAM as etiquetas da empresa em
// tempo real — nada é copiado. Por isso a leitura é sempre "buscar as etiquetas
// das empresas envolvidas" e casar por company_id. Para escala, nunca 1 query
// por tarefa: uma única consulta em lote cobre todas as empresas de uma tela.
//
// FONTE ÚNICA (migration 0107): as etiquetas EFETIVAS de uma empresa vêm da view
// `company_effective_labels` (company_id, label_id), que une os vínculos MANUAIS
// de company_labels com as CALCULADAS (CONSULTORIA/BPO/EMA a partir do Modelo do
// Projeto; TRÁFEGO a partir dos Serviços contratados). A view é security_invoker:
// a RLS das tabelas de base recorta quem lê, igual a antes. As calculadas NUNCA
// têm linha em company_labels. A view só dá os ids; juntamos ao catálogo (tabela
// labels, legível por todos) para obter nome/cores/destaque.

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

// Origem de uma etiqueta calculada. Nulo/ausente = etiqueta MANUAL.
export type DerivedKind = "project_model" | "contracted_service";

export type Label = {
  id: string;
  name: string;
  bg_color: string;
  text_color: string;
  // Etiqueta em destaque: renderiza maior/mais chamativa em todos os lugares.
  highlight: boolean;
  // Marcação de etiqueta CALCULADA (vem do Modelo do Projeto ou dos Serviços
  // contratados). Presente no catálogo (loadLabelCatalog); as leituras de chips
  // não dependem dele. Ausente/nulo = manual.
  derived_kind?: DerivedKind | null;
  derived_value?: string | null;
};

// Catálogo completo de etiquetas (ordenado por nome). Usado na gestão e nos
// seletores de atribuição da empresa. Traz a marcação de calculada.
export async function loadLabelCatalog(
  supabase: SupabaseServer
): Promise<Label[]> {
  const { data } = await supabase
    .from("labels")
    .select("id, name, bg_color, text_color, highlight, derived_kind, derived_value")
    .order("name", { ascending: true });
  return (data as Label[]) ?? [];
}

// Catálogo indexado por id — usado para juntar os label_id da view aos detalhes
// da etiqueta (nome/cores). labels é legível por qualquer autenticado.
async function catalogById(
  supabase: SupabaseServer
): Promise<Map<string, Label>> {
  const catalog = await loadLabelCatalog(supabase);
  return new Map(catalog.map((l) => [l.id, l]));
}

// Etiquetas EFETIVAS de UMA empresa (para o cabeçalho da central e a tela de
// edição). Lê a view (manuais ∪ calculadas), escopada pela RLS.
export async function loadCompanyLabels(
  supabase: SupabaseServer,
  companyId: string
): Promise<Label[]> {
  const [{ data }, byId] = await Promise.all([
    supabase
      .from("company_effective_labels")
      .select("label_id")
      .eq("company_id", companyId),
    catalogById(supabase),
  ]);
  const out: Label[] = [];
  for (const row of (data as { label_id: string }[]) ?? []) {
    const l = byId.get(row.label_id);
    if (l) out.push(l);
  }
  return sortLabels(out);
}

// Etiquetas EFETIVAS de VÁRIAS empresas de uma vez (herança em listas). Retorna
// um mapa company_id -> Label[]. Uma query na view + o catálogo (minúsculo).
export async function loadLabelsByCompany(
  supabase: SupabaseServer,
  companyIds: string[]
): Promise<Map<string, Label[]>> {
  const map = new Map<string, Label[]>();
  const ids = Array.from(new Set(companyIds.filter(Boolean)));
  if (ids.length === 0) return map;

  const [{ data }, byId] = await Promise.all([
    supabase
      .from("company_effective_labels")
      .select("company_id, label_id")
      .in("company_id", ids),
    catalogById(supabase),
  ]);

  for (const row of (data as { company_id: string; label_id: string }[]) ?? []) {
    const l = byId.get(row.label_id);
    if (!l) continue;
    const list = map.get(row.company_id) ?? [];
    list.push(l);
    map.set(row.company_id, list);
  }
  map.forEach((list, key) => map.set(key, sortLabels(list)));
  return map;
}

// Etiquetas EFETIVAS de TODAS as empresas que o usuário pode ver, numa query só.
//
// Existe para quebrar um waterfall: `loadLabelsByCompany` precisa dos company_id,
// que só ficam conhecidos DEPOIS da consulta de tarefas/templates. Sem o filtro
// `.in()`, roda em paralelo com as outras consultas da tela.
//
// O escopo NÃO é enfraquecido: a view é security_invoker e as policies das
// tabelas de base (cl_select/cd_select/ccc_select) já restringem às empresas de
// admin/consultor/colaborador. Quem recorta é a RLS, não o filtro da query.
export async function loadAllLabelsByCompany(
  supabase: SupabaseServer
): Promise<Map<string, Label[]>> {
  const map = new Map<string, Label[]>();

  const [{ data }, byId] = await Promise.all([
    supabase.from("company_effective_labels").select("company_id, label_id"),
    catalogById(supabase),
  ]);

  for (const row of (data as { company_id: string; label_id: string }[]) ?? []) {
    const l = byId.get(row.label_id);
    if (!l) continue;
    const list = map.get(row.company_id) ?? [];
    list.push(l);
    map.set(row.company_id, list);
  }
  map.forEach((list, key) => map.set(key, sortLabels(list)));
  return map;
}

// Etiquetas EM USO por alguma empresa ALCANÇÁVEL pelo usuário — para o filtro da
// tela de Empresas não oferecer opção que retornaria vazio. Agora inclui as
// calculadas (ex.: TRÁFEGO) quando em uso. Escopo da RLS via view.
export async function loadInUseLabels(
  supabase: SupabaseServer
): Promise<Label[]> {
  const [{ data }, byId] = await Promise.all([
    supabase.from("company_effective_labels").select("label_id"),
    catalogById(supabase),
  ]);

  const seen = new Map<string, Label>();
  for (const row of (data as { label_id: string }[]) ?? []) {
    const l = byId.get(row.label_id);
    if (l && !seen.has(l.id)) seen.set(l.id, l);
  }
  return sortLabels(Array.from(seen.values()));
}

// IDs das etiquetas MANUAIS realmente atribuídas a uma empresa (linhas em
// company_labels) — para o CONTROLE de atribuição manual saber o que está
// marcado. As calculadas nunca entram aqui (não têm linha em company_labels),
// então o controle só lida com o que é editável. NÃO usar para exibir chips:
// para exibição use loadCompanyLabels (efetivas, via view).
export async function loadManualCompanyLabelIds(
  supabase: SupabaseServer,
  companyId: string
): Promise<string[]> {
  const { data } = await supabase
    .from("company_labels")
    .select("label_id")
    .eq("company_id", companyId);
  return ((data as { label_id: string }[]) ?? []).map((r) => r.label_id);
}

// Destaques primeiro (para se sobressaírem nas listas), depois por nome.
function sortLabels(list: Label[]): Label[] {
  return list.sort((a, b) => {
    if (a.highlight !== b.highlight) return a.highlight ? -1 : 1;
    return a.name.localeCompare(b.name, "pt-BR");
  });
}

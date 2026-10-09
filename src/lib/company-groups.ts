import type { createClient } from "@/lib/supabase-server";

// =====================================================================
// Grupos de empresas (tela do admin) — resolução CENTRALIZADA "empresa -> grupo".
//
// PORTA ABERTA para M:N no futuro: hoje uma empresa tem UM grupo (companies.
// group_id). Se um dia surgir a necessidade de mais de um grupo por empresa, o
// caminho é uma tabela de junção company_group_members alimentada a partir do
// group_id atual — e a ÚNICA coisa a mudar é `resolveCompanyGroupId` (+ o seu
// loader). Por isso nenhuma tela lê `company.group_id` direto: todas passam por
// aqui. Não espalhe a leitura de group_id pelo código.
// =====================================================================

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

// Semântica do grupo para o fluxo automático (migration 0095). TODO consumidor
// decide por `kind`, NUNCA pelo nome: `paused` (Aguardando Renovação, Pausados,
// Sem Resposta|BO, Projetos Finalizados, Cancelados) é o que pausa a geração e,
// nos painéis, nasce recolhido e dispara o aviso ao criar tarefa.
export type GroupKind = "active" | "paused" | "onboarding" | "neutral";

export type CompanyGroup = {
  id: string;
  name: string;
  color: string;
  position: number;
  kind: GroupKind;
  // Correspondência com o quadro Tráfego (migration 0108). Null = "sem
  // correspondência" (as empresas deste grupo caem em "Sem grupo" no Tráfego).
  // Só o admin usa (edição de grupo + quadro /trafego).
  traffic_group_id?: string | null;
};

// Chave do balde "Sem grupo" (empresas com group_id nulo). Não é um grupo real:
// não se renomeia, não se colore, não se exclui e fica sempre por último.
export const SEM_GRUPO = "__sem_grupo__";

// Presets da paleta Monvatti + tons de estado úteis para os grupos de contrato
// (Ativos, Pausados, Cancelados, B.O, Aguardando Renovação). Qualquer hex é
// seguro porque a cor só tinge barra/bolinha/cabeçalho em baixa opacidade — o
// texto usa sempre as cores de tema (ver colorTints / regra de uso da cor).
export const GROUP_COLOR_PRESETS: { name: string; value: string }[] = [
  { name: "RISD Blue", value: "#3145FF" },
  { name: "Chrysler", value: "#001AD8" },
  { name: "Gunmetal", value: "#2B333B" },
  { name: "Verde", value: "#22C55E" },
  { name: "Âmbar", value: "#F59E0B" },
  { name: "Vermelho", value: "#EF4444" },
  { name: "Roxo", value: "#8B5CF6" },
  { name: "Ardósia", value: "#64748B" },
];

export const DEFAULT_GROUP_COLOR = GROUP_COLOR_PRESETS[0].value;

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export function isValidGroupColor(value: string): boolean {
  return HEX_RE.test(value.trim());
}

export function normalizeGroupColor(value: string): string {
  const v = value.trim();
  return HEX_RE.test(v) ? v.toUpperCase() : DEFAULT_GROUP_COLOR;
}

// A ÚNICA leitura de group_id do sistema. Devolve o id do grupo da empresa ou
// null ("Sem grupo"). Para M:N no futuro: passar a devolver várias e ajustar
// quem chama — mas o ponto de mudança é este, não as telas.
export function resolveCompanyGroupId(company: {
  group_id: string | null;
}): string | null {
  return company.group_id ?? null;
}

// Grupos existentes, na ordem de exibição (position; empate por nome). Desde a
// 0099, company_groups é legível por admin, consultor e colaborador — então esta
// função serve aos três (os painéis montam as seções com ela). `kind` decide o
// recolhimento inicial e o aviso de empresa parada.
export async function loadCompanyGroups(
  supabase: SupabaseServer
): Promise<CompanyGroup[]> {
  const { data } = await supabase
    .from("company_groups")
    .select("id, name, color, position, kind, traffic_group_id")
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  return (data as CompanyGroup[]) ?? [];
}

// Mapa empresa → grupo (id) das empresas que o CHAMADOR alcança (RLS de companies
// escopa: admin todas, consultor a carteira, colaborador o vínculo∪tarefas). Para
// painéis que só têm a lista de ids das empresas (ex.: colaborador, cuja RPC não
// devolve group_id) e precisam agrupar. A leitura de group_id passa por
// resolveCompanyGroupId (ponto único — porta aberta a M:N).
export async function loadCompanyGroupMap(
  supabase: SupabaseServer
): Promise<Map<string, string | null>> {
  const { data } = await supabase.from("companies").select("id, group_id");
  const map = new Map<string, string | null>();
  for (const c of (data as { id: string; group_id: string | null }[] | null) ??
    []) {
    map.set(c.id, resolveCompanyGroupId(c));
  }
  return map;
}

// Dado o mapa empresa→grupo e a lista de grupos, devolve empresa→NOME do grupo
// SÓ para empresas em grupo PARADO (kind='paused'). Alimenta o aviso de "cliente
// parado" ao criar tarefa (faixa + confirmação). Empresa sem grupo ou em grupo
// não-parado fica de fora (sem aviso). Pura (sem I/O).
export function pausedGroupNamesByCompany(
  groupByCompany: Map<string, string | null>,
  groups: CompanyGroup[]
): Record<string, string> {
  const pausedNameById = new Map<string, string>();
  for (const g of groups) if (g.kind === "paused") pausedNameById.set(g.id, g.name);
  const out: Record<string, string> = {};
  groupByCompany.forEach((groupId, companyId) => {
    const name = groupId ? pausedNameById.get(groupId) : undefined;
    if (name) out[companyId] = name;
  });
  return out;
}

// REGRA DE USO DA COR (obrigatória — é o que torna o seletor livre seguro): a
// cor do grupo pinta APENAS barra lateral, bolinha e fundo do cabeçalho em baixa
// opacidade. NUNCA colore texto nem vira fundo de texto em opacidade alta. Assim
// qualquer hex escolhido continua legível no claro e no escuro, sem cálculo de
// contraste. Estes tokens (hex + alfa de 8 bits) são a fonte única desse uso.
export function colorTints(color: string): {
  dot: string; // bolinha / barra — cor cheia
  headerBg: string; // fundo do cabeçalho — baixa opacidade
} {
  const c = normalizeGroupColor(color);
  return {
    dot: c,
    headerBg: `${c}14`, // ~8% de opacidade
  };
}

// Particiona empresas em seções na ORDEM dos grupos, com o balde "Sem grupo"
// sempre por último. Pura (sem I/O): a tela client consome com os itens já
// resolvidos (groupId vindo de resolveCompanyGroupId no servidor).
export function groupCompanies<T extends { groupId: string | null }>(
  items: T[],
  groups: CompanyGroup[]
): { key: string; group: CompanyGroup | null; items: T[] }[] {
  const byGroup = new Map<string, T[]>();
  const semGrupo: T[] = [];
  for (const item of items) {
    if (item.groupId == null) {
      semGrupo.push(item);
    } else {
      const list = byGroup.get(item.groupId) ?? [];
      list.push(item);
      byGroup.set(item.groupId, list);
    }
  }
  const sections: { key: string; group: CompanyGroup | null; items: T[] }[] =
    groups.map((g) => ({
      key: g.id,
      group: g,
      items: byGroup.get(g.id) ?? [],
    }));
  sections.push({ key: SEM_GRUPO, group: null, items: semGrupo });
  return sections;
}

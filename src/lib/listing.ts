import type { createClient } from "@/lib/supabase-server";
import type { ListingMarketplace } from "@/lib/types";
import { resolvePeople } from "@/lib/creator";

type Client = Awaited<ReturnType<typeof createClient>>;

// Os 3 marketplaces suportados pela "Listagem de marcas" (passo 22), na ordem
// em que aparecem no formulário. O valor é o do enum; o label é o exibido.
export const MARKETPLACES: { value: ListingMarketplace; label: string }[] = [
  { value: "mercado_livre", label: "Mercado Livre" },
  { value: "shopee", label: "Shopee" },
  { value: "amazon", label: "Amazon" },
];

const MARKETPLACE_LABELS: Record<ListingMarketplace, string> = {
  mercado_livre: "Mercado Livre",
  shopee: "Shopee",
  amazon: "Amazon",
};

// Ordem canônica dos marketplaces (para ordenar de forma estável).
const MARKETPLACE_ORDER: Record<ListingMarketplace, number> = {
  mercado_livre: 0,
  shopee: 1,
  amazon: 2,
};

export function marketplaceLabel(value: ListingMarketplace): string {
  return MARKETPLACE_LABELS[value] ?? value;
}

export type ListingBrandRef = { id: string; name: string };

// Dados de uma listagem prontos para exibir (marcas + marketplaces + margem).
export type ListingDetails = {
  brands: ListingBrandRef[];
  marketplaces: ListingMarketplace[];
  needsMargin: boolean;
  taxRate: number | null;
};

// Resultado de finalização por combinação marca × marketplace: OU o link da
// planilha, OU a justificativa de "não feita" (passo 22.1).
export type ListingResultView = {
  brandName: string;
  marketplace: ListingMarketplace;
  link: string | null;
  reason: string | null;
};

// Monta a mensagem de WhatsApp de uma listagem finalizada (passo 22.2): resumo
// opcional no topo, depois as listagens agrupadas por marca (nome em *negrito*
// do WhatsApp), com o marketplace e o link OU a justificativa de cada combinação.
// Legível no celular: uma linha por combinação, quebra entre marcas, sem cortar
// links. Preserva a ordem de entrada (marca-major, como o formulário monta).
export function buildListingWhatsappMessage(
  note: string,
  results: ListingResultView[]
): string {
  const blocks: string[] = [];

  const trimmed = note.trim();
  if (trimmed) blocks.push(trimmed);

  // Agrupa por marca preservando a ordem de primeira aparição.
  const byBrand = new Map<string, ListingResultView[]>();
  for (const r of results) {
    const list = byBrand.get(r.brandName) ?? [];
    list.push(r);
    byBrand.set(r.brandName, list);
  }

  for (const [brandName, rows] of Array.from(byBrand.entries())) {
    const lines = [`*${brandName}*`];
    for (const r of rows) {
      const mk = marketplaceLabel(r.marketplace);
      if (r.link) {
        lines.push(`${mk}: ${r.link}`);
      } else {
        // Sem link: envia só a justificativa (sem o rótulo "não feita", que
        // pode gerar mal-entendido no grupo do cliente).
        lines.push(`${mk}: ${r.reason ?? ""}`);
      }
    }
    blocks.push(lines.join("\n"));
  }

  // Uma linha em branco entre o resumo e cada marca (evita parede de texto).
  return blocks.join("\n\n");
}

type TemplateListingRow = {
  template_type: string;
  listing_marketplaces: ListingMarketplace[] | null;
  listing_needs_margin: boolean;
  listing_tax_rate: number | null;
};

// Carrega os detalhes da listagem de um template. Retorna null quando o template
// não é uma listagem (template_type != 'listagem') — assim quem chama decide se
// mostra a seção. A RLS de task_templates e listing_brands já escopa o acesso.
export async function loadListingByTemplate(
  supabase: Client,
  templateId: string
): Promise<ListingDetails | null> {
  const { data: tmpl } = await supabase
    .from("task_templates")
    .select(
      "template_type, listing_marketplaces, listing_needs_margin, listing_tax_rate"
    )
    .eq("id", templateId)
    .maybeSingle();

  const row = tmpl as TemplateListingRow | null;
  if (!row || row.template_type !== "listagem") return null;

  const { data: brandRows } = await supabase
    .from("listing_brands")
    .select("id, name")
    .eq("template_id", templateId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  return {
    brands: (brandRows as ListingBrandRef[] | null) ?? [],
    marketplaces: row.listing_marketplaces ?? [],
    needsMargin: row.listing_needs_margin,
    taxRate: row.listing_tax_rate,
  };
}

// Resultados já capturados na finalização de uma listagem (para exibir na tarefa
// finalizada e, depois, na aba "Minhas Listagens"). Ordena por marca e marketplace
// seguindo a ordem em que as marcas foram cadastradas.
export async function loadListingResults(
  supabase: Client,
  taskId: string
): Promise<ListingResultView[]> {
  const { data } = await supabase
    .from("listing_results")
    .select(
      "marketplace, link, not_done_reason, brand:listing_brands!listing_results_brand_id_fkey(name, position)"
    )
    .eq("task_id", taskId);

  type Row = {
    marketplace: ListingMarketplace;
    link: string | null;
    not_done_reason: string | null;
    brand: { name: string; position: number } | { name: string; position: number }[] | null;
  };

  const first = <T,>(v: T | T[] | null): T | null =>
    Array.isArray(v) ? v[0] ?? null : v;

  const rows = ((data as Row[] | null) ?? []).map((r) => {
    const brand = first(r.brand);
    return {
      brandName: brand?.name ?? "(marca removida)",
      brandPos: brand?.position ?? 0,
      marketplace: r.marketplace,
      link: r.link,
      reason: r.not_done_reason,
    };
  });

  rows.sort(
    (a, b) =>
      a.brandPos - b.brandPos ||
      MARKETPLACE_ORDER[a.marketplace] - MARKETPLACE_ORDER[b.marketplace] ||
      a.brandName.localeCompare(b.brandName, "pt-BR")
  );

  return rows.map((r) => ({
    brandName: r.brandName,
    marketplace: r.marketplace,
    link: r.link,
    reason: r.reason,
  }));
}

// Uma marca × marketplace entregue numa listagem da empresa (aba "Minhas
// Listagens", passo 23). `dateISO` é a data da entrega (finalização; ou a data
// da tarefa como fallback), usada para ordenar/exibir.
export type CompanyListingRow = {
  id: string;
  brandName: string;
  marketplace: ListingMarketplace;
  link: string | null;
  reason: string | null;
  taskId: string;
  taskTitle: string;
  dateISO: string | null;
};

// Todas as listagens (resultados marca × marketplace) de UMA empresa. Escala:
// puxa por template→instância→resultado com filtros por id (sem varrer tudo). A
// RLS (tt_select / lr_select) já escopa admin (todas) e consultor (só as dele).
export async function loadCompanyListings(
  supabase: Client,
  companyId: string
): Promise<CompanyListingRow[]> {
  // 1. Templates de listagem desta empresa.
  const { data: tmplData } = await supabase
    .from("task_templates")
    .select("id")
    .eq("company_id", companyId)
    .eq("template_type", "listagem");
  const templateIds = ((tmplData as { id: string }[] | null) ?? []).map(
    (t) => t.id
  );
  if (templateIds.length === 0) return [];

  // 2. Instâncias dessas listagens (título e data).
  const { data: instData } = await supabase
    .from("task_instances")
    .select("id, title, task_date, finished_at")
    .in("template_id", templateIds);
  const instances =
    (instData as
      | { id: string; title: string; task_date: string; finished_at: string | null }[]
      | null) ?? [];
  if (instances.length === 0) return [];

  const instById = new Map(instances.map((i) => [i.id, i]));
  const taskIds = instances.map((i) => i.id);

  // 3. Resultados (marca × marketplace) dessas tarefas.
  const { data: resData } = await supabase
    .from("listing_results")
    .select(
      "id, task_id, marketplace, link, not_done_reason, brand:listing_brands!listing_results_brand_id_fkey(name, position)"
    )
    .in("task_id", taskIds);

  type Row = {
    id: string;
    task_id: string;
    marketplace: ListingMarketplace;
    link: string | null;
    not_done_reason: string | null;
    brand: { name: string; position: number } | { name: string; position: number }[] | null;
  };
  const first = <T,>(v: T | T[] | null): T | null =>
    Array.isArray(v) ? v[0] ?? null : v;

  const rows: (CompanyListingRow & { brandPos: number })[] = (
    (resData as Row[] | null) ?? []
  ).map((r) => {
    const brand = first(r.brand);
    const inst = instById.get(r.task_id);
    return {
      id: r.id,
      brandName: brand?.name ?? "(marca removida)",
      brandPos: brand?.position ?? 0,
      marketplace: r.marketplace,
      link: r.link,
      reason: r.not_done_reason,
      taskId: r.task_id,
      taskTitle: inst?.title ?? "(tarefa removida)",
      dateISO: inst?.finished_at ?? (inst ? `${inst.task_date}T00:00:00` : null),
    };
  });

  // Ordem padrão: entrega mais recente primeiro; depois marca e marketplace.
  rows.sort(
    (a, b) =>
      (b.dateISO ?? "").localeCompare(a.dateISO ?? "") ||
      a.brandPos - b.brandPos ||
      MARKETPLACE_ORDER[a.marketplace] - MARKETPLACE_ORDER[b.marketplace] ||
      a.brandName.localeCompare(b.brandName, "pt-BR")
  );

  return rows.map((r) => ({
    id: r.id,
    brandName: r.brandName,
    marketplace: r.marketplace,
    link: r.link,
    reason: r.reason,
    taskId: r.taskId,
    taskTitle: r.taskTitle,
    dateISO: r.dateISO,
  }));
}

// Um evento de validação de listagem (passo 33), para o histórico na central.
export type ListingValidationItem = {
  event: "aprovado" | "ajuste_solicitado" | "contestado";
  comment: string | null;
  authorType: "cliente" | "interno";
  author: string | null; // primeiro nome de quem registrou, do lado interno
  at: string;
};

// Histórico de validação de TODAS as listagens de uma empresa, agrupado por
// listing_result_id e em ordem cronológica. A RLS lv_select escopa (admin/
// consultor da empresa; a central só é usada por eles). Os nomes de quem
// registrou (lado interno) vêm de display_profiles em lote (não esbarra no RLS
// de profiles). Usado na aba "Minhas Listagens" para mostrar o veredito do
// cliente e seu histórico junto de cada entrega.
export async function loadListingValidations(
  supabase: Client,
  companyId: string
): Promise<Record<string, ListingValidationItem[]>> {
  const { data } = await supabase
    .from("listing_validations")
    .select("listing_result_id, event_type, comment, author_type, author_id, created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: true });

  type Row = {
    listing_result_id: string;
    event_type: ListingValidationItem["event"];
    comment: string | null;
    author_type: "cliente" | "interno";
    author_id: string | null;
    created_at: string;
  };
  const rows = (data as Row[] | null) ?? [];
  if (rows.length === 0) return {};

  const people = await resolvePeople(
    supabase,
    rows.filter((r) => r.author_type === "interno").map((r) => r.author_id)
  );

  const out: Record<string, ListingValidationItem[]> = {};
  for (const r of rows) {
    const list = out[r.listing_result_id] ?? (out[r.listing_result_id] = []);
    list.push({
      event: r.event_type,
      comment: r.comment,
      authorType: r.author_type,
      author:
        r.author_type === "interno"
          ? (people.get(r.author_id ?? "")?.name ?? "Equipe").split(" ")[0]
          : null,
      at: r.created_at,
    });
  }
  return out;
}

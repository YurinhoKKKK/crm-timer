import type { createClient } from "@/lib/supabase-server";
import type { ListingMarketplace } from "@/lib/types";

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

  const order: Record<ListingMarketplace, number> = {
    mercado_livre: 0,
    shopee: 1,
    amazon: 2,
  };

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
      order[a.marketplace] - order[b.marketplace] ||
      a.brandName.localeCompare(b.brandName, "pt-BR")
  );

  return rows.map((r) => ({
    brandName: r.brandName,
    marketplace: r.marketplace,
    link: r.link,
    reason: r.reason,
  }));
}

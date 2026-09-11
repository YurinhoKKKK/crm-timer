import type { NoteArea } from "@/lib/types";

// Taxonomia das ÁREAS de trabalho de uma atualização (company_notes). É uma
// taxonomia PRÓPRIA, deliberadamente separada de sales_channel (faturamento) e
// de listing_marketplace (listagens): mesmo que alguns nomes coincidam, o
// propósito é outro e sincronizá-las recriaria a confusão entre canal
// contratado e canal operante que já evitamos. Não reusar aqueles enums aqui.

export type { NoteArea };

// Áreas na ordem canônica de exibição (formulário, etiquetas e filtro).
export const NOTE_AREAS: { value: NoteArea; label: string }[] = [
  { value: "ml", label: "Mercado Livre" },
  { value: "amz", label: "Amazon" },
  { value: "shp", label: "Shopee" },
  { value: "erp", label: "ERP" },
  { value: "site", label: "Site" },
  { value: "trafego", label: "Tráfego" },
  { value: "outros", label: "Outros" },
];

const AREA_LABELS = Object.fromEntries(
  NOTE_AREAS.map((a) => [a.value, a.label])
) as Record<NoteArea, string>;

const AREA_ORDER = Object.fromEntries(
  NOTE_AREAS.map((a, i) => [a.value, i])
) as Record<NoteArea, number>;

export function noteAreaLabel(value: NoteArea): string {
  return AREA_LABELS[value] ?? value;
}

// Ordena uma lista de áreas na ordem canônica (estável em qualquer origem).
export function sortNoteAreas(areas: NoteArea[]): NoteArea[] {
  return [...areas].sort((a, b) => (AREA_ORDER[a] ?? 99) - (AREA_ORDER[b] ?? 99));
}

// Cores das etiquetas. ML/AMZ/SHP reaproveitam a IDENTIDADE de marketplace já
// usada no sistema (as mesmas cores do MarketplaceBadge — coerência visual),
// enquanto ERP/Site/Tráfego/Outros ganham tons NEUTROS próprios, para nunca
// serem confundidos com os marketplaces. Fixas nos dois temas (são identidade,
// não tokens do tema); o texto e o nome sempre aparecem — nunca só a cor.
export const NOTE_AREA_COLORS: Record<
  NoteArea,
  { bg: string; fg: string; accent?: string }
> = {
  ml: { bg: "#FFE600", fg: "#2D3277" },
  amz: { bg: "#232F3E", fg: "#FFFFFF", accent: "#FF9900" },
  shp: { bg: "#EE4D2D", fg: "#FFFFFF" },
  erp: { bg: "#475569", fg: "#FFFFFF" },
  site: { bg: "#57534E", fg: "#FFFFFF" },
  trafego: { bg: "#52525B", fg: "#FFFFFF" },
  outros: { bg: "#6B7280", fg: "#FFFFFF" },
};

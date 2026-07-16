import type { CSSProperties } from "react";
import type { ListingMarketplace } from "@/lib/types";
import { marketplaceLabel } from "@/lib/listing";

// Mapa ÚNICO das cores de identidade dos marketplaces — trocar aqui reflete
// em todo lugar que usa o badge. São cores características (não logos: as
// marcas registradas de terceiros não são reproduzidas; cor + nome + ícone
// genérico de sacola bastam para identificação). Fixas nos dois temas, por
// serem identidade e não tokens do tema; o ring sutil dá contorno em
// qualquer superfície.
export const MARKETPLACE_COLORS: Record<
  ListingMarketplace,
  { bg: string; fg: string; accent?: string }
> = {
  mercado_livre: { bg: "#FFE600", fg: "#2D3277" },
  shopee: { bg: "#EE4D2D", fg: "#FFFFFF" },
  amazon: { bg: "#232F3E", fg: "#FFFFFF", accent: "#FF9900" },
};

export default function MarketplaceBadge({
  marketplace,
  className = "",
}: {
  marketplace: ListingMarketplace;
  className?: string;
}) {
  const c = MARKETPLACE_COLORS[marketplace];
  const style: CSSProperties = { backgroundColor: c.bg, color: c.fg };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold shadow-sm ring-1 ring-black/10 dark:ring-white/20 ${className}`}
      style={style}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={c.accent ? { color: c.accent } : undefined}
      >
        <path d="M6 7h12l1.2 13H4.8L6 7z" />
        <path d="M9 10V6a3 3 0 0 1 6 0v4" />
      </svg>
      {marketplaceLabel(marketplace)}
    </span>
  );
}

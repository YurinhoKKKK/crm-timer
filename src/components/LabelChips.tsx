import type { CSSProperties } from "react";
import type { Label } from "@/lib/labels";

// Estilo inline do chip (cores da própria etiqueta). Em destaque, ganha um
// halo sutil na cor da etiqueta (hex + alfa) — chamativo sem depender do tema.
// Compartilhado com os pickers/gerenciador, para o destaque valer em todo lugar.
export function labelChipStyle(l: Label): CSSProperties {
  const style: CSSProperties = {
    backgroundColor: l.bg_color,
    color: l.text_color,
  };
  if (l.highlight) {
    style.boxShadow = `0 0 0 2px ${l.bg_color}40, 0 2px 8px ${l.bg_color}59`;
  }
  return style;
}

// Chip de etiqueta renderizado com as cores da própria etiqueta. Puramente
// visual (sem estado) — serve tanto em Server quanto em Client Components.
// `size="sm"` é o padrão para listas; "md" para cabeçalhos/detalhe. Etiquetas
// com highlight sobem um degrau de tamanho/peso em relação às normais.
export default function LabelChips({
  labels,
  size = "sm",
  className = "",
}: {
  labels: Label[];
  size?: "sm" | "md";
  className?: string;
}) {
  if (!labels || labels.length === 0) return null;
  const pad =
    size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]";
  const padHighlight =
    size === "md" ? "px-3.5 py-1.5 text-sm" : "px-3 py-1 text-xs";
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {labels.map((l) => (
        <span
          key={l.id}
          className={`inline-flex items-center rounded-full leading-none ${
            l.highlight
              ? `${padHighlight} font-bold tracking-wide`
              : `${pad} font-medium`
          }`}
          style={labelChipStyle(l)}
        >
          {l.name}
        </span>
      ))}
    </div>
  );
}

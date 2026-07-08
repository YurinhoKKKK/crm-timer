import type { Label } from "@/lib/labels";

// Chip de etiqueta renderizado com as cores da própria etiqueta. Puramente
// visual (sem estado) — serve tanto em Server quanto em Client Components.
// `size="sm"` é o padrão para listas; "md" para cabeçalhos/detalhe.
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
  const pad = size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]";
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {labels.map((l) => (
        <span
          key={l.id}
          className={`inline-flex items-center rounded-full font-medium leading-none ${pad}`}
          style={{ backgroundColor: l.bg_color, color: l.text_color }}
        >
          {l.name}
        </span>
      ))}
    </div>
  );
}

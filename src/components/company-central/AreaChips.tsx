import type { CSSProperties } from "react";
import type { NoteArea } from "@/lib/types";
import { NOTE_AREA_COLORS, noteAreaLabel, sortNoteAreas } from "@/lib/note-areas";

// Etiqueta de uma área na LEITURA de uma atualização. Texto (nome da área)
// sempre visível — a cor é reforço de identidade, nunca a única pista. ML/AMZ/
// SHP herdam a cor de marketplace; as demais, um neutro próprio.
export function AreaChip({
  area,
  size = "sm",
}: {
  area: NoteArea;
  size?: "sm" | "xs";
}) {
  const c = NOTE_AREA_COLORS[area];
  const style: CSSProperties = { backgroundColor: c.bg, color: c.fg };
  const pad = size === "xs" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-0.5 text-xs";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold shadow-sm ring-1 ring-black/10 dark:ring-white/20 ${pad}`}
      style={style}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: c.accent ?? c.fg, opacity: c.accent ? 1 : 0.7 }}
      />
      {noteAreaLabel(area)}
    </span>
  );
}

// Conjunto de etiquetas de área de uma atualização (ordem canônica). Não
// renderiza nada quando a atualização é uma das antigas "sem área".
export default function AreaChips({
  areas,
  size = "sm",
  className = "",
}: {
  areas: NoteArea[];
  size?: "sm" | "xs";
  className?: string;
}) {
  if (areas.length === 0) return null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      {sortNoteAreas(areas).map((a) => (
        <AreaChip key={a} area={a} size={size} />
      ))}
    </span>
  );
}

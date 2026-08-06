"use client";

import { farolOf, type Farol } from "@/lib/followup";

// Identidade VISUAL do semáforo de contato — fonte ÚNICA compartilhada entre a
// página /acompanhamento (FollowupView) e a badge nos cards de empresa do painel
// do consultor. A cor NUNCA é o único sinal: o rótulo em texto acompanha sempre
// (acessibilidade). Os PRAZOS (verde ≤7 · amarelo 7–15 · vermelho >15 e
// sem-registro) moram em farolOf (lib/followup), também fonte única.
export const FAROL_UI: Record<
  Farol,
  { label: string; dot: string; chip: string; text: string }
> = {
  verde: {
    label: "Em dia",
    dot: "bg-emerald-500",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  amarelo: {
    label: "Atenção",
    dot: "bg-amber-500",
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
    text: "text-amber-700 dark:text-amber-300",
  },
  vermelho: {
    label: "Sem contato",
    dot: "bg-red-500",
    chip: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30",
    text: "text-red-700 dark:text-red-300",
  },
};

// Dias desde o último contato, em texto discreto. null = nunca houve registro.
function dimensionText(days: number | null): string {
  if (days === null) return "nunca contatado";
  if (days === 0) return "contato hoje";
  return `há ${days} ${days === 1 ? "dia" : "dias"}`;
}

// Badge compacta de contato para os cards: chip colorido com o rótulo da faixa
// (gravidade) + os dias desde o último contato, discretos (dimensão). Mesmos
// prazos e mesmo padrão visual da página de acompanhamento — é UM sinal a mais no
// card, não o protagonista.
export function FarolBadge({
  days,
  className,
}: {
  days: number | null;
  className?: string;
}) {
  const ui = FAROL_UI[farolOf(days)];
  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ""}`}>
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold ${ui.chip}`}
      >
        <span className={`h-2 w-2 rounded-full ${ui.dot}`} aria-hidden="true" />
        {ui.label}
      </span>
      <span className="text-xs text-fg-subtle">{dimensionText(days)}</span>
    </span>
  );
}

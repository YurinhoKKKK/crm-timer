"use client";

import type { DayColor } from "@/lib/followup";

// Identidade VISUAL do semáforo de contato — fonte ÚNICA compartilhada entre a
// página /acompanhamento (FollowupView) e a badge nos cards de empresa do painel
// do consultor. A cor NUNCA é o único sinal: o rótulo em texto acompanha sempre
// (acessibilidade).
//
// Desde a 0150 a unidade é a COR DO DIA (não "dias desde o contato"): verde =
// contato pela manhã (+1), amarelo = contato à tarde (0), vermelho = contato
// após as 17h ou nenhum no dia (−1), aguardando (cinza) = dia corrente em
// andamento ainda sem contato antes das 17h (neutro, não é falta).
export const FAROL_UI: Record<
  DayColor,
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
    label: "Após 17h / sem contato",
    dot: "bg-red-500",
    chip: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30",
    text: "text-red-700 dark:text-red-300",
  },
  aguardando: {
    label: "Aguardando",
    dot: "bg-slate-400",
    chip: "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/30",
    text: "text-slate-600 dark:text-slate-300",
  },
};

// Badge compacta de contato para os cards: chip colorido com o rótulo da COR DO
// DIA. É UM sinal a mais no card, não o protagonista. A cor vem pronta do banco
// (followup_board); quando não há cor (empresa fora de grupo ativo), o chamador
// simplesmente não renderiza a badge.
export function FarolBadge({
  color,
  className,
}: {
  color: DayColor;
  className?: string;
}) {
  const ui = FAROL_UI[color];
  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ""}`}>
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold ${ui.chip}`}
      >
        <span className={`h-2 w-2 rounded-full ${ui.dot}`} aria-hidden="true" />
        {ui.label}
      </span>
    </span>
  );
}

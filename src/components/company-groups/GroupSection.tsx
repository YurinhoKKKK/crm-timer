"use client";

import type { ReactNode, HTMLAttributes } from "react";
import { colorTints, type CompanyGroup } from "@/lib/company-groups";

// =====================================================================
// Casca VISUAL de uma seção de grupo (ou do balde "Sem grupo") — fonte única do
// cabeçalho colorido retrátil usado no quadro do admin (/admin/empresas) E nos
// painéis do consultor e do colaborador. Aqui mora SÓ o visual; as AÇÕES (seleção
// múltipla, menu do grupo, arrastar-soltar) entram por slots:
//   - leading:  antes do botão de recolher (admin: checkbox de seleção)
//   - trailing: à direita de tudo (admin: menu de ações do grupo)
//   - meta:     ao lado da contagem (painéis: "N com tarefa sua em aberto")
// O corpo (children) é responsabilidade de quem chama: linhas no admin, cards nos
// painéis. Nada de duplicar o cabeçalho tingido em três telas.
//
// REGRA DE USO DA COR (obrigatória): a cor tinge APENAS barra lateral, bolinha e
// fundo do cabeçalho em baixa opacidade (colorTints) — o texto usa sempre as
// cores de tema, então qualquer hex livre é legível no claro e no escuro.
// =====================================================================
export default function GroupSection({
  group,
  count,
  collapsed,
  onToggleCollapse,
  // Classe de borda da <section> (o admin troca por destaque de drop/arraste).
  borderClassName = "border-line",
  // Handlers/atributos extras na <section> (o admin passa os de drag-and-drop).
  sectionProps,
  leading,
  trailing,
  meta,
  children,
}: {
  group: CompanyGroup | null;
  count: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  borderClassName?: string;
  sectionProps?: HTMLAttributes<HTMLElement>;
  leading?: ReactNode;
  trailing?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
}) {
  const tint = group ? colorTints(group.color) : null;

  return (
    <section
      {...sectionProps}
      className={`rounded-2xl border bg-surface shadow-card transition ${borderClassName}`}
    >
      {/* Cabeçalho: barra/bolinha na cor do grupo + nome + contagem + recolher.
          rounded-t-2xl (em vez de overflow-hidden) para o fundo tingido respeitar
          os cantos SEM recortar um eventual dropdown no slot trailing. */}
      <div
        className={`flex items-center gap-2 border-b border-line px-3 py-2.5 rounded-t-2xl ${
          collapsed ? "rounded-b-2xl border-b-0" : ""
        }`}
        style={tint ? { backgroundColor: tint.headerBg } : undefined}
      >
        {tint && (
          <span
            className="h-6 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: tint.dot }}
            aria-hidden="true"
          />
        )}

        {leading}

        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd rounded"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={`shrink-0 text-fg-subtle transition-transform ${
              collapsed ? "-rotate-90" : ""
            }`}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
          {tint && (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: tint.dot }}
              aria-hidden="true"
            />
          )}
          <span className="truncate font-semibold text-fg">
            {group?.name ?? "Sem grupo"}
          </span>
          <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium tabular-nums text-fg-muted">
            {count}
          </span>
          {meta}
        </button>

        {trailing}
      </div>

      {!collapsed && <div className="p-3">{children}</div>}
    </section>
  );
}

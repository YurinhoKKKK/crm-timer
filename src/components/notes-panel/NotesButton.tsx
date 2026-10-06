"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { MessageSquareText } from "lucide-react";
import type { NotesSource } from "./notes-source";

// O painel (e o editor TipTap que ele arrasta) só entram no bundle quando o
// balão é clicado — via next/dynamic, ssr:false. A lista de empresas e o painel
// do consultor (telas leves e muito acessadas) carregam apenas este botão.
const NotesPanel = dynamic(() => import("./NotesPanel"), { ssr: false });

// Balão de atalho para as anotações de uma empresa, no espírito do balão de
// atualizações do Monday. Mesmo componente na lista do admin, no cartão do
// consultor e no quadro de Sucesso do Cliente. Mostra a contagem ao lado;
// empresa sem anotação aparece apagada, sem número, e o painel abre convidando
// a escrever a primeira. A `source` opcional troca a fonte (CS) e os termos.
export default function NotesButton({
  companyId,
  companyName,
  userId,
  isAdmin,
  notesHref,
  initialCount,
  className = "",
  size = "md",
  source,
}: {
  companyId: string;
  companyName: string;
  userId: string;
  isAdmin: boolean;
  notesHref: string;
  initialCount: number;
  className?: string;
  // Tamanho do balão: "md" (padrão, lista do admin/cartão do consultor) ou "sm"
  // (compacto, para linhas de ação como o quadro do CS).
  size?: "sm" | "md";
  // Fonte alternativa (CS). Ausente = Atualizações normais (company_notes).
  source?: NotesSource;
}) {
  const [open, setOpen] = useState(false);
  // Contagem local: atualiza sozinha quando uma anotação nova é criada no
  // painel, sem recarregar a tela inteira.
  const [count, setCount] = useState(initialCount);
  const has = count > 0;
  // Termos exibidos: "atualização(ões)" (padrão) ou "atualização(ões) do CS".
  const termS = source?.termSingular ?? "atualização";
  const termP = source?.termPlural ?? "atualizações";
  const sizeCls = size === "sm" ? "px-1.5 py-1 text-xs" : "px-2 py-1.5 text-sm";
  const iconSize = size === "sm" ? 14 : 17;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // No cartão do consultor o balão fica sobre um link-overlay: não deixar
          // o clique navegar para a empresa.
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={
          has
            ? `${termP[0].toUpperCase()}${termP.slice(1)} de ${companyName} (${count})`
            : `Escrever a primeira ${termS} de ${companyName}`
        }
        title={has ? `${count} ${count === 1 ? termS : termP}` : `Sem ${termP}`}
        className={`inline-flex shrink-0 items-center gap-1 rounded-lg font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${sizeCls} ${
          has
            ? "text-risd hover:bg-brand-tint"
            : "text-fg-subtle hover:bg-surface-2 hover:text-fg-muted"
        } ${className}`}
      >
        <MessageSquareText size={iconSize} aria-hidden="true" />
        {has && <span className="tabular-nums">{count}</span>}
      </button>

      {open && (
        <NotesPanel
          companyId={companyId}
          companyName={companyName}
          userId={userId}
          isAdmin={isAdmin}
          notesHref={notesHref}
          onClose={() => setOpen(false)}
          onCountChange={(delta) => setCount((c) => Math.max(0, c + delta))}
          source={source}
        />
      )}
    </>
  );
}

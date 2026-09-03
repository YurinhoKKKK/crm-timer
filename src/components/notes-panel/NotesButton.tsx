"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { MessageSquareText } from "lucide-react";

// O painel (e o editor TipTap que ele arrasta) só entram no bundle quando o
// balão é clicado — via next/dynamic, ssr:false. A lista de empresas e o painel
// do consultor (telas leves e muito acessadas) carregam apenas este botão.
const NotesPanel = dynamic(() => import("./NotesPanel"), { ssr: false });

// Balão de atalho para as anotações de uma empresa, no espírito do balão de
// atualizações do Monday. Mesmo componente na lista do admin e no cartão do
// consultor. Mostra a contagem ao lado; empresa sem anotação aparece apagada,
// sem número, e o painel abre convidando a escrever a primeira.
export default function NotesButton({
  companyId,
  companyName,
  userId,
  isAdmin,
  notesHref,
  initialCount,
  className = "",
}: {
  companyId: string;
  companyName: string;
  userId: string;
  isAdmin: boolean;
  notesHref: string;
  initialCount: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // Contagem local: atualiza sozinha quando uma anotação nova é criada no
  // painel, sem recarregar a tela inteira.
  const [count, setCount] = useState(initialCount);
  const has = count > 0;

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
            ? `Atualizações de ${companyName} (${count})`
            : `Escrever a primeira atualização de ${companyName}`
        }
        title={has ? `${count} atualizaç${count === 1 ? "ão" : "ões"}` : "Sem atualizações"}
        className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
          has
            ? "text-risd hover:bg-brand-tint"
            : "text-fg-subtle hover:bg-surface-2 hover:text-fg-muted"
        } ${className}`}
      >
        <MessageSquareText size={17} aria-hidden="true" />
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
        />
      )}
    </>
  );
}

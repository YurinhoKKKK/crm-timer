"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// Modal base do sistema: portal no body, backdrop com blur, fecha no ESC e no
// clique fora, trava o scroll do fundo e devolve o foco. Segue a identidade da
// marca (superfície, borda e sombra dos cards) e o tema claro/escuro.
//
// ALTURA: o painel nunca ultrapassa a viewport (max-h abaixo, já descontando o
// respiro do wrapper). Ele é uma COLUNA FLEX; quando o conteúdo não cabe, quem
// rola é o corpo — o painel só não estoura a tela (o bug clássico de topo
// cortado + botões fora de alcance em notebook/mobile).
//
// `flush`: o filho gerencia a própria estrutura (cabeçalho/corpo/rodapé) e por
// isso recebe a altura inteira do painel, sem padding nem rolagem impostos aqui
// — usado pelo formulário de reunião, que fixa cabeçalho e ações e rola só o
// meio. Sem `flush` (padrão), o conteúdo ganha o padding de sempre e rola por
// inteiro quando é alto — retrocompatível com os modais existentes.
export default function Modal({
  open,
  onClose,
  labelledBy,
  children,
  maxWidth = "max-w-md",
  flush = false,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy?: string;
  children: React.ReactNode;
  maxWidth?: string;
  flush?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Foco inicial no painel (acessibilidade).
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  // z-overlay (50): acima do pill do timer (45), abaixo do detalhe de tarefa
  // (z-sheet, 60). Escala de camadas em tailwind.config.ts.
  return createPortal(
    <div className="fixed inset-0 z-overlay flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-gunmetal/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`relative flex max-h-[calc(100dvh-2rem)] w-full ${maxWidth} animate-fade-in flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop outline-none`}
      >
        <div
          className={
            flush
              ? "flex min-h-0 flex-1 flex-col"
              : "min-h-0 flex-1 overflow-y-auto p-5 sm:p-6"
          }
        >
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// Modal base do sistema: portal no body, backdrop com blur, fecha no ESC e no
// clique fora, trava o scroll do fundo e devolve o foco. Segue a identidade da
// marca (superfície, borda e sombra dos cards) e o tema claro/escuro.
export default function Modal({
  open,
  onClose,
  labelledBy,
  children,
  maxWidth = "max-w-md",
}: {
  open: boolean;
  onClose: () => void;
  labelledBy?: string;
  children: React.ReactNode;
  maxWidth?: string;
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
        className={`relative w-full ${maxWidth} animate-fade-in rounded-2xl border border-line bg-surface p-5 shadow-pop outline-none sm:p-6`}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}

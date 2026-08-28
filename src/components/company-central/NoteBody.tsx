"use client";

import { useEffect, useRef, useState } from "react";

// Altura máxima do texto retraído (~9 linhas). Recolhe por ALTURA, não por
// número de caracteres — título, imagem e tabela ocupam alturas muito
// diferentes. Só retrai quem passa com folga (COLLAPSE_PX + 48).
const COLLAPSE_PX = 208;

// Corpo de uma anotação, compartilhado pela aba de Anotações (CompanyNotes) e
// pelo painel de atalho (NotesPanel). Retrai textos longos por padrão, com um
// degradê suave no corte e um botão "Ver/Ler mais" ao pé; abre o lightbox ao
// clicar numa imagem. O ResizeObserver re-mede quando as imagens carregam (a
// altura muda depois do primeiro render).
//
// O corte é APENAS visual: o HTML salvo não muda e o conteúdo inteiro continua
// no DOM (overflow-hidden, não display:none), então o leitor de tela alcança o
// texto oculto mesmo recolhido. Expandir/recolher é local, sem recarregar.
export default function NoteBody({
  html,
  onImageClick,
  className = "rich-text note-view",
  moreLabel = "Ver mais",
  lessLabel = "Ver menos",
}: {
  html: string;
  onImageClick: (images: string[], index: number) => void;
  className?: string;
  moreLabel?: string;
  lessLabel?: string;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const check = () => setOverflows(el.offsetHeight > COLLAPSE_PX + 48);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [html]);

  const collapsed = overflows && !expanded;

  return (
    <div>
      <div
        className={collapsed ? "relative overflow-hidden" : undefined}
        style={collapsed ? { maxHeight: COLLAPSE_PX } : undefined}
      >
        <div
          ref={innerRef}
          className={className}
          onClick={(e) => {
            const t = e.target;
            if (t instanceof HTMLImageElement && t.src) {
              // Todas as imagens DESTA anotação, para navegar entre elas.
              const imgs = Array.from(
                e.currentTarget.querySelectorAll("img")
              ).map((i) => i.src);
              onImageClick(imgs, Math.max(0, imgs.indexOf(t.src)));
            }
          }}
          // Sanitizado no servidor (loadCompanyNotes → DOMPurify).
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {collapsed && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-surface to-transparent"
          />
        )}
      </div>
      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-1.5 text-sm font-medium text-risd transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          {expanded ? lessLabel : moreLabel}
        </button>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { PortalUpdate } from "@/lib/client-portal";
import { formatPortalDate } from "./portal-format";

// Aba "Atualizações do projeto" do portal do cliente. O HTML de cada
// atualização JÁ CHEGA sanitizado do servidor (sanitizeNoteHtml/DOMPurify em
// page.tsx — o ponto único de sanitização não muda); aqui é só render. O
// lightbox age exclusivamente na camada de exibição: captura o clique em
// <img> por delegação e amplia num modal via React portal (document.body),
// por cima de tudo.

export default function PortalUpdates({
  updates,
}: {
  updates: PortalUpdate[];
}) {
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);

  function handleContentClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.tagName === "IMG") {
      const img = target as HTMLImageElement;
      setZoom({ src: img.src, alt: img.alt ?? "" });
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-brand-tint text-risd">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m3 11 18-7-4 16-6.5-4.5L8 19l-.5-5L3 11z" />
          </svg>
        </span>
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-fg">
            Atualizações do projeto
          </h2>
          <p className="mt-0.5 text-sm text-fg-muted">
            Resumos de reunião, planos de ação e novidades compartilhados pela
            equipe.
          </p>
        </div>
      </div>

      {updates.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-line bg-surface-2/40 p-6 text-center text-sm text-fg-subtle">
          Nenhuma atualização ainda.
        </p>
      ) : (
        <ol className="mt-6 space-y-5">
          {updates.map((u) => (
            <li
              key={u.id}
              className="rounded-xl border border-line bg-surface-2/40 p-4 sm:p-5"
            >
              <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-brand-tint px-2.5 py-1 text-xs font-semibold text-risd dark:text-white">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="5" width="18" height="16" rx="2" />
                  <path d="M8 3v4M16 3v4M3 10h18" />
                </svg>
                {formatPortalDate(u.at)}
              </p>
              <div
                className="rich-text note-view"
                onClick={handleContentClick}
                // Sanitizado no servidor (sanitizeNoteHtml/DOMPurify).
                dangerouslySetInnerHTML={{ __html: u.html }}
              />
            </li>
          ))}
        </ol>
      )}

      {zoom && <Lightbox {...zoom} onClose={() => setZoom(null)} />}
    </section>
  );
}

function Lightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  // Esc fecha; trava o scroll do fundo enquanto aberto.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Imagem ampliada"
      onClick={onClose}
      className="fixed inset-0 z-lightbox grid place-items-center bg-black/85 p-4 backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar imagem ampliada"
        className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] max-w-[92vw] rounded-lg object-contain shadow-pop"
      />
    </div>,
    document.body
  );
}

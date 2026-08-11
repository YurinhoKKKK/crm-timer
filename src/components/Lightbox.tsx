"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

// Visualizador de imagem ampliada (lightbox) — fonte ÚNICA compartilhada pelas
// anotações da empresa (CompanyNotes) e pelos chamados de suporte (detalhe do
// chamado). Renderizado via PORTAL no body, fora dos containers da lista/editor/
// modal, então nenhum ancestral com transform/filter/overflow quebra o
// position:fixed nem a ordem das camadas. z-lightbox (100) fica acima de todo o
// sistema (escala em tailwind.config.ts), inclusive acima de um Modal (z-overlay
// 50) que o tenha aberto. Fecha no ESC, no clique fora e no X; setas navegam
// entre as imagens; clicar na imagem alterna zoom (tamanho real com rolagem).
//
// ESC em CAPTURA + stopImmediatePropagation: quando o lightbox é aberto de dentro
// de um Modal (ex.: detalhe do chamado), o ESC fecha SÓ a imagem, sem também
// fechar o modal por baixo — o handler de captura roda antes do handler de bolha
// do Modal e interrompe a cadeia. Fora de um modal (anotações) é inócuo.
export default function Lightbox({
  images,
  index,
  onClose,
  onNavigate,
}: {
  images: string[];
  index: number;
  onClose: () => void;
  onNavigate: (i: number) => void;
}) {
  const [zoomed, setZoomed] = useState(false);
  const src = images[index];
  const many = images.length > 1;

  // Trocar de imagem sempre volta ao enquadramento normal.
  useEffect(() => setZoomed(false), [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
      if (many && e.key === "ArrowLeft") {
        onNavigate((index - 1 + images.length) % images.length);
      }
      if (many && e.key === "ArrowRight") {
        onNavigate((index + 1) % images.length);
      }
    };
    document.addEventListener("keydown", onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prev;
    };
  }, [onClose, onNavigate, index, images.length, many]);

  if (typeof document === "undefined" || !src) return null;

  const navBtn =
    "rounded-full bg-white/10 p-2 text-white transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";

  return createPortal(
    <div
      className="fixed inset-0 z-lightbox bg-gunmetal/90"
      role="dialog"
      aria-modal="true"
      aria-label="Imagem ampliada"
    >
      {/* Camada da imagem: clique fora fecha; clique na imagem alterna zoom */}
      {zoomed ? (
        <div className="absolute inset-0 z-10 overflow-auto p-6" onClick={onClose}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt=""
            onClick={(e) => {
              e.stopPropagation();
              setZoomed(false);
            }}
            className="mx-auto cursor-zoom-out rounded-lg shadow-pop"
            style={{ maxWidth: "none" }}
          />
        </div>
      ) : (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center p-6"
          onClick={onClose}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt=""
            onClick={(e) => {
              e.stopPropagation();
              setZoomed(true);
            }}
            className="max-h-[90vh] max-w-[92vw] cursor-zoom-in rounded-lg object-contain shadow-pop"
          />
        </div>
      )}

      {/* Controles sempre ACIMA da imagem */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar"
        title="Fechar (Esc)"
        className={`absolute right-4 top-4 z-20 ${navBtn}`}
      >
        <X size={22} />
      </button>

      {many && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate((index - 1 + images.length) % images.length);
            }}
            aria-label="Imagem anterior"
            title="Anterior (←)"
            className={`absolute left-3 top-1/2 z-20 -translate-y-1/2 ${navBtn}`}
          >
            <ChevronLeft size={24} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate((index + 1) % images.length);
            }}
            aria-label="Próxima imagem"
            title="Próxima (→)"
            className={`absolute right-3 top-1/2 z-20 -translate-y-1/2 ${navBtn}`}
          >
            <ChevronRight size={24} />
          </button>
          <span className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-sm font-medium tabular-nums text-white">
            {index + 1} / {images.length}
          </span>
        </>
      )}
    </div>,
    document.body
  );
}

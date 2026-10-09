"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

// Popover ancorado (portal + posição fixa) — não é recortado pelo overflow-x das
// seções; fecha no Esc e no clique fora; usa o token z-overlay. Compartilhado
// pelos quadros CS e Tráfego (chips de status, orçamento, data da reunião).
export default function AnchoredPopover({
  anchor,
  onClose,
  children,
  width = 240,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    function place() {
      const panel = panelRef.current;
      if (!panel) return;
      const r = anchor.getBoundingClientRect();
      const h = panel.offsetHeight;
      const w = panel.offsetWidth || width;
      const left = Math.min(Math.max(8, r.left), window.innerWidth - 8 - w);
      let top = r.bottom + 6;
      // Vira para cima se estourar embaixo.
      if (top + h > window.innerHeight - 8) {
        const above = r.top - 6 - h;
        top = above >= 8 ? above : Math.max(8, window.innerHeight - 8 - h);
      }
      setPos({ top, left });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor, width]);

  useEffect(() => {
    function onDown(e: PointerEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchor.contains(t)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      style={{
        position: "fixed",
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        minWidth: width,
        visibility: pos ? "visible" : "hidden",
      }}
      className="z-overlay max-w-[calc(100vw-1rem)] rounded-xl border border-line bg-surface p-1.5 shadow-pop"
    >
      {children}
    </div>,
    document.body
  );
}

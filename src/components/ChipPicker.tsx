"use client";

import { useRef, useState } from "react";
import AnchoredPopover from "@/components/AnchoredPopover";

// Chip + popover de escolha ÚNICA (com "Limpar") — generalização do seletor de
// status do quadro CS. Parametrizado por uma lista de opções {value,label,
// chipClass}; grava ao escolher. O texto do rótulo está SEMPRE presente (a cor é
// reforço). Valor nulo mostra o placeholder (ex.: "Não definido").
export type ChipOption<V extends string = string> = {
  value: V;
  label: string;
  chipClass: string;
};

export default function ChipPicker<V extends string>({
  value,
  options,
  onPick,
  ariaLabel,
  placeholder = "Não definido",
  width = 240,
  // Compacto (quadro de Tráfego): chip no tamanho das etiquetas (text-[11px]) e
  // placeholder menor/discreto — para linhas baixas.
  compact = false,
}: {
  value: V | null;
  options: ChipOption<V>[];
  onPick: (value: V | null) => void;
  ariaLabel: string;
  placeholder?: string;
  width?: number;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const current = value != null ? options.find((o) => o.value === value) ?? null : null;
  const chipSize = compact
    ? "px-2 py-0.5 text-[11px] whitespace-nowrap"
    : "px-2 py-0.5 text-xs";

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={current ? current.label : placeholder}
        className="rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
      >
        {current ? (
          <span
            className={`inline-flex items-center rounded-full border font-medium ${chipSize} ${current.chipClass}`}
          >
            {current.label}
          </span>
        ) : (
          <span
            className={compact ? "whitespace-nowrap text-xs text-fg-subtle" : "text-fg-subtle"}
          >
            {placeholder}
          </span>
        )}
      </button>
      {open && ref.current && (
        <AnchoredPopover anchor={ref.current} onClose={() => setOpen(false)} width={width}>
          <div className="flex flex-col">
            {options.map((o) => {
              const active = value === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onPick(o.value);
                  }}
                  className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
                    active ? "font-semibold text-fg" : "text-fg-muted"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full border ${o.chipClass}`}
                  />
                  {o.label}
                </button>
              );
            })}
            <div className="my-1 border-t border-line" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPick(null);
              }}
              className="rounded-md px-2.5 py-1.5 text-left text-sm text-fg-muted transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
            >
              Limpar
            </button>
          </div>
        </AnchoredPopover>
      )}
    </>
  );
}

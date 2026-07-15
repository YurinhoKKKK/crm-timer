"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { norm } from "@/components/ListControls";

// Dropdown de seleção única COM BUSCA interna (Passo 18 — preparo para escala).
// Substitui os <select> nativos nos seletores de empresa/colaborador/consultor/
// grupo, que viram listas enormes de rolar com 40+ empresas / 20+ pessoas.
//
// Controlado: o pai guarda `value` (id) e recebe `onChange(id)`. A validação de
// obrigatoriedade fica no pai/na server action (que já retorna erro inline), por
// isso não replicamos o `required` nativo aqui.
//
// O painel é renderizado num PORTAL com posição `fixed` calculada a partir do
// gatilho, para nunca ser cortado por contêineres com overflow (ex.: a lista
// rolável do AssignmentPicker).

export type ComboOption = { value: string; label: string; hint?: string };

// Variante para BARRAS DE FILTRO: o mesmo Combobox com uma opção "todos"
// (value vazio) no topo, substituindo o <select> nativo nos filtros de empresa
// — que precisam de busca por qualquer trecho do nome, sem acentos, porque os
// nomes começam com código interno (ex.: "315. WAGEN…").
export function ComboFilter({
  value,
  onChange,
  allLabel,
  options,
  ariaLabel,
  searchPlaceholder,
}: {
  value: string;
  onChange: (value: string) => void;
  allLabel: string;
  options: ComboOption[];
  ariaLabel: string;
  searchPlaceholder?: string;
}) {
  const opts = useMemo(
    () => [{ value: "", label: allLabel }, ...options],
    [allLabel, options]
  );
  return (
    <div className="sm:w-64">
      <Combobox
        value={value}
        onChange={onChange}
        options={opts}
        ariaLabel={ariaLabel}
        placeholder={allLabel}
        searchPlaceholder={searchPlaceholder}
      />
    </div>
  );
}

const triggerClass =
  "flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-left text-sm text-fg shadow-sm transition hover:border-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60";

type Pos = { left: number; top: number; width: number; openUp: boolean };

export default function Combobox({
  value,
  onChange,
  options,
  id,
  ariaLabel,
  placeholder = "Selecione…",
  searchPlaceholder = "Buscar…",
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<Pos | null>(null);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return options;
    return options.filter((o) => norm(o.label).includes(q));
  }, [options, query]);

  const PANEL_MAX = 320; // altura estimada do painel (busca + lista)

  const reposition = useCallback(() => {
    const el = buttonRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < PANEL_MAX && r.top > spaceBelow;
    setPos({
      left: r.left,
      width: r.width,
      top: openUp ? r.top : r.bottom,
      openUp,
    });
  }, []);

  // Ao abrir: mede a posição, limpa a busca, foca o campo e destaca o selecionado.
  useEffect(() => {
    if (!open) return;
    reposition();
    setQuery("");
    const idx = selected
      ? Math.max(0, options.findIndex((o) => o.value === selected.value))
      : 0;
    setActive(idx);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Reposiciona e fecha em rolagem/resize da página (o painel é fixed).
  useEffect(() => {
    if (!open) return;
    const onScroll = () => reposition();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, reposition]);

  // Fecha ao clicar fora (gatilho + painel no portal).
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Mantém a opção destacada visível.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${active}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open, filtered.length]);

  function choose(option: ComboOption) {
    onChange(option.value);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[active];
      if (opt) choose(opt);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (
            !open &&
            (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")
          ) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={triggerClass}
      >
        <span className={`truncate ${selected ? "text-fg" : "text-fg-subtle"}`}>
          {selected ? selected.label : placeholder}
        </span>
        <svg
          className="shrink-0 text-fg-subtle"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              left: pos.left,
              width: pos.width,
              ...(pos.openUp
                ? { bottom: window.innerHeight - pos.top }
                : { top: pos.top }),
            }}
            className="z-[60] mt-1 overflow-hidden rounded-lg border border-line bg-surface shadow-pop"
          >
            <div className="border-b border-line p-2">
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
              />
            </div>
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-fg-subtle">
                Nenhum resultado.
              </p>
            ) : (
              <ul
                ref={listRef}
                role="listbox"
                aria-label={ariaLabel}
                className="max-h-60 overflow-y-auto py-1"
              >
                {filtered.map((o, i) => {
                  const isSelected = o.value === value;
                  const isActive = i === active;
                  return (
                    <li
                      key={o.value}
                      role="option"
                      aria-selected={isSelected}
                      data-index={i}
                    >
                      <button
                        type="button"
                        onMouseEnter={() => setActive(i)}
                        onClick={() => choose(o)}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition ${
                          isActive ? "bg-brand-tint" : ""
                        } ${isSelected ? "text-risd" : "text-fg"}`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate">{o.label}</span>
                          {o.hint && (
                            <span className="block truncate text-xs text-fg-subtle">
                              {o.hint}
                            </span>
                          )}
                        </span>
                        {isSelected && (
                          <svg
                            className="shrink-0 text-risd"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>,
          document.body
        )}
    </>
  );
}

"use client";

import { useEffect, useState, type ReactNode } from "react";

// Controles de filtro compartilhados pelas listagens (tarefas, empresas,
// usuários). Visual discreto, alinhado à identidade da marca. A filtragem em
// si é feita no componente de cada lista (estado local + useMemo) — instantânea,
// sem ida ao servidor.

const selectClass =
  "rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm transition focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      {children}
    </div>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative sm:min-w-[220px] sm:flex-1">
      <svg
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
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
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-sm text-fg shadow-sm transition placeholder:text-fg-subtle focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      />
    </div>
  );
}

export type SelectOption = { value: string; label: string };

export function SelectFilter({
  value,
  onChange,
  allLabel,
  options,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  allLabel: string;
  options: SelectOption[];
  ariaLabel: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      className={selectClass}
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// Normaliza para busca: minúsculas e sem acentos.
export function norm(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Estado vazio padrão das listas (sem dados ou sem resultado de filtro).
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-12 text-center text-fg-subtle shadow-card">
      {children}
    </div>
  );
}

// Revelação incremental "ver mais" (Passo 18 — escala). Mantém a busca
// instantânea (o filtro continua em memória sobre a lista toda), mas só renderiza
// uma janela de itens por vez, para não montar centenas de nós no DOM. O limite
// volta ao início sempre que a lista filtrada muda (nova busca/filtro).
export function usePaged<T>(
  items: T[],
  step = 20
): { visible: T[]; hasMore: boolean; remaining: number; showMore: () => void } {
  const [limit, setLimit] = useState(step);

  useEffect(() => {
    setLimit(step);
  }, [items, step]);

  return {
    visible: items.slice(0, limit),
    hasMore: items.length > limit,
    remaining: Math.max(0, items.length - limit),
    showMore: () => setLimit((l) => l + step),
  };
}

// Botão "Ver mais" centralizado, responsivo (full-width no celular).
export function ShowMore({
  remaining,
  onClick,
}: {
  remaining: number;
  onClick: () => void;
}) {
  return (
    <div className="mt-4 flex justify-center">
      <button
        type="button"
        onClick={onClick}
        className="w-full rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg shadow-sm transition hover:border-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas sm:w-auto"
      >
        Ver mais{" "}
        <span className="text-fg-subtle">
          ({remaining} restante{remaining === 1 ? "" : "s"})
        </span>
      </button>
    </div>
  );
}

// Aviso de que a lista foi limitada no servidor (teto de desempenho). Sinaliza
// que a busca/os filtros agem só sobre o que foi carregado.
export function TruncationNotice({ count }: { count: number }) {
  return (
    <p className="mb-3 rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-xs text-fg-subtle">
      Exibindo as primeiras {count} tarefas (limite de desempenho). A busca e os
      filtros abaixo agem sobre estas; refine para encontrar tarefas específicas.
    </p>
  );
}

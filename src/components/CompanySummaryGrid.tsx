"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SearchBox, EmptyState, norm } from "@/components/ListControls";
import LabelChips from "@/components/LabelChips";
import type { Label } from "@/lib/labels";

export type CompanyCardItem = {
  id: string;
  name: string;
  href: string;
  done: number;
  total: number;
  pending: number;
  overdue: number;
  // Só o painel do colaborador usa estes dois; ficam ocultos quando ausentes.
  dueSoon?: number;
  labels?: Label[];
};

// Grade de cards "Minhas empresas" dos painéis do consultor e do colaborador,
// com barra de busca por empresa (qualquer trecho do nome, sem acentos — os
// nomes começam com código interno, ex.: "315. WAGEN…"). Os cards mantêm o
// visual que cada painel já tinha; a filtragem é em memória, instantânea.
export default function CompanySummaryGrid({
  items,
}: {
  items: CompanyCardItem[];
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return items;
    return items.filter((c) => norm(c.name).includes(q));
  }, [items, query]);

  return (
    <>
      <div className="mb-4">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Buscar empresa…"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState>Nenhuma empresa corresponde à busca.</EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => {
            const percent =
              c.total > 0 ? Math.round((c.done / c.total) * 100) : 0;
            return (
              <li key={c.id}>
                <Link
                  href={c.href}
                  className="group block rounded-xl border border-line bg-surface p-5 shadow-card transition hover:-translate-y-0.5 hover:border-risd/40 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold text-fg group-hover:text-risd">
                      {c.name}
                    </h3>
                    <span className="text-fg-subtle transition group-hover:translate-x-0.5 group-hover:text-risd">
                      →
                    </span>
                  </div>
                  {c.labels && c.labels.length > 0 && (
                    <LabelChips labels={c.labels} className="mt-2" />
                  )}

                  <div className="mt-4">
                    <div className="mb-1.5 flex items-center justify-between text-xs text-fg-muted">
                      <span className="font-mono tabular-nums">
                        {percent}% concluído
                      </span>
                      <span className="font-mono tabular-nums">
                        {c.done}/{c.total}
                      </span>
                    </div>
                    <div
                      className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
                      role="progressbar"
                      aria-valuenow={percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="h-full rounded-full bg-risd transition-all"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-fg-muted">
                      {c.pending} pendente{c.pending === 1 ? "" : "s"}
                    </span>
                    {c.overdue > 0 && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300">
                        {c.overdue} atrasada{c.overdue === 1 ? "" : "s"}
                      </span>
                    )}
                    {(c.dueSoon ?? 0) > 0 && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                        {c.dueSoon} vencendo em 24h
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

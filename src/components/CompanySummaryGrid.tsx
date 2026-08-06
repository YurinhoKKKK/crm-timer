"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SearchBox, EmptyState, norm } from "@/components/ListControls";
import LabelChips from "@/components/LabelChips";
import type { Label } from "@/lib/labels";
import { farolOf } from "@/lib/followup";
import { FarolBadge } from "@/components/followup/FarolBadge";

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
  // Semáforo de contato (mesma fonte da /acompanhamento). Presente só onde há
  // acompanhamento (painel do consultor); `days` null = nunca contatado. Quando
  // ausente, o card não mostra badge nem o filtro de atenção aparece.
  contact?: { days: number | null };
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
  // Filtro rápido "só quem precisa de atenção" (amarelo + vermelho + sem
  // registro = tudo que NÃO é verde). NÃO reordena os cards — a ordem serve para
  // ENCONTRAR uma empresa; a cor é que chama atenção. Só aparece onde há dado de
  // contato (painel do consultor).
  const [attentionOnly, setAttentionOnly] = useState(false);

  // Há acompanhamento nestes cards? (colaborador não tem → sem badge nem filtro)
  const hasContact = useMemo(
    () => items.some((c) => c.contact !== undefined),
    [items]
  );
  const needsAttention = (c: CompanyCardItem) =>
    c.contact !== undefined && farolOf(c.contact.days) !== "verde";
  const attentionCount = useMemo(
    () => (hasContact ? items.filter(needsAttention).length : 0),
    [items, hasContact]
  );

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    let list = q ? items.filter((c) => norm(c.name).includes(q)) : items;
    if (attentionOnly) list = list.filter(needsAttention);
    return list;
  }, [items, query, attentionOnly]);

  return (
    <>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Buscar empresa…"
        />
        {hasContact && (
          <button
            type="button"
            onClick={() => setAttentionOnly((v) => !v)}
            aria-pressed={attentionOnly}
            className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${
              attentionOnly
                ? "border-risd/50 bg-brand-tint text-fg"
                : "border-line bg-surface text-fg-muted hover:text-fg"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                attentionOnly ? "bg-amber-500" : "bg-fg-subtle"
              }`}
              aria-hidden="true"
            />
            Só quem precisa de atenção
            <span className="tabular-nums text-fg-subtle">{attentionCount}</span>
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState>
          {attentionOnly && attentionCount === 0
            ? "Nenhuma empresa precisando de atenção agora. 🎉"
            : "Nenhuma empresa corresponde à busca."}
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => {
            const percent =
              c.total > 0 ? Math.round((c.done / c.total) * 100) : 0;
            return (
              // li em flex + Link flex-1 h-full: os cards da MESMA fileira ganham
              // a altura da fileira (o mais alto manda), esticando os menores em
              // vez de cortar os maiores.
              <li key={c.id} className="flex">
                <Link
                  href={c.href}
                  className="group flex flex-1 flex-col rounded-xl border border-line bg-surface p-5 shadow-card transition hover:-translate-y-0.5 hover:border-risd/40 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                >
                  {/* items-start: com título de 2–3 linhas a seta fica alinhada à
                      primeira linha, não centralizada verticalmente. */}
                  <div className="flex items-start justify-between gap-2">
                    <h3
                      title={c.name}
                      className="font-semibold text-fg group-hover:text-risd"
                    >
                      {c.name}
                    </h3>
                    <span className="mt-0.5 shrink-0 text-fg-subtle transition group-hover:translate-x-0.5 group-hover:text-risd">
                      →
                    </span>
                  </div>
                  {c.labels && c.labels.length > 0 && (
                    <LabelChips labels={c.labels} className="mt-2" />
                  )}

                  {/* mt-auto empurra progresso + pendências + badge para a base:
                      a folga extra sobra AQUI (entre o título e o progresso), e os
                      três blocos alinham horizontalmente entre cards vizinhos.
                      pt-4 garante um respiro mínimo mesmo no card mais alto. */}
                  <div className="mt-auto pt-4">
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

                  {/* Semáforo de contato — um sinal a mais, discreto, numa linha
                      própria sob as tarefas. Não protagoniza o card. */}
                  {c.contact && (
                    <div className="mt-3 border-t border-line/60 pt-3">
                      <FarolBadge days={c.contact.days} />
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

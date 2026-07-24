"use client";

import { useMemo, useState } from "react";
import type { CompanyListingRow, ListingValidationItem } from "@/lib/listing";
import { MARKETPLACES, marketplaceLabel } from "@/lib/listing";
import TaskDetailLink from "@/components/TaskDetailLink";
import {
  FilterBar,
  SearchBox,
  SelectFilter,
  EmptyState,
  ShowMore,
  usePaged,
  norm,
} from "@/components/ListControls";

type SortKey = "recentes" | "antigas" | "marca";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// Aba "Minhas Listagens" da central da empresa (passo 23): as marcas entregues
// nas tarefas de listagem daquela empresa, cada uma com o link clicável (ou a
// justificativa) e o marketplace. Busca por marca, filtro por marketplace,
// ordenação e paginação ("ver mais") reaproveitando os controles do sistema.
const VALIDATION_LABEL: Record<ListingValidationItem["event"], string> = {
  aprovado: "Aprovada",
  ajuste_solicitado: "Ajuste solicitado",
  contestado: "Cliente quer listar",
};

function validationTone(event: ListingValidationItem["event"]): string {
  return event === "aprovado"
    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
    : "bg-amber-500/15 text-amber-700 dark:text-amber-300";
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Histórico de validação de uma listagem (passo 33): estado atual em destaque +
// todos os eventos (append-only, nunca reescritos), do mais recente ao mais
// antigo, com autor e comentário.
function ValidationHistory({ events }: { events: ListingValidationItem[] }) {
  if (events.length === 0) return null;
  const latest = events[events.length - 1];
  const author = (e: ListingValidationItem) =>
    e.authorType === "cliente" ? "Cliente" : e.author ?? "Equipe";

  return (
    <details className="mt-2 rounded-lg border border-line bg-surface-2/40 px-3 py-2">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-xs">
        <span
          className={`rounded-full px-2 py-0.5 font-medium ${validationTone(
            latest.event
          )}`}
        >
          {VALIDATION_LABEL[latest.event]}
        </span>
        <span className="text-fg-subtle">
          {author(latest)} · {formatDateTime(latest.at)}
        </span>
        {events.length > 1 && (
          <span className="text-fg-subtle">
            · histórico ({events.length})
          </span>
        )}
      </summary>
      <ol className="mt-2 space-y-2 border-t border-line pt-2">
        {[...events].reverse().map((e, i) => (
          <li key={i} className="text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 font-medium ${validationTone(
                  e.event
                )}`}
              >
                {VALIDATION_LABEL[e.event]}
              </span>
              <span className="text-fg-subtle">
                {author(e)} · {formatDateTime(e.at)}
              </span>
            </div>
            {e.comment && (
              <p className="mt-1 text-fg-muted">“{e.comment}”</p>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

export default function CompanyListings({
  rows,
  validations = {},
}: {
  rows: CompanyListingRow[];
  // Histórico de validação por listing_result_id (passo 33).
  validations?: Record<string, ListingValidationItem[]>;
}) {
  const [query, setQuery] = useState("");
  const [marketplace, setMarketplace] = useState("");
  const [sort, setSort] = useState<SortKey>("recentes");

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    const out = rows.filter((r) => {
      if (q && !norm(r.brandName).includes(q)) return false;
      if (marketplace && r.marketplace !== marketplace) return false;
      return true;
    });
    out.sort((a, b) => {
      if (sort === "marca") {
        return (
          a.brandName.localeCompare(b.brandName, "pt-BR") ||
          (b.dateISO ?? "").localeCompare(a.dateISO ?? "")
        );
      }
      const cmp = (a.dateISO ?? "").localeCompare(b.dateISO ?? "");
      return sort === "antigas" ? cmp : -cmp;
    });
    return out;
  }, [rows, query, marketplace, sort]);

  const { visible, hasMore, remaining, showMore } = usePaged(filtered);

  if (rows.length === 0) {
    return (
      <EmptyState>
        Nenhuma listagem entregue para esta empresa ainda.
      </EmptyState>
    );
  }

  return (
    <section>
      <FilterBar>
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Buscar por marca…"
        />
        <SelectFilter
          value={marketplace}
          onChange={setMarketplace}
          allLabel="Todos os marketplaces"
          ariaLabel="Filtrar por marketplace"
          options={MARKETPLACES.map((m) => ({ value: m.value, label: m.label }))}
        />
        <SelectFilter
          value={sort}
          onChange={(v) => setSort(v as SortKey)}
          allLabel="Mais recentes"
          ariaLabel="Ordenar"
          options={[
            { value: "antigas", label: "Mais antigas" },
            { value: "marca", label: "Marca (A→Z)" },
          ]}
        />
      </FilterBar>

      {filtered.length === 0 ? (
        <EmptyState>Nenhuma listagem corresponde aos filtros.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {visible.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-line bg-surface p-3 shadow-card"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-fg">{r.brandName}</span>
                <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-xs text-fg-muted">
                  {marketplaceLabel(r.marketplace)}
                </span>
                <span className="ml-auto text-xs text-fg-subtle">
                  {formatDate(r.dateISO)}
                </span>
              </div>
              <div className="mt-1.5 text-sm">
                {r.link ? (
                  <a
                    href={r.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-risd underline decoration-risd/40 underline-offset-2 hover:decoration-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                  >
                    {r.link}
                  </a>
                ) : (
                  <span className="text-fg-subtle">
                    Não feita
                    {r.reason ? (
                      <>
                        {" "}
                        — <span className="italic text-fg-muted">{r.reason}</span>
                      </>
                    ) : null}
                  </span>
                )}
              </div>
              {/* Tarefa de origem: abre o painel de detalhe unificado. */}
              <TaskDetailLink
                taskId={r.taskId}
                className="mt-1 block max-w-full truncate text-left text-xs text-fg-subtle underline decoration-line underline-offset-2 transition hover:text-risd hover:decoration-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
              >
                {r.taskTitle}
              </TaskDetailLink>
              <ValidationHistory events={validations[r.id] ?? []} />
            </li>
          ))}
        </ul>
      )}

      {hasMore && <ShowMore remaining={remaining} onClick={showMore} />}
    </section>
  );
}

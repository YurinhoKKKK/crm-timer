"use client";

import { useMemo, useState } from "react";
import type { CompanyListingRow } from "@/lib/listing";
import { MARKETPLACES, marketplaceLabel } from "@/lib/listing";
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
export default function CompanyListings({
  rows,
}: {
  rows: CompanyListingRow[];
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
              <p className="mt-1 truncate text-xs text-fg-subtle">{r.taskTitle}</p>
            </li>
          ))}
        </ul>
      )}

      {hasMore && <ShowMore remaining={remaining} onClick={showMore} />}
    </section>
  );
}

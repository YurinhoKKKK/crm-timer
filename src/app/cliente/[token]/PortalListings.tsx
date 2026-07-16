"use client";

import { useMemo, useState } from "react";
import MarketplaceBadge from "@/components/MarketplaceBadge";
import {
  FilterBar,
  SearchBox,
  SelectFilter,
  ShowMore,
  norm,
  usePaged,
} from "@/components/ListControls";
import { MARKETPLACES } from "@/lib/listing";
import type { PortalListing } from "@/lib/client-portal";
import { formatPortalDate } from "./portal-format";

// Aba "Listagens" do portal do cliente. Filtra e pagina EM MEMÓRIA sobre o
// conjunto curado que veio de client_portal_data — nenhuma consulta nova.
// ListControls é puramente visual (estado local), seguro no portal blindado.
//
// Curadoria do status: "Listada" (verde discreto) quando há link; "Não
// listada" em tom NEUTRO com o motivo como nota editorial — não é falha nem
// pendência, é decisão de curadoria.

const STATUS_OPTIONS = [
  { value: "listada", label: "Listada" },
  { value: "nao_listada", label: "Não listada" },
];

const BRANDS_PER_PAGE = 10;

export default function PortalListings({
  listings,
}: {
  listings: PortalListing[];
}) {
  const [query, setQuery] = useState("");
  const [marketplace, setMarketplace] = useState("");
  const [status, setStatus] = useState("");

  const filtered = useMemo(
    () =>
      listings.filter(
        (l) =>
          (!query || norm(l.brand).includes(norm(query))) &&
          (!marketplace || l.marketplace === marketplace) &&
          (!status || (status === "listada") === Boolean(l.link))
      ),
    [listings, query, marketplace, status]
  );

  // Agrupa por marca preservando a ordem de chegada (mais recente primeiro).
  const groups = useMemo(() => {
    const byBrand = new Map<string, PortalListing[]>();
    for (const l of filtered) {
      const list = byBrand.get(l.brand) ?? [];
      list.push(l);
      byBrand.set(l.brand, list);
    }
    return Array.from(byBrand.entries());
  }, [filtered]);

  const { visible, hasMore, remaining, showMore } = usePaged(
    groups,
    BRANDS_PER_PAGE
  );

  const brandTotal = new Set(listings.map((l) => l.brand)).size;
  const activeTotal = listings.filter((l) => l.link).length;
  const hasFilter = Boolean(query || marketplace || status);

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
            <path d="M6 7h12l1.2 13H4.8L6 7z" />
            <path d="M9 10V6a3 3 0 0 1 6 0v4" />
          </svg>
        </span>
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-fg">
            Suas listagens nos marketplaces
          </h2>
          <p className="mt-0.5 text-sm text-fg-muted">
            As marcas do seu catálogo em cada marketplace, com o link de cada
            listagem — e, quando uma marca não é listada, o motivo da decisão.
          </p>
        </div>
      </div>

      {listings.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-line bg-surface-2/40 p-6 text-center text-sm text-fg-subtle">
          As listagens do seu projeto aparecerão aqui assim que estiverem
          disponíveis.
        </p>
      ) : (
        <>
          {/* Números que agregam: total de marcas e listagens ativas */}
          <dl className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-3 text-center">
              <dd className="text-2xl font-bold tracking-tight text-fg">
                {brandTotal}
              </dd>
              <dt className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                {brandTotal === 1 ? "Marca" : "Marcas"}
              </dt>
            </div>
            <div className="rounded-xl border border-risd/30 bg-brand-tint px-3 py-3 text-center">
              <dd className="text-2xl font-bold tracking-tight text-risd dark:text-white">
                {activeTotal}
              </dd>
              <dt className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                {activeTotal === 1 ? "Listagem ativa" : "Listagens ativas"}
              </dt>
            </div>
          </dl>

          {/* Busca por marca + filtros por marketplace e status */}
          <div className="mt-5">
            <FilterBar>
              <SearchBox
                value={query}
                onChange={setQuery}
                placeholder="Buscar marca…"
              />
              <SelectFilter
                value={marketplace}
                onChange={setMarketplace}
                allLabel="Todos os marketplaces"
                options={MARKETPLACES}
                ariaLabel="Filtrar por marketplace"
              />
              <SelectFilter
                value={status}
                onChange={setStatus}
                allLabel="Todos os status"
                options={STATUS_OPTIONS}
                ariaLabel="Filtrar por status"
              />
            </FilterBar>
          </div>

          {groups.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line bg-surface-2/40 p-6 text-center text-sm text-fg-subtle">
              Nenhuma listagem encontrada com essa busca ou filtros.
            </p>
          ) : (
            <>
              <div className="space-y-5">
                {visible.map(([brand, rows]) => (
                  <div
                    key={brand}
                    className="overflow-hidden rounded-xl border border-line bg-surface-2/40"
                  >
                    <div className="flex items-center gap-3 border-b border-line/70 px-4 py-3.5">
                      <span
                        aria-hidden="true"
                        className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-brand-tint text-base font-bold text-risd dark:text-white"
                      >
                        {brand.trim().charAt(0).toUpperCase() || "•"}
                      </span>
                      <p className="min-w-0 truncate font-semibold text-fg">
                        {brand}
                      </p>
                    </div>
                    <ul className="space-y-2.5 p-3.5 sm:p-4">
                      {rows.map((r, i) => (
                        <li key={`${r.marketplace}-${i}`}>
                          {r.link ? (
                            <ListedRow row={r} />
                          ) : (
                            <NotListedRow row={r} />
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              {hasMore && <ShowMore remaining={remaining} onClick={showMore} />}
              {hasFilter && (
                <p className="mt-4 text-center text-xs text-fg-subtle">
                  {filtered.length} de {listings.length}{" "}
                  {listings.length === 1 ? "listagem" : "listagens"} com os
                  filtros atuais
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

// Com link: a LINHA INTEIRA é clicável; "Ver listagem" é um link discreto
// (o azul cheio fica reservado a no máximo uma ação principal por bloco).
function ListedRow({ row }: { row: PortalListing }) {
  return (
    <a
      href={row.link!}
      target="_blank"
      rel="noopener noreferrer"
      className="group block rounded-xl border border-line bg-surface p-3.5 shadow-sm transition hover:border-risd/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:p-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <MarketplaceBadge marketplace={row.marketplace} />
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
          Listada
        </span>
        <span className="ml-auto flex items-center gap-3">
          {row.date && (
            <span className="text-xs text-fg-subtle">
              {formatPortalDate(row.date)}
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-sm font-medium text-risd">
            Ver listagem
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="transition-transform group-hover:translate-x-0.5"
            >
              <path d="M7 17 17 7" />
              <path d="M9 7h8v8" />
            </svg>
          </span>
        </span>
      </div>
    </a>
  );
}

// Sem link: tom NEUTRO (não é alerta nem pendência) e o motivo como nota
// editorial da curadoria.
function NotListedRow({ row }: { row: PortalListing }) {
  return (
    <div className="rounded-xl border border-line/70 bg-surface-2/50 p-3.5 sm:p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <MarketplaceBadge marketplace={row.marketplace} />
        <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-xs font-medium text-fg-muted">
          Não listada
        </span>
        {row.date && (
          <span className="ml-auto text-xs text-fg-subtle">
            {formatPortalDate(row.date)}
          </span>
        )}
      </div>
      {row.reason && (
        <p className="mt-2 text-sm text-fg-muted">{row.reason}</p>
      )}
    </div>
  );
}

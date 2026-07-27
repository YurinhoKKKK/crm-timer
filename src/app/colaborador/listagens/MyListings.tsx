"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import MarketplaceBadge from "@/components/MarketplaceBadge";
import TaskDetailLink from "@/components/TaskDetailLink";
import {
  FilterBar,
  SearchBox,
  SelectFilter,
  EmptyState,
  ShowMore,
  norm,
} from "@/components/ListControls";
import {
  MARKETPLACES,
  isValidationPending,
  type ListingValidationState,
  type MyListingRow,
} from "@/lib/listing";

// "Minhas Listagens" do COLABORADOR: TODAS as listagens que ele executa,
// cruzando empresas, com o estado de validação do cliente. O escopo (isolamento
// por executor) é do BANCO (RPC my_listings, SECURITY INVOKER) — aqui só se
// filtra/ordena EM MEMÓRIA sobre o conjunto já escopado, então busca e filtros
// nunca "vazam" um item de fora do escopo: eles nunca chegaram ao cliente.

type SortKey = "data" | "empresa" | "marca";
const STEP = 20;

const STATE_META: Record<
  ListingValidationState,
  { label: string; tone: string }
> = {
  aprovada: {
    label: "Aprovada",
    tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  ajuste_solicitado: {
    label: "Ajuste solicitado",
    tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  contestado: {
    label: "Gostaria de listar",
    tone: "bg-risd/10 text-risd dark:text-white",
  },
  reajuste_feito: {
    label: "Reajuste feito",
    tone: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  aguardando: {
    label: "Aguardando cliente",
    tone: "bg-surface-2 text-fg-subtle",
  },
};

// Estados que podem ocorrer hoje (o cliente ainda não tem como gerar
// "reajuste_feito" — isso vem no fluxo interno do 2º prompt).
const STATE_OPTIONS: { value: ListingValidationState; label: string }[] = [
  { value: "aprovada", label: "Aprovada" },
  { value: "ajuste_solicitado", label: "Ajuste solicitado" },
  { value: "contestado", label: "Gostaria de listar" },
  { value: "aguardando", label: "Aguardando cliente" },
];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function MyListings({ rows }: { rows: MyListingRow[] }) {
  const params = useSearchParams();
  const highlightId = params.get("destaque");

  const [query, setQuery] = useState("");
  const [marketplace, setMarketplace] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [onlyPending, setOnlyPending] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("data");
  const [sortAsc, setSortAsc] = useState(true); // data: mais antigo primeiro
  const [shown, setShown] = useState(STEP);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const didHighlight = useRef(false);

  const pendingCount = useMemo(
    () => rows.filter((r) => isValidationPending(r.state)).length,
    [rows]
  );

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    const out = rows.filter((r) => {
      if (
        q &&
        !norm(r.companyName).includes(q) &&
        !norm(r.brandName).includes(q) &&
        !norm(r.marketplace).includes(q)
      )
        return false;
      if (marketplace && r.marketplace !== marketplace) return false;
      if (stateFilter && r.state !== stateFilter) return false;
      if (onlyPending && !isValidationPending(r.state)) return false;
      return true;
    });
    out.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "empresa") {
        cmp =
          a.companyName.localeCompare(b.companyName, "pt-BR") ||
          a.brandName.localeCompare(b.brandName, "pt-BR");
      } else if (sortKey === "marca") {
        cmp = a.brandName.localeCompare(b.brandName, "pt-BR");
      } else {
        cmp = (a.dateISO ?? "").localeCompare(b.dateISO ?? "");
      }
      return sortAsc ? cmp : -cmp;
    });
    return out;
  }, [rows, query, marketplace, stateFilter, onlyPending, sortKey, sortAsc]);

  // "Ver mais" volta ao início quando a lista filtrada muda.
  useEffect(() => {
    setShown(STEP);
  }, [query, marketplace, stateFilter, onlyPending, sortKey, sortAsc]);

  // Destaque vindo da notificação (item 3): revela a página que contém o item,
  // rola até ele e aplica um realce temporário. Uma única vez.
  useEffect(() => {
    if (didHighlight.current || !highlightId) return;
    const idx = filtered.findIndex((r) => r.id === highlightId);
    if (idx === -1) return; // fora do escopo/filtro — nada a destacar
    didHighlight.current = true;
    setShown((s) => Math.max(s, idx + 1));
    setHighlighted(highlightId);
    const t = window.setTimeout(() => setHighlighted(null), 2800);
    return () => window.clearTimeout(t);
  }, [filtered, highlightId]);

  // Rola até o item destacado assim que ele estiver renderizado (depois que
  // `shown` cresceu o suficiente para incluí-lo).
  useEffect(() => {
    if (!highlighted) return;
    const el = document.getElementById(`listing-${highlighted}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlighted, shown]);

  if (rows.length === 0) {
    return (
      <EmptyState>
        Você ainda não tem listagens. As entregas das suas tarefas de listagem
        aparecem aqui, com o veredito do cliente.
      </EmptyState>
    );
  }

  const visible = filtered.slice(0, shown);
  const hasMore = filtered.length > shown;
  const remaining = Math.max(0, filtered.length - shown);

  return (
    <section>
      <FilterBar>
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Buscar por empresa, marca ou marketplace…"
        />
        <SelectFilter
          value={marketplace}
          onChange={setMarketplace}
          allLabel="Todos os marketplaces"
          ariaLabel="Filtrar por marketplace"
          options={MARKETPLACES.map((m) => ({ value: m.value, label: m.label }))}
        />
        <SelectFilter
          value={stateFilter}
          onChange={setStateFilter}
          allLabel="Todos os estados"
          ariaLabel="Filtrar por estado de validação"
          options={STATE_OPTIONS}
        />
        <SelectFilter
          value={sortKey}
          onChange={(v) => setSortKey(v as SortKey)}
          allLabel="Ordenar por data"
          ariaLabel="Ordenar"
          options={[
            { value: "empresa", label: "Empresa (A→Z)" },
            { value: "marca", label: "Marca (A→Z)" },
          ]}
        />
        <button
          type="button"
          onClick={() => setSortAsc((v) => !v)}
          aria-pressed={!sortAsc}
          title={sortAsc ? "Ordem crescente" : "Ordem decrescente"}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg-muted shadow-sm transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={sortAsc ? "" : "rotate-180"}
          >
            <path d="M12 5v14M6 11l6-6 6 6" />
          </svg>
          {sortKey === "data"
            ? sortAsc
              ? "Mais antigas"
              : "Mais recentes"
            : sortAsc
            ? "A→Z"
            : "Z→A"}
        </button>
      </FilterBar>

      {/* Filtro de PENDÊNCIAS (item 4): a fila do que precisa refazer, entre
          todas as empresas. Destacado por ser a ação principal desta tela. */}
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOnlyPending((v) => !v)}
          aria-pressed={onlyPending}
          className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${
            onlyPending
              ? "border-amber-400 bg-amber-500/15 text-amber-700 dark:text-amber-300"
              : "border-line bg-surface text-fg-muted hover:border-amber-300 hover:text-fg"
          }`}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 9v4M12 17h.01" />
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          </svg>
          Só pendências
          {pendingCount > 0 && (
            <span
              className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-xs font-semibold ${
                onlyPending
                  ? "bg-amber-500/25"
                  : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
              }`}
            >
              {pendingCount}
            </span>
          )}
        </button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState>Nenhuma listagem corresponde aos filtros.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {visible.map((r) => {
            const meta = STATE_META[r.state];
            const isHot = highlighted === r.id;
            return (
              <li
                key={r.id}
                id={`listing-${r.id}`}
                className={`scroll-mt-24 rounded-xl border bg-surface p-3 shadow-card transition ${
                  isHot
                    ? "border-risd ring-2 ring-risd ring-offset-2 ring-offset-canvas"
                    : "border-line"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-fg">
                    {r.companyName}
                  </span>
                  <span className="text-fg-subtle">·</span>
                  <span className="text-sm text-fg-muted">{r.brandName}</span>
                  <MarketplaceBadge marketplace={r.marketplace} />
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.tone}`}
                  >
                    {meta.label}
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
                          —{" "}
                          <span className="italic text-fg-muted">
                            {r.reason}
                          </span>
                        </>
                      ) : null}
                    </span>
                  )}
                </div>

                {/* Comentário do cliente na pendência (por que pediu ajuste /
                    quis listar) — o que o colaborador precisa para agir. */}
                {r.validationComment &&
                  isValidationPending(r.state) && (
                    <p className="mt-1.5 rounded-lg bg-surface-2/60 px-2.5 py-1.5 text-sm text-fg-muted">
                      “{r.validationComment}”
                    </p>
                  )}

                <TaskDetailLink
                  taskId={r.taskId}
                  className="mt-1 block max-w-full truncate text-left text-xs text-fg-subtle underline decoration-line underline-offset-2 transition hover:text-risd hover:decoration-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
                >
                  {r.taskTitle}
                </TaskDetailLink>
              </li>
            );
          })}
        </ul>
      )}

      {hasMore && (
        <ShowMore remaining={remaining} onClick={() => setShown((s) => s + STEP)} />
      )}
    </section>
  );
}

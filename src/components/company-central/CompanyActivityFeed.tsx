"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { FilterBar, SearchBox, EmptyState } from "@/components/ListControls";
import { ComboFilter } from "@/components/Combobox";
import { DateRangeField } from "@/components/DateField";
import { formatDuration } from "@/lib/format";
import {
  ACTIVITY_TYPE_OPTIONS,
  activityTypeLabel,
  EMPTY_ACTIVITY_FILTERS,
  formatActivityAt,
  hasActiveFilters,
  isExpandable,
  type ActivityAuthor,
  type ActivityFilters,
  type ActivityItem,
} from "@/lib/company-activity";
import {
  loadCompanyActivity,
  loadCompanyActivityAuthors,
} from "@/app/company-activity-actions";

// Histórico de atividades (Fatia 1 — apresentação). Carrega SOB DEMANDA: fica
// fora do load inicial da página; a 1ª página só é buscada quando a seção entra
// em tela (IntersectionObserver). Pagina de 20 em 20 pelo banco (mais recentes
// primeiro), cada evento recolhido por padrão, com busca e filtros server-side.
// A Fatia 2 acrescenta tipos de evento sem mexer nesta tela.

type Status = "idle" | "loading" | "ready" | "error";

export default function CompanyActivityFeed({
  companyId,
}: {
  companyId: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [authors, setAuthors] = useState<ActivityAuthor[]>([]);
  const [filters, setFilters] = useState<ActivityFilters>(EMPTY_ACTIVITY_FILTERS);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const sectionRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false); // já disparou a 1ª carga?
  const authorsRef = useRef(false); // já buscou a lista de autores?
  const reqRef = useRef(0); // token anti-corrida: só a resposta mais nova vale

  const filtersKey = useMemo(() => JSON.stringify(filters), [filters]);

  // Busca a lista de autores UMA vez (independe de paginação e filtros — senão
  // não daria para trocar de pessoa).
  const loadAuthors = useCallback(async () => {
    if (authorsRef.current) return;
    authorsRef.current = true;
    const res = await loadCompanyActivityAuthors(companyId);
    if (!res.error) setAuthors(res.authors);
  }, [companyId]);

  // (Re)carrega a PRIMEIRA página com os filtros atuais (substitui a lista).
  const loadFirst = useCallback(async () => {
    const token = ++reqRef.current;
    setStatus("loading");
    void loadAuthors();
    const res = await loadCompanyActivity(companyId, 0, filters);
    if (token !== reqRef.current) return; // chegou uma resposta mais nova
    if (res.error) {
      setError(res.error);
      setStatus("error");
      return;
    }
    setError(null);
    setTotal(res.total);
    setItems(res.items);
    setStatus("ready");
  }, [companyId, filters, loadAuthors]);

  // Próxima página (anexa). Offset = quantos já temos.
  async function loadMore() {
    const token = ++reqRef.current;
    setLoadingMore(true);
    const res = await loadCompanyActivity(companyId, items.length, filters);
    if (token !== reqRef.current) {
      setLoadingMore(false);
      return;
    }
    setLoadingMore(false);
    if (res.error) {
      setError(res.error);
      setStatus("error");
      return;
    }
    setTotal(res.total);
    setItems((prev) => [...prev, ...res.items]);
  }

  // Lazy: a 1ª carga só acontece quando a seção entra em tela (ou logo antes,
  // com rootMargin). Quem abre a empresa só para ver tarefa não paga esse custo.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || startedRef.current) return;
    if (typeof IntersectionObserver === "undefined") {
      startedRef.current = true;
      void loadFirst();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !startedRef.current) {
          startedRef.current = true;
          io.disconnect();
          void loadFirst();
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
    // Só monta o observer uma vez; loadFirst usado aqui é o do 1º render (filtros
    // vazios), que é exatamente o que a primeira carga deve usar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filtros mudaram (depois da 1ª carga): recomeça do zero, com debounce para a
  // busca por texto não disparar a cada tecla.
  useEffect(() => {
    if (!startedRef.current) return;
    const t = setTimeout(() => void loadFirst(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const authorOptions = useMemo(
    () => authors.map((a) => ({ value: a.id, label: a.name })),
    [authors]
  );

  const active = hasActiveFilters(filters);
  const canLoadMore = status === "ready" && items.length < total;

  return (
    <section
      ref={sectionRef}
      className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6"
    >
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">Histórico de atividades</h3>
        {status === "ready" && (
          <span className="text-xs text-fg-subtle">
            {active
              ? `${total} ${total === 1 ? "resultado" : "resultados"}`
              : `${total} ${total === 1 ? "registro" : "registros"}`}
          </span>
        )}
      </div>

      {/* Filtros — mesmos componentes das outras telas. Ficam disponíveis assim
          que a seção carrega. */}
      <FilterBar>
        <SearchBox
          value={filters.search}
          onChange={(v) => setFilters((f) => ({ ...f, search: v }))}
          placeholder="Buscar no conteúdo…"
        />
        <ComboFilter
          value={filters.type}
          onChange={(v) => setFilters((f) => ({ ...f, type: v }))}
          allLabel="Todos os tipos"
          ariaLabel="Filtrar por tipo de evento"
          options={ACTIVITY_TYPE_OPTIONS}
        />
        <ComboFilter
          value={filters.authorId}
          onChange={(v) => setFilters((f) => ({ ...f, authorId: v }))}
          allLabel="Todas as pessoas"
          ariaLabel="Filtrar por pessoa"
          searchPlaceholder="Buscar pessoa…"
          options={authorOptions}
        />
        <DateRangeField
          startValue={filters.from}
          endValue={filters.to}
          onChange={(from, to) => setFilters((f) => ({ ...f, from, to }))}
        />
      </FilterBar>

      {active && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium text-fg-subtle">Filtros:</span>
          {filters.search && (
            <FilterPill
              label={`“${filters.search}”`}
              onClear={() => setFilters((f) => ({ ...f, search: "" }))}
            />
          )}
          {filters.type && (
            <FilterPill
              label={activityTypeLabel(filters.type)}
              onClear={() => setFilters((f) => ({ ...f, type: "" }))}
            />
          )}
          {filters.authorId && (
            <FilterPill
              label={
                authors.find((a) => a.id === filters.authorId)?.name ?? "Pessoa"
              }
              onClear={() => setFilters((f) => ({ ...f, authorId: "" }))}
            />
          )}
          {(filters.from || filters.to) && (
            <FilterPill
              label={`Período: ${filters.from || "…"} – ${filters.to || "…"}`}
              onClear={() => setFilters((f) => ({ ...f, from: "", to: "" }))}
            />
          )}
          <button
            type="button"
            onClick={() => setFilters(EMPTY_ACTIVITY_FILTERS)}
            className="ml-1 rounded-full border border-line px-3 py-1 font-medium text-fg-muted transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
          >
            Limpar filtros
          </button>
        </div>
      )}

      {/* Estados próprios da seção */}
      {status === "idle" || status === "loading" ? (
        <p className="py-8 text-center text-sm text-fg-subtle">
          Carregando o histórico…
        </p>
      ) : status === "error" ? (
        <div className="py-8 text-center">
          <p className="text-sm text-red-600 dark:text-red-400">
            {error ?? "Não foi possível carregar o histórico."}
          </p>
          <button
            type="button"
            onClick={() => void loadFirst()}
            className="mt-3 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg-muted transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
          >
            Tentar de novo
          </button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState>
          {active
            ? "Nenhum evento corresponde aos filtros."
            : "Nenhuma atividade registrada nesta empresa ainda."}
        </EmptyState>
      ) : (
        <>
          <ol className="space-y-4">
            {items.map((a) => {
              const isOpen = expanded.has(a.id);
              const expandable = isExpandable(a);
              const seconds = a.meta.seconds ?? 0;
              return (
                <li
                  key={a.id}
                  className="relative border-l-2 border-line pl-4"
                >
                  <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-risd" />
                  <div className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
                    <span className="inline-flex items-center gap-1.5 font-medium text-fg">
                      <Avatar
                        name={a.authorName ?? "—"}
                        url={a.authorAvatar}
                        size={18}
                      />
                      {a.authorName ?? "—"}
                    </span>
                    <span>·</span>
                    <span>{formatActivityAt(a.at)}</span>
                    <span>·</span>
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 font-medium text-fg-muted">
                      {activityTypeLabel(a.type)}
                    </span>
                    {seconds > 0 && (
                      <>
                        <span>·</span>
                        <span className="font-mono tabular-nums">
                          {formatDuration(seconds)}
                        </span>
                      </>
                    )}
                    {a.meta.sentWhatsapp && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                        WhatsApp
                      </span>
                    )}
                  </div>

                  <p className="mt-1 whitespace-pre-wrap text-sm text-fg-muted">
                    {isOpen ? a.content : a.summary}
                  </p>

                  {expandable && (
                    <button
                      type="button"
                      onClick={() => toggle(a.id)}
                      className="mt-1 text-xs font-medium text-risd underline-offset-2 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
                    >
                      {isOpen ? "Ler menos" : "Ler mais"}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>

          {canLoadMore && (
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg-muted transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd disabled:opacity-60"
              >
                {loadingMore
                  ? "Carregando…"
                  : `Carregar mais (${total - items.length} restantes)`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function FilterPill({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2.5 py-1 font-medium text-fg-muted">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Remover filtro ${label}`}
        className="flex h-4 w-4 items-center justify-center rounded-full opacity-70 transition hover:bg-black/10 hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-risd dark:hover:bg-white/10"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </span>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  FilterBar,
  SearchBox,
  SelectFilter,
  EmptyState,
  ShowMore,
  type SelectOption,
} from "@/components/ListControls";
import LabelChips, { labelChipStyle } from "@/components/LabelChips";
import Avatar from "@/components/Avatar";
import type { Label } from "@/lib/labels";

export type CompanyItem = {
  id: string;
  name: string;
  whatsappGroupName: string | null;
  whatsappContactId: string | null;
  consultants: { id: string; name: string; avatarUrl?: string | null }[];
  labels: Label[];
};

// Lista de empresas com busca por nome + filtro por ETIQUETA (multi, OU) +
// consultor, TUDO resolvido no servidor. Este componente só reflete o estado na
// URL (como periodo/status noutras telas): mudou um filtro → reescreve a query →
// o server refaz a consulta escopada pela RLS e devolve a nova página. Nada é
// filtrado no navegador; a contagem e o "ver mais" valem sobre o conjunto
// inteiro, não sobre a página atual.
export default function CompanyBrowser({
  companies,
  total,
  step,
  inUseLabels,
  selectedLabelIds,
  query,
  consultantId,
  consultores,
}: {
  companies: CompanyItem[];
  total: number;
  step: number;
  inUseLabels: Label[];
  selectedLabelIds: string[];
  query: string;
  consultantId: string;
  consultores: SelectOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Reescreve a URL com as mudanças. Trocar QUALQUER filtro zera o "ver mais"
  // (n), para a paginação recomeçar sobre o novo conjunto; só o próprio "ver
  // mais" preserva/estende n. Valor vazio remove o parâmetro (URL limpa).
  const setParams = useCallback(
    (updates: Record<string, string | null>, keepN = false) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") params.delete(key);
        else params.set(key, value);
      }
      if (!keepN) params.delete("n");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  // Busca por nome: instantânea no input, com debounce antes de ir ao servidor.
  const [search, setSearch] = useState(query);
  const lastPushed = useRef(query);
  useEffect(() => {
    const t = setTimeout(() => {
      if (search === lastPushed.current) return;
      lastPushed.current = search;
      setParams({ q: search || null });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  // Sincroniza o input quando a URL muda por fora (voltar/limpar), sem atropelar
  // o que está sendo digitado (ignora eco do próprio push em voo).
  useEffect(() => {
    if (query !== lastPushed.current) {
      lastPushed.current = query;
      setSearch(query);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const selected = new Set(selectedLabelIds);
  const toggleLabel = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setParams({ labels: Array.from(next).join(",") || null });
  };

  const filtersActive = !!(query || selectedLabelIds.length || consultantId);
  const clearAll = () => {
    setSearch("");
    lastPushed.current = "";
    setParams({ q: null, labels: null, consultant: null });
  };

  const remaining = Math.max(0, total - companies.length);

  return (
    <>
      <FilterBar>
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Buscar por nome…"
        />
        <SelectFilter
          value={consultantId}
          onChange={(v) => setParams({ consultant: v || null })}
          allLabel="Todos os consultores"
          ariaLabel="Filtrar por consultor responsável"
          options={consultores}
        />
      </FilterBar>

      {/* Filtro por etiqueta (multi, OU) — só as etiquetas em uso no escopo.
          Cada chip usa a cor/identidade da própria etiqueta (labelChipStyle). */}
      {inUseLabels.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-fg-subtle">Etiquetas:</span>
          {inUseLabels.map((l) => {
            const on = selected.has(l.id);
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => toggleLabel(l.id)}
                aria-pressed={on}
                style={labelChipStyle(l)}
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${
                  on
                    ? "ring-2 ring-fg ring-offset-2 ring-offset-canvas"
                    : "opacity-70 hover:opacity-100"
                }`}
              >
                {on && (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                )}
                {l.name}
              </button>
            );
          })}
          {filtersActive && (
            <button
              type="button"
              onClick={clearAll}
              className="ml-1 rounded-full border border-line px-3 py-1 text-xs font-medium text-fg-muted transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
            >
              Limpar filtros
            </button>
          )}
        </div>
      )}

      {/* Contagem do conjunto FILTRADO inteiro (não só da página). */}
      <p className="mb-3 text-sm text-fg-muted">
        {total} {total === 1 ? "empresa" : "empresas"}
        {filtersActive ? " no filtro" : ""}
      </p>

      {total === 0 ? (
        <EmptyState>
          {filtersActive
            ? "Nenhuma empresa corresponde aos filtros."
            : "Nenhuma empresa cadastrada ainda."}
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {companies.map((company) => (
            <li key={company.id}>
              <Link
                href={`/admin/empresas/${company.id}`}
                className="group block rounded-xl border border-line bg-surface p-4 shadow-card transition hover:-translate-y-0.5 hover:border-risd/40 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-medium text-fg group-hover:text-risd">
                      {company.name}
                    </span>
                    <LabelChips labels={company.labels} />
                  </div>
                  <span className="text-fg-subtle transition group-hover:translate-x-0.5 group-hover:text-risd">
                    →
                  </span>
                </div>
                {company.whatsappGroupName || company.whatsappContactId ? (
                  <span className="mt-1 block text-sm text-fg-muted">
                    WhatsApp: {company.whatsappGroupName ?? "(sem nome)"}
                  </span>
                ) : (
                  <span className="mt-1 block text-sm text-fg-subtle">
                    Sem grupo de WhatsApp vinculado.
                  </span>
                )}
                {company.consultants.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {company.consultants.map((c) => (
                      <span
                        key={c.id}
                        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 py-0.5 pl-1 pr-2 text-xs text-fg-muted"
                      >
                        <Avatar name={c.name} url={c.avatarUrl} size={18} />
                        {c.name}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {remaining > 0 && (
        <ShowMore
          remaining={remaining}
          onClick={() =>
            setParams({ n: String(companies.length + step) }, true)
          }
        />
      )}
    </>
  );
}

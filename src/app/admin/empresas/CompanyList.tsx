"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  FilterBar,
  SearchBox,
  SelectFilter,
  EmptyState,
  ShowMore,
  usePaged,
  norm,
  type SelectOption,
} from "@/components/ListControls";
import LabelChips from "@/components/LabelChips";
import type { Label } from "@/lib/labels";

export type CompanyItem = {
  id: string;
  name: string;
  whatsappGroupName: string | null;
  whatsappContactId: string | null;
  consultants: { id: string; name: string }[];
  labels: Label[];
};

export default function CompanyList({
  companies,
  consultores,
}: {
  companies: CompanyItem[];
  consultores: SelectOption[];
}) {
  const [query, setQuery] = useState("");
  const [consultantId, setConsultantId] = useState("");

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    return companies.filter((c) => {
      if (q && !norm(c.name).includes(q)) return false;
      if (consultantId && !c.consultants.some((x) => x.id === consultantId))
        return false;
      return true;
    });
  }, [companies, query, consultantId]);

  const { visible, hasMore, remaining, showMore } = usePaged(filtered);

  return (
    <>
      <FilterBar>
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Buscar por nome…"
        />
        <SelectFilter
          value={consultantId}
          onChange={setConsultantId}
          allLabel="Todos os consultores"
          ariaLabel="Filtrar por consultor responsável"
          options={consultores}
        />
      </FilterBar>

      {companies.length === 0 ? (
        <EmptyState>Nenhuma empresa cadastrada ainda.</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>Nenhuma empresa corresponde aos filtros.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {visible.map((company) => (
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
                        className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-xs text-fg-muted"
                      >
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

      {hasMore && <ShowMore remaining={remaining} onClick={showMore} />}
    </>
  );
}

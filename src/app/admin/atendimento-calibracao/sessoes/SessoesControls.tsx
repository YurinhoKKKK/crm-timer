"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

export type PersonOption = { id: string; full_name: string };

// Seletores de dia e pessoa da visão Sessões. Navegam por URL (?dia=&pessoa=);
// a página é server component e refaz a busca.
export default function SessoesControls({
  people,
  dia,
  pessoa,
}: {
  people: PersonOption[];
  dia: string;
  pessoa: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startNav] = useTransition();

  function go(nextDia: string, nextPessoa: string | null) {
    const sp = new URLSearchParams();
    sp.set("dia", nextDia);
    if (nextPessoa) sp.set("pessoa", nextPessoa);
    // Filtro na mesma página: sem rolar ao topo, sem descartar o conteúdo atual.
    startNav(() => {
      router.push(`${pathname}?${sp.toString()}`, { scroll: false });
    });
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <label className="inline-flex items-center gap-2 text-sm text-fg-muted">
        Dia
        <input
          type="date"
          value={dia}
          onChange={(e) => go(e.target.value || dia, pessoa)}
          className="rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm text-fg shadow-sm focus:border-risd focus:outline-none focus:ring-1 focus:ring-risd"
        />
      </label>
      <label className="inline-flex items-center gap-2 text-sm text-fg-muted">
        Pessoa
        <select
          value={pessoa ?? ""}
          onChange={(e) => go(dia, e.target.value || null)}
          className="rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm text-fg shadow-sm focus:border-risd focus:outline-none focus:ring-1 focus:ring-risd"
        >
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { EmptyState } from "@/components/ListControls";
import { loadCompanyResponsibleTimeline } from "@/app/company-activity-actions";
import type { ResponsiblePeriod } from "@/lib/company-activity";

// Linha do tempo de Responsáveis da empresa: períodos por pessoa e papel
// (Consultor / Colaborador). Fonte: company_responsible_periods (vínculos
// 'registrado' daqui para frente; 'reconstruido' = aproximado, com selo).
//
// Papéis em rótulo NEUTRO (Consultor/Colaborador): não sabemos o gênero da
// pessoa e não vamos inferir pelo nome.

type Status = "idle" | "loading" | "ready" | "error";

// Data "AAAA-MM-DD" -> "DD/MM/AAAA" (sem fuso: é data pura do banco).
function fmtDate(d: string | null): string {
  if (!d) return "hoje";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

export default function ResponsiblesTimeline({
  companyId,
  active,
}: {
  companyId: string;
  active: boolean;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [periods, setPeriods] = useState<ResponsiblePeriod[]>([]);
  const loadedRef = useRef(false);

  // Carrega sob demanda na 1ª vez que a aba "Responsáveis" é aberta.
  useEffect(() => {
    if (!active || loadedRef.current) return;
    loadedRef.current = true;
    setStatus("loading");
    void loadCompanyResponsibleTimeline(companyId).then((res) => {
      if (res.error) {
        setError(res.error);
        setStatus("error");
        return;
      }
      setPeriods(res.periods);
      setStatus("ready");
    });
  }, [active, companyId]);

  // Agrupa por papel, cada grupo ordenado do mais recente para o mais antigo
  // (abertos primeiro). O banco já ordena, mas reforçamos no cliente.
  const groups = useMemo(() => {
    const byRole: Record<"consultor" | "colaborador", ResponsiblePeriod[]> = {
      consultor: [],
      colaborador: [],
    };
    for (const p of periods) byRole[p.role]?.push(p);
    const sort = (a: ResponsiblePeriod, b: ResponsiblePeriod) => {
      if (!a.endDate && b.endDate) return -1;
      if (a.endDate && !b.endDate) return 1;
      return b.startDate.localeCompare(a.startDate);
    };
    byRole.consultor.sort(sort);
    byRole.colaborador.sort(sort);
    return byRole;
  }, [periods]);

  if (status === "idle" || status === "loading") {
    return (
      <p className="py-8 text-center text-sm text-fg-subtle">
        Carregando os responsáveis…
      </p>
    );
  }
  if (status === "error") {
    return (
      <p className="py-8 text-center text-sm text-red-600 dark:text-red-400">
        {error ?? "Não foi possível carregar os responsáveis."}
      </p>
    );
  }
  if (periods.length === 0) {
    return (
      <EmptyState>
        Nenhum período de responsável registrado para esta empresa ainda.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-5">
      {(["consultor", "colaborador"] as const).map((role) =>
        groups[role].length === 0 ? null : (
          <div key={role}>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
              {role === "consultor" ? "Consultores" : "Colaboradores"}
            </h4>
            <ol className="space-y-3">
              {groups[role].map((p) => (
                <li
                  key={p.id}
                  className="relative border-l-2 border-line pl-4"
                >
                  <span
                    className={`absolute -left-[5px] top-1.5 h-2 w-2 rounded-full ${
                      p.endDate ? "bg-line" : "bg-risd"
                    }`}
                  />
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="inline-flex items-center gap-1.5 font-medium text-fg">
                      <Avatar name={p.name} url={p.avatar} size={20} />
                      {p.name}
                    </span>
                    <span className="text-xs text-fg-subtle">
                      · {role === "consultor" ? "Consultor" : "Colaborador"} ·{" "}
                      {fmtDate(p.startDate)} até {fmtDate(p.endDate)}
                    </span>
                    {p.source === "reconstruido" && (
                      <span
                        className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                        title="Período inferido de registros antigos; a data é aproximada."
                      >
                        reconstruído (aproximado)
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )
      )}
    </div>
  );
}

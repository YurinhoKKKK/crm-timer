"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DateField } from "@/components/DateField";
import { brDate } from "@/lib/period";
import { addAbsence, removeAbsence } from "./actions";

// Ausências do colaborador (admin). Dias ÚTEIS de ausência saem dos pontos E das
// chances do Aproveitamento do Acompanhamento (o cálculo exclui na leitura, então
// vale retroativamente). O quadro de Acompanhamento continua mostrando a cor real
// do cliente. Sem campo de motivo (LGPD).
export type AbsenceView = { id: string; startDate: string; endDate: string };

export default function CollaboratorAbsences({
  collaboratorId,
  absences,
}: {
  collaboratorId: string;
  absences: AbsenceView[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function fmt(a: AbsenceView): string {
    return a.startDate === a.endDate
      ? brDate(a.startDate)
      : `${brDate(a.startDate)} a ${brDate(a.endDate)}`;
  }

  async function onAdd() {
    setError(null);
    if (!start || !end) {
      setError("Informe início e fim.");
      return;
    }
    const res = await addAbsence(collaboratorId, start, end);
    if (res.error) {
      setError(res.error);
      return;
    }
    setStart("");
    setEnd("");
    startTransition(() => router.refresh());
  }

  async function onRemove(id: string) {
    setBusyId(id);
    const res = await removeAbsence(collaboratorId, id);
    setBusyId(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-fg">Ausências</h3>
        <span className="text-xs text-fg-subtle">
          Dias úteis de ausência saem dos pontos e das chances do Aproveitamento
          (vale retroativamente). O quadro continua mostrando a cor real do cliente.
        </span>
      </div>

      {/* Adicionar */}
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-fg-muted">Início</label>
          <DateField value={start} onChange={setStart} ariaLabel="Início da ausência" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-fg-muted">Fim</label>
          <DateField
            value={end}
            onChange={setEnd}
            ariaLabel="Fim da ausência"
            minIso={start || undefined}
          />
        </div>
        <button
          type="button"
          onClick={() => void onAdd()}
          disabled={pending || !start || !end}
          className="inline-flex items-center gap-2 rounded-lg bg-risd px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-risd/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-1 focus-visible:ring-offset-surface disabled:opacity-60"
        >
          Adicionar
        </button>
      </div>

      {error && (
        <p className="mt-2 text-xs text-red-700 dark:text-red-300">{error}</p>
      )}

      {/* Lista */}
      <div className="mt-4">
        {absences.length === 0 ? (
          <p className="text-sm text-fg-subtle">Nenhuma ausência registrada.</p>
        ) : (
          <ul className="divide-y divide-line/60 rounded-xl border border-line">
            {absences.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="tabular-nums text-fg">{fmt(a)}</span>
                <button
                  type="button"
                  onClick={() => void onRemove(a.id)}
                  disabled={busyId === a.id}
                  className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-fg-muted transition hover:border-red-400/60 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd disabled:opacity-60 dark:hover:text-red-300"
                >
                  {busyId === a.id ? "Removendo…" : "Remover"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

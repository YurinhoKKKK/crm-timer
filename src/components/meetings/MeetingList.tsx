"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import MeetingCard from "./MeetingCard";
import ResultBanner from "./ResultBanner";
import {
  formatMeetingDay,
  meetingDayKey,
  type MeetingActionsContext,
  type MeetingRow,
} from "@/lib/meetings";

// Lista de reuniões agrupada por dia (próximas primeiro). Client porque hospeda
// as ações por cartão (editar/excluir/enviar/remover) e o banner de resultado
// ACIMA da lista — o cartão pode sumir no refresh após excluir. `showCompany`
// some quando a lista já é de uma empresa só (a aba da central).
export default function MeetingList({
  rows,
  emptyLabel,
  showCompany = true,
  ctx,
}: {
  rows: MeetingRow[];
  emptyLabel: string;
  showCompany?: boolean;
  ctx: MeetingActionsContext;
}) {
  const router = useRouter();
  const [result, setResult] = useState<{
    warning: string | null;
    successText: string;
  } | null>(null);
  const [, startTransition] = useTransition();

  function onResult(warning: string | null, successText: string) {
    setResult({ warning, successText });
    startTransition(() => router.refresh());
  }

  // Agrupa por dia (BRT), preservando a ordem ascendente já vinda do banco.
  const groups: { key: string; label: string; items: MeetingRow[] }[] = [];
  for (const row of rows) {
    const key = meetingDayKey(row.startsAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(row);
    } else {
      groups.push({ key, label: formatMeetingDay(row.startsAt), items: [row] });
    }
  }

  return (
    <div>
      {result && (
        <ResultBanner
          warning={result.warning}
          successText={result.successText}
          onClose={() => setResult(null)}
        />
      )}

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-10 text-center text-sm text-fg-subtle shadow-card">
          {emptyLabel}
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.key}>
              <h3 className="mb-2 text-sm font-semibold text-fg-muted">
                {group.label}
              </h3>
              <ul className="space-y-2.5">
                {group.items.map((m) => (
                  <li key={m.id}>
                    <MeetingCard
                      meeting={m}
                      showCompany={showCompany}
                      ctx={ctx}
                      onResult={onResult}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

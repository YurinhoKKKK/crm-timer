"use client";

import Link from "next/link";
import Avatar from "@/components/Avatar";
import { avatarUrl } from "@/lib/avatar";
import { ShowMore, usePaged } from "@/components/ListControls";

export type CollaboratorRow = {
  id: string;
  name: string;
  avatarPath: string | null;
  timeLabel: string;
  done: number;
  total: number;
  percent: number;
};

// Resumo por responsável do dashboard, com "ver mais" (Passo 18 — escala) para
// não montar dezenas de linhas de uma vez. Mantém o visual da tabela original.
export default function CollaboratorSummary({
  rows,
  period,
}: {
  rows: CollaboratorRow[];
  period: string;
}) {
  const { visible, hasMore, remaining, showMore } = usePaged(rows, 12);

  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-fg-subtle">
        Nenhuma atividade registrada no período.
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
              <th className="pb-3 font-medium">Responsável</th>
              <th className="pb-3 text-right font-medium">Tempo</th>
              <th className="pb-3 text-right font-medium">Tarefas</th>
              <th className="pb-3 pl-4 font-medium">Concluídas</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr
                key={r.id}
                className="group border-b border-line/60 transition last:border-0 hover:bg-surface-2/50"
              >
                <td className="py-3 pr-4 font-medium text-fg">
                  <Link
                    href={`/admin/colaboradores/${r.id}?periodo=${period}`}
                    className="flex items-center gap-2.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                  >
                    <Avatar
                      name={r.name}
                      url={avatarUrl(r.avatarPath)}
                      size={28}
                    />
                    <span className="group-hover:text-risd">{r.name}</span>
                    <span
                      aria-hidden="true"
                      className="text-fg-subtle transition group-hover:translate-x-0.5 group-hover:text-risd"
                    >
                      →
                    </span>
                  </Link>
                </td>
                <td className="py-3 text-right font-mono tabular-nums text-fg-muted">
                  {r.timeLabel}
                </td>
                <td className="py-3 text-right font-mono tabular-nums text-fg-muted">
                  {r.done}/{r.total}
                </td>
                <td className="py-3 pl-4">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-2 w-24 overflow-hidden rounded-full bg-surface-2"
                      role="progressbar"
                      aria-valuenow={r.percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="h-full rounded-full bg-risd"
                        style={{ width: `${r.percent}%` }}
                      />
                    </div>
                    <span className="font-mono text-xs tabular-nums text-fg-muted">
                      {r.percent}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasMore && <ShowMore remaining={remaining} onClick={showMore} />}
    </>
  );
}

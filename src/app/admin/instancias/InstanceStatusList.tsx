"use client";

import type { TaskStatus } from "@/lib/types";
import { STATUS_META } from "@/lib/status";
import { formatDuration, formatDue } from "@/lib/format";
import {
  ShowMore,
  TruncationNotice,
  usePaged,
} from "@/components/ListControls";
import LabelChips from "@/components/LabelChips";
import type { Label } from "@/lib/labels";

export type InstanceItem = {
  id: string;
  title: string;
  status: TaskStatus;
  due_at: string | null;
  total_seconds: number;
  companyId: string;
  companyName: string;
  collaboratorName: string;
};

// Lista de instâncias por status (drill-down do dashboard). Renderiza uma janela
// por vez ("ver mais") para não montar centenas de nós no DOM (Passo 18).
export default function InstanceStatusList({
  items,
  truncated = false,
  labelsByCompany,
}: {
  items: InstanceItem[];
  truncated?: boolean;
  // Etiquetas herdadas da empresa (company_id -> etiquetas).
  labelsByCompany?: Record<string, Label[]>;
}) {
  const { visible, hasMore, remaining, showMore } = usePaged(items);

  return (
    <>
      {truncated && <TruncationNotice count={items.length} />}
      <ul className="space-y-3">
        {visible.map((r) => {
          const meta = STATUS_META[r.status];
          return (
            <li
              key={r.id}
              className="rounded-xl border border-line bg-surface p-4 shadow-card"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-fg">{r.title}</span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${meta.badge}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                  {meta.label}
                </span>
              </div>
              <p className="mt-1 text-sm text-fg-muted">
                {r.companyName} · {r.collaboratorName}
              </p>
              {labelsByCompany?.[r.companyId]?.length ? (
                <LabelChips
                  labels={labelsByCompany[r.companyId]}
                  className="mt-1.5"
                />
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-fg-subtle">
                <span>Prazo: {formatDue(r.due_at)}</span>
                <span>
                  Tempo:{" "}
                  <span className="font-mono tabular-nums">
                    {formatDuration(r.total_seconds)}
                  </span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {hasMore && <ShowMore remaining={remaining} onClick={showMore} />}
    </>
  );
}

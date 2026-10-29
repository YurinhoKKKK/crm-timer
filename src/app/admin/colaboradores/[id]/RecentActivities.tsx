"use client";

import { useState } from "react";
import { formatDuration } from "@/lib/format";
import { loadCollaboratorActivities, type ActivityItem } from "./actions";

const STEP = 30;

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Histórico de atividades do colaborador no período (início E fim respeitados no
// servidor). "Ver mais" carrega mais 30 por vez via server action.
export default function RecentActivities({
  collaboratorId,
  start,
  end,
  initialActivities,
  initialHasMore,
}: {
  collaboratorId: string;
  start: string | null;
  end: string | null;
  initialActivities: ActivityItem[];
  initialHasMore: boolean;
}) {
  const [activities, setActivities] = useState<ActivityItem[]>(initialActivities);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    setLoading(true);
    setError(null);
    const res = await loadCollaboratorActivities({
      collaboratorId,
      start,
      end,
      offset: activities.length,
      limit: STEP,
    });
    setLoading(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setActivities((prev) => {
      const seen = new Set(prev.map((a) => a.id));
      return [...prev, ...res.activities.filter((a) => !seen.has(a.id))];
    });
    setHasMore(res.hasMore);
  }

  if (activities.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-fg-subtle">
        Nenhuma atividade registrada no período.
      </p>
    );
  }

  return (
    <>
      <ol className="space-y-4">
        {activities.map((a) => (
          <li key={a.id} className="relative border-l-2 border-line pl-4">
            <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-risd" />
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
              <span className="font-medium text-fg">{a.companyName}</span>
              <span>·</span>
              <span>{formatDateTime(a.created_at)}</span>
              <span>·</span>
              <span className="font-mono tabular-nums">
                {formatDuration(a.seconds_spent)}
              </span>
              {a.sent_whatsapp && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                  WhatsApp
                </span>
              )}
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-fg-muted">
              {a.message}
            </p>
          </li>
        ))}
      </ol>

      {error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="w-full rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg shadow-sm transition hover:border-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:opacity-60 sm:w-auto"
          >
            {loading ? "Carregando…" : "Ver mais"}
          </button>
        </div>
      )}
    </>
  );
}

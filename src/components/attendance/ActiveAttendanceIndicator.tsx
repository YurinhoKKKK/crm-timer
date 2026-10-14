"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import {
  useAttendance,
  seedOpenFromDb,
  setPausedTask,
  doStop,
  hydratePaused,
} from "@/lib/attendance-store";
import { ATTENDANCE_SYNC_EVENT, emitAttendanceSync } from "@/lib/attendance-sync";
import { startTimer } from "@/app/colaborador/actions";
import { emitTimerSync } from "@/lib/timer-sync";
import { formatElapsedCompact } from "@/lib/timer";

// Indicador global do cronômetro de ATENDIMENTO (calibração, 0126). Vive no
// AppShell, aparece em todas as telas enquanto houver atendimento aberto do
// PRÓPRIO usuário. Mesmo padrão/posição do indicador de timer de tarefa — e os
// dois nunca aparecem juntos (o banco garante exclusão mútua). Ao encerrar, se
// uma tarefa foi pausada pelo atendimento, oferece "Retomar {tarefa}" (um
// clique no fluxo normal de iniciar o cronômetro da tarefa).

const POLL_MS = 45_000;

function Dot() {
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-risd opacity-60" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-risd" />
    </span>
  );
}

export default function ActiveAttendanceIndicator() {
  const router = useRouter();
  const { open, pausedTask } = useAttendance();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchCurrent = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("attendance_current");
    if (error) return; // poll silencioso
    const row = (Array.isArray(data) ? data[0] : data) as
      | { company_id: string; company_number: string | null; started_at: string }
      | undefined;
    seedOpenFromDb(
      row
        ? { companyId: row.company_id, companyNumber: row.company_number, startedAt: row.started_at }
        : null
    );
  }, []);

  useEffect(() => {
    hydratePaused();
    fetchCurrent();
    const id = window.setInterval(fetchCurrent, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchCurrent();
    };
    const onSync = () => fetchCurrent();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", fetchCurrent);
    window.addEventListener(ATTENDANCE_SYNC_EVENT, onSync);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", fetchCurrent);
      window.removeEventListener(ATTENDANCE_SYNC_EVENT, onSync);
    };
  }, [fetchCurrent]);

  const active = !!open;
  useEffect(() => {
    if (!active) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  async function onPause() {
    setBusy(true);
    setErr(null);
    const r = await doStop();
    setBusy(false);
    if (r.error) {
      setErr(r.error);
      return;
    }
    emitAttendanceSync();
    router.refresh();
  }

  async function onResume() {
    if (!pausedTask) return;
    setBusy(true);
    setErr(null);
    const r = await startTimer(pausedTask.id);
    setBusy(false);
    if (r.error) {
      setErr(r.error);
      return;
    }
    // Começar a tarefa encerra qualquer atendimento no banco; avisa os dois
    // indicadores (o de tarefa refaz o fetch; o de atendimento também).
    setPausedTask(null);
    emitTimerSync({ taskId: pausedTask.id, action: "start", source: "page" });
    emitAttendanceSync();
    router.refresh();
  }

  const wrapper =
    "pointer-events-none fixed inset-x-0 z-pill flex flex-col items-center px-4 lg:left-64";
  const wrapperStyle = { bottom: "max(1rem, env(safe-area-inset-bottom))" } as const;

  if (open) {
    const elapsed = formatElapsedCompact(Math.max(0, (nowMs - open.startedAtMs) / 1000));
    return (
      <div className={wrapper} style={wrapperStyle}>
        {err && (
          <p className="pointer-events-auto mb-2 max-w-[92vw] truncate rounded-lg border border-red-200 bg-surface px-3 py-1.5 text-xs text-red-600 shadow-card dark:border-red-500/30 dark:text-red-400">
            {err}
          </p>
        )}
        <div className="pointer-events-auto flex max-w-[92vw] animate-fade-in items-center gap-2.5 rounded-full border border-line bg-surface py-1.5 pl-3.5 pr-1.5 shadow-pop">
          <Dot />
          <span className="text-sm font-medium text-fg">
            Atendendo{open.companyNumber ? `: ${open.companyNumber}` : ""}
          </span>
          <span className="font-mono text-sm tabular-nums text-risd">{elapsed}</span>
          <button
            type="button"
            onClick={onPause}
            disabled={busy}
            className="ml-1 shrink-0 rounded-full border border-line px-3 py-1 text-xs font-semibold text-risd transition hover:bg-brand-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Pausando…" : "Pausar"}
          </button>
        </div>
      </div>
    );
  }

  if (pausedTask) {
    return (
      <div className={wrapper} style={wrapperStyle}>
        {err && (
          <p className="pointer-events-auto mb-2 max-w-[92vw] truncate rounded-lg border border-red-200 bg-surface px-3 py-1.5 text-xs text-red-600 shadow-card dark:border-red-500/30 dark:text-red-400">
            {err}
          </p>
        )}
        <div className="pointer-events-auto flex max-w-[92vw] animate-fade-in items-center gap-2 rounded-full border border-line bg-surface py-1.5 pl-3.5 pr-1.5 shadow-pop">
          <span className="min-w-0 truncate text-sm text-fg-muted">
            Tarefa pausada: <span className="font-medium text-fg">{pausedTask.title}</span>
          </span>
          <button
            type="button"
            onClick={onResume}
            disabled={busy}
            className="shrink-0 rounded-full bg-risd px-3 py-1 text-xs font-semibold text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Retomando…" : "Retomar"}
          </button>
          <button
            type="button"
            onClick={() => setPausedTask(null)}
            aria-label="Dispensar"
            className="shrink-0 rounded-full p-1.5 text-fg-muted transition hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return null;
}

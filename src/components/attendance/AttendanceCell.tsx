"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAttendance, doStart, doStop } from "@/lib/attendance-store";
import { emitAttendanceSync } from "@/lib/attendance-sync";
import { emitMeetingTimerSync } from "@/lib/timer-sync";
import { fetchMyOpenMeetingTimer } from "@/app/meeting-timer-actions";
import { formatElapsedCompact } from "@/lib/timer";

// Célula da coluna "Atendimento" no painel "Minhas empresas" (calibração, 0126).
// Botão play quando parado; quando rodando NESTA empresa, tempo ao vivo (do
// started_at do banco) + botão pause. Fica ACIMA do link-overlay da linha
// (z-10), então clicar o botão não navega. Texto acessível; a cor nunca é o
// único sinal (há rótulo e ícone).

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  );
}

export default function AttendanceCell({
  companyId,
  companyNumber,
  todaySeconds,
}: {
  companyId: string;
  companyNumber: string | null;
  todaySeconds: number;
}) {
  const { open } = useAttendance();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Iniciar atendimento encerra o timer de reunião aberto (decisão 5) — confirma.
  const [pendingMeeting, setPendingMeeting] = useState<string | null>(null);
  const isHere = open?.companyId === companyId;

  useEffect(() => {
    if (!isHere) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isHere]);

  async function proceedPlay() {
    setPendingMeeting(null);
    setBusy(true);
    setErr(null);
    const r = await doStart(companyId, companyNumber);
    setBusy(false);
    if (r.error) {
      setErr(r.error);
      return;
    }
    emitAttendanceSync();
    emitMeetingTimerSync(); // o atendimento encerrou o timer de reunião (decisão 5)
    router.refresh();
  }

  async function onPlay() {
    setErr(null);
    const openMeeting = await fetchMyOpenMeetingTimer();
    if (openMeeting) {
      setPendingMeeting(openMeeting.title ?? "reunião em andamento");
      return;
    }
    await proceedPlay();
  }

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

  const elapsed =
    isHere && open
      ? formatElapsedCompact(Math.max(0, (nowMs - open.startedAtMs) / 1000))
      : null;
  const todayLabel =
    todaySeconds > 0 ? `hoje ${formatElapsedCompact(todaySeconds)}` : null;

  return (
    <div className="relative z-10 flex flex-wrap items-center gap-x-2 gap-y-1">
      {isHere ? (
        <>
          <span
            aria-live="polite"
            className="inline-flex items-center gap-1.5 font-mono text-sm font-semibold tabular-nums text-risd"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-risd" aria-hidden="true" />
            {elapsed}
          </span>
          <button
            type="button"
            onClick={onPause}
            disabled={busy}
            aria-label={`Pausar atendimento${companyNumber ? ` da empresa ${companyNumber}` : ""}`}
            className="inline-flex items-center gap-1 rounded-full border border-risd/50 bg-brand-tint px-2.5 py-1 text-xs font-semibold text-risd transition hover:bg-risd/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd disabled:cursor-not-allowed disabled:opacity-60"
          >
            <PauseIcon />
            Pausar
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={onPlay}
            disabled={busy}
            aria-label={`Iniciar atendimento${companyNumber ? ` da empresa ${companyNumber}` : ""}`}
            className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-fg-muted transition hover:border-risd/50 hover:text-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd disabled:cursor-not-allowed disabled:opacity-60"
          >
            <PlayIcon />
            Atender
          </button>
          {todayLabel && (
            <span className="text-[11px] tabular-nums text-fg-subtle">{todayLabel}</span>
          )}
        </>
      )}
      {err && (
        <span className="text-[11px] text-red-600 dark:text-red-400" title={err}>
          erro
        </span>
      )}
      {pendingMeeting !== null && (
        <div className="mt-1 flex w-full flex-wrap items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          <span>Encerrar o timer da reunião “{pendingMeeting}”?</span>
          <button
            type="button"
            onClick={proceedPlay}
            disabled={busy}
            className="rounded border border-risd/50 px-1.5 py-0.5 font-semibold text-risd hover:bg-brand-tint disabled:opacity-60"
          >
            Continuar
          </button>
          <button
            type="button"
            onClick={() => setPendingMeeting(null)}
            disabled={busy}
            className="rounded px-1.5 py-0.5 text-fg-muted hover:text-fg"
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}

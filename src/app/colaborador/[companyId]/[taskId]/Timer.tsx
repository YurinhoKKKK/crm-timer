"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TaskStatus } from "@/lib/types";
import { startTimer, pauseTimer, finishTask } from "../../actions";

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

export default function Timer({
  taskId,
  companyId,
  status,
  totalSeconds,
  openStartedAt,
  completionNote,
}: {
  taskId: string;
  companyId: string;
  status: TaskStatus;
  totalSeconds: number;
  openStartedAt: string | null;
  completionNote: string | null;
}) {
  const router = useRouter();
  const [localStatus, setLocalStatus] = useState<TaskStatus>(status);
  const [base, setBase] = useState(totalSeconds);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(
    openStartedAt ? Date.parse(openStartedAt) : null
  );
  const running = startedAtMs !== null;

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Tique de 1s enquanto rodando (o tempo autoritativo vem do servidor ao pausar).
  useEffect(() => {
    if (!running) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const elapsed =
    base + (running && startedAtMs ? (nowMs - startedAtMs) / 1000 : 0);

  const finalized = localStatus === "finalizada";
  const canceled = localStatus === "cancelada";

  async function handleStart() {
    setError(null);
    setBusy(true);
    const { error: err, startedAt } = await startTimer(taskId);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setStartedAtMs(startedAt ? Date.parse(startedAt) : Date.now());
    setLocalStatus("iniciada");
    startTransition(() => router.refresh());
  }

  async function handlePause() {
    setError(null);
    setBusy(true);
    const { error: err, totalSeconds: total } = await pauseTimer(taskId);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    if (typeof total === "number") setBase(total);
    setStartedAtMs(null);
    startTransition(() => router.refresh());
  }

  async function handleFinish(send: boolean) {
    setError(null);
    setWarning(null);
    setBusy(true);
    const {
      error: err,
      totalSeconds: total,
      warning: warn,
    } = await finishTask(taskId, companyId, note, send);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    if (typeof total === "number") setBase(total);
    setStartedAtMs(null);
    setLocalStatus("finalizada");
    setFinishing(false);
    if (warn) setWarning(warn);
    startTransition(() => router.refresh());
  }

  // --- Tarefa já encerrada -------------------------------------------------
  if (finalized || canceled) {
    return (
      <section className="rounded-xl border border-platinum bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              finalized
                ? "bg-green-100 text-green-700"
                : "bg-platinum text-gunmetal/50"
            }`}
          >
            {finalized ? "Finalizada" : "Cancelada"}
          </span>
          <span className="text-sm text-gunmetal/60">
            Tempo total: {formatClock(base)}
          </span>
        </div>
        {finalized && (completionNote || note) && (
          <div className="mt-4">
            <p className="text-sm font-medium text-gunmetal">Resumo</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gunmetal/70">
              {completionNote || note}
            </p>
          </div>
        )}
        {warning && (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
            {warning}
          </p>
        )}
      </section>
    );
  }

  // --- Timer ativo ---------------------------------------------------------
  return (
    <section className="rounded-xl border border-platinum bg-white p-6 shadow-sm">
      <div className="flex flex-col items-center">
        <span className="text-xs uppercase tracking-wide text-gunmetal/50">
          Tempo
        </span>
        <span
          className="mt-1 font-mono text-5xl font-semibold tabular-nums text-risd"
          aria-live="off"
        >
          {formatClock(elapsed)}
        </span>
        {running && (
          <span className="mt-2 flex items-center gap-1.5 text-xs text-gunmetal/50">
            <span className="h-2 w-2 animate-pulse rounded-full bg-risd" />
            Em andamento
          </span>
        )}
      </div>

      {!finishing ? (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {!running ? (
            <button
              type="button"
              onClick={handleStart}
              disabled={busy}
              className="rounded-lg bg-risd px-6 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-chrysler focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {base > 0 ? "Retomar" : "Iniciar"}
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePause}
              disabled={busy}
              className="rounded-lg border border-risd bg-white px-6 py-2.5 text-sm font-medium text-risd shadow-sm transition hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Pausar
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setError(null);
              setFinishing(true);
            }}
            disabled={busy}
            className="rounded-lg bg-chrysler px-6 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-chrysler/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chrysler focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Finalizar
          </button>
        </div>
      ) : (
        <div className="mt-6 border-t border-platinum pt-6">
          <label
            htmlFor="completion-note"
            className="mb-1 block text-sm font-medium text-gunmetal"
          >
            Resumo do que foi feito{" "}
            <span className="text-red-500">*</span>
          </label>
          <textarea
            id="completion-note"
            rows={4}
            required
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Descreva o que foi realizado nesta tarefa…"
            className="w-full rounded-lg border border-platinum bg-white px-3 py-2 text-sm text-gunmetal shadow-sm transition focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2"
            autoFocus
          />

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => handleFinish(true)}
              disabled={busy || note.trim().length === 0}
              className="rounded-lg bg-chrysler px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-chrysler/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chrysler focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Finalizar e enviar ao WhatsApp
            </button>
            <button
              type="button"
              onClick={() => handleFinish(false)}
              disabled={busy || note.trim().length === 0}
              className="rounded-lg border border-platinum bg-white px-4 py-2.5 text-sm font-medium text-gunmetal shadow-sm transition hover:border-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Finalizar e apenas salvar no registro
            </button>
            <button
              type="button"
              onClick={() => setFinishing(false)}
              disabled={busy}
              className="rounded-lg px-4 py-2.5 text-sm text-gunmetal/60 transition hover:text-gunmetal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2"
            >
              Cancelar
            </button>
          </div>
          <p className="mt-2 text-xs text-gunmetal/40">
            &quot;Enviar ao WhatsApp&quot; dispara o resumo ao grupo vinculado à
            empresa. Se a empresa não tiver grupo, a tarefa é finalizada mesmo
            assim e um aviso é exibido.
          </p>
        </div>
      )}

      {error && (
        <p className="mt-4 text-center text-sm text-red-600">{error}</p>
      )}
    </section>
  );
}

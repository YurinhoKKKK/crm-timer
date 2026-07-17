"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { pauseTimer } from "@/app/colaborador/actions";
import {
  TIMER_SYNC_EVENT,
  emitTimerSync,
  type TimerSyncDetail,
} from "@/lib/timer-sync";

/* -------------------------------------------------------------------------- */
/* Indicador global de timer ativo (passo do lembrete de timer esquecido).    */
/* Vive no AppShell, então aparece em TODAS as telas autenticadas. Mostra     */
/* apenas os time_entries ABERTOS do PRÓPRIO usuário logado (nunca de         */
/* terceiros, mesmo sendo admin). O tempo corre no cliente a partir do        */
/* started_at; o banco só é consultado ao montar, num poll leve e ao voltar   */
/* o foco para a aba.                                                         */
/* -------------------------------------------------------------------------- */

type OpenTimer = {
  entryId: string;
  taskId: string;
  companyId: string;
  title: string;
  startedAtMs: number;
};

const COLLAPSE_KEY = "crm-timer-indicator-collapsed";
const POLL_MS = 45_000;

// Título original da aba, no escopo do módulo para sobreviver aos remounts do
// indicador a cada navegação (o AppShell é renderizado por página).
let baseTitle: string | null = null;

function applyDocTitle(next: string | null) {
  if (next === null) {
    if (baseTitle !== null) {
      document.title = baseTitle;
      baseTitle = null;
    }
    return;
  }
  if (baseTitle === null) baseTitle = document.title;
  document.title = next;
}

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

function taskHref(t: OpenTimer): string {
  return `/colaborador/${t.companyId}/${t.taskId}`;
}

function Chevron({ up }: { up: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {up ? <path d="M6 15l6-6 6 6" /> : <path d="M6 9l6 6 6-6" />}
    </svg>
  );
}

function PulseDot({ warn }: { warn: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      <span
        className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${
          warn ? "bg-amber-500" : "bg-risd"
        }`}
      />
      <span
        className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
          warn ? "bg-amber-500" : "bg-risd"
        }`}
      />
    </span>
  );
}

export default function ActiveTimerIndicator() {
  const router = useRouter();
  const [timers, setTimers] = useState<OpenTimer[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [collapsed, setCollapsed] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [pausingId, setPausingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const uidRef = useRef<string | null>(null);

  // Busca os time_entries abertos do usuário logado. Escopo ESTRITO: filtra
  // por collaborator_id = auth.uid() no time_entry E confere o responsável da
  // tarefa — não confia só no RLS (um admin lê entries de terceiros).
  const fetchOpen = useCallback(async () => {
    const supabase = createClient();
    if (!uidRef.current) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setTimers([]);
        return;
      }
      uidRef.current = user.id;
    }
    const uid = uidRef.current;
    const { data, error: err } = await supabase
      .from("time_entries")
      .select(
        "id, started_at, task_id, task:task_instances!inner(id, title, company_id, collaborator_id)"
      )
      .is("ended_at", null)
      .eq("collaborator_id", uid);
    if (err) return; // poll silencioso; a próxima tentativa corrige

    const list: OpenTimer[] = [];
    for (const row of (data ?? []) as {
      id: string;
      started_at: string;
      task_id: string;
      task:
        | { id: string; title: string; company_id: string; collaborator_id: string }
        | { id: string; title: string; company_id: string; collaborator_id: string }[]
        | null;
    }[]) {
      const task = Array.isArray(row.task) ? row.task[0] : row.task;
      if (!task || task.collaborator_id !== uid) continue;
      list.push({
        entryId: row.id,
        taskId: row.task_id,
        companyId: task.company_id,
        title: task.title,
        startedAtMs: Date.parse(row.started_at),
      });
    }
    list.sort((a, b) => a.startedAtMs - b.startedAtMs);
    setTimers(list);
  }, []);

  // Busca ao montar (o AppShell remonta a cada rota, então isso também cobre a
  // troca de tela), poll leve e refetch ao voltar o foco para a aba.
  useEffect(() => {
    fetchOpen();
    const id = window.setInterval(fetchOpen, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchOpen();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchOpen]);

  // O timer da tela da tarefa avisa quando inicia/pausa/finaliza (mesma aba).
  useEffect(() => {
    const onSync = (e: Event) => {
      const detail = (e as CustomEvent<TimerSyncDetail>).detail;
      if (!detail || detail.source === "indicator") return;
      fetchOpen();
    };
    window.addEventListener(TIMER_SYNC_EVENT, onSync);
    return () => window.removeEventListener(TIMER_SYNC_EVENT, onSync);
  }, [fetchOpen]);

  // Tique de 1s no cliente enquanto houver timer rodando (nada de query/s).
  const active = timers.length > 0;
  useEffect(() => {
    if (!active) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  // Estado de colapso persiste entre telas (sessionStorage); nunca some de
  // vez enquanto houver timer — o objetivo é lembrar.
  useEffect(() => {
    try {
      setCollapsed(sessionStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {}
  }, []);
  const setCollapsedPersist = (v: boolean) => {
    setCollapsed(v);
    try {
      sessionStorage.setItem(COLLAPSE_KEY, v ? "1" : "0");
    } catch {}
  };

  // Reforço no título da aba: denuncia o timer mesmo em segundo plano.
  const multi = timers.length > 1;
  const tabTitle = !active
    ? null
    : multi
      ? `▶ ${timers.length} tarefas ativas`
      : `▶ ${formatElapsed(nowMs - timers[0].startedAtMs)} · ${timers[0].title}`;
  useEffect(() => {
    applyDocTitle(tabTitle);
  }, [tabTitle]);
  useEffect(() => () => applyDocTitle(null), []);

  async function handlePause(taskId: string) {
    setError(null);
    setPausingId(taskId);
    const { error: err, totalSeconds } = await pauseTimer(taskId);
    setPausingId(null);
    if (err) {
      setError(err);
      return;
    }
    setTimers((prev) => prev.filter((t) => t.taskId !== taskId));
    emitTimerSync({ taskId, action: "pause", totalSeconds, source: "indicator" });
    startTransition(() => router.refresh());
  }

  if (!active) return null;

  const first = timers[0];

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center px-4 lg:left-64"
      style={{ bottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      {error && (
        <p className="pointer-events-auto mb-2 max-w-[92vw] truncate rounded-lg border border-red-200 bg-surface px-3 py-1.5 text-xs text-red-600 shadow-card dark:border-red-500/30 dark:text-red-400">
          {error}
        </p>
      )}

      {/* Lista expandida (2+ timers) */}
      {multi && listOpen && !collapsed && (
        <div className="pointer-events-auto mb-2 w-[min(92vw,24rem)] animate-fade-in rounded-2xl border border-line bg-surface p-2 shadow-pop">
          <p className="px-2 pb-1 pt-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            Mais de uma tarefa em andamento — o tempo está sendo contado em
            dobro.
          </p>
          <ul className="flex flex-col gap-1">
            {timers.map((t) => (
              <li
                key={t.entryId}
                className="flex items-center gap-2 rounded-xl px-2 py-1.5 transition hover:bg-surface-2"
              >
                <Link
                  href={taskHref(t)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">
                    {t.title}
                  </span>
                  <span className="font-mono text-sm tabular-nums text-risd">
                    {formatElapsed(nowMs - t.startedAtMs)}
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => handlePause(t.taskId)}
                  disabled={pausingId !== null}
                  className="shrink-0 rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-risd transition hover:bg-brand-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pausingId === t.taskId ? "Pausando…" : "Pausar"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {collapsed ? (
        /* Chip mínimo: ponto pulsante + tempo. Clique reexpande. */
        <button
          type="button"
          onClick={() => setCollapsedPersist(false)}
          aria-label="Expandir indicador de timer ativo"
          className={`pointer-events-auto flex animate-fade-in items-center gap-2 rounded-full border bg-surface px-3 py-1.5 shadow-pop transition hover:border-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
            multi
              ? "border-amber-400/70 dark:border-amber-400/40"
              : "border-line"
          }`}
        >
          <PulseDot warn={multi} />
          <span className="font-mono text-sm tabular-nums text-fg">
            {multi
              ? `${timers.length} ativas`
              : formatElapsed(nowMs - first.startedAtMs)}
          </span>
        </button>
      ) : (
        /* Pill completo */
        <div
          className={`pointer-events-auto flex max-w-[92vw] animate-fade-in items-center gap-1.5 rounded-full border bg-surface py-1.5 pl-3.5 pr-1.5 shadow-pop ${
            multi
              ? "border-amber-400/70 dark:border-amber-400/40"
              : "border-line"
          }`}
        >
          {multi ? (
            <button
              type="button"
              onClick={() => setListOpen((v) => !v)}
              aria-expanded={listOpen}
              className="flex min-w-0 items-center gap-2.5 rounded-full text-sm font-medium text-fg transition hover:text-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
            >
              <PulseDot warn />
              <span className="truncate">{timers.length} tarefas ativas</span>
              <Chevron up={!listOpen} />
            </button>
          ) : (
            <>
              <Link
                href={taskHref(first)}
                className="flex min-w-0 items-center gap-2.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
              >
                <PulseDot warn={false} />
                <span className="min-w-0 max-w-[38vw] truncate text-sm font-medium text-fg sm:max-w-[16rem]">
                  {first.title}
                </span>
                <span className="font-mono text-sm tabular-nums text-risd">
                  {formatElapsed(nowMs - first.startedAtMs)}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => handlePause(first.taskId)}
                disabled={pausingId !== null}
                className="ml-1 shrink-0 rounded-full border border-line px-3 py-1 text-xs font-semibold text-risd transition hover:bg-brand-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pausingId === first.taskId ? "Pausando…" : "Pausar"}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              setListOpen(false);
              setCollapsedPersist(true);
            }}
            aria-label="Minimizar indicador de timer ativo"
            className="shrink-0 rounded-full p-1.5 text-fg-muted transition hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
          >
            <Chevron up={false} />
          </button>
        </div>
      )}
    </div>
  );
}

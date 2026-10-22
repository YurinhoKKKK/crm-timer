"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { formatClock, formatDurationBR, parseStartedAt, clockSkewMs, type MeetingTimerBase } from "@/lib/timer";
import { useMeetingTimerTotal } from "@/lib/useMeetingTimerTotal";
import { MEETING_TIMER_SYNC_EVENT, emitMeetingTimerSync } from "@/lib/timer-sync";
import {
  startMeetingTimer,
  pauseMeetingTimer,
  resumeMeetingTimer,
  finalizeMeetingTimer,
  editMeetingTimer,
  fetchReadableMeetingTimers,
  type MeetingTimerState,
} from "@/app/meeting-timer-actions";
import type { DirectoryUser, ReachableCompany } from "@/lib/meetings";

const TZ = "America/Sao_Paulo";
const PLAY_LEAD_MS = 30 * 60 * 1000; // Play liberado 30 min antes do início (decisão 5).

// Formata o horário (BRT) a partir do qual o Play fica disponível. Mostra só HH:MM
// quando é hoje; senão inclui DD/MM.
function playFromLabel(fromMs: number): string {
  const d = new Date(fromMs);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const day = d.toLocaleDateString("en-CA", { timeZone: TZ });
  const hhmm = d.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  if (day === today) return hhmm;
  const ddmm = d.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" });
  return `${ddmm} ${hhmm}`;
}

// Controle do timer de REUNIÃO no card da Agenda e na aba Reuniões. Play / Pause /
// Finalizar / Editar para quem opera (criador da reunião do CRM ou dono do evento
// importado); para os demais, só o tempo. O tempo ao vivo é derivado do banco
// (nunca acumulado — mesmo helper do timer de tarefa). A autorização real é do
// banco; `canStart` só decide exibir o botão de iniciar.
export default function MeetingTimerControl({
  kind,
  meetingId,
  googleEventId,
  scheduledStart,
  currentUserId,
  canStart,
  companies,
  directory,
  nameById,
}: {
  kind: "meeting" | "imported";
  meetingId?: string | null;
  googleEventId?: string | null;
  // Início agendado (ISO) — para a janela de Play (decisão 5). Null = sem limite.
  scheduledStart?: string | null;
  currentUserId: string;
  // Para reunião do CRM: é o criador. Para importado: dono + não privado + não é
  // reunião do CRM. Só controla a exibição do botão Iniciar (o resto é por `mine`).
  canStart: boolean;
  companies?: ReachableCompany[];
  directory?: DirectoryUser[];
  nameById?: Map<string, string>;
}) {
  const [timer, setTimer] = useState<MeetingTimerState | null>(null);
  const [skew, setSkew] = useState(0); // defasagem servidor−navegador (decisão 4)
  const skewSet = useRef(false); // calcula a defasagem UMA vez
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now()); // só para a janela de Play

  // Form do importado (empresa + consultores presentes).
  const [picking, setPicking] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [people, setPeople] = useState<Set<string>>(new Set());

  // Modal (inline) de edição de tempo.
  const [editing, setEditing] = useState(false);

  const matches = useCallback(
    (t: MeetingTimerState) =>
      kind === "meeting"
        ? t.meetingId === meetingId
        : t.googleEventId === googleEventId,
    [kind, meetingId, googleEventId]
  );

  const load = useCallback(async () => {
    const all = await fetchReadableMeetingTimers();
    const t = all.find(matches) ?? null;
    setTimer(t);
    if (t && !skewSet.current) {
      setSkew(clockSkewMs(t.serverNow));
      skewSet.current = true;
    }
    setLoaded(true);
  }, [matches]);

  useEffect(() => {
    load();
  }, [load]);

  // Reflete ações feitas em outro lugar (rodapé, outra aba do card) na mesma aba.
  useEffect(() => {
    const onSync = () => load();
    window.addEventListener(MEETING_TIMER_SYNC_EVENT, onSync);
    return () => window.removeEventListener(MEETING_TIMER_SYNC_EVENT, onSync);
  }, [load]);

  const running = !!timer?.isOpen;
  const finalized = !!timer?.isFinalized;
  const mine = timer?.startedBy === currentUserId;

  // Tempo exibido ao vivo — MESMA conta do pop-up e da linha da empresa
  // (lib/timer.ts): base que não corre + (agora+skew − início do trecho aberto).
  const base: MeetingTimerBase | null = timer
    ? {
        baseSeconds: timer.baseSeconds,
        openStartsMs:
          timer.isOpen && timer.openStartedAt
            ? [parseStartedAt(timer.openStartedAt) ?? Date.now()]
            : [],
        skewMs: skew,
      }
    : null;
  const elapsed = useMeetingTimerTotal(base);

  // Janela de Play (decisão 5): a partir de 30 min antes do início agendado. Tem
  // tique próprio só enquanto a janela ainda não abriu (o relógio ao vivo é do hook).
  const playFromMs = useMemo(() => {
    const s = parseStartedAt(scheduledStart);
    return s === null ? null : s - PLAY_LEAD_MS;
  }, [scheduledStart]);
  const playAllowed = playFromMs === null || nowMs >= playFromMs;
  const waitingForWindow =
    !running && !finalized && !playAllowed && (canStart || (!!timer && mine));
  useEffect(() => {
    if (!waitingForWindow) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [waitingForWindow]);

  async function act(fn: () => Promise<{ error: string | null }>) {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return false;
    }
    emitMeetingTimerSync();
    await load();
    return true;
  }

  async function doStart(input: Parameters<typeof startMeetingTimer>[0]) {
    if (await act(() => startMeetingTimer(input))) setPicking(false);
  }

  const btn =
    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd disabled:cursor-not-allowed disabled:opacity-60";
  const btnPrimary = `${btn} bg-risd text-white hover:bg-chrysler`;
  const btnOutline = `${btn} border border-risd bg-surface text-risd hover:bg-brand-tint`;
  const btnGhost = `${btn} border border-line bg-surface text-fg-muted hover:border-risd/40 hover:text-fg`;

  if (!loaded) {
    return <div className="mt-3 h-8 animate-pulse rounded-lg bg-surface-2" />;
  }

  const windowHint =
    !playAllowed && playFromMs !== null
      ? `Disponível a partir de ${playFromLabel(playFromMs)}`
      : null;

  const Clock = (
    <span className="inline-flex items-center gap-2">
      <span
        className={`h-2 w-2 rounded-full ${running ? "animate-pulse bg-risd" : "bg-fg-subtle"}`}
        aria-hidden
      />
      <span className="font-mono text-sm font-semibold tabular-nums text-risd">
        {formatClock(elapsed)}
      </span>
    </span>
  );

  // Botão de Play (Iniciar/Retomar) com a trava da janela e a dica.
  function PlayButton({ label, onClick }: { label: string; onClick: () => void }) {
    return (
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          className={btnPrimary}
          disabled={busy || !playAllowed}
          title={windowHint ?? undefined}
          onClick={onClick}
        >
          {busy ? "…" : label}
        </button>
        {windowHint && <span className="text-[11px] text-fg-subtle">{windowHint}</span>}
      </span>
    );
  }

  const toggle = (id: string) =>
    setPeople((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="mt-3 rounded-lg border border-line bg-surface-2/40 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
          Tempo de reunião
        </span>

        {/* --- sem timer --- */}
        {!timer && !picking && (
          canStart ? (
            <PlayButton
              label="Iniciar"
              onClick={() => {
                if (kind === "meeting") doStart({ meetingId });
                else setPicking(true);
              }}
            />
          ) : (
            <span className="text-xs text-fg-subtle">Timer não iniciado.</span>
          )
        )}

        {/* --- rodando --- */}
        {timer?.isOpen && (
          <div className="flex flex-wrap items-center gap-2">
            {Clock}
            {mine ? (
              <>
                <button type="button" className={btnOutline} disabled={busy}
                  onClick={() => act(() => pauseMeetingTimer(timer.timerId))}>
                  {busy ? "…" : "Pausar"}
                </button>
                <button type="button" className={btnGhost} disabled={busy}
                  onClick={() => act(() => finalizeMeetingTimer(timer.timerId))}>
                  Finalizar
                </button>
              </>
            ) : (
              <span className="text-xs text-fg-subtle">
                em andamento por {nameById?.get(timer.startedBy) ?? "outra pessoa"}
              </span>
            )}
          </div>
        )}

        {/* --- pausado (há trechos, sem aberto, não finalizado) --- */}
        {timer && !timer.isOpen && !timer.isFinalized && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold tabular-nums text-fg">
              {formatClock(elapsed)}
            </span>
            {mine ? (
              <>
                <PlayButton label="Retomar" onClick={() => act(() => resumeMeetingTimer(timer.timerId))} />
                <button type="button" className={btnGhost} disabled={busy}
                  onClick={() => act(() => finalizeMeetingTimer(timer.timerId))}>
                  Finalizar
                </button>
                <button type="button" className={btnGhost} disabled={busy}
                  onClick={() => { setError(null); setEditing(true); }}>
                  Editar
                </button>
              </>
            ) : (
              <span className="text-xs text-fg-subtle">
                cronometrada por {nameById?.get(timer.startedBy) ?? "outra pessoa"}
              </span>
            )}
          </div>
        )}

        {/* --- finalizado (sem Play) --- */}
        {timer?.isFinalized && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold tabular-nums text-fg">
              {formatClock(elapsed)}
            </span>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-fg-subtle">
              Finalizada
            </span>
            {mine ? (
              <button type="button" className={btnGhost} disabled={busy}
                onClick={() => { setError(null); setEditing(true); }}>
                Editar
              </button>
            ) : (
              <span className="text-xs text-fg-subtle">
                cronometrada por {nameById?.get(timer.startedBy) ?? "outra pessoa"}
              </span>
            )}
          </div>
        )}
      </div>

      {/* --- form do importado: empresa + consultores presentes --- */}
      {picking && (
        <div className="mt-2 space-y-2 border-t border-line pt-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-fg">Empresa da reunião</label>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-fg focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
            >
              <option value="">— escolha —</option>
              {(companies ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {directory && directory.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-fg">
                Outros consultores presentes <span className="text-fg-subtle">(opcional)</span>
              </label>
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                {directory
                  .filter((u) => u.id !== currentUserId)
                  .map((u) => {
                    const on = people.has(u.id);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => toggle(u.id)}
                        aria-pressed={on}
                        className={`inline-flex items-center gap-1 rounded-full border py-0.5 pl-0.5 pr-2 text-xs transition ${
                          on
                            ? "border-risd bg-brand-tint text-risd"
                            : "border-line bg-surface text-fg-muted hover:border-risd/40"
                        }`}
                      >
                        <Avatar name={u.name} url={u.avatarUrl} size={16} />
                        {u.name}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={btnPrimary}
              disabled={busy || !companyId || !playAllowed}
              title={windowHint ?? undefined}
              onClick={() =>
                doStart({ googleEventId, companyId, people: Array.from(people) })
              }
            >
              {busy ? "Iniciando…" : "Iniciar timer"}
            </button>
            {windowHint && <span className="text-[11px] text-fg-subtle">{windowHint}</span>}
            <button
              type="button"
              className="rounded-lg px-2.5 py-1.5 text-xs text-fg-muted transition hover:text-fg"
              disabled={busy}
              onClick={() => setPicking(false)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* --- modal (inline) de edição de tempo --- */}
      {editing && timer && (
        <EditTimePanel
          currentSeconds={timer.baseSeconds}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={async (seconds, justification) => {
            const ok = await act(() => editMeetingTimer(timer.timerId, seconds, justification));
            if (ok) setEditing(false);
            return ok;
          }}
        />
      )}

      {error && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

// Editar o tempo da reunião: horas + minutos + justificativa (≥ 10 car.), 1 min a
// 6 h. O banco revalida e registra a auditoria; aqui só a conveniência do form.
function EditTimePanel({
  currentSeconds,
  busy,
  onCancel,
  onSave,
}: {
  currentSeconds: number;
  busy: boolean;
  onCancel: () => void;
  onSave: (seconds: number, justification: string) => Promise<boolean>;
}) {
  const [hours, setHours] = useState(() => Math.floor(currentSeconds / 3600));
  const [minutes, setMinutes] = useState(() => Math.round((currentSeconds % 3600) / 60));
  const [justification, setJustification] = useState("");
  const [localErr, setLocalErr] = useState<string | null>(null);

  const total = hours * 3600 + minutes * 60;
  const justOk = justification.trim().length >= 10;
  const timeOk = total >= 60 && total <= 21600;

  async function submit() {
    setLocalErr(null);
    if (!timeOk) {
      setLocalErr(total < 60 ? "O tempo mínimo é 1 minuto." : "O tempo máximo é 6 horas.");
      return;
    }
    if (!justOk) {
      setLocalErr("A justificativa é obrigatória (mínimo 10 caracteres).");
      return;
    }
    await onSave(total, justification.trim());
  }

  const numCls =
    "w-16 rounded-lg border border-line bg-surface px-2 py-1 text-sm text-fg focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd";

  return (
    <div className="mt-2 space-y-2 border-t border-line pt-2">
      <p className="text-xs font-medium text-fg">Editar tempo da reunião</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[11px] text-fg-subtle">
          Horas
          <input type="number" min={0} max={6} value={hours} className={`mt-0.5 block ${numCls}`}
            onChange={(e) => { setLocalErr(null); setHours(Math.max(0, Math.min(6, Number(e.target.value) || 0))); }} />
        </label>
        <label className="text-[11px] text-fg-subtle">
          Minutos
          <input type="number" min={0} max={59} value={minutes} className={`mt-0.5 block ${numCls}`}
            onChange={(e) => { setLocalErr(null); setMinutes(Math.max(0, Math.min(59, Number(e.target.value) || 0))); }} />
        </label>
        <span className="pb-1 text-xs text-fg-subtle">= {formatDurationBR(total)}</span>
      </div>
      <div>
        <label className="mb-1 block text-[11px] text-fg-subtle">
          Justificativa <span className="text-red-500">*</span>
        </label>
        <textarea
          value={justification}
          onChange={(e) => { setLocalErr(null); setJustification(e.target.value); }}
          rows={2}
          placeholder="Por que o tempo está sendo ajustado? (mínimo 10 caracteres)"
          className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-fg focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
        />
      </div>
      <div className="flex items-center gap-2">
        <button type="button" disabled={busy || !timeOk || !justOk}
          onClick={submit}
          className="rounded-lg bg-risd px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-chrysler disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? "Salvando…" : "Salvar"}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}
          className="rounded-lg px-2.5 py-1.5 text-xs text-fg-muted transition hover:text-fg">
          Cancelar
        </button>
      </div>
      {localErr && <p className="text-[11px] text-red-600 dark:text-red-400">{localErr}</p>}
    </div>
  );
}

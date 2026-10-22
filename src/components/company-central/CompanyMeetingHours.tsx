"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { avatarUrl } from "@/lib/avatar";
import { formatDurationBR, meetingLiveSeconds, clockSkewMs, parseStartedAt } from "@/lib/timer";
import { MEETING_TIMER_SYNC_EVENT } from "@/lib/timer-sync";
import { fetchCompanyMeetingHours, type MeetingHoursRow } from "@/app/meeting-timer-actions";

// Linha "Horas em reunião" no topo da aba Reuniões da empresa (decisão 9). Só admin
// e consultores da empresa veem (o banco recusa colaborador → restricted → some).
// Total do período + quebra por consultor, em durações legíveis. Usa a MESMA conta
// viva do pop-up/cards (meetingLiveSeconds): base que não corre + trechos abertos,
// com defasagem de relógio — então, se uma reunião está rodando, o total avança.

const TZ = "America/Sao_Paulo";

type Period = "mes" | "30d" | "tudo";
const PERIODS: { value: Period; label: string; prefix: string }[] = [
  { value: "mes", label: "Este mês", prefix: "neste mês" },
  { value: "30d", label: "Últimos 30 dias", prefix: "nos últimos 30 dias" },
  { value: "tudo", label: "Tudo", prefix: "no total" },
];

function todayBRT(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}
function rangeOf(p: Period): { start: string | null; end: string | null } {
  if (p === "tudo") return { start: null, end: null };
  const today = todayBRT();
  if (p === "mes") return { start: `${today.slice(0, 7)}-01`, end: null };
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 29);
  return { start: d.toISOString().slice(0, 10), end: null };
}

export default function CompanyMeetingHours({ companyId }: { companyId: string }) {
  const [period, setPeriod] = useState<Period>("mes");
  const [loading, setLoading] = useState(true);
  const [restricted, setRestricted] = useState(false);
  const [rows, setRows] = useState<MeetingHoursRow[]>([]);
  const [skew, setSkew] = useState(0);
  const skewSet = useRef(false); // calcula a defasagem UMA vez
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    const { start, end } = rangeOf(period);
    const res = await fetchCompanyMeetingHours(companyId, start, end);
    if (res.restricted) {
      setRestricted(true);
      setLoading(false);
      return;
    }
    setRows(res.rows ?? []);
    if (!skewSet.current) {
      setSkew(clockSkewMs(res.serverNow));
      skewSet.current = true;
    }
    setLoading(false);
  }, [companyId, period]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Reflete qualquer ação de timer (Play/Pause/Finalizar/Editar) feita na mesma aba.
  useEffect(() => {
    const onSync = () => load();
    window.addEventListener(MEETING_TIMER_SYNC_EVENT, onSync);
    return () => window.removeEventListener(MEETING_TIMER_SYNC_EVENT, onSync);
  }, [load]);

  // Tiquetaqueia só quando há alguma reunião rodando (algum trecho aberto).
  const anyOpen = useMemo(() => rows.some((r) => r.openStarts.length > 0), [rows]);
  useEffect(() => {
    if (!anyOpen) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [anyOpen]);

  // Segundos ao vivo por consultor (mesma fórmula da fonte única).
  const live = useMemo(
    () =>
      rows.map((r) => ({
        userId: r.userId,
        userName: r.userName,
        avatarPath: r.avatarPath,
        seconds: meetingLiveSeconds(
          {
            baseSeconds: r.baseSeconds,
            openStartsMs: r.openStarts.map((s) => parseStartedAt(s) ?? Date.now()),
            skewMs: skew,
          },
          nowMs
        ),
      })),
    [rows, skew, nowMs]
  );
  const total = useMemo(() => live.reduce((a, r) => a + r.seconds, 0), [live]);
  const prefix = PERIODS.find((p) => p.value === period)?.prefix ?? "";

  if (restricted) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-line bg-surface-2/40 px-4 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="text-fg-muted">
          <span className="font-medium text-fg">Horas em reunião</span> {prefix}:
        </span>
        {loading ? (
          <span className="text-fg-subtle">carregando…</span>
        ) : total <= 0 ? (
          <span className="text-fg-subtle">nenhuma reunião cronometrada.</span>
        ) : (
          <>
            <span className="font-semibold tabular-nums text-fg">{formatDurationBR(total)}</span>
            {live.map((r) => (
              <span
                key={r.userId}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface py-0.5 pl-0.5 pr-2.5 text-xs text-fg"
              >
                <Avatar name={r.userName || "?"} url={avatarUrl(r.avatarPath)} size={18} />
                <span className="text-fg-muted">{r.userName || "(sem nome)"}</span>
                <span className="font-semibold tabular-nums">{formatDurationBR(r.seconds)}</span>
              </span>
            ))}
          </>
        )}
      </div>
      <div role="tablist" className="flex shrink-0 rounded-lg border border-line bg-surface p-0.5">
        {PERIODS.map((p) => {
          const active = period === p.value;
          return (
            <button
              key={p.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setPeriod(p.value)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
                active ? "bg-brand-tint text-risd" : "text-fg-muted hover:text-fg"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

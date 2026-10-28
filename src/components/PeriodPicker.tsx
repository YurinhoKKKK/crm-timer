"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type PeriodValue,
  type PeriodConfig,
  type ShortcutId,
  brtToday,
  daysInMonth,
  firstWeekdayOfMonth,
  shiftMonth,
  makeYmd,
  ymOf,
  monthName,
  brDate,
  lastDayOfMonth,
  monthYearLabel,
  periodParamNames,
  shortcutPeriodValue,
} from "@/lib/period";

// Seletor de período ÚNICO do sistema (padroniza os 8 seletores antigos). Visual
// e comportamento do antigo PeriodPicker do Dashboard: rótulo "Período: …" +
// atalhos visíveis + botão "Período" com popover (atalhos + calendário próprio;
// um mês por vez, título abre a grade de meses, 1º clique = início, 2º = fim).
// Cada tela escolhe por `config`: atalhos visíveis, atalhos do popover, aceitar
// futuro (padrão: não), modo (range/month), nomes dos parâmetros de URL. Sem
// biblioteca de datas — toda a aritmética de calendário vem de lib/period.ts.

const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];
const MONTHS_SHORT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

const SHORTCUT_LABELS: Record<ShortcutId, string> = {
  ontem: "Ontem",
  hoje: "Hoje",
  tudo: "Tudo",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  este_mes: "Este mês",
  mes_passado: "Mês passado",
  calib_start: "Desde o início",
};

export default function PeriodPicker({
  value,
  config,
  extraParams,
}: {
  value: PeriodValue;
  config: PeriodConfig;
  // Parâmetros fixos que acompanham TODA navegação deste seletor (ex.: manter a
  // aba ativa: {aba: "faturamento"}). Não são apagados entre trocas de período.
  extraParams?: Record<string, string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Troca de período é navegação de FILTRO: mantém o conteúdo atual na tela (sem
  // cair no loading.tsx) e não rola ao topo. isPending dá o feedback discreto.
  const [isPending, startTransition] = useTransition();

  const names = useMemo(() => periodParamNames(config), [config]);
  const mode = config.mode ?? "range";
  const monthRange = mode === "month" && !!config.monthRange;
  const allowFuture = !!config.allowFuture;

  const today = brtToday();
  const curMonth = today.slice(0, 7);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Mês/ano em exibição no calendário e na grade de meses.
  const initialYm = ymOf(value.end ?? value.start ?? today);
  const [viewYm, setViewYm] = useState(initialYm);
  // Range mode: alterna entre o calendário de dias e a grade de meses. Month
  // mode: a grade de meses é sempre exibida (nunca há calendário de dias).
  const [monthGrid, setMonthGrid] = useState(mode === "month");
  // 1º clique "pendente" (dia em range; mês em month-range) à espera do 2º.
  const [pendingStart, setPendingStart] = useState<string | null>(null);

  // Navega preservando parâmetros alheios; só apaga/escreve OS DESTA tela (pelos
  // nomes do config) — assim não atropela outro seletor na mesma URL.
  function navigate(params: Record<string, string>) {
    const sp = new URLSearchParams(searchParams?.toString());
    for (const k of [names.periodo, names.de, names.ate, names.mes]) sp.delete(k);
    for (const [k, v] of Object.entries(extraParams ?? {})) sp.set(k, v);
    for (const [k, v] of Object.entries(params)) sp.set(k, v);
    const qs = sp.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  function close() {
    setOpen(false);
    setMonthGrid(mode === "month");
    setPendingStart(null);
  }

  // Esc e clique fora fecham o popover.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Ao abrir, reancora no período atual e foca o popover.
  useEffect(() => {
    if (open) {
      setViewYm(ymOf(value.end ?? value.start ?? today));
      setPendingStart(null);
      setMonthGrid(mode === "month");
      popoverRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ----- Atalhos -----------------------------------------------------------
  function applyShortcut(s: ShortcutId) {
    navigate(shortcutPeriodValue(s, config).params);
    close();
  }

  function isShortcutActive(s: ShortcutId): boolean {
    if (s === "tudo") return value.kind === "tudo";
    if (s === "hoje") return value.kind === "hoje";
    if (s === "ontem") return value.kind === "ontem";
    const sv = shortcutPeriodValue(s, config);
    return value.kind === "custom" && value.start === sv.start && value.end === sv.end;
  }

  // "Período" ativo quando há um intervalo/mês específico (não um atalho de ponto).
  const periodActive = value.kind === "custom" || value.kind === "mes";

  // ----- Calendário de dias (range mode) -----------------------------------
  function onDayClick(ymd: string) {
    if (!allowFuture && ymd > today) return;
    if (!pendingStart) {
      setPendingStart(ymd);
      return;
    }
    const [lo, hi] = pendingStart <= ymd ? [pendingStart, ymd] : [ymd, pendingStart];
    navigate({ [names.de]: lo, [names.ate]: hi });
    close();
  }

  const dayGrid = useMemo(() => {
    const lead = firstWeekdayOfMonth(viewYm);
    const total = daysInMonth(viewYm);
    const [y, m] = viewYm.split("-").map(Number);
    const cells: (string | null)[] = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= total; d++) cells.push(makeYmd(y, m, d));
    return cells;
  }, [viewYm]);

  // Realce: sem clique pendente mostra o intervalo ativo; com pendente, só o início.
  const daySelStart = pendingStart ?? (value.kind === "tudo" ? null : value.start);
  const daySelEnd = pendingStart ? null : value.kind === "tudo" ? null : value.end;

  function dayState(ymd: string) {
    const isStart = !!daySelStart && ymd === daySelStart;
    const isEnd = !!daySelEnd && ymd === daySelEnd;
    return {
      isToday: ymd === today,
      isStart,
      isEnd,
      inRange: !!daySelStart && !!daySelEnd && ymd > daySelStart && ymd < daySelEnd,
      disabled: !allowFuture && ymd > today,
    };
  }

  // ----- Grade de meses ----------------------------------------------------
  function onMonthClick(ym: string) {
    if (monthDisabled(ym)) return;
    if (monthRange) {
      if (!pendingStart) {
        setPendingStart(ym);
        return;
      }
      const [lo, hi] = pendingStart <= ym ? [pendingStart, ym] : [ym, pendingStart];
      navigate({ [names.de]: lo, [names.ate]: hi });
      close();
      return;
    }
    if (mode === "month") {
      navigate({ [names.mes]: ym });
      close();
      return;
    }
    // Range mode: escolher um mês seleciona o MÊS INTEIRO (como no Dashboard).
    navigate({ [names.de]: `${ym}-01`, [names.ate]: lastDayOfMonth(ym) });
    close();
  }

  function monthDisabled(ym: string): boolean {
    if (!allowFuture && ym > curMonth) return true;
    if (config.minMonth && ym < config.minMonth) return true;
    return false;
  }

  // Meses selecionados (só no modo month): single = o mês do valor; range =
  // intervalo lo..hi (ou só o início pendente).
  const monthSel = useMemo(() => {
    if (mode !== "month") return { start: null as string | null, end: null as string | null };
    if (monthRange) {
      if (pendingStart) return { start: pendingStart, end: null };
      return { start: value.start?.slice(0, 7) ?? null, end: value.end?.slice(0, 7) ?? null };
    }
    const m = value.kind === "mes" ? value.start?.slice(0, 7) ?? null : null;
    return { start: m, end: m };
  }, [mode, monthRange, pendingStart, value]);

  function monthState(ym: string) {
    const isStart = !!monthSel.start && ym === monthSel.start;
    const isEnd = !!monthSel.end && ym === monthSel.end;
    return {
      isCurrent: ym === curMonth,
      isStart,
      isEnd,
      inRange: !!monthSel.start && !!monthSel.end && ym > monthSel.start && ym < monthSel.end,
      disabled: monthDisabled(ym),
    };
  }

  const viewYear = Number(viewYm.split("-")[0]);
  const barShortcuts = config.barShortcuts;
  const popoverShortcuts = config.popoverShortcuts;

  // Seta de "anterior": range+dia = mês; grade de meses (range ou month) = ano.
  const showingMonthGrid = mode === "month" || monthGrid;
  const prevLabel = showingMonthGrid ? "Ano anterior" : "Mês anterior";
  const nextLabel = showingMonthGrid ? "Próximo ano" : "Próximo mês";
  const stepPrev = () => setViewYm(shiftMonth(viewYm, showingMonthGrid ? -12 : -1));
  const stepNext = () => setViewYm(shiftMonth(viewYm, showingMonthGrid ? 12 : 1));

  return (
    <div ref={rootRef} className="relative">
      <div
        aria-busy={isPending}
        className={`flex flex-wrap items-center gap-2 transition-opacity ${
          isPending ? "opacity-60" : ""
        }`}
      >
        {/* Rótulo textual SEMPRE visível. */}
        <span className="text-xs text-fg-subtle" aria-live="polite">
          Período:{" "}
          <span className="font-medium text-fg-muted">{value.label}</span>
        </span>

        <div
          role="group"
          aria-label="Período"
          className="inline-flex rounded-xl border border-line bg-surface p-1 shadow-card"
        >
          {barShortcuts.map((s) => {
            const active = isShortcutActive(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => applyShortcut(s)}
                aria-pressed={active}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-1 focus-visible:ring-offset-surface ${
                  active
                    ? "bg-risd text-white shadow-sm"
                    : "text-fg-muted hover:bg-surface-2 hover:text-fg"
                }`}
              >
                {SHORTCUT_LABELS[s]}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-pressed={periodActive}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-1 focus-visible:ring-offset-surface ${
              periodActive
                ? "bg-risd text-white shadow-sm"
                : "text-fg-muted hover:bg-surface-2 hover:text-fg"
            }`}
          >
            Período
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className={`transition-transform ${open ? "rotate-180" : ""}`}
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Escolher período"
          tabIndex={-1}
          className="absolute right-0 z-overlay mt-2 w-[20rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-surface p-4 shadow-pop focus:outline-none"
        >
          {/* Atalhos do popover. */}
          {popoverShortcuts.length > 0 && (
            <>
              <div className="mb-3 grid grid-cols-2 gap-2">
                {popoverShortcuts.map((s) => {
                  const active = isShortcutActive(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => applyShortcut(s)}
                      aria-pressed={active}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-1 focus-visible:ring-offset-surface ${
                        active
                          ? "border-risd bg-brand-tint font-semibold text-risd"
                          : "border-line bg-surface text-fg-muted hover:border-risd/50 hover:text-fg"
                      }`}
                    >
                      {SHORTCUT_LABELS[s]}
                    </button>
                  );
                })}
              </div>
              <div className="mb-3 border-t border-line" />
            </>
          )}

          {/* Cabeçalho do calendário: ◀ título ▶ (em range, o título abre a grade de meses). */}
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label={prevLabel}
              onClick={stepPrev}
              className="rounded-lg border border-line bg-surface p-1.5 text-fg-muted transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            {mode === "month" ? (
              <span className="px-3 py-1 text-sm font-semibold text-fg">{viewYear}</span>
            ) : (
              <button
                type="button"
                onClick={() => setMonthGrid((v) => !v)}
                aria-expanded={monthGrid}
                className="rounded-lg px-3 py-1 text-sm font-semibold capitalize text-fg transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
              >
                {monthGrid ? viewYear : `${monthName(viewYm)} de ${viewYear}`}
              </button>
            )}
            <button
              type="button"
              aria-label={nextLabel}
              onClick={stepNext}
              className="rounded-lg border border-line bg-surface p-1.5 text-fg-muted transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>

          {showingMonthGrid ? (
            <>
              {monthRange && pendingStart && (
                <p className="mb-2 text-xs text-fg-subtle">
                  Mês inicial em{" "}
                  <span className="font-medium text-fg-muted">
                    {monthYearLabel(pendingStart)}
                  </span>{" "}
                  — escolha o fim.
                </p>
              )}
              <div className="grid grid-cols-3 gap-2">
                {MONTHS_SHORT.map((mn, i) => {
                  const ym = `${viewYear}-${String(i + 1).padStart(2, "0")}`;
                  const st = monthState(ym);
                  let tone: string;
                  if (st.disabled) {
                    tone = "cursor-not-allowed border-line/60 text-fg-subtle/40";
                  } else if (st.isStart || st.isEnd) {
                    tone = "border-risd bg-risd font-bold text-white shadow-sm";
                  } else if (st.inRange) {
                    tone = "border-risd/40 bg-brand-tint font-medium text-risd";
                  } else if (st.isCurrent) {
                    tone = "border-risd font-semibold text-risd";
                  } else {
                    tone = "border-line text-fg-muted hover:border-risd/50 hover:text-fg";
                  }
                  return (
                    <button
                      key={mn}
                      type="button"
                      disabled={st.disabled}
                      aria-pressed={st.isStart || st.isEnd}
                      onClick={() => onMonthClick(ym)}
                      className={`rounded-lg border px-2 py-2 text-sm font-medium capitalize transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${tone}`}
                    >
                      {mn}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              {pendingStart && (
                <p className="mb-2 text-xs text-fg-subtle">
                  Início em{" "}
                  <span className="font-medium text-fg-muted">
                    {brDate(pendingStart)}
                  </span>{" "}
                  — escolha o fim.
                </p>
              )}
              <div className="grid grid-cols-7 gap-0.5 text-center">
                {WEEKDAYS.map((w, i) => (
                  <div
                    key={i}
                    className="pb-1 text-[0.65rem] font-medium uppercase text-fg-subtle"
                  >
                    {w}
                  </div>
                ))}
                {dayGrid.map((ymd, i) =>
                  ymd === null ? (
                    <div key={`b${i}`} />
                  ) : (
                    (() => {
                      const st = dayState(ymd);
                      const d = Number(ymd.slice(8, 10));
                      const base =
                        "relative flex h-9 items-center justify-center rounded-lg text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:z-10";
                      let tone: string;
                      if (st.disabled) {
                        tone = "cursor-not-allowed text-fg-subtle/40";
                      } else if (st.isStart || st.isEnd) {
                        tone = "bg-risd font-bold text-white shadow-sm";
                      } else if (st.inRange) {
                        tone = "bg-brand-tint font-medium text-risd";
                      } else {
                        tone = "text-fg-muted hover:bg-surface-2 hover:text-fg";
                      }
                      const todayRing =
                        st.isToday && !st.isStart && !st.isEnd && !st.disabled
                          ? " ring-1 ring-inset ring-risd/70 underline underline-offset-2"
                          : "";
                      return (
                        <button
                          key={ymd}
                          type="button"
                          disabled={st.disabled}
                          onClick={() => onDayClick(ymd)}
                          aria-label={brDate(ymd)}
                          aria-current={st.isToday ? "date" : undefined}
                          aria-pressed={st.isStart || st.isEnd}
                          className={`${base} ${tone}${todayRing}`}
                        >
                          {d}
                        </button>
                      );
                    })()
                  )
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

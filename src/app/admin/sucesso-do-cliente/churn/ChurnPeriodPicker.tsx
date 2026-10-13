"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type ChurnPeriod,
  brtToday,
  daysInMonth,
  firstWeekdayOfMonth,
  shiftMonth,
  makeYmd,
  ymOf,
  monthName,
  brDate,
} from "@/lib/period";

// Seletor de período do Controle de Churn (2ª aba do Sucesso do Cliente). Mesma
// linguagem do seletor do dashboard (calendário próprio + grade de meses, sem
// biblioteca de datas), mas com os atalhos desta aba: "Mês atual", "Mês anterior",
// "Todos" e "Período" (abre o calendário). Escolher um mês na grade filtra o mês
// inteiro; o dia-a-dia faz um intervalo livre. Datas em texto AAAA-MM-DD na URL;
// a validação final mora no servidor (resolveChurnPeriod).

const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];
const MONTHS_SHORT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

export default function ChurnPeriodPicker({ value }: { value: ChurnPeriod }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const initialYm = ymOf(value.end ?? value.start ?? brtToday());
  const [viewYm, setViewYm] = useState(initialYm);
  const [monthGrid, setMonthGrid] = useState(false);
  const [pendingStart, setPendingStart] = useState<string | null>(null);

  const today = brtToday();

  // Navega preservando parâmetros não relacionados ao período; limpa os de período
  // e aplica os novos.
  function navigate(params: Record<string, string>) {
    const sp = new URLSearchParams(searchParams?.toString());
    for (const k of ["periodo", "de", "ate"]) sp.delete(k);
    for (const [k, v] of Object.entries(params)) sp.set(k, v);
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function close() {
    setOpen(false);
    setMonthGrid(false);
    setPendingStart(null);
  }

  function applyRange(start: string, end: string) {
    const [lo, hi] = start <= end ? [start, end] : [end, start];
    navigate({ de: lo, ate: hi });
    close();
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
  }, [open]);

  useEffect(() => {
    if (open) {
      setViewYm(ymOf(value.end ?? value.start ?? brtToday()));
      setPendingStart(null);
      setMonthGrid(false);
      popoverRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function onDayClick(ymd: string) {
    if (!pendingStart) {
      setPendingStart(ymd);
      return;
    }
    applyRange(pendingStart, ymd);
  }

  const grid = useMemo(() => {
    const lead = firstWeekdayOfMonth(viewYm);
    const total = daysInMonth(viewYm);
    const [y, m] = viewYm.split("-").map(Number);
    const cells: (string | null)[] = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= total; d++) cells.push(makeYmd(y, m, d));
    return cells;
  }, [viewYm]);

  // Realce: sem clique pendente, mostra o período ativo (se for intervalo real).
  const hasRange = value.preset !== "todos" && value.start != null && value.end != null;
  const selStart = pendingStart ?? (hasRange ? value.start : null);
  const selEnd = pendingStart ? null : hasRange ? value.end : null;

  function dayState(ymd: string) {
    const isStart = !!selStart && ymd === selStart;
    const isEnd = !!selEnd && ymd === selEnd;
    const inRange = !!selStart && !!selEnd && ymd > selStart && ymd < selEnd;
    return { isToday: ymd === today, isStart, isEnd, inRange };
  }

  const periodActive = value.preset === "custom";
  const viewYear = Number(viewYm.split("-")[0]);

  const shortcuts = [
    { key: "mes_atual", label: "Mês atual", params: { periodo: "mes_atual" } },
    { key: "mes_anterior", label: "Mês anterior", params: { periodo: "mes_anterior" } },
    { key: "todos", label: "Todos", params: { periodo: "todos" } },
  ] as const;

  return (
    <div ref={rootRef} className="relative">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-fg-subtle" aria-live="polite">
          Período: <span className="font-medium text-fg-muted">{value.label}</span>
        </span>

        <div
          role="group"
          aria-label="Período"
          className="inline-flex rounded-xl border border-line bg-surface p-1 shadow-card"
        >
          {shortcuts.map((o) => {
            const active = value.preset === o.key;
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => {
                  navigate(o.params);
                  close();
                }}
                aria-pressed={active}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-1 focus-visible:ring-offset-surface ${
                  active
                    ? "bg-risd text-white shadow-sm"
                    : "text-fg-muted hover:bg-surface-2 hover:text-fg"
                }`}
              >
                {o.label}
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
              width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
              strokeLinejoin="round" aria-hidden="true"
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
          className="absolute left-0 z-overlay mt-2 w-[20rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-surface p-4 shadow-pop focus:outline-none"
        >
          {/* Cabeçalho do calendário: ◀ título ▶ (título abre a grade de meses). */}
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label={monthGrid ? "Ano anterior" : "Mês anterior"}
              onClick={() =>
                monthGrid ? setViewYm(shiftMonth(viewYm, -12)) : setViewYm(shiftMonth(viewYm, -1))
              }
              className="rounded-lg border border-line bg-surface p-1.5 text-fg-muted transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setMonthGrid((v) => !v)}
              aria-expanded={monthGrid}
              className="rounded-lg px-3 py-1 text-sm font-semibold capitalize text-fg transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
            >
              {monthGrid ? viewYear : `${monthName(viewYm)} de ${viewYear}`}
            </button>
            <button
              type="button"
              aria-label={monthGrid ? "Próximo ano" : "Próximo mês"}
              onClick={() =>
                monthGrid ? setViewYm(shiftMonth(viewYm, 12)) : setViewYm(shiftMonth(viewYm, 1))
              }
              className="rounded-lg border border-line bg-surface p-1.5 text-fg-muted transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>

          {monthGrid ? (
            // Grade de meses: escolher um mês filtra o MÊS INTEIRO.
            <div className="grid grid-cols-3 gap-2">
              {MONTHS_SHORT.map((mn, i) => {
                const ym = `${viewYear}-${String(i + 1).padStart(2, "0")}`;
                const isCurrent = ym === today.slice(0, 7);
                return (
                  <button
                    key={mn}
                    type="button"
                    onClick={() => applyRange(`${ym}-01`, makeYmd(viewYear, i + 1, daysInMonth(ym)))}
                    className={`rounded-lg border px-2 py-2 text-sm font-medium capitalize transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
                      isCurrent
                        ? "border-risd font-semibold text-risd"
                        : "border-line text-fg-muted hover:border-risd/50 hover:text-fg"
                    }`}
                  >
                    {mn}
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              {pendingStart && (
                <p className="mb-2 text-xs text-fg-subtle">
                  Início em{" "}
                  <span className="font-medium text-fg-muted">{brDate(pendingStart)}</span> —
                  escolha o fim.
                </p>
              )}
              <div className="grid grid-cols-7 gap-0.5 text-center">
                {WEEKDAYS.map((w, i) => (
                  <div key={i} className="pb-1 text-[0.65rem] font-medium uppercase text-fg-subtle">
                    {w}
                  </div>
                ))}
                {grid.map((ymd, i) =>
                  ymd === null ? (
                    <div key={`b${i}`} />
                  ) : (
                    (() => {
                      const st = dayState(ymd);
                      const d = Number(ymd.slice(8, 10));
                      const base =
                        "relative flex h-9 items-center justify-center rounded-lg text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:z-10";
                      let tone: string;
                      if (st.isStart || st.isEnd) {
                        tone = "bg-risd font-bold text-white shadow-sm";
                      } else if (st.inRange) {
                        tone = "bg-brand-tint font-medium text-risd";
                      } else {
                        tone = "text-fg-muted hover:bg-surface-2 hover:text-fg";
                      }
                      const todayRing =
                        st.isToday && !st.isStart && !st.isEnd
                          ? " ring-1 ring-inset ring-risd/70 underline underline-offset-2"
                          : "";
                      return (
                        <button
                          key={ymd}
                          type="button"
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

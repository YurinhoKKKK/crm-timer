"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type DashboardPeriod,
  brtToday,
  daysInMonth,
  firstWeekdayOfMonth,
  shiftMonth,
  makeYmd,
  ymOf,
  monthName,
  brDate,
  last7Range,
  last30Range,
  thisMonthRange,
  lastMonthRange,
} from "@/lib/period";

// Seletor de período do dashboard (/admin e /admin/colaboradores/[id]).
// Visíveis: Ontem · Hoje · Tudo + botão "Período" que abre um popover com
// atalhos (Últimos 7/30 dias, Este mês, Mês passado) e um calendário próprio
// (um mês por vez; o título abre a grade de meses). Sem biblioteca de datas:
// toda a aritmética de calendário vem de lib/period.ts (datas puras AAAA-MM-DD).
// O MESMO componente serve as duas telas, sem variante.

const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];
const MONTHS_SHORT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

export default function PeriodPicker({ value }: { value: DashboardPeriod }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Mês em exibição no calendário e grade de meses (escolher o título abre-a).
  const initialYm = ymOf(value.end ?? value.start ?? brtToday());
  const [viewYm, setViewYm] = useState(initialYm);
  const [monthGrid, setMonthGrid] = useState(false);
  // 1º clique no calendário fica "pendente" como início; o 2º fecha o período.
  const [pendingStart, setPendingStart] = useState<string | null>(null);

  const today = brtToday();

  // Navega preservando parâmetros não relacionados ao período; limpa os de
  // período e aplica os novos. A validação final mora no servidor (resolve...).
  function navigate(params: Record<string, string>) {
    const sp = new URLSearchParams(searchParams?.toString());
    for (const k of ["periodo", "de", "ate", "mes"]) sp.delete(k);
    for (const [k, v] of Object.entries(params)) sp.set(k, v);
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function close() {
    setOpen(false);
    setMonthGrid(false);
    setPendingStart(null);
  }

  function applyShortcut(range: { start: string; end: string }) {
    navigate({ de: range.start, ate: range.end });
    close();
  }

  function applyCustom(start: string, end: string) {
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

  // Ao abrir, reancora o calendário no período atual e foca o popover.
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
    applyCustom(pendingStart, ymd);
  }

  // Dias do mês em exibição + preenchimento inicial (alinha a 1ª semana).
  const grid = useMemo(() => {
    const lead = firstWeekdayOfMonth(viewYm);
    const total = daysInMonth(viewYm);
    const [y, m] = viewYm.split("-").map(Number);
    const cells: (string | null)[] = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= total; d++) cells.push(makeYmd(y, m, d));
    return cells;
  }, [viewYm]);

  // Realce de seleção: enquanto não há clique pendente, mostra o período ativo
  // (se for um intervalo real de datas); com clique pendente, só o início novo.
  const selStart = pendingStart ?? (value.preset === "tudo" ? null : value.start);
  const selEnd = pendingStart ? null : value.preset === "tudo" ? null : value.end;

  function dayState(ymd: string): {
    isToday: boolean;
    isStart: boolean;
    isEnd: boolean;
    inRange: boolean;
  } {
    const isToday = ymd === today;
    const isStart = !!selStart && ymd === selStart;
    const isEnd = !!selEnd && ymd === selEnd;
    const inRange =
      !!selStart && !!selEnd && ymd > selStart && ymd < selEnd;
    return { isToday, isStart, isEnd, inRange };
  }

  const periodActive = value.preset === "custom";
  const viewYear = Number(viewYm.split("-")[0]);

  return (
    <div ref={rootRef} className="relative">
      <div className="flex flex-wrap items-center gap-2">
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
          {([
            { key: "ontem", label: "Ontem", params: { periodo: "ontem" } },
            { key: "hoje", label: "Hoje", params: { periodo: "hoje" } },
            { key: "tudo", label: "Tudo", params: { periodo: "tudo" } },
          ] as const).map((o) => {
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
          {/* Atalhos de intervalo. */}
          <div className="mb-3 grid grid-cols-2 gap-2">
            {[
              { label: "Últimos 7 dias", get: last7Range },
              { label: "Últimos 30 dias", get: last30Range },
              { label: "Este mês", get: thisMonthRange },
              { label: "Mês passado", get: lastMonthRange },
            ].map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => applyShortcut(s.get())}
                className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-fg-muted transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="mb-3 border-t border-line" />

          {/* Cabeçalho do calendário: ◀ título ▶ (título abre grade de meses). */}
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label={monthGrid ? "Ano anterior" : "Mês anterior"}
              onClick={() =>
                monthGrid
                  ? setViewYm(shiftMonth(viewYm, -12))
                  : setViewYm(shiftMonth(viewYm, -1))
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
                monthGrid
                  ? setViewYm(shiftMonth(viewYm, 12))
                  : setViewYm(shiftMonth(viewYm, 1))
              }
              className="rounded-lg border border-line bg-surface p-1.5 text-fg-muted transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>

          {monthGrid ? (
            // Grade de meses: escolher um mês seleciona o MÊS INTEIRO.
            <div className="grid grid-cols-3 gap-2">
              {MONTHS_SHORT.map((mn, i) => {
                const ym = `${viewYear}-${String(i + 1).padStart(2, "0")}`;
                const r = {
                  start: `${ym}-01`,
                  end: makeYmd(viewYear, i + 1, daysInMonth(ym)),
                };
                const isCurrent = ym === today.slice(0, 7);
                return (
                  <button
                    key={mn}
                    type="button"
                    onClick={() => applyShortcut(r)}
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
                        // Selecionado: cor cheia + peso (sinal além da cor).
                        tone = "bg-risd font-bold text-white shadow-sm";
                      } else if (st.inRange) {
                        tone = "bg-brand-tint font-medium text-risd";
                      } else {
                        tone = "text-fg-muted hover:bg-surface-2 hover:text-fg";
                      }
                      // Hoje: anel + sublinhado (sinal não-cromático), some se
                      // já estiver selecionado (que tem seu próprio destaque).
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

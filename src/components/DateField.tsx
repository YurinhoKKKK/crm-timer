"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  MONTHS_PT,
  WEEKDAYS_PT,
  addMonthsYm,
  formatPureDate,
  isValidIso,
  maskBR,
  monthMatrix,
  parseBRToIso,
  shiftIso,
  todayBRT,
  yearOptions,
  ymOfIso,
} from "@/lib/date-picker";

// Seletor de data DO PROJETO (substitui o input type="date" nativo). Fala TEXTO
// "AAAA-MM-DD" na entrada e na saída — nunca objeto Date, nunca toISOString,
// nunca fuso. Aceita digitação BR (DD/MM/AAAA) e escolha no calendário, com
// navegação rápida de mês/ano e teclado. Sem dependência nova.
//
// z-index: o popover usa z-overlay (token do passo 32.2). Nesta tela (Informações
// do cliente) não há modal, então fica acima do conteúdo da página. Se um dia for
// usado DENTRO de um modal, trocar por portal ao body (feito na etapa seguinte).

type View = { year: number; month: number };

function viewFromIso(iso: string | null): View {
  const base = iso && isValidIso(iso) ? iso : todayBRT();
  return ymOfIso(base);
}

// Em telas de TOQUE (ponteiro grosso), o picker nativo do celular (roda) é mais
// ergonômico que um calendário custom de células pequenas — então caímos para o
// <input type="date"> nativo APENAS no mobile. É seguro quanto a fuso: o valor
// do input nativo já é o texto "AAAA-MM-DD" (mesmo contrato do componente), sem
// Date nem toISOString. No desktop usamos o calendário do projeto.
//
// Começa `false` (desktop/custom) para o servidor e a primeira pintura baterem
// (sem mismatch de hidratação); o efeito ajusta após montar.
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    setCoarse(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setCoarse(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return coarse;
}

// Input de data NATIVO (fallback mobile). value/onChange em "AAAA-MM-DD".
function NativeDate({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (iso: string) => void;
  ariaLabel?: string;
}) {
  return (
    <input
      type="date"
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputBase} tabular-nums`}
    />
  );
}

// --- Calendário (grade + navegação + teclado) --------------------------------
function Calendar({
  view,
  setView,
  start,
  end,
  hover,
  setHover,
  onPick,
  autoFocus,
}: {
  view: View;
  setView: (v: View) => void;
  // Para destacar: seleção única usa start (end=null); intervalo usa os dois.
  start: string | null;
  end: string | null;
  hover: string | null;
  setHover: (iso: string | null) => void;
  onPick: (iso: string) => void;
  autoFocus: boolean;
}) {
  const today = todayBRT();
  const weeks = monthMatrix(view.year, view.month);

  // Dia "rovingtabindex": só ele é tabbable; as setas movem o foco.
  const [focusIso, setFocusIso] = useState<string>(
    () => start ?? `${view.year}-${String(view.month).padStart(2, "0")}-01`
  );
  const gridRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef(autoFocus);

  // Mantém o dia em foco dentro do mês visível.
  useEffect(() => {
    const { year, month } = ymOfIso(focusIso);
    if (year !== view.year || month !== view.month) {
      pendingFocus.current = true;
      setView({ year, month });
    }
  }, [focusIso]); // eslint-disable-line react-hooks/exhaustive-deps

  // Move o foco real para o dia em foco quando pedimos (abertura ou navegação).
  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    const el = gridRef.current?.querySelector<HTMLButtonElement>(
      `[data-iso="${focusIso}"]`
    );
    el?.focus();
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    let next: string | null = null;
    if (e.key === "ArrowLeft") next = shiftIso(focusIso, -1);
    else if (e.key === "ArrowRight") next = shiftIso(focusIso, 1);
    else if (e.key === "ArrowUp") next = shiftIso(focusIso, -7);
    else if (e.key === "ArrowDown") next = shiftIso(focusIso, 7);
    else if (e.key === "PageUp") next = shiftIso(focusIso, -28);
    else if (e.key === "PageDown") next = shiftIso(focusIso, 28);
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPick(focusIso);
      return;
    } else return;
    e.preventDefault();
    pendingFocus.current = true;
    setFocusIso(next);
  };

  const stepMonth = (delta: number) => setView(addMonthsYm(view.year, view.month, delta));

  const inRange = (iso: string) => {
    if (!start) return false;
    const rightRaw = end ?? hover;
    if (!rightRaw) return false;
    const lo = start <= rightRaw ? start : rightRaw;
    const hi = start <= rightRaw ? rightRaw : start;
    return iso >= lo && iso <= hi;
  };

  const navBtn =
    "grid h-8 w-8 place-items-center rounded-lg text-fg-muted transition hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd";
  const sel =
    "rounded-lg border border-line bg-surface px-2 py-1 text-sm text-fg shadow-sm transition focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd";

  return (
    <div>
      {/* Navegação: ‹ mês › + selects de mês e ano (salto rápido de vários anos). */}
      <div className="mb-2 flex items-center gap-1.5">
        <button type="button" onClick={() => stepMonth(-1)} className={navBtn} aria-label="Mês anterior">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <select
          aria-label="Mês"
          value={view.month}
          onChange={(e) => setView({ ...view, month: Number(e.target.value) })}
          className={`${sel} flex-1`}
        >
          {MONTHS_PT.map((n, i) => (
            <option key={i} value={i + 1}>{n}</option>
          ))}
        </select>
        <select
          aria-label="Ano"
          value={view.year}
          onChange={(e) => setView({ ...view, year: Number(e.target.value) })}
          className={sel}
        >
          {yearOptions(view.year).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <button type="button" onClick={() => stepMonth(1)} className={navBtn} aria-label="Próximo mês">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>

      {/* Cabeçalho dos dias da semana. */}
      <div className="grid grid-cols-7 gap-0.5 px-0.5 pb-1">
        {WEEKDAYS_PT.map((w, i) => (
          <div key={i} className="grid h-6 place-items-center text-[11px] font-medium text-fg-subtle" title={w.full}>
            {w.short}
          </div>
        ))}
      </div>

      {/* Grade dos dias — roving tabindex + navegação por setas. */}
      <div
        ref={gridRef}
        role="grid"
        onKeyDown={onKeyDown}
        className="grid grid-cols-7 gap-0.5"
        onMouseLeave={() => setHover(null)}
      >
        {weeks.flat().map((cell) => {
          const isStart = cell.iso === start;
          const isEnd = cell.iso === end;
          const selected = isStart || isEnd;
          const ranged = inRange(cell.iso);
          const isToday = cell.iso === today;
          const tabbable = cell.iso === focusIso;
          return (
            <button
              key={cell.iso}
              type="button"
              role="gridcell"
              data-iso={cell.iso}
              tabIndex={tabbable ? 0 : -1}
              aria-label={formatPureDate(cell.iso)}
              aria-pressed={selected}
              aria-current={isToday ? "date" : undefined}
              onClick={() => onPick(cell.iso)}
              onMouseEnter={() => setHover(cell.iso)}
              onFocus={() => setFocusIso(cell.iso)}
              className={`grid h-9 place-items-center rounded-lg text-sm tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
                selected
                  ? "bg-risd font-semibold text-white"
                  : ranged
                  ? "bg-brand-tint text-fg"
                  : cell.inMonth
                  ? "text-fg hover:bg-surface-2"
                  : "text-fg-subtle/60 hover:bg-surface-2"
              } ${
                isToday && !selected ? "ring-1 ring-inset ring-risd/50" : ""
              }`}
            >
              {cell.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// --- Popover (posicionamento + fechar fora/Esc) ------------------------------
function Popover({
  open,
  onClose,
  children,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  labelledBy?: string;
}) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={labelledBy}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className="absolute left-0 top-full z-overlay mt-2 w-[18rem] max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-3 shadow-pop"
    >
      {children}
    </div>
  );
}

// Fecha ao clicar fora do container (ref no wrapper que engloba campos+popover).
function useOutsideClose(
  open: boolean,
  ref: React.RefObject<HTMLElement>,
  onClose: () => void
) {
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, ref, onClose]);
}

const inputBase =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm transition placeholder:text-fg-subtle focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

// Campo de texto BR com máscara e commit no blur/Enter. Fala iso "AAAA-MM-DD".
function DateTextInput({
  iso,
  onCommit,
  onFocusOpen,
  placeholder = "DD/MM/AAAA",
  ariaLabel,
}: {
  iso: string | null;
  onCommit: (iso: string | null) => void;
  onFocusOpen: () => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(iso ? formatPureDate(iso) : "");
  const [bad, setBad] = useState(false);

  // Ressincroniza quando o valor externo muda (ex.: escolha no calendário).
  useEffect(() => {
    setText(iso ? formatPureDate(iso) : "");
    setBad(false);
  }, [iso]);

  const commit = () => {
    const t = text.trim();
    if (t === "") {
      setBad(false);
      onCommit(null);
      return;
    }
    const parsed = parseBRToIso(t);
    if (parsed) {
      setBad(false);
      onCommit(parsed);
    } else {
      setBad(true);
    }
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      value={text}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-invalid={bad}
      onFocusCapture={onFocusOpen}
      onChange={(e) => {
        setText(maskBR(e.target.value));
        setBad(false);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
      className={`${inputBase} tabular-nums ${bad ? "border-red-400 focus:border-red-400" : ""}`}
    />
  );
}

// ============================================================================
// DateField — data ÚNICA. value/onChange em "AAAA-MM-DD" (ou "").
// ============================================================================
export function DateField({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (iso: string) => void;
  ariaLabel?: string;
}) {
  const iso = value && isValidIso(value) ? value : null;
  const coarse = useCoarsePointer();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>(() => viewFromIso(iso));
  const [hover, setHover] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  useOutsideClose(open, wrapRef, () => setOpen(false));

  useEffect(() => {
    if (open) setView(viewFromIso(iso));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (picked: string) => {
    onChange(picked);
    setOpen(false);
  };

  // Mobile (toque): picker nativo. Desktop: calendário do projeto.
  if (coarse) {
    return <NativeDate value={value} onChange={onChange} ariaLabel={ariaLabel} />;
  }

  return (
    <div
      ref={wrapRef}
      className="relative"
      onKeyDown={(e) => {
        // Esc fecha de QUALQUER foco dentro do campo (inclusive digitando no
        // input, que não é descendente do popover).
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <div className="flex items-center gap-1.5">
        <DateTextInput
          iso={iso}
          ariaLabel={ariaLabel}
          onCommit={(v) => onChange(v ?? "")}
          onFocusOpen={() => setOpen(true)}
        />
        <CalendarToggle open={open} onToggle={() => setOpen((v) => !v)} />
      </div>
      <Popover open={open} onClose={() => setOpen(false)} labelledBy={labelId}>
        <span id={labelId} className="sr-only">Escolher data</span>
        <Calendar
          view={view}
          setView={setView}
          start={iso}
          end={null}
          hover={hover}
          setHover={setHover}
          onPick={pick}
          autoFocus
        />
      </Popover>
    </div>
  );
}

// ============================================================================
// DateRangeField — INTERVALO (início + fim). Um calendário, dois campos.
// ============================================================================
export function DateRangeField({
  startValue,
  endValue,
  onChange,
  startLabel = "Início",
  endLabel = "Término",
}: {
  startValue: string;
  endValue: string;
  // Ambos em "AAAA-MM-DD" ou "".
  onChange: (start: string, end: string) => void;
  startLabel?: string;
  endLabel?: string;
}) {
  const start = startValue && isValidIso(startValue) ? startValue : null;
  const end = endValue && isValidIso(endValue) ? endValue : null;

  const coarse = useCoarsePointer();
  const [open, setOpen] = useState(false);
  const [leg, setLeg] = useState<"start" | "end">("start");
  const [view, setView] = useState<View>(() => viewFromIso(start));
  const [hover, setHover] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  useOutsideClose(open, wrapRef, () => setOpen(false));

  const openFor = (which: "start" | "end") => {
    setLeg(which);
    setView(viewFromIso(which === "start" ? start : end ?? start));
    setOpen(true);
  };

  // Clique/Enter num dia. Primeiro define o início; o segundo, o fim (invertendo
  // se vier antes). Editar um campo específico via foco respeita a "perna" ativa.
  const pick = (iso: string) => {
    if (leg === "start" || !start || (start && end)) {
      onChange(iso, ""); // novo início zera o fim
      setLeg("end");
      setHover(null);
      return;
    }
    // leg === "end", start definido, sem fim
    if (iso >= start) {
      onChange(start, iso);
      setHover(null);
      setOpen(false);
      setLeg("start");
    } else {
      // escolheu um dia antes do início → vira o novo início
      onChange(iso, "");
      setLeg("end");
    }
  };

  // Mobile (toque): dois inputs nativos. Desktop: calendário único do projeto.
  if (coarse) {
    return (
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <div>
          <span className="mb-1 block text-xs text-fg-subtle">{startLabel}</span>
          <NativeDate
            value={startValue}
            onChange={(v) => onChange(v, endValue)}
            ariaLabel={`${startLabel} do contrato`}
          />
        </div>
        <div>
          <span className="mb-1 block text-xs text-fg-subtle">{endLabel}</span>
          <NativeDate
            value={endValue}
            onChange={(v) => onChange(startValue, v)}
            ariaLabel={`${endLabel} do contrato`}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <div>
          <span className="mb-1 block text-xs text-fg-subtle">{startLabel}</span>
          <div className="flex items-center gap-1.5">
            <DateTextInput
              iso={start}
              ariaLabel={`${startLabel} do contrato`}
              onCommit={(v) => onChange(v ?? "", endValue)}
              onFocusOpen={() => openFor("start")}
            />
            <CalendarToggle
              open={open && leg === "start"}
              onToggle={() => (open && leg === "start" ? setOpen(false) : openFor("start"))}
            />
          </div>
        </div>
        <div>
          <span className="mb-1 block text-xs text-fg-subtle">{endLabel}</span>
          <div className="flex items-center gap-1.5">
            <DateTextInput
              iso={end}
              ariaLabel={`${endLabel} do contrato`}
              onCommit={(v) => onChange(startValue, v ?? "")}
              onFocusOpen={() => openFor("end")}
            />
            <CalendarToggle
              open={open && leg === "end"}
              onToggle={() => (open && leg === "end" ? setOpen(false) : openFor("end"))}
            />
          </div>
        </div>
      </div>

      <Popover open={open} onClose={() => setOpen(false)} labelledBy={labelId}>
        <span id={labelId} className="sr-only">
          Escolher {leg === "start" ? startLabel.toLowerCase() : endLabel.toLowerCase()}
        </span>
        <p className="mb-2 text-xs text-fg-muted">
          Escolhendo:{" "}
          <strong className="font-semibold text-fg">
            {leg === "start" ? startLabel.toLowerCase() : endLabel.toLowerCase()}
          </strong>
        </p>
        <Calendar
          view={view}
          setView={setView}
          start={start}
          end={end}
          hover={hover}
          setHover={setHover}
          onPick={pick}
          autoFocus
        />
      </Popover>
    </div>
  );
}

// ============================================================================
// DateTimeField — data + hora (substitui o <input type="datetime-local">).
// value/onChange no MESMO formato do nativo: wall-clock "AAAA-MM-DDTHH:mm" (ou
// ""). A DATA usa o calendário do projeto; a HORA segue no <input type="time">
// nativo — o problema era o CALENDÁRIO desenhado pelo navegador, não o relógio,
// e o time picker é pequeno e consistente. Sem fuso: só recorta/concatena texto.
// ============================================================================
export function DateTimeField({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel?: string;
}) {
  const datePart = value.slice(0, 10);
  const timePart = value.length >= 16 ? value.slice(11, 16) : "";
  const emit = (d: string, t: string) => {
    if (!d) {
      onChange("");
      return;
    }
    onChange(`${d}T${t || "00:00"}`);
  };
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-[150px] flex-1">
        <DateField
          value={datePart}
          onChange={(d) => emit(d, timePart)}
          ariaLabel={ariaLabel}
        />
      </div>
      <input
        type="time"
        value={timePart}
        onChange={(e) => emit(datePart, e.target.value)}
        aria-label={`${ariaLabel ?? "Data"} — hora`}
        className={`${inputBase} w-28`}
      />
    </div>
  );
}

function CalendarToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="Abrir calendário"
      aria-expanded={open}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-surface text-fg-muted shadow-sm transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
    </button>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { MeetingRow } from "@/lib/meetings";
import { eventBlockStyle } from "@/lib/meeting-colors";
import { layoutDay, type Placed } from "./layout";
import {
  civilMidnightMs,
  hourLabel,
  isToday,
  minutesInDay,
  nowMinutes,
  timeLabel,
  weekdayShort,
  type Civil,
} from "./datetime";

const HOUR_PX = 48; // altura de uma hora na grade
const DAY_MIN = 24 * 60;
const MIN_EVENT_PX = 22; // eventos curtos (15–30min) continuam legíveis
const BIZ_START = 8; // faixa de horário comercial em destaque
const BIZ_END = 18;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

// Grade de horas (visão Semana com 7 dias ou Dia com 1). Horas na lateral, dias
// em colunas, faixa comercial destacada, linha da hora atual, sobreposições lado
// a lado e clique no vazio para criar.
export default function TimeGridView({
  days,
  meetings,
  colorOf,
  onEventClick,
  onSlotClick,
}: {
  days: Civil[];
  meetings: MeetingRow[];
  colorOf: (userId: string) => string;
  onEventClick: (m: MeetingRow) => void;
  onSlotClick: (day: Civil, hour: number, minute: number) => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const multi = days.length > 1;

  // Largura da barra de rolagem VERTICAL do corpo (0 em scrollbars sobrepostas,
  // ~17px no Windows). O cabeçalho NÃO rola, então precisa desse padding à
  // direita para as colunas dele baterem exatamente com as do corpo — o
  // desalinhamento clássico entre header e grade. Como o corpo tem 24h fixas,
  // ele SEMPRE transborda na vertical, então a medida é estável.
  const [scrollbarW, setScrollbarW] = useState(0);
  useEffect(() => {
    const measure = () => {
      const el = bodyRef.current;
      if (!el) return;
      const w = el.offsetWidth - el.clientWidth;
      setScrollbarW((prev) => (prev === w ? prev : w));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [multi]);

  // Rola até o horário comercial (8h) ao montar — não para a meia-noite.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = BIZ_START * HOUR_PX;
  }, []);

  // "Tick" para reposicionar a linha da hora atual (a cada minuto).
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  // Altura vem do contêiner pai via CSS var (--agenda-h), definida em Calendar a
  // partir do topo REAL da área — mesma altura para grade e painel, sem área
  // morta. h-[var] no mobile; lg:h-full preenche a linha no desktop. O max-h é só
  // teto para o primeiro paint (antes de a var existir).
  return (
    <div className="flex h-[var(--agenda-h)] max-h-[calc(100dvh-10rem)] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card lg:h-full">
      {/* Rolagem HORIZONTAL compartilhada (semana estreita): cabeçalho e corpo
          rolam juntos no eixo X; só o corpo rola no eixo Y. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-x-auto">
        <div className={`flex min-h-0 flex-1 flex-col ${multi ? "min-w-[680px]" : ""}`}>
          {/* Cabeçalho dos dias — barra sólida, não rola. paddingRight compensa a
              scrollbar vertical do corpo para as colunas alinharem. */}
          <div
            className="flex shrink-0 border-b border-line bg-surface"
            style={{ paddingRight: scrollbarW }}
          >
            <div className="w-14 shrink-0" />
            {days.map((d) => (
              <DayHeader key={`${d.y}-${d.m}-${d.d}`} day={d} single={!multi} />
            ))}
          </div>

          {/* Corpo: gutter de horas + colunas (rola na vertical) */}
          <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex" style={{ height: DAY_MIN * (HOUR_PX / 60) }}>
              <div className="w-14 shrink-0">
                {HOURS.map((h) => (
                  <div key={h} className="relative" style={{ height: HOUR_PX }}>
                    {h > 0 && (
                      <span className="absolute -top-2 right-1.5 text-[11px] tabular-nums text-fg-subtle">
                        {hourLabel(h)}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {days.map((day) => (
                <DayColumn
                  key={`${day.y}-${day.m}-${day.d}`}
                  day={day}
                  meetings={meetings}
                  colorOf={colorOf}
                  onEventClick={onEventClick}
                  onSlotClick={onSlotClick}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DayHeader({ day, single }: { day: Civil; single: boolean }) {
  const today = isToday(day);
  return (
    <div className="flex-1 px-1 py-2 text-center">
      <div className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
        {weekdayShort(day)}
      </div>
      <div
        className={`mx-auto mt-0.5 flex h-7 items-center justify-center rounded-full text-sm font-semibold ${
          today
            ? "bg-risd text-white"
            : "text-fg"
        } ${single ? "w-auto px-3" : "w-7"}`}
      >
        {day.d}
      </div>
    </div>
  );
}

function DayColumn({
  day,
  meetings,
  colorOf,
  onEventClick,
  onSlotClick,
}: {
  day: Civil;
  meetings: MeetingRow[];
  colorOf: (userId: string) => string;
  onEventClick: (m: MeetingRow) => void;
  onSlotClick: (day: Civil, hour: number, minute: number) => void;
}) {
  const dayStart = civilMidnightMs(day);
  const dayEnd = dayStart + DAY_MIN * 60000;

  // Eventos que tocam este dia, clampados à janela [0, 1440).
  const placed = layoutDay(
    meetings
      .filter((m) => {
        const s = new Date(m.startsAt).getTime();
        const e = new Date(m.endsAt).getTime();
        return s < dayEnd && e > dayStart;
      })
      .map((m) => ({
        item: m,
        startMin: Math.max(0, minutesInDay(m.startsAt, day)),
        endMin: Math.min(DAY_MIN, minutesInDay(m.endsAt, day)),
      }))
  );

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const raw = (y / HOUR_PX) * 60;
    const snapped = Math.max(0, Math.min(DAY_MIN - 30, Math.floor(raw / 30) * 30));
    onSlotClick(day, Math.floor(snapped / 60), snapped % 60);
  }

  return (
    <div
      className="relative flex-1 border-l border-line"
      style={{ height: DAY_MIN * (HOUR_PX / 60) }}
      onClick={handleClick}
    >
      {/* Faixa de horário comercial em destaque */}
      <div
        className="pointer-events-none absolute inset-x-0 bg-brand-tint/40 dark:bg-brand-tint/10"
        style={{ top: BIZ_START * HOUR_PX, height: (BIZ_END - BIZ_START) * HOUR_PX }}
      />
      {/* Linhas de hora */}
      {HOURS.map((h) => (
        <div
          key={h}
          className="pointer-events-none absolute inset-x-0 border-t border-line/60"
          style={{ top: h * HOUR_PX }}
        />
      ))}
      {/* Linhas de meia-hora (mais fracas) — deixam VISÍVEL a granularidade de
          30 min do clique, como no Google; sem elas a grade "parece" só de horas. */}
      {HOURS.map((h) => (
        <div
          key={`half-${h}`}
          className="pointer-events-none absolute inset-x-0 border-t border-line/25"
          style={{ top: h * HOUR_PX + HOUR_PX / 2 }}
        />
      ))}

      {/* Linha da hora atual (só hoje) */}
      {isToday(day) && <NowLine />}

      {/* Eventos */}
      {placed.map((p) => (
        <EventBlock
          key={p.item.id}
          placed={p}
          color={colorOf(p.item.creator.id)}
          onClick={(ev) => {
            ev.stopPropagation();
            onEventClick(p.item);
          }}
        />
      ))}
    </div>
  );
}

function NowLine() {
  const top = (nowMinutes() / 60) * HOUR_PX;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
      style={{ top }}
    >
      <span className="-ml-1 h-2.5 w-2.5 rounded-full bg-red-500" />
      <span className="h-px flex-1 bg-red-500" />
    </div>
  );
}

function EventBlock({
  placed,
  color,
  onClick,
}: {
  placed: Placed<MeetingRow>;
  color: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  const m = placed.item;
  const top = (placed.startMin / 60) * HOUR_PX;
  const height = Math.max(
    MIN_EVENT_PX,
    ((placed.endMin - placed.startMin) / 60) * HOUR_PX
  );
  const widthPct = 100 / placed.cols;
  const compact = height < 34;

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${m.title} · ${timeLabel(m.startsAt)}–${timeLabel(m.endsAt)}`}
      style={{
        position: "absolute",
        top,
        height: height - 2,
        left: `calc(${placed.col * widthPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
        ...eventBlockStyle(color),
      }}
      className="z-10 flex flex-col overflow-hidden rounded-md px-1.5 py-0.5 text-left text-fg transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd dark:hover:brightness-110"
    >
      <span className="truncate text-[11px] font-semibold leading-tight">
        {m.title}
      </span>
      {!compact && (
        <span className="truncate text-[10px] leading-tight text-fg-muted">
          {timeLabel(m.startsAt)}–{timeLabel(m.endsAt)}
        </span>
      )}
    </button>
  );
}

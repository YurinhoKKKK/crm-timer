"use client";

import { isImported, type GridItem } from "@/lib/meetings";
import { personColor } from "@/lib/meeting-colors";
import {
  addDays,
  civilKey,
  civilMidnightMs,
  isToday,
  timeLabel,
  weekStart,
  type Civil,
} from "./datetime";

const WEEKDAY_HEADERS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const CAP = 3; // eventos visíveis por célula antes do "+N mais"

// Visão de Mês: 6 semanas × 7 dias (domingo→sábado), eventos compactos por
// célula e "+N mais" quando não couber. Mostra reuniões do sistema E eventos
// importados do Google (estes com marcador vazado/tracejado e "Ocupado" quando
// particulares de terceiros). Dia clicado → visão de Dia; clique no vazio da
// célula → criar naquele dia.
export default function MonthView({
  anchorMonth,
  items,
  onEventClick,
  onDayClick,
  onCreateDay,
}: {
  anchorMonth: Civil;
  items: GridItem[];
  onEventClick: (item: GridItem) => void;
  onDayClick: (day: Civil) => void;
  onCreateDay: (day: Civil) => void;
}) {
  const gridStart = weekStart({ y: anchorMonth.y, m: anchorMonth.m, d: 1 });
  const days: Civil[] = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <div className="grid grid-cols-7 border-b border-line">
        {WEEKDAY_HEADERS.map((w) => (
          <div
            key={w}
            className="px-2 py-2 text-center text-[11px] font-medium uppercase tracking-wide text-fg-subtle"
          >
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day, i) => (
          <MonthCell
            key={civilKey(day)}
            day={day}
            inMonth={day.m === anchorMonth.m}
            lastRow={i >= 35}
            lastCol={(i + 1) % 7 === 0}
            items={items}
            onEventClick={onEventClick}
            onDayClick={onDayClick}
            onCreateDay={onCreateDay}
          />
        ))}
      </div>
    </div>
  );
}

function MonthCell({
  day,
  inMonth,
  lastRow,
  lastCol,
  items,
  onEventClick,
  onDayClick,
  onCreateDay,
}: {
  day: Civil;
  inMonth: boolean;
  lastRow: boolean;
  lastCol: boolean;
  items: GridItem[];
  onEventClick: (item: GridItem) => void;
  onDayClick: (day: Civil) => void;
  onCreateDay: (day: Civil) => void;
}) {
  const dayStart = civilMidnightMs(day);
  const dayEnd = dayStart + 24 * 60 * 60000;
  const dayItems = items
    .filter((m) => {
      const s = new Date(m.startsAt).getTime();
      const e = new Date(m.endsAt).getTime();
      return s < dayEnd && e > dayStart;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const shown = dayItems.slice(0, CAP);
  const extra = dayItems.length - shown.length;
  const today = isToday(day);

  return (
    <div
      onClick={() => onCreateDay(day)}
      className={`min-h-[104px] cursor-pointer p-1.5 transition hover:bg-surface-2/50 ${
        lastCol ? "" : "border-r"
      } ${lastRow ? "" : "border-b"} border-line ${
        inMonth ? "" : "bg-surface-2/30"
      }`}
    >
      <div className="mb-1 flex justify-end">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDayClick(day);
          }}
          className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
            today
              ? "bg-risd text-white"
              : inMonth
              ? "text-fg hover:bg-surface-2"
              : "text-fg-subtle hover:bg-surface-2"
          }`}
        >
          {day.d}
        </button>
      </div>

      <div className="space-y-1">
        {shown.map((m) => {
          const imported = isImported(m);
          const color = personColor(imported ? m.ownerId : m.creator.id);
          const label = imported ? m.title ?? "Ocupado" : m.title;
          return (
            <button
              key={m.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEventClick(m);
              }}
              title={`${label} · ${timeLabel(m.startsAt)}${
                imported ? " — Google, somente leitura" : ""
              }`}
              className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  imported ? "border" : ""
                }`}
                style={
                  imported
                    ? { borderColor: color, backgroundColor: "transparent" }
                    : { backgroundColor: color }
                }
              />
              <span
                className={`truncate text-[11px] ${
                  imported ? "text-fg-muted" : "text-fg"
                }`}
              >
                <span className="tabular-nums text-fg-subtle">
                  {timeLabel(m.startsAt)}
                </span>{" "}
                {label}
              </span>
            </button>
          );
        })}
        {extra > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDayClick(day);
            }}
            className="w-full rounded px-1 py-0.5 text-left text-[11px] font-medium text-fg-muted transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
          >
            +{extra} mais
          </button>
        )}
      </div>
    </div>
  );
}

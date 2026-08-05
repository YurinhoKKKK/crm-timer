"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  isImported,
  type GridItem,
  type ImportedEventRow,
  type MeetingRow,
} from "@/lib/meetings";
import { eventBlockStyle, importedBlockStyle } from "@/lib/meeting-colors";
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

// Arrastar para reagendar
const SNAP_MIN = 15; // nada de horários quebrados tipo 13:07
const DRAG_THRESHOLD = 5; // px para virar arrasto (senão é clique-para-criar/abrir)

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const snapMin = (v: number) => Math.round(v / SNAP_MIN) * SNAP_MIN;
const pad2 = (n: number) => String(n).padStart(2, "0");
const fmtMin = (min: number) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;

// Estado bruto do arrasto (ref mutável, não dispara render).
type PendingDrag = {
  meeting: MeetingRow;
  mode: "move" | "resize";
  dayIndex: number;
  colWidth: number;
  startX: number;
  startY: number;
  originStartMin: number;
  originEndMin: number;
  isOwn: boolean;
  active: boolean;
};

// Estado visível do arrasto (fantasma + original esmaecido).
type DragView = {
  meetingId: string;
  mode: "move" | "resize";
  dayIndex: number;
  startMin: number;
  endMin: number;
};

// Onde o arrasto leva a reunião (dia + minutos), a partir do ponteiro.
function computeTarget(
  d: PendingDrag,
  clientX: number,
  clientY: number,
  daysLen: number
): { dayIndex: number; startMin: number; endMin: number } {
  const dyMin = (clientY - d.startY) * (60 / HOUR_PX);
  const dx = clientX - d.startX;
  const duration = d.originEndMin - d.originStartMin;
  let dayIndex = d.dayIndex;
  let startMin: number;
  let endMin: number;
  if (d.mode === "move") {
    startMin = clamp(snapMin(d.originStartMin + dyMin), 0, DAY_MIN - duration);
    endMin = startMin + duration;
    if (daysLen > 1 && d.colWidth > 0) {
      dayIndex = clamp(d.dayIndex + Math.round(dx / d.colWidth), 0, daysLen - 1);
    }
  } else {
    startMin = d.originStartMin;
    endMin = clamp(snapMin(d.originEndMin + dyMin), startMin + SNAP_MIN, DAY_MIN);
  }
  return { dayIndex, startMin, endMin };
}

// Grade de horas (visão Semana com 7 dias ou Dia com 1). Horas na lateral, dias
// em colunas, faixa comercial destacada, linha da hora atual, sobreposições lado
// a lado, clique no vazio para criar e ARRASTAR as próprias reuniões para
// reagendar (mover) ou puxar a borda para mudar a duração (redimensionar).
export default function TimeGridView({
  days,
  items,
  colorOf,
  currentUserId,
  nameById,
  onEventClick,
  onSlotClick,
  onReschedule,
}: {
  days: Civil[];
  items: GridItem[];
  colorOf: (userId: string) => string;
  currentUserId: string;
  // Nome por id — para rótulo/tooltip dos eventos importados ("agenda de X").
  nameById: Map<string, string>;
  onEventClick: (item: GridItem) => void;
  onSlotClick: (day: Civil, hour: number, minute: number) => void;
  // Soltar um arrasto: o pai confere conflito e grava (banco → Google), com
  // feedback otimista e reversão. Recebe o novo intervalo em ISO (UTC). Só as
  // reuniões DO SISTEMA arrastam — importados são somente-leitura.
  onReschedule: (m: MeetingRow, startISO: string, endISO: string) => void;
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

  // ---- Arrastar para reagendar ---------------------------------------------
  const [drag, setDrag] = useState<DragView | null>(null);
  const dragRef = useRef<PendingDrag | null>(null);
  // Um arrasto acabou de acontecer: engole o "click" seguinte para não abrir o
  // detalhe nem criar no vazio.
  const justDraggedRef = useRef(false);
  const [blockedHint, setBlockedHint] = useState<string | null>(null);

  // Listeners no window (montados uma vez) leem o dragRef mutável — assim o
  // arrasto continua mesmo se o ponteiro sair do bloco. Só o botão esquerdo.
  useEffect(() => {
    function endDrag() {
      dragRef.current = null;
      setDrag(null);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      if (justDraggedRef.current) {
        window.setTimeout(() => {
          justDraggedRef.current = false;
        }, 0);
      }
    }
    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      if (!d.active) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD)
          return;
        d.active = true;
        justDraggedRef.current = true;
        if (!d.isOwn) {
          // Tentativa de arrastar reunião de outra pessoa: explica o porquê.
          setBlockedHint(d.meeting.creator.name);
          window.setTimeout(() => setBlockedHint(null), 2600);
          endDrag();
          return;
        }
        document.body.style.userSelect = "none";
        document.body.style.cursor = d.mode === "resize" ? "ns-resize" : "grabbing";
      }
      setDrag({
        meetingId: d.meeting.id,
        mode: d.mode,
        ...computeTarget(d, e.clientX, e.clientY, days.length),
      });
    }
    function onUp(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      const settle = d.active && d.isOwn;
      const t = settle ? computeTarget(d, e.clientX, e.clientY, days.length) : null;
      endDrag();
      if (!t) return;
      const changed =
        t.dayIndex !== d.dayIndex ||
        t.startMin !== d.originStartMin ||
        t.endMin !== d.originEndMin;
      if (!changed) return;
      const day = days[t.dayIndex];
      const startISO = new Date(civilMidnightMs(day) + t.startMin * 60000).toISOString();
      const endISO = new Date(civilMidnightMs(day) + t.endMin * 60000).toISOString();
      onReschedule(d.meeting, startISO, endISO);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [days, onReschedule]);

  const beginDrag = useCallback(
    (
      e: React.PointerEvent,
      meeting: MeetingRow,
      dayIndex: number,
      mode: "move" | "resize"
    ) => {
      if (e.button !== 0) return; // só botão esquerdo
      const colEl = (e.currentTarget as HTMLElement).closest(
        "[data-col]"
      ) as HTMLElement | null;
      const colWidth = colEl ? colEl.getBoundingClientRect().width : 0;
      const day = days[dayIndex];
      dragRef.current = {
        meeting,
        mode,
        dayIndex,
        colWidth,
        startX: e.clientX,
        startY: e.clientY,
        originStartMin: clamp(minutesInDay(meeting.startsAt, day), 0, DAY_MIN),
        originEndMin: clamp(minutesInDay(meeting.endsAt, day), 0, DAY_MIN),
        isOwn: meeting.creator.id === currentUserId,
        active: false,
      };
    },
    [days, currentUserId]
  );

  // Altura vem do contêiner pai via CSS var (--agenda-h), definida em Calendar a
  // partir do topo REAL da área — mesma altura para grade e painel, sem área
  // morta. h-[var] no mobile; lg:h-full preenche a linha no desktop. O max-h é só
  // teto para o primeiro paint (antes de a var existir).
  return (
    <div className="relative flex h-[var(--agenda-h)] max-h-[calc(100dvh-10rem)] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card lg:h-full">
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

              {days.map((day, dayIndex) => (
                <DayColumn
                  key={`${day.y}-${day.m}-${day.d}`}
                  day={day}
                  dayIndex={dayIndex}
                  items={items}
                  colorOf={colorOf}
                  currentUserId={currentUserId}
                  nameById={nameById}
                  drag={drag}
                  justDraggedRef={justDraggedRef}
                  onBeginDrag={beginDrag}
                  onEventClick={onEventClick}
                  onSlotClick={onSlotClick}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Aviso ao tentar arrastar reunião de outra pessoa */}
      {blockedHint && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-toast flex justify-center px-4">
          <div className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 shadow-pop dark:border-amber-500/30 dark:bg-amber-950 dark:text-amber-200">
            Só {blockedHint} (quem criou) pode reagendar esta reunião.
          </div>
        </div>
      )}
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
          today ? "bg-risd text-white" : "text-fg"
        } ${single ? "w-auto px-3" : "w-7"}`}
      >
        {day.d}
      </div>
    </div>
  );
}

function DayColumn({
  day,
  dayIndex,
  items,
  colorOf,
  currentUserId,
  nameById,
  drag,
  justDraggedRef,
  onBeginDrag,
  onEventClick,
  onSlotClick,
}: {
  day: Civil;
  dayIndex: number;
  items: GridItem[];
  colorOf: (userId: string) => string;
  currentUserId: string;
  nameById: Map<string, string>;
  drag: DragView | null;
  justDraggedRef: React.MutableRefObject<boolean>;
  onBeginDrag: (
    e: React.PointerEvent,
    m: MeetingRow,
    dayIndex: number,
    mode: "move" | "resize"
  ) => void;
  onEventClick: (item: GridItem) => void;
  onSlotClick: (day: Civil, hour: number, minute: number) => void;
}) {
  const dayStart = civilMidnightMs(day);
  const dayEnd = dayStart + DAY_MIN * 60000;

  // Eventos que tocam este dia, clampados à janela [0, 1440). Reuniões do sistema
  // e importados dividem a MESMA coluna: quando se sobrepõem, ficam lado a lado —
  // o que torna o conflito com a agenda do Google visível na própria grade.
  const placed = layoutDay(
    items
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
    if (justDraggedRef.current) return; // acabou de arrastar: não cria
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const raw = (y / HOUR_PX) * 60;
    const snapped = Math.max(0, Math.min(DAY_MIN - 30, Math.floor(raw / 30) * 30));
    onSlotClick(day, Math.floor(snapped / 60), snapped % 60);
  }

  return (
    <div
      data-col={dayIndex}
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

      {/* Eventos — reuniões do sistema (arrastáveis) e importados (só-leitura) */}
      {placed.map((p) =>
        isImported(p.item) ? (
          <ImportedBlock
            key={p.item.id}
            placed={p as Placed<ImportedEventRow>}
            color={colorOf(p.item.ownerId)}
            ownerName={nameById.get(p.item.ownerId) ?? "colega"}
            isOwn={p.item.ownerId === currentUserId}
            onClick={(ev) => {
              ev.stopPropagation();
              onEventClick(p.item);
            }}
          />
        ) : (
          <EventBlock
            key={p.item.id}
            placed={p as Placed<MeetingRow>}
            color={colorOf(p.item.creator.id)}
            isOwn={p.item.creator.id === currentUserId}
            dimmed={drag?.meetingId === p.item.id}
            onMovePointerDown={(e) =>
              onBeginDrag(e, p.item as MeetingRow, dayIndex, "move")
            }
            onResizePointerDown={(e) => {
              e.stopPropagation();
              onBeginDrag(e, p.item as MeetingRow, dayIndex, "resize");
            }}
            onClick={(ev) => {
              ev.stopPropagation();
              if (justDraggedRef.current) return; // acabou de arrastar: não abre
              onEventClick(p.item);
            }}
          />
        )
      )}

      {/* Fantasma do arrasto (posição destino) */}
      {drag && drag.dayIndex === dayIndex && (
        <GhostBlock startMin={drag.startMin} endMin={drag.endMin} />
      )}
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

// Bloco translúcido que segue o arrasto, mostrando o novo horário.
function GhostBlock({ startMin, endMin }: { startMin: number; endMin: number }) {
  const top = (startMin / 60) * HOUR_PX;
  const height = Math.max(MIN_EVENT_PX, ((endMin - startMin) / 60) * HOUR_PX);
  return (
    <div
      className="pointer-events-none absolute inset-x-0.5 z-30 flex flex-col justify-center overflow-hidden rounded-md border-2 border-dashed border-risd bg-brand-tint/80 px-1.5 py-0.5 text-fg shadow-pop dark:bg-brand-tint/50"
      style={{ top, height: height - 2 }}
    >
      <span className="truncate text-[11px] font-semibold tabular-nums">
        {fmtMin(startMin)}–{fmtMin(endMin)}
      </span>
    </div>
  );
}

function EventBlock({
  placed,
  color,
  isOwn,
  dimmed,
  onMovePointerDown,
  onResizePointerDown,
  onClick,
}: {
  placed: Placed<MeetingRow>;
  color: string;
  isOwn: boolean;
  dimmed: boolean;
  onMovePointerDown: (e: React.PointerEvent) => void;
  onResizePointerDown: (e: React.PointerEvent) => void;
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
  const roomToResize = isOwn && height >= 30;

  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={onMovePointerDown}
      title={
        isOwn
          ? `${m.title} · ${timeLabel(m.startsAt)}–${timeLabel(m.endsAt)} — arraste para mover${
              roomToResize ? "; puxe a borda de baixo para mudar a duração" : ""
            }`
          : `${m.title} · ${timeLabel(m.startsAt)}–${timeLabel(m.endsAt)} — só ${m.creator.name} pode reagendar`
      }
      style={{
        position: "absolute",
        top,
        height: height - 2,
        left: `calc(${placed.col * widthPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
        cursor: isOwn ? "grab" : "pointer",
        touchAction: isOwn ? "none" : undefined,
        opacity: dimmed ? 0.4 : 1,
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

      {/* Alça de redimensionar (borda de baixo) — só nas próprias, se houver
          altura. stopPropagation evita disparar o "mover". */}
      {roomToResize && (
        <span
          onPointerDown={onResizePointerDown}
          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
          aria-hidden="true"
        />
      )}
    </button>
  );
}

// Evento IMPORTADO do Google: hachurado, tracejado e SEM arrasto/alça — deixa
// claro que veio do Google e não se edita por aqui. Título particular de outro
// aparece como "Ocupado" (o banco não enviou o título). Clicável para um detalhe
// somente-leitura.
function ImportedBlock({
  placed,
  color,
  ownerName,
  isOwn,
  onClick,
}: {
  placed: Placed<ImportedEventRow>;
  color: string;
  ownerName: string;
  isOwn: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const ev = placed.item;
  const top = (placed.startMin / 60) * HOUR_PX;
  const height = Math.max(
    MIN_EVENT_PX,
    ((placed.endMin - placed.startMin) / 60) * HOUR_PX
  );
  const widthPct = 100 / placed.cols;
  const compact = height < 34;
  // Título: o dono sempre vê o próprio; de outro, "Ocupado" quando particular.
  const label = ev.title ?? "Ocupado";
  const whose = isOwn ? "sua agenda do Google" : `agenda de ${ownerName} (Google)`;

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} · ${timeLabel(ev.startsAt)}–${timeLabel(
        ev.endsAt
      )} — ${whose}, somente leitura`}
      style={{
        position: "absolute",
        top,
        height: height - 2,
        left: `calc(${placed.col * widthPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
        cursor: "pointer",
        ...importedBlockStyle(color),
      }}
      className="z-10 flex flex-col overflow-hidden rounded-md px-1.5 py-0.5 text-left text-fg-muted transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd dark:hover:brightness-110"
    >
      <span className="flex items-center gap-1 truncate text-[11px] font-medium leading-tight">
        <GoogleGlyph />
        <span className="truncate">{label}</span>
      </span>
      {!compact && (
        <span className="truncate text-[10px] leading-tight text-fg-subtle">
          {timeLabel(ev.startsAt)}–{timeLabel(ev.endsAt)}
        </span>
      )}
    </button>
  );
}

// "G" discreto para marcar origem Google no bloco importado.
function GoogleGlyph() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="shrink-0 opacity-70"
    >
      <path d="M12 11v2.6h4.3c-.2 1-1.3 3-4.3 3a4.6 4.6 0 0 1 0-9.2c1.3 0 2.3.5 2.9 1l2-1.9A7.6 7.6 0 1 0 12 19.6c4.4 0 7.3-3.1 7.3-7.4 0-.5 0-.9-.1-1.2H12z" />
    </svg>
  );
}

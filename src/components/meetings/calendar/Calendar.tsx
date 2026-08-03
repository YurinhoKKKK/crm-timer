"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "@/components/Modal";
import MeetingForm from "@/components/meetings/MeetingForm";
import MeetingCard from "@/components/meetings/MeetingCard";
import ResultBanner from "@/components/meetings/ResultBanner";
import CalendarToolbar, { type CalendarView } from "./CalendarToolbar";
import PeopleSidebar from "./PeopleSidebar";
import TimeGridView from "./TimeGridView";
import MonthView from "./MonthView";
import { fetchMeetingsRange } from "@/app/meeting-actions";
import { personColor } from "@/lib/meeting-colors";
import type {
  DirectoryUser,
  MeetingActionsContext,
  MeetingRow,
  ReachableCompany,
} from "@/lib/meetings";
import {
  addDays,
  addMonths,
  civilKey,
  civilMidnightMs,
  civilTimeToISO,
  longDayLabel,
  monthLabel,
  todayCivil,
  weekRangeLabel,
  weekStart,
  type Civil,
} from "./datetime";

const DAY_MS = 24 * 60 * 60000;

// Dias visíveis conforme a visão.
function visibleDays(view: CalendarView, anchor: Civil): Civil[] {
  if (view === "day") return [anchor];
  if (view === "week") {
    const s = weekStart(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(s, i));
  }
  const s = weekStart({ y: anchor.y, m: anchor.m, d: 1 });
  return Array.from({ length: 42 }, (_, i) => addDays(s, i));
}

// Intervalo a buscar + chave de cache (normalizada por visão).
function rangeOf(view: CalendarView, anchor: Civil) {
  const days = visibleDays(view, anchor);
  const from = civilMidnightMs(days[0]);
  const to = civilMidnightMs(days[days.length - 1]) + DAY_MS;
  const key =
    view === "day"
      ? `d:${civilKey(anchor)}`
      : view === "week"
      ? `w:${civilKey(weekStart(anchor))}`
      : `m:${anchor.y}-${anchor.m}`;
  return { fromISO: new Date(from).toISOString(), toISO: new Date(to).toISOString(), key };
}

function shiftAnchor(view: CalendarView, anchor: Civil, dir: 1 | -1): Civil {
  if (view === "day") return addDays(anchor, dir);
  if (view === "week") return addDays(anchor, 7 * dir);
  return addMonths(anchor, dir);
}

type Draft = { startISO?: string; endISO?: string };

// Calendário da /agenda — visões Dia/Semana/Mês no espírito do Google Calendar,
// com filtro de pessoas por cor. Busca só o intervalo visível (+ vizinhos, para
// navegação instantânea) e reaproveita o formulário e o cartão de reunião.
export default function Calendar({
  currentUserId,
  isAdmin,
  googleConnected,
  directory,
  companies,
  initialMeetings,
}: {
  currentUserId: string;
  isAdmin: boolean;
  googleConnected: boolean;
  directory: DirectoryUser[];
  companies: ReachableCompany[];
  initialMeetings: MeetingRow[];
}) {
  const today = todayCivil();
  const initialKey = `w:${civilKey(weekStart(today))}`;

  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState<Civil>(today);
  const [selected, setSelected] = useState<Set<string>>(new Set([currentUserId]));
  const [cache, setCache] = useState<Map<string, MeetingRow[]>>(
    () => new Map([[initialKey, initialMeetings]])
  );
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [createDraft, setCreateDraft] = useState<Draft | null>(null);
  const [detail, setDetail] = useState<MeetingRow | null>(null);
  const [result, setResult] = useState<{ warning: string | null; successText: string } | null>(null);

  // Mobile: a grade de semana não cabe — abre em Dia. Só no primeiro render.
  useEffect(() => {
    if (window.matchMedia("(max-width: 640px)").matches) setView("day");
  }, []);

  const { fromISO, toISO, key } = useMemo(() => rangeOf(view, anchor), [view, anchor]);

  // Busca do intervalo visível (cache-first). Erros classificados; a base inteira
  // nunca é buscada.
  useEffect(() => {
    if (cache.has(key)) {
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchMeetingsRange(fromISO, toISO)
      .then((rows) => {
        if (cancelled) return;
        setCache((prev) => new Map(prev).set(key, rows));
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Não foi possível carregar as reuniões deste período.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key, fromISO, toISO, cache, reload]);

  // Pré-busca vizinhos (anterior/próximo) para a navegação ser instantânea.
  useEffect(() => {
    for (const dir of [-1, 1] as const) {
      const r = rangeOf(view, shiftAnchor(view, anchor, dir));
      if (cache.has(r.key)) continue;
      fetchMeetingsRange(r.fromISO, r.toISO)
        .then((rows) =>
          setCache((prev) => (prev.has(r.key) ? prev : new Map(prev).set(r.key, rows)))
        )
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const rows = cache.get(key) ?? [];
  // Filtro de pessoas: a reunião aparece se alguma pessoa LIGADA é criadora ou
  // participante (decisão: todos os internos podem ver as reuniões uns dos outros).
  const visible = useMemo(
    () =>
      rows.filter(
        (m) =>
          selected.has(m.creator.id) ||
          m.participants.some((p) => selected.has(p.id))
      ),
    [rows, selected]
  );

  const ctx: MeetingActionsContext = {
    currentUserId,
    isAdmin,
    googleConnected,
    directory,
    companies,
  };

  const label =
    view === "day"
      ? longDayLabel(anchor)
      : view === "week"
      ? weekRangeLabel(weekStart(anchor))
      : monthLabel(anchor);

  const invalidate = useCallback(() => {
    setCache(new Map());
    setReload((n) => n + 1);
  }, []);

  function handleResult(warning: string | null, successText: string) {
    setResult({ warning, successText });
    setDetail(null);
    setCreateDraft(null);
    invalidate();
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openSlot = (day: Civil, hour: number, minute: number) => {
    const start = civilTimeToISO(day, hour, minute);
    const end = new Date(new Date(start).getTime() + 3600 * 1000).toISOString();
    setCreateDraft({ startISO: start, endISO: end });
  };
  const openCreateDay = (day: Civil) => openSlot(day, 9, 0);

  return (
    <div>
      {result && (
        <ResultBanner
          warning={result.warning}
          successText={result.successText}
          onClose={() => setResult(null)}
        />
      )}

      <CalendarToolbar
        view={view}
        label={label}
        onView={setView}
        onToday={() => setAnchor(todayCivil())}
        onPrev={() => setAnchor((a) => shiftAnchor(view, a, -1))}
        onNext={() => setAnchor((a) => shiftAnchor(view, a, 1))}
        onCreate={() => setCreateDraft({})}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
      />

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className={`${sidebarOpen ? "block" : "hidden"} lg:block`}>
          <PeopleSidebar
            people={directory}
            selected={selected}
            currentUserId={currentUserId}
            onToggle={toggle}
            onOnlyMe={() => setSelected(new Set([currentUserId]))}
          />
        </div>

        <div className="min-w-0 flex-1">
          {error ? (
            <div className="rounded-2xl border border-red-300/60 bg-red-50 p-8 text-center text-sm text-red-700 shadow-card dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              <p>{error}</p>
              <button
                type="button"
                onClick={invalidate}
                className="mt-3 rounded-lg border border-red-300/60 px-3 py-1.5 text-xs font-medium transition hover:bg-red-100/50 dark:hover:bg-red-500/10"
              >
                Tentar de novo
              </button>
            </div>
          ) : loading && !cache.has(key) ? (
            <div className="flex h-64 items-center justify-center rounded-2xl border border-line bg-surface text-sm text-fg-subtle shadow-card">
              Carregando reuniões…
            </div>
          ) : (
            <>
              {visible.length === 0 && (
                <p className="mb-2 text-xs text-fg-subtle">
                  Nenhuma reunião das agendas selecionadas neste período.
                </p>
              )}
              {view === "month" ? (
                <MonthView
                  anchorMonth={anchor}
                  meetings={visible}
                  onEventClick={setDetail}
                  onDayClick={(d) => {
                    setAnchor(d);
                    setView("day");
                  }}
                  onCreateDay={openCreateDay}
                />
              ) : (
                <TimeGridView
                  days={visibleDays(view, anchor)}
                  meetings={visible}
                  colorOf={personColor}
                  onEventClick={setDetail}
                  onSlotClick={openSlot}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Criar (botão ou clique no vazio) */}
      <Modal
        open={createDraft !== null}
        onClose={() => setCreateDraft(null)}
        maxWidth="max-w-lg"
      >
        {createDraft !== null && (
          <MeetingForm
            key={`create-${createDraft.startISO ?? "new"}`}
            mode="create"
            bare
            directory={directory}
            companies={companies}
            prefillStartISO={createDraft.startISO}
            prefillEndISO={createDraft.endISO}
            onDone={(warning) =>
              handleResult(
                warning,
                "Reunião criada e adicionada à sua agenda do Google."
              )
            }
            onCancel={() => setCreateDraft(null)}
          />
        )}
      </Modal>

      {/* Detalhe do evento (com as ações da fatia 1.1) */}
      <Modal open={detail !== null} onClose={() => setDetail(null)} maxWidth="max-w-xl">
        {detail !== null && (
          <MeetingCard
            key={detail.id}
            meeting={detail}
            showCompany
            ctx={ctx}
            onResult={handleResult}
          />
        )}
      </Modal>
    </div>
  );
}

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import Modal from "@/components/Modal";
import MeetingForm from "@/components/meetings/MeetingForm";
import MeetingCard, {
  type ResponsesPatch,
} from "@/components/meetings/MeetingCard";
import ResultBanner from "@/components/meetings/ResultBanner";
import CalendarToolbar, { type CalendarView } from "./CalendarToolbar";
import PeopleSidebar from "./PeopleSidebar";
import TimeGridView from "./TimeGridView";
import MonthView from "./MonthView";
import {
  fetchMeetingsRange,
  updateMeeting,
  checkMeetingConflicts,
  type ConflictRow,
} from "@/app/meeting-actions";
import { syncMyGoogleCalendar } from "@/app/google-import-actions";
import { personColor } from "@/lib/meeting-colors";
import { describeConflict, formatMeetingRange, isImported } from "@/lib/meetings";
import { btnPrimary, btnSecondary } from "@/lib/ui";
import type {
  DirectoryUser,
  GridItem,
  MeetingActionsContext,
  MeetingRow,
  ReachableCompany,
} from "@/lib/meetings";
import ImportedEventDetail from "./ImportedEventDetail";
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
// Ao abrir a agenda, se a última sincronização com o Google for mais velha que
// isto, dispara um sync em segundo plano (sem travar a tela).
const SYNC_STALE_MS = 10 * 60 * 1000;
const SIDEBAR_PREF_KEY = "agenda:sidebar"; // preferência de recolher no desktop
const BOTTOM_GAP = 24; // respiro até a base da viewport (pb-6 do <main>)
const MIN_AREA_PX = 360; // piso de altura em telas muito baixas

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

// Move otimista de UMA reunião dentro do período visível. Arrastar nunca cruza a
// chave (mesma semana/dia), então basta atualizar as linhas da chave atual. Só
// reuniões do sistema arrastam; importados ficam intocados.
function moveInKey(
  map: Map<string, GridItem[]>,
  key: string,
  id: string,
  startISO: string,
  endISO: string
): Map<string, GridItem[]> {
  const rows = map.get(key);
  if (!rows) return map;
  const next = rows.map((r) =>
    r.id === id ? { ...r, startsAt: startISO, endsAt: endISO } : r
  );
  return new Map(map).set(key, next);
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
  managedCompanyIds,
  initialItems,
  initialLastSync,
}: {
  currentUserId: string;
  isAdmin: boolean;
  googleConnected: boolean;
  directory: DirectoryUser[];
  companies: ReachableCompany[];
  managedCompanyIds: string[];
  initialItems: GridItem[];
  // Última sincronização da agenda Google do usuário (ISO) — para "sincronizado
  // há X" e para decidir o sync automático em segundo plano. null = nunca.
  initialLastSync: string | null;
}) {
  const today = todayCivil();
  const initialKey = `w:${civilKey(weekStart(today))}`;

  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState<Civil>(today);
  const [selected, setSelected] = useState<Set<string>>(new Set([currentUserId]));
  const [cache, setCache] = useState<Map<string, GridItem[]>>(
    () => new Map([[initialKey, initialItems]])
  );
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Duas noções de visibilidade do painel de agendas:
  //  - sidebarOpen: gaveta no MOBILE (fechada por padrão; abre por cima da grade).
  //  - sidebarCollapsed: recolhido no DESKTOP, liberando a largura para a grade.
  //    A preferência é lembrada entre navegações (localStorage).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    try {
      setSidebarCollapsed(
        localStorage.getItem(SIDEBAR_PREF_KEY) === "collapsed"
      );
    } catch {
      /* localStorage indisponível — mantém expandido */
    }
  }, []);

  // Um só controle (na barra): no desktop recolhe/expande (e lembra); no mobile
  // abre/fecha a gaveta. Decide pela largura no momento do clique.
  const toggleSidebar = useCallback(() => {
    const isDesktop =
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 1024px)").matches;
    if (isDesktop) {
      setSidebarCollapsed((c) => {
        const next = !c;
        try {
          localStorage.setItem(
            SIDEBAR_PREF_KEY,
            next ? "collapsed" : "expanded"
          );
        } catch {
          /* ignora falha de persistência */
        }
        return next;
      });
    } else {
      setSidebarOpen((o) => !o);
    }
  }, []);

  const [createDraft, setCreateDraft] = useState<Draft | null>(null);
  const [detail, setDetail] = useState<GridItem | null>(null);
  const [result, setResult] = useState<{ warning: string | null; successText: string } | null>(null);
  // Sincronização com o Google (Fatia 2): carimbo da última vez e estado do botão.
  const [lastSync, setLastSync] = useState<string | null>(initialLastSync);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  // Arrasto solto que caiu em conflito — aguarda a confirmação do usuário.
  // `backup` guarda os itens do período para reverter se ele cancelar.
  const [dragConfirm, setDragConfirm] = useState<{
    meeting: MeetingRow;
    startISO: string;
    endISO: string;
    conflicts: ConflictRow[];
    backup: GridItem[];
  } | null>(null);

  // Mobile: a grade de semana não cabe — abre em Dia. Só no primeiro render.
  useEffect(() => {
    if (window.matchMedia("(max-width: 640px)").matches) setView("day");
  }, []);

  // Altura disponível da ÁREA (painel + grade): do topo REAL da linha até a base
  // da viewport (menos o pb-6 do <main>). Medir o CONTÊINER PAI e distribuir a
  // mesma altura para grade e painel (via CSS var) garante que nenhum dos dois
  // sobre área morta nem estoure. Remede em resize, quando o banner aparece/some
  // e no próximo frame (para pegar o layout já assentado).
  const areaRef = useRef<HTMLDivElement>(null);
  const [areaH, setAreaH] = useState<number | undefined>(undefined);
  useEffect(() => {
    const measure = () => {
      const el = areaRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const h = Math.max(
        MIN_AREA_PX,
        Math.round(window.innerHeight - top - BOTTOM_GAP)
      );
      setAreaH((prev) => (prev !== undefined && Math.abs(prev - h) < 1 ? prev : h));
    };
    measure();
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, [result]);

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
  // Filtro de pessoas: reunião do sistema aparece se alguém LIGADO é criador ou
  // participante; evento importado aparece se o DONO da agenda está ligado
  // (decisão: todos os internos veem as agendas uns dos outros).
  const visible = useMemo(
    () =>
      rows.filter((m) =>
        isImported(m)
          ? selected.has(m.ownerId)
          : selected.has(m.creator.id) ||
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
    managedCompanyIds,
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

  // Espelha no cache (todas as janelas) E no detalhe aberto os status recém-lidos
  // do Google (ou a própria resposta enviada). A action JÁ gravou no banco; sem
  // isto, fechar+reabrir o modal na MESMA sessão traz o valor velho do cache e o
  // usuário precisa "Atualizar status" de novo. Não fecha o modal (ao contrário
  // do invalidate) — o quadro de status continua visível com o valor fresco.
  const applyResponses = useCallback(
    (meetingId: string, patch: ResponsesPatch) => {
      const apply = (item: GridItem): GridItem => {
        if (isImported(item) || item.id !== meetingId) return item;
        return {
          ...item,
          roomResponse: patch.room !== undefined ? patch.room : item.roomResponse,
          responsesSyncedAt: patch.syncedAt ?? item.responsesSyncedAt,
          participants: item.participants.map((p) =>
            patch.byUser.has(p.id)
              ? { ...p, response: patch.byUser.get(p.id) ?? null }
              : p
          ),
        };
      };
      setCache((prev) => {
        const next = new Map<string, GridItem[]>();
        for (const [k, rows] of Array.from(prev.entries()))
          next.set(k, rows.map(apply));
        return next;
      });
      setDetail((d) => (d && !isImported(d) && d.id === meetingId ? apply(d) : d));
    },
    []
  );

  // Sincroniza a agenda do Google do PRÓPRIO usuário (só o token dele é
  // alcançável — ver google-import-actions). No sucesso, recarrega o período para
  // os importados aparecerem/atualizarem. `silent` (auto-sync no load) não mostra
  // erro na cara do usuário; o botão manual mostra.
  const runSync = useCallback(
    async (silent: boolean) => {
      if (syncing) return;
      setSyncing(true);
      if (!silent) setSyncMsg(null);
      const res = await syncMyGoogleCalendar();
      setSyncing(false);
      if (res.status === "ok") {
        setLastSync(res.lastSyncedAt);
        invalidate();
        if (!silent) setSyncMsg(null);
      } else if (res.status === "nao_conectado") {
        if (!silent)
          setSyncMsg("Conecte sua conta Google no seu perfil para importar a agenda.");
      } else {
        if (!silent) setSyncMsg(res.message);
      }
    },
    [syncing, invalidate]
  );

  // Auto-sync ao abrir, se a última for velha (ou nunca) e houver conta conectada.
  // Roda uma vez, em segundo plano; erros ficam silenciosos aqui.
  const autoSyncedRef = useRef(false);
  useEffect(() => {
    if (autoSyncedRef.current) return;
    if (!googleConnected) return;
    const stale =
      !lastSync || Date.now() - new Date(lastSync).getTime() > SYNC_STALE_MS;
    if (!stale) return;
    autoSyncedRef.current = true;
    void runSync(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleConnected]);

  const nameById = useMemo(
    () => new Map(directory.map((u) => [u.id, u.name])),
    [directory]
  );

  function handleResult(warning: string | null, successText: string) {
    setResult({ warning, successText });
    setDetail(null);
    setCreateDraft(null);
    invalidate();
  }

  // Grava o reagendamento: banco → Google (fluxo da fatia 1.1). No sucesso,
  // reconcilia o período em SILÊNCIO (sem limpar o cache → sem "Carregando…",
  // mantendo o otimismo até a resposta chegar). Na falha, REVERTE para o backup
  // e avisa — a mudança não fica pela metade.
  const finishReschedule = useCallback(
    async (
      meeting: MeetingRow,
      startISO: string,
      endISO: string,
      backup: GridItem[]
    ) => {
      const res = await updateMeeting({
        meetingId: meeting.id,
        companyId: meeting.companyId,
        companyName: meeting.companyName,
        title: meeting.title,
        description: meeting.description ?? "",
        type: meeting.type,
        room: meeting.room,
        startISO,
        endISO,
        participantIds: meeting.participants.map((p) => p.id),
      });
      if (!res.ok) {
        setCache((prev) => new Map(prev).set(key, backup));
        setResult({
          warning: `Não foi possível reagendar: ${res.error}`,
          successText: "",
        });
        return;
      }
      setResult({ warning: res.warning, successText: "Reunião reagendada." });
      try {
        const rows = await fetchMeetingsRange(fromISO, toISO);
        setCache((prev) => new Map(prev).set(key, rows));
      } catch {
        /* mantém a versão otimista já visível */
      }
    },
    [key, fromISO, toISO]
  );

  // Soltou o arrasto: aplica o feedback otimista, roda a MESMA verificação de
  // conflito (todos os participantes + o criador, no servidor) e, havendo
  // sobreposição, PEDE CONFIRMAÇÃO sem bloquear. Sem conflito, grava direto.
  const onReschedule = useCallback(
    async (meeting: MeetingRow, startISO: string, endISO: string) => {
      const backup = cache.get(key) ?? [];
      setCache((prev) => moveInKey(prev, key, meeting.id, startISO, endISO));
      let conflicts: ConflictRow[] = [];
      try {
        conflicts = await checkMeetingConflicts(
          startISO,
          endISO,
          meeting.participants.map((p) => p.id),
          meeting.id
        );
      } catch {
        conflicts = [];
      }
      if (conflicts.length > 0) {
        setDragConfirm({ meeting, startISO, endISO, conflicts, backup });
        return;
      }
      await finishReschedule(meeting, startISO, endISO, backup);
    },
    [cache, key, finishReschedule]
  );

  // Cancela o arrasto em conflito: reverte o otimismo ao lugar de origem.
  const cancelDragConfirm = useCallback(() => {
    setDragConfirm((c) => {
      if (c) setCache((prev) => new Map(prev).set(key, c.backup));
      return null;
    });
  }, [key]);

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
        onToggleSidebar={toggleSidebar}
        sidebarCollapsed={sidebarCollapsed}
        googleConnected={googleConnected}
        lastSync={lastSync}
        syncing={syncing}
        onSync={() => runSync(false)}
      />
      {syncMsg && (
        <p className="mb-3 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          {syncMsg}
        </p>
      )}

      {/* Área (painel + grade): a linha recebe a altura disponível (CSS var) e
          filhos preenchem com lg:h-full; grade e painel rolam por dentro. */}
      <div
        ref={areaRef}
        style={
          areaH !== undefined
            ? ({ ["--agenda-h" as string]: `${areaH}px` } as CSSProperties)
            : undefined
        }
        className="flex flex-col gap-4 lg:h-[var(--agenda-h)] lg:min-h-0 lg:flex-row lg:overflow-hidden"
      >
        <div
          className={`${sidebarOpen ? "block" : "hidden"} ${
            sidebarCollapsed ? "lg:hidden" : "lg:block"
          } lg:h-full lg:min-h-0`}
        >
          <PeopleSidebar
            people={directory}
            selected={selected}
            currentUserId={currentUserId}
            onToggle={toggle}
            onOnlyMe={() => setSelected(new Set([currentUserId]))}
            onCollapse={toggleSidebar}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col lg:h-full lg:min-h-0">
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
                <p className="mb-2 shrink-0 text-xs text-fg-subtle">
                  Nenhuma reunião das agendas selecionadas neste período.
                </p>
              )}
              <div className="min-h-0 flex-1">
                {view === "month" ? (
                  <div className="lg:h-full lg:overflow-y-auto">
                    <MonthView
                      anchorMonth={anchor}
                      items={visible}
                      onEventClick={setDetail}
                      onDayClick={(d) => {
                        setAnchor(d);
                        setView("day");
                      }}
                      onCreateDay={openCreateDay}
                    />
                  </div>
                ) : (
                  <TimeGridView
                    days={visibleDays(view, anchor)}
                    items={visible}
                    colorOf={personColor}
                    currentUserId={currentUserId}
                    nameById={nameById}
                    onEventClick={setDetail}
                    onSlotClick={openSlot}
                    onReschedule={onReschedule}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Criar (botão ou clique no vazio) */}
      <Modal
        open={createDraft !== null}
        onClose={() => setCreateDraft(null)}
        maxWidth="max-w-lg"
        flush
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

      {/* Detalhe do evento: reunião do sistema (ações da fatia 1.1) ou evento
          importado do Google (somente-leitura). */}
      <Modal open={detail !== null} onClose={() => setDetail(null)} maxWidth="max-w-xl">
        {detail !== null &&
          (isImported(detail) ? (
            <ImportedEventDetail
              key={detail.id}
              event={detail}
              ownerName={nameById.get(detail.ownerId) ?? "colega"}
              isOwn={detail.ownerId === currentUserId}
            />
          ) : (
            <MeetingCard
              key={detail.id}
              meeting={detail}
              showCompany
              ctx={ctx}
              onResult={handleResult}
              onResponses={applyResponses}
            />
          ))}
      </Modal>

      {/* Conflito ao arrastar — avisa com quem/qual, mas NÃO bloqueia. Fechar
          (ESC/fora/Cancelar) devolve a reunião ao lugar de origem. */}
      <Modal open={dragConfirm !== null} onClose={cancelDragConfirm} maxWidth="max-w-md">
        {dragConfirm && (
          <div className="space-y-4">
            <div>
              <h2 className="font-semibold text-fg">Possível conflito de horário</h2>
              <p className="mt-1 text-sm text-fg-muted">
                Mover “{dragConfirm.meeting.title}” para{" "}
                {formatMeetingRange(dragConfirm.startISO, dragConfirm.endISO)}{" "}
                sobrepõe:
              </p>
            </div>
            <ul className="space-y-1.5 rounded-xl border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              {dragConfirm.conflicts.map((c) => {
                const { who, tail } = describeConflict(c, nameById);
                return (
                  <li key={`${c.source}-${c.refId}`}>
                    <span className="font-medium">{who}</span>
                    {tail}
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-fg-subtle">
              É só um aviso — você pode mover mesmo assim. A verificação cobre as
              reuniões deste sistema e os eventos da sua agenda do Google.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={btnPrimary}
                onClick={() => {
                  const c = dragConfirm;
                  setDragConfirm(null);
                  finishReschedule(c.meeting, c.startISO, c.endISO, c.backup);
                }}
              >
                Mover mesmo assim
              </button>
              <button
                type="button"
                className={btnSecondary}
                onClick={cancelDragConfirm}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

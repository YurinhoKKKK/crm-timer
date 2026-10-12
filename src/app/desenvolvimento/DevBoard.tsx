"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type HTMLAttributes,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { History, Move, Pause, Play } from "lucide-react";
import { FilterBar, SearchBox, EmptyState, norm } from "@/components/ListControls";
import GroupSection from "@/components/company-groups/GroupSection";
import BoardGrid, { type BoardColumn } from "@/components/board/BoardGrid";
import {
  groupCompanies,
  colorTints,
  SEM_GRUPO,
  type CompanyGroup,
} from "@/lib/company-groups";
import LabelChips from "@/components/LabelChips";
import AnchoredPopover from "@/components/AnchoredPopover";
import ChipPicker from "@/components/ChipPicker";
import NotesButton from "@/components/notes-panel/NotesButton";
import { DEV_STATUS, type DevStatus } from "@/lib/dev-options";
import type { Label } from "@/lib/labels";
import { formatPureDate } from "@/lib/company-details";
import {
  setDevStatus,
  moveDevCompany,
  pauseDevDeadline,
  resumeDevDeadline,
} from "./actions";
import DevHistoryPanel from "./DevHistoryPanel";

// Quadro do Desenvolvimento (Etapa 1) — mesma ESTRUTURA do Tráfego/CS (seções
// coloridas + BoardGrid), no formato COMPACTO: coluna Empresa fixa, UMA ÚNICA
// rolagem horizontal, nada quebra linha. Diferente do Tráfego, NÃO há modo
// "sincronizado": o Desenvolvimento é 100% manual, então TODAS as linhas podem
// arrastar e trocar de grupo. Trocar um Status que corresponde a um grupo move a
// empresa para a seção certa (a correspondência mora no banco; o front só
// revalida após salvar). Edição e movimento são otimistas, com reversão em erro.
//
// COLUNAS: alça | Empresa | Prazo | Status | Ações (Histórico, Mover). O balão de
// Atualizações (Etapa 3) fica na célula Empresa, à direita, como no Tráfego: mostra
// SÓ as Atualizações da empresa com a área 'site' (são company_notes normais, não
// privadas — aparecem também na central). Nova nota nasce com a área Site travada
// (origin='site'); o banco (0117) garante a área e a trava.
//
// PRAZO (Etapa 2): barra de 15 dias ÚTEIS que só corre em "Em Desenvolvimento"
// (grupo + status) e sem pausa manual. O banco (dev_board) resolve tudo — dias
// usados, se corre/já começou, a pausa manual e a previsão de entrega; o front só
// desenha e oferece pausar/retomar.

export type DevBoardRow = {
  id: string;
  name: string;
  groupId: string | null; // grupo NO DESENVOLVIMENTO (já resolvido no servidor)
  status: DevStatus;
  labels: Label[];
  historyCount: number;
  // --- Prazo (Etapa 2), tudo pronto do banco ---
  usedDays: number; // dias úteis já consumidos
  deadlineDays: number; // total do prazo (15)
  running: boolean; // o prazo corre agora (Em Desenvolvimento + em_desenvolvimento, sem pausa)
  startedEver: boolean; // o prazo já correu alguma vez (há períodos)
  manualPaused: boolean; // pausa manual ligada
  pauseReason: string | null; // motivo da pausa manual
  pausedAtISO: string | null; // quando pausou (timestamptz)
  pausedByName: string | null; // quem pausou (nome resolvido)
  forecast: string | null; // previsão de entrega (data pura AAAA-MM-DD) ou null
  siteNoteCount: number; // nº de Atualizações da empresa com a área 'site' (balão)
};

const COLLAPSE_KEY = "crm:desenvolvimento:grupos-recolhidos";
// Soma das larguras MÍNIMAS das colunas: abaixo disso aparece a rolagem única.
// alça(24) + Empresa(290) + Prazo(200) + Status(180) + Ações(88).
const MIN_WIDTH = 782;

// --- Contexto de célula ----------------------------------------------------- //
type CellCtx = {
  groups: CompanyGroup[];
  userId: string; // visitante (autor das Atualizações escritas pelo balão)
  canOpenCompany: boolean; // admin abre a central da empresa
  autoOpenNotesId: string | null; // empresa cujo balão abre sozinho (?empresa=)
  onOpen: (id: string) => void;
  openingId: string | null;
  setStatus: (row: DevBoardRow, v: DevStatus) => void;
  move: (row: DevBoardRow, groupId: string) => void;
  pauseDeadline: (row: DevBoardRow, reason: string) => void;
  resumeDeadline: (row: DevBoardRow) => void;
  openHistory: (row: DevBoardRow) => void;
  onRowDragStart: (id: string) => void;
  onRowDragEnd: () => void;
};

// Botão de ícone padrão das Ações: alvo de clique mínimo de 32px.
const ICON_BTN =
  "relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted transition hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd";

// --- Menu "Mover para..." (ícone) ------------------------------------------- //
function MoveMenu({ row, ctx }: { row: DevBoardRow; ctx: CellCtx }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Mover para..."
        aria-label="Mover para..."
        className={ICON_BTN}
      >
        <Move size={15} aria-hidden="true" />
      </button>
      {open && ref.current && (
        <AnchoredPopover anchor={ref.current} onClose={() => setOpen(false)} width={220}>
          <div role="menu" className="flex max-h-72 flex-col overflow-y-auto">
            {ctx.groups.map((g) => (
              <button
                key={g.id}
                type="button"
                role="menuitem"
                disabled={g.id === row.groupId}
                onClick={() => {
                  setOpen(false);
                  ctx.move(row, g.id);
                }}
                className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-fg transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd disabled:cursor-default disabled:opacity-40"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: colorTints(g.color).dot }}
                  aria-hidden="true"
                />
                <span className="truncate">{g.name}</span>
              </button>
            ))}
          </div>
        </AnchoredPopover>
      )}
    </>
  );
}

// --- Célula da ALÇA de arraste (coluna própria; só desktop) ----------------- //
function DragHandleCell({ row, ctx }: { row: DevBoardRow; ctx: CellCtx }) {
  return (
    <span
      role="button"
      aria-label={`Arraste ${row.name} para mover de grupo`}
      title="Arraste para mover de grupo"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", row.id);
        ctx.onRowDragStart(row.id);
      }}
      onDragEnd={ctx.onRowDragEnd}
      className="hidden shrink-0 cursor-grab items-center text-fg-subtle transition hover:text-fg active:cursor-grabbing sm:flex"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="9" cy="6" r="1.6" />
        <circle cx="15" cy="6" r="1.6" />
        <circle cx="9" cy="12" r="1.6" />
        <circle cx="15" cy="12" r="1.6" />
        <circle cx="9" cy="18" r="1.6" />
        <circle cx="15" cy="18" r="1.6" />
      </svg>
    </span>
  );
}

// --- Célula Empresa (nome + chips à esquerda; balão à direita, centralizado) - //
// O balão mostra SÓ as Atualizações da empresa com a área 'site' (inclusive as
// criadas fora do quadro). Nova nota nasce com a área Site travada e origin='site'.
function EmpresaCell({ row, ctx }: { row: DevBoardRow; ctx: CellCtx }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {ctx.canOpenCompany ? (
          <button
            type="button"
            onClick={() => ctx.onOpen(row.id)}
            title={row.name}
            className="group/co block w-full rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
          >
            <span className="line-clamp-2 font-medium text-fg transition group-hover/co:text-risd">
              {row.name}
            </span>
            {ctx.openingId === row.id && (
              <span className="mt-0.5 block text-xs text-fg-subtle">Abrindo…</span>
            )}
          </button>
        ) : (
          <span className="line-clamp-2 font-medium text-fg" title={row.name}>
            {row.name}
          </span>
        )}
        {row.labels.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <LabelChips labels={row.labels} nowrap />
          </div>
        )}
      </div>

      {/* Atualizações FILTRADAS pela área Site. Nova nota nasce com a área Site
          travada (origin='site'); o gatilho da 0117 garante a área. */}
      <NotesButton
        companyId={row.id}
        companyName={row.name}
        userId={ctx.userId}
        isAdmin={ctx.canOpenCompany}
        notesHref={`/admin/empresas/${row.id}?aba=notes`}
        initialCount={row.siteNoteCount}
        className="shrink-0"
        areaFilter="site"
        lockedArea="site"
        origin="site"
        showFullTab={ctx.canOpenCompany}
        defaultOpen={ctx.autoOpenNotesId === row.id}
      />
    </div>
  );
}

// --- Célula Ações (ícones: Histórico, Mover) -------------------------------- //
function ActionsCell({ row, ctx }: { row: DevBoardRow; ctx: CellCtx }) {
  return (
    <div className="flex items-center justify-end gap-0.5">
      <button
        type="button"
        onClick={() => ctx.openHistory(row)}
        title="Histórico"
        aria-label={row.historyCount > 0 ? `Histórico (${row.historyCount})` : "Histórico"}
        className={ICON_BTN}
      >
        <History size={15} aria-hidden="true" />
        {row.historyCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[14px] rounded-full bg-surface-2 px-1 text-[9px] font-semibold leading-[14px] tabular-nums text-fg-subtle">
            {row.historyCount}
          </span>
        )}
      </button>
      <MoveMenu row={row} ctx={ctx} />
    </div>
  );
}

// --- Célula Prazo (barra de 15 dias úteis + pausa manual) ------------------- //
// A barra e o texto refletem o estado que o banco já resolveu:
//   não iniciado → o prazo nunca correu; correndo → conta e mostra a previsão de
//   entrega; atrasado → usados ≥ total enquanto corre (vermelho); pausado → pausa
//   manual (âmbar, congela os dias); parado → já começou mas não corre nem está
//   pausado (entregue/cancelado/pendência…): o chip de Status explica o porquê.
type DeadlineView = {
  percent: number;
  fillClass: string;
  line: string;
  lineClass: string;
};

function deadlineView(row: DevBoardRow): DeadlineView {
  const total = row.deadlineDays || 15;
  const used = row.usedDays;
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

  if (!row.startedEver) {
    return { percent: 0, fillClass: "bg-surface-2", line: "Não iniciado", lineClass: "text-fg-subtle" };
  }
  if (row.manualPaused) {
    return {
      percent: pct,
      fillClass: "bg-amber-500",
      line: `Pausado · ${used}/${total} dias úteis`,
      lineClass: "font-medium text-amber-700 dark:text-amber-400",
    };
  }
  if (row.running) {
    const over = used - total;
    if (over >= 0) {
      return {
        percent: 100,
        fillClass: "bg-red-500",
        line:
          over === 0
            ? `No limite · ${used}/${total} dias úteis`
            : `Atrasado · ${over} ${over === 1 ? "dia útil" : "dias úteis"} acima`,
        lineClass: "font-medium text-red-700 dark:text-red-400",
      };
    }
    const remaining = total - used;
    const near = remaining <= 3;
    const forecast = row.forecast ? formatPureDate(row.forecast) : null;
    return {
      percent: pct,
      fillClass: near ? "bg-amber-500" : "bg-risd",
      line: forecast
        ? `${used}/${total} dias úteis · prev. ${forecast}`
        : `${used}/${total} dias úteis`,
      lineClass: near ? "font-medium text-amber-700 dark:text-amber-400" : "text-fg-muted",
    };
  }
  // Já começou, mas parado (não corre e não é pausa manual).
  return {
    percent: pct,
    fillClass: "bg-fg-subtle",
    line: `${used}/${total} dias úteis · parado`,
    lineClass: "text-fg-subtle",
  };
}

// Data+hora da pausa em Brasília (o timestamptz vem com fuso; o toLocaleString
// renderiza em BRT).
function formatPausedWhen(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const POPOVER_BOX = "w-[18rem] max-w-[calc(100vw-1.5rem)] p-1.5 text-left";
const POPOVER_PRIMARY_BTN =
  "mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-risd px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-chrysler focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd";

// Conteúdo do balão: pausar (correndo), retomar (pausado) ou só informação.
function DeadlinePopover({
  row,
  reason,
  setReason,
  err,
  onPause,
  onResume,
}: {
  row: DevBoardRow;
  reason: string;
  setReason: (v: string) => void;
  err: string | null;
  onPause: () => void;
  onResume: () => void;
}) {
  const total = row.deadlineDays || 15;

  if (row.manualPaused) {
    const when = row.pausedAtISO ? formatPausedWhen(row.pausedAtISO) : null;
    return (
      <div className={POPOVER_BOX}>
        <p className="mb-1 flex items-center gap-1 text-sm font-semibold text-amber-700 dark:text-amber-400">
          <Pause size={13} aria-hidden="true" /> Prazo pausado
        </p>
        <p className="text-xs text-fg-muted">
          {row.usedDays}/{total} dias úteis usados até a pausa.
        </p>
        {row.pauseReason && (
          <p className="mt-2 rounded-md bg-surface-2 px-2.5 py-1.5 text-sm text-fg">
            “{row.pauseReason}”
          </p>
        )}
        {(row.pausedByName || when) && (
          <p className="mt-1.5 text-[11px] text-fg-subtle">
            {[row.pausedByName ? `por ${row.pausedByName}` : null, when].filter(Boolean).join(" · ")}
          </p>
        )}
        <button type="button" onClick={onResume} className={POPOVER_PRIMARY_BTN}>
          <Play size={14} aria-hidden="true" /> Retomar prazo
        </button>
      </div>
    );
  }

  if (row.running) {
    return (
      <div className={POPOVER_BOX}>
        <label className="mb-1 block text-xs font-medium text-fg-muted">Motivo da pausa</label>
        <textarea
          autoFocus
          rows={3}
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ex.: aguardando material do cliente."
          className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
        />
        {err && (
          <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
            {err}
          </p>
        )}
        <button type="button" onClick={onPause} className={POPOVER_PRIMARY_BTN}>
          <Pause size={14} aria-hidden="true" /> Pausar prazo
        </button>
      </div>
    );
  }

  // Não iniciado ou parado: só informação (a pausa manual só existe correndo).
  return (
    <div className={POPOVER_BOX}>
      <p className="text-sm text-fg">
        {row.startedEver
          ? `${row.usedDays}/${total} dias úteis usados.`
          : "O prazo ainda não começou."}
      </p>
      <p className="mt-1 text-xs text-fg-subtle">
        {row.startedEver
          ? "O prazo não está correndo agora. A pausa manual só está disponível em “Em Desenvolvimento”."
          : "A contagem de 15 dias úteis começa quando a empresa entra em “Em Desenvolvimento”."}
      </p>
    </div>
  );
}

function DeadlineCell({ row, ctx }: { row: DevBoardRow; ctx: CellCtx }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const v = deadlineView(row);

  function submitPause() {
    const r = reason.trim();
    if (!r) {
      setErr("Informe o motivo da pausa.");
      return;
    }
    setOpen(false);
    setReason("");
    setErr(null);
    ctx.pauseDeadline(row, r);
  }

  const title = row.manualPaused
    ? "Prazo pausado — clique para ver ou retomar"
    : row.running
      ? "Clique para pausar o prazo"
      : "Detalhes do prazo";

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => {
          setErr(null);
          setReason("");
          setOpen((o) => !o);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
        className="block w-full min-w-0 rounded px-1 py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
      >
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-valuenow={v.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Prazo: ${v.line}`}
        >
          <div
            className={`h-full rounded-full transition-all ${v.fillClass}`}
            style={{ width: `${v.percent}%` }}
          />
        </div>
        <div className={`mt-1 flex items-center gap-1 truncate text-[11px] ${v.lineClass}`}>
          {row.manualPaused && <Pause size={11} aria-hidden="true" className="shrink-0" />}
          <span className="truncate">{v.line}</span>
        </div>
      </button>
      {open && ref.current && (
        <AnchoredPopover anchor={ref.current} onClose={() => setOpen(false)} width={300}>
          <DeadlinePopover
            row={row}
            reason={reason}
            setReason={(x) => {
              setReason(x);
              setErr(null);
            }}
            err={err}
            onPause={submitPause}
            onResume={() => {
              setOpen(false);
              ctx.resumeDeadline(row);
            }}
          />
        </AnchoredPopover>
      )}
    </>
  );
}

// --- Colunas (fonte única; ordem/larguras compactas) ------------------------ //
type DevColumn = BoardColumn<DevBoardRow, CellCtx>;

const COLUMNS: DevColumn[] = [
  {
    id: "drag",
    label: "",
    width: "24px",
    align: "left",
    stickyLeft: 0,
    cell: (row, ctx) => <DragHandleCell row={row} ctx={ctx} />,
  },
  {
    id: "company",
    label: "Empresa",
    width: "minmax(290px, 1fr)",
    align: "left",
    stickyLeft: 24,
    borderRight: true,
    cell: (row, ctx) => <EmpresaCell row={row} ctx={ctx} />,
  },
  {
    id: "deadline",
    label: "Prazo",
    width: "200px",
    align: "left",
    cell: (row, ctx) => <DeadlineCell row={row} ctx={ctx} />,
  },
  {
    id: "status",
    label: "Status",
    width: "180px",
    align: "left",
    cell: (row, ctx) => (
      <ChipPicker<DevStatus>
        value={row.status}
        options={DEV_STATUS}
        ariaLabel="Alterar Status"
        onPick={(v) => v && ctx.setStatus(row, v)}
        compact
        clearable={false}
      />
    ),
  },
  {
    id: "actions",
    label: "Ações",
    width: "88px",
    align: "right",
    tight: true,
    cell: (row, ctx) => <ActionsCell row={row} ctx={ctx} />,
  },
];

// --- Seção ------------------------------------------------------------------ //
function DevSection({
  sectionKey,
  group,
  items,
  collapsed,
  onToggle,
  ctx,
  dragActive,
  dragOver,
  onDragEnterSection,
  onDragLeaveSection,
  onDropSection,
}: {
  sectionKey: string;
  group: CompanyGroup | null;
  items: DevBoardRow[];
  collapsed: boolean;
  onToggle: () => void;
  ctx: CellCtx;
  dragActive: boolean;
  dragOver: boolean;
  onDragEnterSection: () => void;
  onDragLeaveSection: () => void;
  onDropSection: () => void;
}) {
  // "Sem grupo" não é destino de movimento (null = fora dos 6 grupos). Só grupos
  // reais recebem arraste.
  const isDroppable = dragActive && group != null;
  const dropProps: HTMLAttributes<HTMLElement> = isDroppable
    ? {
        onDragOver: (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          onDragEnterSection();
        },
        onDragLeave: (e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) onDragLeaveSection();
        },
        onDrop: (e) => {
          e.preventDefault();
          onDropSection();
        },
      }
    : {};

  const borderClassName = dragOver
    ? "border-risd ring-2 ring-risd ring-offset-2 ring-offset-canvas"
    : isDroppable
      ? "border-dashed border-line-strong"
      : "border-line";

  return (
    <GroupSection
      group={group}
      count={items.length}
      collapsed={collapsed}
      onToggleCollapse={onToggle}
      borderClassName={borderClassName}
      sectionProps={dropProps}
      bodyClassName="p-0"
      overflowClip
    >
      {items.length === 0 ? (
        <p className="px-3 py-4 text-center text-sm text-fg-subtle">
          {sectionKey === SEM_GRUPO ? "Nenhuma empresa sem grupo." : "Nenhuma empresa"}
        </p>
      ) : (
        <BoardGrid
          columns={COLUMNS}
          rows={items}
          ctx={ctx}
          minWidth={MIN_WIDTH}
          compact
          scroll={false}
        />
      )}
    </GroupSection>
  );
}

// --- Quadro ----------------------------------------------------------------- //
export default function DevBoard({
  companies,
  groups,
  userId,
  canOpenCompany,
}: {
  companies: DevBoardRow[];
  groups: CompanyGroup[]; // os 6 grupos do Desenvolvimento (adaptados a CompanyGroup)
  userId: string; // visitante (autor das Atualizações escritas pelo balão)
  canOpenCompany: boolean; // admin abre a central da empresa pelo nome
}) {
  const router = useRouter();
  // Notificação (etapa 4) leva a /desenvolvimento?empresa=<id> — abre o balão
  // daquela empresa sozinho, como no Tráfego.
  const searchParams = useSearchParams();
  const autoOpenNotesId = searchParams.get("empresa");
  const [isPending, startTransition] = useTransition();
  const [openingId, setOpeningId] = useState<string | null>(null);
  useEffect(() => {
    if (!isPending) setOpeningId(null);
  }, [isPending]);

  function openCompany(id: string) {
    setOpeningId(id);
    startTransition(() => router.push(`/admin/empresas/${id}`));
  }

  // Estado local para edição/movimento OTIMISTAS; ressincroniza no refresh.
  const [rows, setRows] = useState(companies);
  useEffect(() => setRows(companies), [companies]);

  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<DevBoardRow | null>(null);

  // Arrastar (todos os grupos reais recebem). Mesmo padrão do quadro Empresas.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  // Trocar o Status: otimista no chip. Como um status pode mover a empresa de
  // seção (correspondência no banco), revalidamos após salvar para o servidor
  // reposicionar a linha — sem duplicar a correspondência no front.
  async function doSetStatus(row: DevBoardRow, v: DevStatus) {
    if (v === row.status) return;
    const snapshot = rows;
    setNotice(null);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: v } : r)));
    const res = await setDevStatus(row.id, v);
    if (res.error) {
      setRows(snapshot);
      setNotice(res.error);
      return;
    }
    router.refresh();
  }

  // Mover de grupo: otimista (a linha pula de seção). O status correspondente ao
  // grupo de destino é aplicado pelo banco e chega no refresh.
  async function doMove(row: DevBoardRow, groupId: string) {
    if (row.groupId === groupId) return;
    const snapshot = rows;
    setNotice(null);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, groupId } : r)));
    const res = await moveDevCompany(row.id, groupId);
    if (res.error) {
      setRows(snapshot);
      setNotice(res.error);
      return;
    }
    router.refresh();
  }

  // Pausar o prazo: otimista (congela e marca a pausa) + revalida para o servidor
  // devolver os dias usados/estado autoritativos.
  async function doPauseDeadline(row: DevBoardRow, reason: string) {
    const snapshot = rows;
    setNotice(null);
    setRows((rs) =>
      rs.map((r) =>
        r.id === row.id
          ? { ...r, manualPaused: true, pauseReason: reason, running: false, forecast: null }
          : r
      )
    );
    const res = await pauseDevDeadline(row.id, reason);
    if (res.error) {
      setRows(snapshot);
      setNotice(res.error);
      return;
    }
    router.refresh();
  }

  // Retomar: volta a correr (a empresa continua em Em Desenvolvimento). A previsão
  // de entrega é recalculada pelo servidor no refresh.
  async function doResumeDeadline(row: DevBoardRow) {
    const snapshot = rows;
    setNotice(null);
    setRows((rs) =>
      rs.map((r) =>
        r.id === row.id
          ? {
              ...r,
              manualPaused: false,
              pauseReason: null,
              pausedByName: null,
              pausedAtISO: null,
              running: true,
            }
          : r
      )
    );
    const res = await resumeDevDeadline(row.id);
    if (res.error) {
      setRows(snapshot);
      setNotice(res.error);
      return;
    }
    router.refresh();
  }

  function handleDropOn(groupId: string | null) {
    const dragId = draggingId;
    setDragOverKey(null);
    setDraggingId(null);
    if (!dragId || groupId == null) return; // "Sem grupo" não é destino
    const row = rows.find((r) => r.id === dragId);
    if (row && row.groupId !== groupId) doMove(row, groupId);
  }

  const [search, setSearch] = useState("");
  const filtersActive = !!search.trim();

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      if (raw) setCollapsed(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* localStorage indisponível — tudo expandido */
    }
  }, []);
  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(Array.from(next)));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const filtered = useMemo(() => {
    const q = norm(search.trim());
    if (!q) return rows;
    return rows.filter((c) => norm(c.name).includes(q));
  }, [rows, search]);

  const sections = useMemo(() => groupCompanies(filtered, groups), [filtered, groups]);

  // Os 6 grupos aparecem SEMPRE (abertos, destino de arraste); "Sem grupo" só com
  // empresas. Com busca ativa, oculta seções vazias.
  const visibleSections = sections.filter((s) => {
    if (filtersActive) return s.items.length > 0;
    if (s.key === SEM_GRUPO) return s.items.length > 0;
    return true;
  });

  const ctx: CellCtx = {
    groups,
    userId,
    canOpenCompany,
    autoOpenNotesId,
    onOpen: openCompany,
    openingId,
    setStatus: doSetStatus,
    move: doMove,
    pauseDeadline: doPauseDeadline,
    resumeDeadline: doResumeDeadline,
    openHistory: setHistory,
    onRowDragStart: setDraggingId,
    onRowDragEnd: () => {
      setDraggingId(null);
      setDragOverKey(null);
    },
  };

  return (
    <>
      <FilterBar>
        <SearchBox value={search} onChange={setSearch} placeholder="Buscar por nome…" />
      </FilterBar>

      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">
          {filtersActive ? (
            <>
              {filtered.length} {filtered.length === 1 ? "resultado" : "resultados"} de{" "}
              {rows.length}
            </>
          ) : (
            <>
              {rows.length} {rows.length === 1 ? "empresa" : "empresas"}
            </>
          )}
        </p>
      </div>

      {notice && (
        <div className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dispensar aviso"
            className="shrink-0 text-red-700/70 hover:text-red-700 dark:text-red-300/70"
          >
            ✕
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState>Nenhuma empresa contratou serviço de site ainda.</EmptyState>
      ) : visibleSections.length === 0 ? (
        <EmptyState>Nenhuma empresa corresponde à busca.</EmptyState>
      ) : (
        // UMA única rolagem horizontal para o quadro inteiro: todas as seções
        // compartilham este viewport; a coluna Empresa fica fixa à esquerda.
        <div className="overflow-x-auto pb-10">
          <div className="space-y-4" style={{ minWidth: MIN_WIDTH }}>
            {visibleSections.map((section) => (
              <DevSection
                key={section.key}
                sectionKey={section.key}
                group={section.group}
                items={section.items}
                collapsed={!filtersActive && collapsed.has(section.key)}
                onToggle={() => toggleCollapse(section.key)}
                ctx={ctx}
                dragActive={draggingId !== null}
                dragOver={dragOverKey === section.key}
                onDragEnterSection={() => setDragOverKey(section.key)}
                onDragLeaveSection={() =>
                  setDragOverKey((k) => (k === section.key ? null : k))
                }
                onDropSection={() => handleDropOn(section.group ? section.group.id : null)}
              />
            ))}
          </div>
        </div>
      )}

      {history && (
        <DevHistoryPanel
          companyId={history.id}
          companyName={history.name}
          onClose={() => setHistory(null)}
        />
      )}
    </>
  );
}

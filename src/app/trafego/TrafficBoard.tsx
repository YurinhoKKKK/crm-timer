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
import { Link2, Hand, History, Move } from "lucide-react";
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
import ContractBar from "@/components/ContractBar";
import NotesButton from "@/components/notes-panel/NotesButton";
import { formatProjectTime } from "@/lib/contract-time";
import { formatBRL, brToDecimalString, decimalToBRInput } from "@/lib/money-br";
import {
  TRAFFIC_FOCUS,
  TRAFFIC_PLATFORM,
  TRAFFIC_STATUS,
  type TrafficFocus,
  type TrafficPlatform,
  type TrafficStatus,
} from "@/lib/traffic-options";
import type { Label } from "@/lib/labels";
import {
  setTrafficFocus,
  setTrafficPlatform,
  setTrafficStatus,
  setTrafficBudget,
  moveTrafficCompany,
} from "./actions";
import TrafficHistoryPanel from "./TrafficHistoryPanel";

// Quadro do Tráfego — mesma ESTRUTURA do CS (seções coloridas + BoardGrid), aqui
// no formato COMPACTO: linhas de 2 "andares" (nome; modo + etiquetas), colunas
// alinhadas à esquerda, coluna Empresa fixa e UMA ÚNICA rolagem horizontal para o
// quadro inteiro (não uma por seção). As colunas Foco/Plataforma/Status/Orçamento
// são editáveis em TODAS as linhas; o movimento entre grupos é só nas manuais
// (arrastar + menu). Edição e movimento são otimistas, com reversão em erro.

export type TrafficBoardRow = {
  id: string;
  name: string;
  groupId: string | null; // grupo NO TRÁFEGO (já resolvido no servidor; otimista)
  synced: boolean;
  monthsTotal: number | null;
  periodDays: number | null;
  // Datas PURAS (AAAA-MM-DD) do contrato — alimentam a MESMA barra do quadro de
  // Empresas (ContractBar). Vêm da RPC traffic_board (sem ler company_details).
  startedOn: string | null;
  endsOn: string | null;
  labels: Label[];
  focus: TrafficFocus | null;
  platform: TrafficPlatform | null;
  status: TrafficStatus | null;
  budget: string | null; // decimal em texto "digits.dd" (nunca float) | null
  historyCount: number;
  // Nº de Atualizações da empresa COM a área Tráfego (balão de Ações).
  trafficNoteCount: number;
};

const COLLAPSE_KEY = "crm:trafego:grupos-recolhidos";
// Soma das larguras MÍNIMAS das colunas: abaixo disso aparece a rolagem única.
// Dimensionada para caber na área de conteúdo a 1536px com o menu lateral aberto
// (≈1216px) e para a opção MAIS LONGA de cada chip caber em uma linha.
const MIN_WIDTH = 1192;

// --- Chip de MODO (texto CURTO sempre; a cor é só reforço) ------------------ //
function ModeChip({ synced }: { synced: boolean }) {
  return synced ? (
    <span
      title="Sincronizado com Empresas: tem Tráfego e ao menos um marketplace."
      className="inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300"
    >
      <Link2 size={11} aria-hidden="true" />
      Sincronizado
    </span>
  ) : (
    <span
      title="Movimentação manual: só Tráfego (ou Tráfego com site), sem marketplace."
      className="inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300"
    >
      <Hand size={11} aria-hidden="true" />
      Manual
    </span>
  );
}

// --- Contexto de célula ----------------------------------------------------- //
type CellCtx = {
  groups: CompanyGroup[];
  userId: string; // visitante (autor das Atualizações escritas pelo balão)
  canOpenCompany: boolean; // admin abre a central; Gestor de Tráfego NÃO (texto)
  autoOpenNotesId: string | null; // empresa cujo balão abre sozinho (?empresa=)
  onOpen: (id: string) => void;
  openingId: string | null;
  setFocus: (row: TrafficBoardRow, v: TrafficFocus | null) => void;
  setPlatform: (row: TrafficBoardRow, v: TrafficPlatform | null) => void;
  setStatus: (row: TrafficBoardRow, v: TrafficStatus | null) => void;
  setBudget: (row: TrafficBoardRow, decimal: string | null) => void;
  move: (row: TrafficBoardRow, groupId: string) => void;
  openHistory: (row: TrafficBoardRow) => void;
  onRowDragStart: (id: string) => void;
  onRowDragEnd: () => void;
};

// Botão de ícone padrão das Ações: alvo de clique mínimo de 32px.
const ICON_BTN =
  "relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted transition hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd";

// --- Menu "Mover para..." (ícone; só manuais) ------------------------------- //
function MoveMenu({ row, ctx }: { row: TrafficBoardRow; ctx: CellCtx }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  // Sincronizada: menu DESABILITADO com o texto explicativo.
  if (row.synced) {
    const msg = "Sincronizado com Empresas: mova pelo quadro de Empresas.";
    return (
      <button
        type="button"
        disabled
        aria-disabled="true"
        title={msg}
        aria-label={msg}
        className={`${ICON_BTN} cursor-not-allowed opacity-50 hover:bg-transparent hover:text-fg-muted`}
      >
        <Move size={15} aria-hidden="true" />
      </button>
    );
  }

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

// --- Célula da ALÇA de arraste (coluna própria; só manuais, só desktop) ----- //
function DragHandleCell({ row, ctx }: { row: TrafficBoardRow; ctx: CellCtx }) {
  if (row.synced) return null;
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
function EmpresaCell({ row, ctx }: { row: TrafficBoardRow; ctx: CellCtx }) {
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
          // Gestor de Tráfego não acessa a central: nome em texto simples.
          <span className="line-clamp-2 font-medium text-fg" title={row.name}>
            {row.name}
          </span>
        )}
        {/* Andar 2: modo + etiquetas na MESMA linha; cada chip sem quebra. */}
        <div className="flex flex-wrap items-center gap-1">
          <ModeChip synced={row.synced} />
          {row.labels.length > 0 && <LabelChips labels={row.labels} nowrap />}
        </div>
      </div>

      {/* Balão das Atualizações FILTRADAS pela área Tráfego — junto da empresa,
          centralizado na vertical, como nas linhas do quadro de Empresas. Nova
          nota nasce com a área Tráfego travada (origin='traffic'). */}
      <NotesButton
        companyId={row.id}
        companyName={row.name}
        userId={ctx.userId}
        isAdmin={ctx.canOpenCompany}
        notesHref={`/admin/empresas/${row.id}?aba=notes`}
        initialCount={row.trafficNoteCount}
        className="shrink-0"
        areaFilter="trafego"
        lockedArea="trafego"
        origin="traffic"
        showFullTab={ctx.canOpenCompany}
        defaultOpen={ctx.autoOpenNotesId === row.id}
      />
    </div>
  );
}

// --- Célula Tempo de Contrato (MESMA barra de Empresas, variante "board") ---- //
function TimeCell({ row }: { row: TrafficBoardRow }) {
  // Mesma regra do quadro de Empresas: a barra só existe com início E fim. O
  // prefixo é a duração ("12 meses"); a barra acrescenta "· faltam 364 dias".
  if (row.startedOn && row.endsOn) {
    return (
      <ContractBar
        startedOn={row.startedOn}
        endsOn={row.endsOn}
        board
        prefix={formatProjectTime(row.monthsTotal, row.periodDays)}
      />
    );
  }
  return <span className="whitespace-nowrap text-[11px] text-fg-subtle">Não informado</span>;
}

// --- Célula Ações (ícones: Histórico, Mover) -------------------------------- //
function ActionsCell({ row, ctx }: { row: TrafficBoardRow; ctx: CellCtx }) {
  return (
    <div className="flex items-center justify-end gap-0.5">
      <button
        type="button"
        onClick={() => ctx.openHistory(row)}
        title="Histórico"
        aria-label={
          row.historyCount > 0 ? `Histórico (${row.historyCount})` : "Histórico"
        }
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

// --- Editor de Orçamento (campo em reais + Limpar) -------------------------- //
function BudgetEditor({
  row,
  onSubmit,
}: {
  row: TrafficBoardRow;
  onSubmit: (decimal: string | null) => void;
}) {
  const [amount, setAmount] = useState(row.budget != null ? decimalToBRInput(row.budget) : "");
  const [err, setErr] = useState<string | null>(null);

  function submit() {
    const dec = brToDecimalString(amount);
    if (dec == null) {
      setErr("Informe um valor válido (ex.: 1.500,00).");
      return;
    }
    onSubmit(dec);
  }

  const field =
    "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd";

  return (
    <div className="w-[18rem] max-w-[calc(100vw-1.5rem)] p-1.5 text-left">
      <label className="mb-1 block text-xs font-medium text-fg-muted">Orçamento (R$)</label>
      <input
        type="text"
        inputMode="decimal"
        autoFocus
        value={amount}
        onChange={(e) => {
          setAmount(e.target.value);
          setErr(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Ex.: 1.500,00"
        className={`${field} tabular-nums`}
      />
      {err && (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {err}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          className="flex-1 rounded-lg bg-risd px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-chrysler focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
        >
          Salvar
        </button>
        <button
          type="button"
          onClick={() => onSubmit(null)}
          className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-fg-muted transition hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
        >
          Limpar
        </button>
      </div>
    </div>
  );
}

function BudgetCell({ row, ctx }: { row: TrafficBoardRow; ctx: CellCtx }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const brl = formatBRL(row.budget);
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Definir orçamento"
        className={`whitespace-nowrap rounded px-1 font-medium tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
          brl ? "text-fg" : "text-xs text-fg-subtle"
        }`}
      >
        {brl ?? "Não definido"}
      </button>
      {open && ref.current && (
        <AnchoredPopover anchor={ref.current} onClose={() => setOpen(false)} width={288}>
          <BudgetEditor
            row={row}
            onSubmit={(decimal) => {
              setOpen(false);
              ctx.setBudget(row, decimal);
            }}
          />
        </AnchoredPopover>
      )}
    </>
  );
}

// --- Colunas (fonte única; ordem/larguras compactas) ------------------------ //
type TrafficColumn = BoardColumn<TrafficBoardRow, CellCtx>;

const COLUMNS: TrafficColumn[] = [
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
    id: "time",
    label: "Tempo de Contrato",
    width: "200px",
    align: "left",
    cell: (row) => <TimeCell row={row} />,
  },
  {
    id: "focus",
    label: "Foco",
    width: "150px",
    align: "left",
    cell: (row, ctx) => (
      <ChipPicker<TrafficFocus>
        value={row.focus}
        options={TRAFFIC_FOCUS}
        ariaLabel="Alterar Foco"
        onPick={(v) => ctx.setFocus(row, v)}
        compact
      />
    ),
  },
  {
    id: "platform",
    label: "Plataforma",
    width: "140px",
    align: "left",
    cell: (row, ctx) => (
      <ChipPicker<TrafficPlatform>
        value={row.platform}
        options={TRAFFIC_PLATFORM}
        ariaLabel="Alterar Plataforma"
        onPick={(v) => ctx.setPlatform(row, v)}
        compact
      />
    ),
  },
  {
    id: "status",
    label: "Status",
    width: "180px",
    align: "left",
    cell: (row, ctx) => (
      <ChipPicker<TrafficStatus>
        value={row.status}
        options={TRAFFIC_STATUS}
        ariaLabel="Alterar Status"
        onPick={(v) => ctx.setStatus(row, v)}
        compact
      />
    ),
  },
  {
    id: "budget",
    label: "Orçamento",
    width: "120px",
    align: "right",
    tight: true,
    cell: (row, ctx) => <BudgetCell row={row} ctx={ctx} />,
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
function TrafficSection({
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
  items: TrafficBoardRow[];
  collapsed: boolean;
  onToggle: () => void;
  ctx: CellCtx;
  dragActive: boolean;
  dragOver: boolean;
  onDragEnterSection: () => void;
  onDragLeaveSection: () => void;
  onDropSection: () => void;
}) {
  // "Sem grupo" não é destino de movimento manual (null = seguir a correspondência
  // de Empresas, não um grupo). Só grupos reais recebem arraste.
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
      // A tabela encosta nas bordas do cartão (p-0): a coluna fixa alinha à borda
      // na rolagem ÚNICA. `overflowClip` recorta os cantos quadrados da coluna
      // fixa ao raio do cartão SEM virar contêiner de rolagem (overflow: clip, não
      // hidden) — o sticky continua preso ao viewport único do quadro.
      bodyClassName="p-0"
      overflowClip
    >
      {items.length === 0 ? (
        <p className="px-3 py-4 text-center text-sm text-fg-subtle">
          {sectionKey === SEM_GRUPO
            ? "Nenhuma empresa sem grupo."
            : "Nenhuma empresa neste grupo."}
        </p>
      ) : (
        // scroll=false: a rolagem horizontal é ÚNICA, no contêiner do quadro.
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
export default function TrafficBoard({
  companies,
  groups,
  missingCorrespondence,
  userId,
  canOpenCompany,
}: {
  companies: TrafficBoardRow[];
  groups: CompanyGroup[]; // os 6 grupos do Tráfego (adaptados a CompanyGroup)
  missingCorrespondence: string[];
  userId: string; // visitante (autor das Atualizações escritas pelo balão)
  // Admin abre a central da empresa pelo nome; o Gestor de Tráfego não (texto).
  canOpenCompany: boolean;
}) {
  const router = useRouter();
  // Notificação do gestor leva a /trafego?empresa=<id> — abre o balão daquela
  // empresa sozinho.
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
  const [history, setHistory] = useState<TrafficBoardRow | null>(null);

  // Arrastar (só manuais; grupos reais recebem). Mesmo padrão do quadro Empresas.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  // Núcleo otimista: aplica `patch` na linha, chama a action, reverte se falhar.
  async function optimistic(
    row: TrafficBoardRow,
    patch: Partial<TrafficBoardRow>,
    run: () => Promise<{ error: string | null }>
  ) {
    const snapshot = rows;
    setNotice(null);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
    const res = await run();
    if (res.error) {
      setRows(snapshot);
      setNotice(res.error);
    }
  }

  function doSetFocus(row: TrafficBoardRow, v: TrafficFocus | null) {
    if (v === row.focus) return;
    optimistic(row, { focus: v }, () => setTrafficFocus(row.id, v));
  }
  function doSetPlatform(row: TrafficBoardRow, v: TrafficPlatform | null) {
    if (v === row.platform) return;
    optimistic(row, { platform: v }, () => setTrafficPlatform(row.id, v));
  }
  function doSetStatus(row: TrafficBoardRow, v: TrafficStatus | null) {
    if (v === row.status) return;
    optimistic(row, { status: v }, () => setTrafficStatus(row.id, v));
  }
  function doSetBudget(row: TrafficBoardRow, decimal: string | null) {
    if (decimal === row.budget) return;
    optimistic(row, { budget: decimal }, () => setTrafficBudget(row.id, decimal));
  }

  async function doMove(row: TrafficBoardRow, groupId: string) {
    if (row.synced || row.groupId === groupId) return;
    const snapshot = rows;
    setNotice(null);
    // Otimista: a linha pula de seção (manual → groupId = o grupo escolhido).
    setRows((rs) =>
      rs.map((r) => (r.id === row.id ? { ...r, groupId } : r))
    );
    const res = await moveTrafficCompany(row.id, groupId);
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
    if (row && !row.synced && row.groupId !== groupId) doMove(row, groupId);
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

  // Os 6 grupos aparecem SEMPRE (destino de arraste); "Sem grupo" só com empresas.
  // Com busca ativa, oculta seções vazias.
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
    setFocus: doSetFocus,
    setPlatform: doSetPlatform,
    setStatus: doSetStatus,
    setBudget: doSetBudget,
    move: doMove,
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

      {missingCorrespondence.map((name) => (
        <div
          key={name}
          className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200"
        >
          O grupo <strong>{name}</strong> de Empresas não tem correspondência no
          Tráfego. Configure na edição do grupo.
        </div>
      ))}

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
        <EmptyState>Nenhuma empresa contratou Tráfego ainda.</EmptyState>
      ) : visibleSections.length === 0 ? (
        <EmptyState>Nenhuma empresa corresponde à busca.</EmptyState>
      ) : (
        // UMA única rolagem horizontal para o quadro inteiro: todas as seções
        // compartilham este viewport; a coluna Empresa fica fixa à esquerda. O
        // min-width dispara a rolagem só quando a área é mais estreita que a soma
        // mínima das colunas.
        <div className="overflow-x-auto pb-10">
          <div className="space-y-4" style={{ minWidth: MIN_WIDTH }}>
            {visibleSections.map((section) => (
              <TrafficSection
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
        <TrafficHistoryPanel
          companyId={history.id}
          companyName={history.name}
          onClose={() => setHistory(null)}
        />
      )}
    </>
  );
}

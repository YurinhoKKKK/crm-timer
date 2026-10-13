"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History, Lock } from "lucide-react";
import AnchoredPopover from "@/components/AnchoredPopover";
import ChipPicker from "@/components/ChipPicker";
import GroupSection from "@/components/company-groups/GroupSection";
import BoardGrid, { type BoardColumn } from "@/components/board/BoardGrid";
import { DateField } from "@/components/DateField";
import type { CompanyGroup } from "@/lib/company-groups";
import { formatBRL, brToDecimalString, decimalToBRInput } from "@/lib/money-br";
import {
  CHURN_REASON_OPTIONS,
  churnReasonChipClass,
  type ChurnReason,
} from "@/lib/churn";
import NotesButton from "@/components/notes-panel/NotesButton";
import { csNotesSource } from "@/components/notes-panel/notes-source";
import CsHistoryPanel from "../CsHistoryPanel";
import {
  setChurnDate,
  setChurnReason,
  clearChurnReason,
  setChurnSeller,
  setChurnMrr,
} from "./actions";

// Controle de Churn (2ª aba do Sucesso do Cliente) — quadro no formato COMPACTO do
// componente compartilhado (BoardGrid): largura total, UMA rolagem horizontal, a
// coluna Cliente fixa. Duas seções (Finalizados, Cancelados) com o nome/cor do
// grupo de Empresas correspondente (via churn_type). Edição otimista com reversão
// e erro classificado; os valores derivados (tempo permanecido, receita perdida) e
// o resumo recalculam no servidor via router.refresh após cada salvamento.

export type ChurnRow = {
  id: string; // company_churns.id (chave das RPCs de edição)
  companyId: string;
  companyName: string;
  churnType: "finalizado" | "cancelado";
  churnedOn: string | null; // AAAA-MM-DD | null
  reason: string; // enum churn_reason
  sellerName: string | null;
  consultants: { id: string; name: string }[];
  mrr: string | null; // decimal em texto "digits.dd" | null
  monthsContracted: number | null;
  monthsStayed: number | null;
  lostRevenue: string | null; // decimal em texto (cancelados calculáveis) | null
  csNoteCount: number; // Atualizações do CS da empresa (balão), vindo do churn_board.
};

// Soma das larguras MÍNIMAS das colunas (ver COLUMNS). O contêiner de rolagem usa
// esta largura mínima: abaixo dela aparece a rolagem horizontal ÚNICA e TODAS as
// colunas continuam alcançáveis (o bug anterior era minWidth < soma das mínimas, o
// que cortava as últimas colunas).
const MIN_WIDTH = 1298;
// Espaço FIXO do balão de Atualizações no início da célula Cliente — MESMA largura
// do Desenvolvimento e do Tráfego, para o balão e o começo dos nomes alinharem em
// todas as linhas (na coluna fixa, sempre visível na rolagem).
const NOTE_GUTTER_PX = 56;

function monthsLabel(n: number): string {
  return `${n} ${n === 1 ? "mês" : "meses"}`;
}

function formatDateBR(iso: string | null): string {
  if (!iso) return "Sem data";
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : "Sem data";
}

// --- Contexto de célula ----------------------------------------------------- //
type CellCtx = {
  userId: string; // visitante (autor das Atualizações escritas pelo balão)
  onOpenCompany: (id: string) => void;
  openingId: string | null;
  setDate: (row: ChurnRow, date: string | null) => void;
  // reason null = "Limpar" → volta para 'nao_informado' ("Não informado").
  setReason: (row: ChurnRow, reason: ChurnReason | null) => void;
  setSeller: (row: ChurnRow, text: string | null) => void;
  setMrr: (row: ChurnRow, decimal: string | null) => void;
  openHistory: (row: ChurnRow) => void;
};

// --- Cliente (coluna fixa; balão de Atualizações + nome clicável) ----------- //
function ClienteCell({ row, ctx }: { row: ChurnRow; ctx: CellCtx }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {/* Balão no espaço FIXO do início da célula (mesma posição/largura do Dev e
          do Tráfego). Fonte 'cs' (cs_notes/cs_note_replies) pela empresa do churn —
          a MESMA nota aparece na aba Clientes. Admin-only, igual ao resto do CS. */}
      <div style={{ width: NOTE_GUTTER_PX }} className="flex shrink-0 justify-start">
        <NotesButton
          companyId={row.companyId}
          companyName={row.companyName}
          userId={ctx.userId}
          isAdmin
          notesHref=""
          initialCount={row.csNoteCount}
          source={csNotesSource}
          className="shrink-0"
        />
      </div>

      <button
        type="button"
        onClick={() => ctx.onOpenCompany(row.companyId)}
        title={row.companyName}
        className="group/co block min-w-0 flex-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
      >
        <span className="line-clamp-2 font-medium text-fg transition group-hover/co:text-risd">
          {row.companyName}
        </span>
        {ctx.openingId === row.companyId && (
          <span className="mt-0.5 block text-xs text-fg-subtle">Abrindo…</span>
        )}
      </button>
    </div>
  );
}

// --- Data (editável; "Sem data" em destaque discreto) ----------------------- //
function DataCell({ row, ctx }: { row: ChurnRow; ctx: CellCtx }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Definir a data do churn"
        className={`whitespace-nowrap rounded px-1 tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
          row.churnedOn ? "text-fg" : "text-xs italic text-fg-subtle"
        }`}
      >
        {formatDateBR(row.churnedOn)}
      </button>
      {open && ref.current && (
        <AnchoredPopover anchor={ref.current} onClose={() => setOpen(false)} width={300}>
          <div className="w-[18rem] max-w-[calc(100vw-1.5rem)] p-1">
            <p className="mb-1.5 px-1 text-xs font-medium text-fg-muted">Data do churn</p>
            <DateField
              value={row.churnedOn ?? ""}
              onChange={(v) => {
                setOpen(false);
                ctx.setDate(row, v || null);
              }}
              ariaLabel="Data do churn"
            />
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                ctx.setDate(row, null);
              }}
              className="mt-2 w-full rounded-md px-2.5 py-1.5 text-left text-sm text-fg-muted transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
            >
              Limpar
            </button>
          </div>
        </AnchoredPopover>
      )}
    </>
  );
}

const CHIP =
  "inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap";

// --- Motivo (chip COLORIDO por motivo; finalizado travado) ------------------ //
function MotivoCell({ row, ctx }: { row: ChurnRow; ctx: CellCtx }) {
  // Finalizados: "Projeto finalizado" TRAVADO (não editável) — chip na cor do motivo.
  if (row.churnType === "finalizado") {
    return (
      <span
        title="Projetos finalizados têm o motivo travado."
        className={`${CHIP} ${churnReasonChipClass("projeto_finalizado")}`}
      >
        <Lock size={11} aria-hidden="true" className="shrink-0" />
        Projeto finalizado
      </span>
    );
  }

  // Cancelados: chip colorido + popover (mesmo ChipPicker do Tráfego), com as
  // cores de cada motivo e o botão "Limpar" (volta para "Não informado").
  // 'nao_informado' vira o placeholder (null) do seletor.
  return (
    <ChipPicker<ChurnReason>
      value={row.reason === "nao_informado" ? null : (row.reason as ChurnReason)}
      options={CHURN_REASON_OPTIONS}
      onPick={(v) => ctx.setReason(row, v)}
      ariaLabel="Alterar o motivo do cancelamento"
      placeholder="Não informado"
      compact
      clearable
    />
  );
}

// --- Vendedor (texto editável; vazio = "Não informado") --------------------- //
function SellerEditor({
  row,
  onSubmit,
}: {
  row: ChurnRow;
  onSubmit: (text: string | null) => void;
}) {
  const [text, setText] = useState(row.sellerName ?? "");
  const field =
    "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd";
  return (
    <div className="w-[18rem] max-w-[calc(100vw-1.5rem)] p-1.5 text-left">
      <label className="mb-1 block text-xs font-medium text-fg-muted">Vendedor</label>
      <input
        type="text"
        autoFocus
        maxLength={200}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit(text.trim() || null);
          }
        }}
        placeholder="Nome do vendedor"
        className={field}
      />
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onSubmit(text.trim() || null)}
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

function SellerCell({ row, ctx }: { row: ChurnRow; ctx: CellCtx }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Definir o vendedor"
        className={`truncate rounded px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
          row.sellerName ? "text-fg" : "text-xs italic text-fg-subtle"
        }`}
      >
        {row.sellerName ?? "Não informado"}
      </button>
      {open && ref.current && (
        <AnchoredPopover anchor={ref.current} onClose={() => setOpen(false)} width={288}>
          <SellerEditor
            row={row}
            onSubmit={(t) => {
              setOpen(false);
              ctx.setSeller(row, t);
            }}
          />
        </AnchoredPopover>
      )}
    </>
  );
}

// --- Consultor (chips, somente leitura) ------------------------------------- //
function ConsultorCell({ row }: { row: ChurnRow }) {
  if (row.consultants.length === 0) {
    return <span className="text-xs italic text-fg-subtle">Sem consultor</span>;
  }
  return (
    <div className="flex min-w-0 flex-wrap gap-1">
      {row.consultants.map((c) => (
        <span
          key={c.id}
          title={c.name}
          className="inline-flex max-w-full items-center truncate rounded-full border border-line bg-surface-2 px-2 py-0.5 text-xs font-medium text-fg"
        >
          {c.name}
        </span>
      ))}
    </div>
  );
}

// --- Valor MRR (editável; não altera company_contract_values) --------------- //
function MrrEditor({
  row,
  onSubmit,
}: {
  row: ChurnRow;
  onSubmit: (decimal: string | null) => void;
}) {
  const [amount, setAmount] = useState(row.mrr != null ? decimalToBRInput(row.mrr) : "");
  const [err, setErr] = useState<string | null>(null);
  const field =
    "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd";

  function submit() {
    const dec = brToDecimalString(amount);
    if (dec == null) {
      setErr("Informe um valor válido (ex.: 2.980,00).");
      return;
    }
    onSubmit(dec);
  }

  return (
    <div className="w-[18rem] max-w-[calc(100vw-1.5rem)] p-1.5 text-left">
      <label className="mb-1 block text-xs font-medium text-fg-muted">Valor MRR (R$)</label>
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
        placeholder="Ex.: 2.980,00"
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

function MrrCell({ row, ctx }: { row: ChurnRow; ctx: CellCtx }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const brl = formatBRL(row.mrr);
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Definir o MRR (foto do momento)"
        className={`whitespace-nowrap rounded px-1 font-medium tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
          brl ? "text-fg" : "text-xs italic text-fg-subtle"
        }`}
      >
        {brl ?? "Não informado"}
      </button>
      {open && ref.current && (
        <AnchoredPopover anchor={ref.current} onClose={() => setOpen(false)} width={288}>
          <MrrEditor
            row={row}
            onSubmit={(decimal) => {
              setOpen(false);
              ctx.setMrr(row, decimal);
            }}
          />
        </AnchoredPopover>
      )}
    </>
  );
}

// --- Receita Perdida (só leitura) ------------------------------------------- //
function LostCell({ row }: { row: ChurnRow }) {
  if (row.churnType === "finalizado") {
    return (
      <span
        title="Projetos finalizados não geram receita perdida."
        className="text-xs text-fg-subtle"
      >
        Não se aplica
      </span>
    );
  }
  const brl = formatBRL(row.lostRevenue);
  if (brl) {
    return <span className="font-medium tabular-nums text-fg">{brl}</span>;
  }
  // Não calculável: diz o que falta (Tempo de Projeto / Permanecido / MRR).
  const missing: string[] = [];
  if (row.monthsContracted == null) missing.push("Tempo de Projeto");
  if (row.monthsStayed == null) missing.push("Tempo Permanecido");
  if (row.mrr == null) missing.push("Valor MRR");
  return (
    <span
      title={missing.length ? `Falta: ${missing.join(", ")}.` : "Dados insuficientes."}
      className="text-xs italic text-fg-subtle"
    >
      Não calculável
    </span>
  );
}

// --- Ações (Histórico) ------------------------------------------------------ //
function AcoesCell({ row, ctx }: { row: ChurnRow; ctx: CellCtx }) {
  return (
    <button
      type="button"
      onClick={() => ctx.openHistory(row)}
      title="Histórico"
      aria-label="Histórico"
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted transition hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
    >
      <History size={15} aria-hidden="true" />
    </button>
  );
}

// --- Colunas (fonte única; ordem da etapa 2) -------------------------------- //
type ChurnColumn = BoardColumn<ChurnRow, CellCtx>;

const COLUMNS: ChurnColumn[] = [
  {
    id: "company",
    label: "Cliente",
    width: "minmax(240px, 1fr)",
    align: "left",
    stickyLeft: 0,
    borderRight: true,
    // Recua o rótulo pelo espaço do balão + gap, alinhando com o início dos nomes.
    labelIndent: NOTE_GUTTER_PX + 8,
    cell: (row, ctx) => <ClienteCell row={row} ctx={ctx} />,
  },
  {
    id: "data",
    label: "Data",
    width: "100px",
    align: "center",
    cell: (row, ctx) => <DataCell row={row} ctx={ctx} />,
  },
  {
    id: "motivo",
    label: "Motivo",
    width: "170px",
    align: "left",
    clip: true,
    cell: (row, ctx) => <MotivoCell row={row} ctx={ctx} />,
  },
  {
    id: "vendedor",
    label: "Vendedor",
    width: "140px",
    align: "left",
    clip: true,
    cell: (row, ctx) => <SellerCell row={row} ctx={ctx} />,
  },
  {
    id: "consultor",
    label: "Consultor",
    width: "170px",
    align: "left",
    clip: true,
    cell: (row) => <ConsultorCell row={row} />,
  },
  {
    id: "mrr",
    label: "MRR",
    width: "110px",
    align: "right",
    cell: (row, ctx) => <MrrCell row={row} ctx={ctx} />,
  },
  {
    id: "projeto",
    label: "Projeto",
    labelTitle: "Tempo de Projeto",
    width: "90px",
    align: "center",
    cell: (row) =>
      row.monthsContracted != null ? (
        <span className="whitespace-nowrap text-fg" title="Meses contratados — corrige-se em Editar empresa.">
          {monthsLabel(row.monthsContracted)}
        </span>
      ) : (
        <span className="text-fg-subtle" title="Tempo de Projeto: não informado (sem período de contrato).">
          —
        </span>
      ),
  },
  {
    id: "permanecido",
    label: "Permanência",
    labelTitle: "Tempo Permanecido",
    width: "100px",
    align: "center",
    cell: (row) =>
      row.monthsStayed != null ? (
        <span className="whitespace-nowrap text-fg" title="Meses completos entre a entrada e o churn.">
          {monthsLabel(row.monthsStayed)}
        </span>
      ) : (
        <span className="text-fg-subtle" title="Tempo Permanecido: não informado (sem entrada ou sem data).">
          —
        </span>
      ),
  },
  {
    id: "perdida",
    label: "Receita perdida",
    width: "122px",
    align: "right",
    cell: (row) => <LostCell row={row} />,
  },
  {
    id: "acoes",
    label: "Ações",
    width: "56px",
    align: "right",
    tight: true,
    cell: (row, ctx) => <AcoesCell row={row} ctx={ctx} />,
  },
];

// --- Seção ------------------------------------------------------------------ //
function ChurnSection({
  group,
  fallbackName,
  items,
  collapsed,
  onToggle,
  ctx,
}: {
  group: CompanyGroup | null;
  fallbackName: string;
  items: ChurnRow[];
  collapsed: boolean;
  onToggle: () => void;
  ctx: CellCtx;
}) {
  // O cabeçalho usa SEMPRE o grupo de Empresas correspondente (nome + cor via
  // churn_type). Sem correspondência (não deveria ocorrer), cai num rótulo neutro.
  const groupForHeader: CompanyGroup | null =
    group ?? { id: fallbackName, name: fallbackName, color: "#64748B", position: 0, kind: "paused" };
  return (
    <GroupSection
      group={groupForHeader}
      count={items.length}
      collapsed={collapsed}
      onToggleCollapse={onToggle}
      bodyClassName="p-0"
      overflowClip
    >
      {items.length === 0 ? (
        <p className="px-3 py-4 text-center text-sm text-fg-subtle">
          Nenhum churn neste período.
        </p>
      ) : (
        <BoardGrid columns={COLUMNS} rows={items} ctx={ctx} minWidth={MIN_WIDTH} compact scroll={false} />
      )}
    </GroupSection>
  );
}

// --- Quadro ----------------------------------------------------------------- //
export default function ChurnBoard({
  rows: initial,
  finalizadoGroup,
  canceladoGroup,
  userId,
}: {
  rows: ChurnRow[];
  finalizadoGroup: CompanyGroup | null;
  canceladoGroup: CompanyGroup | null;
  userId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [openingId, setOpeningId] = useState<string | null>(null);
  useEffect(() => {
    if (!isPending) setOpeningId(null);
  }, [isPending]);

  function openCompany(id: string) {
    setOpeningId(id);
    startTransition(() => router.push(`/admin/empresas/${id}`));
  }

  const [rows, setRows] = useState(initial);
  useEffect(() => setRows(initial), [initial]);

  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<ChurnRow | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Núcleo otimista: aplica `patch` na linha, chama a action, reverte se falhar.
  // Em caso de sucesso recarrega do servidor para recomputar os derivados (tempo
  // permanecido, receita perdida), a ordem por data e o resumo do topo.
  async function optimistic(
    row: ChurnRow,
    patch: Partial<ChurnRow>,
    run: () => Promise<{ error: string | null }>
  ) {
    const snapshot = rows;
    setNotice(null);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
    const res = await run();
    if (res.error) {
      setRows(snapshot);
      setNotice(res.error);
      return;
    }
    router.refresh();
  }

  const ctx: CellCtx = {
    userId,
    onOpenCompany: openCompany,
    openingId,
    setDate: (row, date) => {
      if (date === row.churnedOn) return;
      optimistic(row, { churnedOn: date }, () => setChurnDate(row.id, date));
    },
    setReason: (row, reason) => {
      // "Limpar" (reason null) volta para 'nao_informado'; os 6 motivos gravam direto.
      const target = reason ?? "nao_informado";
      if (target === row.reason) return;
      optimistic(row, { reason: target }, () =>
        reason ? setChurnReason(row.id, reason) : clearChurnReason(row.id)
      );
    },
    setSeller: (row, text) => {
      if ((text ?? null) === (row.sellerName ?? null)) return;
      optimistic(row, { sellerName: text }, () => setChurnSeller(row.id, text));
    },
    setMrr: (row, decimal) => {
      if ((decimal ?? null) === (row.mrr ?? null)) return;
      optimistic(row, { mrr: decimal }, () => setChurnMrr(row.id, decimal));
    },
    openHistory: setHistory,
  };

  const finalizados = useMemo(() => rows.filter((r) => r.churnType === "finalizado"), [rows]);
  const cancelados = useMemo(() => rows.filter((r) => r.churnType === "cancelado"), [rows]);

  return (
    <>
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

      {/* UMA rolagem horizontal para o quadro inteiro; a coluna Cliente fica fixa. */}
      <div className="overflow-x-auto pb-10">
        <div className="space-y-4" style={{ minWidth: MIN_WIDTH }}>
          <ChurnSection
            group={finalizadoGroup}
            fallbackName="Projetos Finalizados"
            items={finalizados}
            collapsed={collapsed.has("finalizado")}
            onToggle={() => toggleCollapse("finalizado")}
            ctx={ctx}
          />
          <ChurnSection
            group={canceladoGroup}
            fallbackName="Cancelados"
            items={cancelados}
            collapsed={collapsed.has("cancelado")}
            onToggle={() => toggleCollapse("cancelado")}
            ctx={ctx}
          />
        </div>
      </div>

      {history && (
        <CsHistoryPanel
          companyId={history.companyId}
          companyName={history.companyName}
          onlyChurn
          onClose={() => setHistory(null)}
        />
      )}
    </>
  );
}

"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { History } from "lucide-react";
import { FilterBar, SearchBox, EmptyState, norm } from "@/components/ListControls";
import GroupSection from "@/components/company-groups/GroupSection";
import { groupCompanies, type CompanyGroup } from "@/lib/company-groups";
import { DateField } from "@/components/DateField";
import {
  CS_STATUS_META,
  CS_GENERAL_ORDER,
  CS_PERSON_ORDER,
  type CsNpsStatus,
} from "@/lib/cs-status";
import {
  setCompanyNps,
  setMeetingOn,
  setPersonNps,
  setContractValues,
} from "./actions";
import CsHistoryPanel from "./CsHistoryPanel";
import NotesButton from "@/components/notes-panel/NotesButton";
import { csNotesSource } from "@/components/notes-panel/notes-source";

// Responsável (consultor, colaborador ou AMBOS na mesma empresa) + seu NPS
// individual naquela empresa. O rótulo do papel vai SEMPRE em texto.
export type Responsible = {
  id: string;
  name: string;
  role: "consultor" | "colaborador" | "ambos";
  status: CsNpsStatus | null;
};

export type CsRow = {
  id: string;
  name: string;
  groupId: string | null;
  startedOn: string | null;
  monthlyValue: string | null;
  projectValue: string | null;
  installments: number | null;
  monthsTotal: number | null;
  periodDays: number | null;
  npsStatus: CsNpsStatus | null;
  meetingOn: string | null; // 'AAAA-MM-DD' | null
  responsibles: Responsible[];
  csNoteCount: number; // Atualizações do CS (tabelas próprias, admin-only).
};

const COLLAPSE_KEY = "crm:cs:grupos-recolhidos";

// --- Formatação (só exibição; nada de Date/fuso em dinheiro ou datas) ------- //

function formatDateBR(iso: string | null): string {
  if (!iso) return "Não informado";
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : "Não informado";
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
function formatBRL(text: string | null): string | null {
  if (text == null) return null;
  const n = Number(text);
  return Number.isFinite(n) ? BRL.format(n) : null;
}

function formatProjectTime(months: number | null, days: number | null): string {
  if (months == null || days == null) return "Não informado";
  const parts: string[] = [];
  if (months > 0) parts.push(`${months} ${months === 1 ? "mês" : "meses"}`);
  if (days > 0) parts.push(`${days} ${days === 1 ? "dia" : "dias"}`);
  return parts.length > 0 ? parts.join(" e ") : "0 dias";
}

function roleLabel(role: Responsible["role"]): string {
  if (role === "ambos") return "Consultor e Colaborador";
  return role === "consultor" ? "Consultor" : "Colaborador";
}

// Dinheiro: o input aceita BR ("2.980,00"); convertemos por TEXTO para "digits.dd"
// e enviamos como texto ao banco (nunca float no JS). Vírgula = decimal, ponto =
// milhar (convenção BR). Inválido → null.
function brToDecimalString(raw: string): string | null {
  let s = raw.replace(/[^\d.,]/g, "");
  if (!s) return null;
  if (s.includes(",")) {
    if ((s.match(/,/g) || []).length > 1) return null;
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/\./g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [i, f = ""] = s.split(".");
  return `${i}.${(f + "00").slice(0, 2)}`;
}

// "10000.00" → "10.000,00" (pré-preenche o input em BR).
function decimalToBRInput(ds: string): string {
  const [i, f = "00"] = ds.split(".");
  return `${Number(i).toLocaleString("pt-BR")},${(f + "00").slice(0, 2)}`;
}

// "digits.dd" → centavos (inteiro) — para prévia e otimismo, sem float de dinheiro.
function decimalToCents(ds: string): number {
  const [i, f = "00"] = ds.split(".");
  return Number(i) * 100 + Number((f + "00").slice(0, 2));
}

// centavos (inteiro) → "digits.dd".
function centsToDecimal(cents: number): string {
  const c = Math.max(0, Math.round(cents));
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
}

// centavos (inteiro) → "R$ 1.234,56" (só exibição).
function centsToBRL(cents: number): string {
  const c = Math.max(0, Math.round(cents));
  const reais = Math.floor(c / 100);
  return `R$ ${reais.toLocaleString("pt-BR")},${String(c % 100).padStart(2, "0")}`;
}

// --- Popover ancorado (portal + posição fixa) — não é recortado pelo
//     overflow-x das seções; fecha no Esc e no clique fora; z-overlay. --------
function AnchoredPopover({
  anchor,
  onClose,
  children,
  width = 240,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    function place() {
      const panel = panelRef.current;
      if (!panel) return;
      const r = anchor.getBoundingClientRect();
      const h = panel.offsetHeight;
      const w = panel.offsetWidth || width;
      let left = Math.min(Math.max(8, r.left), window.innerWidth - 8 - w);
      let top = r.bottom + 6;
      // Vira para cima se estourar embaixo.
      if (top + h > window.innerHeight - 8) {
        const above = r.top - 6 - h;
        top = above >= 8 ? above : Math.max(8, window.innerHeight - 8 - h);
      }
      setPos({ top, left });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor, width]);

  useEffect(() => {
    function onDown(e: PointerEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchor.contains(t)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      style={{
        position: "fixed",
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        minWidth: width,
        visibility: pos ? "visible" : "hidden",
      }}
      className="z-overlay max-w-[calc(100vw-1rem)] rounded-xl border border-line bg-surface p-1.5 shadow-pop"
    >
      {children}
    </div>,
    document.body
  );
}

// Lista de opções de status (+ Limpar) para o popover de NPS.
function StatusOptions({
  order,
  current,
  onPick,
}: {
  order: CsNpsStatus[];
  current: CsNpsStatus | null;
  onPick: (v: CsNpsStatus | null) => void;
}) {
  return (
    <div className="flex flex-col">
      {order.map((v) => {
        const meta = CS_STATUS_META[v];
        const active = current === v;
        return (
          <button
            key={v}
            type="button"
            role="menuitem"
            onClick={() => onPick(v)}
            className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
              active ? "font-semibold text-fg" : "text-fg-muted"
            }`}
          >
            <span
              aria-hidden="true"
              className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full border ${meta.chipClass}`}
            />
            {meta.selectLabel}
          </button>
        );
      })}
      <div className="my-1 border-t border-line" />
      <button
        type="button"
        role="menuitem"
        onClick={() => onPick(null)}
        className="rounded-md px-2.5 py-1.5 text-left text-sm text-fg-muted transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
      >
        Limpar
      </button>
    </div>
  );
}

// Chip de status (exibição). Sem valor → "Sem NPS".
function StatusChip({ status }: { status: CsNpsStatus | null }) {
  if (!status) return <span className="text-fg-subtle">Sem NPS</span>;
  const meta = CS_STATUS_META[status];
  return (
    <span
      title={meta.selectLabel}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${meta.chipClass}`}
    >
      {meta.shortLabel}
    </span>
  );
}

// --- Contexto de célula (navegação + edição otimista + histórico) ----------- //

type CellCtx = {
  userId: string; // usuário atual (autor das atualizações do CS).
  onOpenCompany: (id: string) => void;
  openingId: string | null;
  setCompanyNps: (row: CsRow, status: CsNpsStatus | null) => void;
  setPersonNps: (row: CsRow, userId: string, status: CsNpsStatus | null) => void;
  setMeeting: (row: CsRow, date: string | null) => void;
  setContract: (
    row: CsRow,
    installments: number | null,
    total: string | null,
    monthly: string | null
  ) => void;
  openHistory: (row: CsRow) => void;
};

// --- Células ---------------------------------------------------------------- //

function EmpresaCell({ row, ctx }: { row: CsRow; ctx: CellCtx }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <button
        type="button"
        onClick={() => ctx.onOpenCompany(row.id)}
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
      {/* Ações rápidas na coluna FIXA (sticky-left): sempre visíveis, sem rolar
          para o lado. Balão das Atualizações do CS ao lado do Histórico. */}
      <div className="flex items-center gap-1">
        <NotesButton
          companyId={row.id}
          companyName={row.name}
          userId={ctx.userId}
          isAdmin
          notesHref=""
          initialCount={row.csNoteCount}
          source={csNotesSource}
          size="sm"
        />
        <button
          type="button"
          onClick={() => ctx.openHistory(row)}
          className="inline-flex w-fit items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-fg-muted transition hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
        >
          <History size={12} aria-hidden="true" />
          Histórico
        </button>
      </div>
    </div>
  );
}

function NpsGeralCell({ row, ctx }: { row: CsRow; ctx: CellCtx }) {
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
        title="Alterar NPS geral"
        className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
      >
        <StatusChip status={row.npsStatus} />
      </button>
      {open && ref.current && (
        <AnchoredPopover anchor={ref.current} onClose={() => setOpen(false)} width={260}>
          <StatusOptions
            order={CS_GENERAL_ORDER}
            current={row.npsStatus}
            onPick={(v) => {
              setOpen(false);
              ctx.setCompanyNps(row, v);
            }}
          />
        </AnchoredPopover>
      )}
    </>
  );
}

function PersonChip({ row, person, ctx }: { row: CsRow; person: Responsible; ctx: CellCtx }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const rl = roleLabel(person.role);
  const statusTitle = person.status
    ? ` · ${CS_STATUS_META[person.status].selectLabel}`
    : " · Sem NPS";
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${person.name} — ${rl}${statusTitle}`}
        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-xs text-fg transition hover:ring-2 hover:ring-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
      >
        <span className="truncate font-medium">{person.name}</span>
        <span className="shrink-0 rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
          {rl}
        </span>
        <span
          className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
            person.status ? CS_STATUS_META[person.status].chipClass : "border-line text-fg-subtle"
          }`}
        >
          {person.status ? CS_STATUS_META[person.status].shortLabel : "Sem NPS"}
        </span>
      </button>
      {open && ref.current && (
        <AnchoredPopover anchor={ref.current} onClose={() => setOpen(false)}>
          <StatusOptions
            order={CS_PERSON_ORDER}
            current={person.status}
            onPick={(v) => {
              setOpen(false);
              ctx.setPersonNps(row, person.id, v);
            }}
          />
        </AnchoredPopover>
      )}
    </>
  );
}

function ResponsiblesCell({ row, ctx }: { row: CsRow; ctx: CellCtx }) {
  if (row.responsibles.length === 0) {
    return <span className="text-xs italic text-fg-subtle">Sem responsável</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {row.responsibles.map((p) => (
        <PersonChip key={`${p.role}:${p.id}`} row={row} person={p} ctx={ctx} />
      ))}
    </div>
  );
}

function MeetingCell({ row, ctx }: { row: CsRow; ctx: CellCtx }) {
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
        title="Definir data da reunião"
        className={`rounded px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
          row.meetingOn ? "text-fg" : "text-fg-subtle"
        }`}
      >
        {formatDateBR(row.meetingOn)}
      </button>
      {open && ref.current && (
        <AnchoredPopover anchor={ref.current} onClose={() => setOpen(false)} width={300}>
          <div className="w-[18rem] max-w-[calc(100vw-1.5rem)] p-1">
            <p className="mb-1.5 px-1 text-xs font-medium text-fg-muted">
              Data da reunião
            </p>
            <DateField
              value={row.meetingOn ?? ""}
              onChange={(v) => {
                setOpen(false);
                ctx.setMeeting(row, v || null);
              }}
              ariaLabel="Data da reunião"
            />
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                ctx.setMeeting(row, null);
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

// --- Colunas (fonte única; ordem final da fatia 2) -------------------------- //

type CsColumn = {
  id: string;
  label: string;
  width: string;
  align: "left" | "center" | "right";
  sticky?: boolean;
  cell: (row: CsRow, ctx: CellCtx) => ReactNode;
};

const COLUMNS: CsColumn[] = [
  {
    id: "company",
    label: "Empresa",
    width: "minmax(220px, 1.6fr)",
    align: "left",
    sticky: true,
    cell: (row, ctx) => <EmpresaCell row={row} ctx={ctx} />,
  },
  {
    id: "responsibles",
    label: "Responsáveis",
    width: "minmax(260px, 1.6fr)",
    align: "left",
    cell: (row, ctx) => <ResponsiblesCell row={row} ctx={ctx} />,
  },
  {
    id: "nps",
    label: "NPS Geral",
    width: "170px",
    align: "center",
    cell: (row, ctx) => <NpsGeralCell row={row} ctx={ctx} />,
  },
  {
    id: "started",
    label: "Data de Entrada",
    width: "150px",
    align: "center",
    // Somente leitura no CS — editável em "Editar empresa > Informações do cliente".
    cell: (row) => (
      <span
        className={row.startedOn ? "text-fg" : "text-fg-subtle"}
        title="Editável em Editar empresa > Informações do cliente."
      >
        {formatDateBR(row.startedOn)}
      </span>
    ),
  },
  {
    id: "meeting",
    label: "Data da Reunião",
    width: "150px",
    align: "center",
    cell: (row, ctx) => <MeetingCell row={row} ctx={ctx} />,
  },
  {
    id: "monthly",
    label: "Valor Mensal",
    width: "160px",
    align: "right",
    cell: (row, ctx) => <ValorMensalCell row={row} ctx={ctx} />,
  },
  {
    id: "time",
    label: "Tempo de Projeto",
    width: "170px",
    align: "center",
    // Somente leitura no CS — deriva do período, editável em "Editar empresa".
    cell: (row) => (
      <span
        className={row.monthsTotal != null ? "text-fg" : "text-fg-subtle"}
        title="Editável em Editar empresa > Informações do cliente."
      >
        {formatProjectTime(row.monthsTotal, row.periodDays)}
      </span>
    ),
  },
];

const GRID_TEMPLATE = COLUMNS.map((c) => c.width).join(" ");
const MIN_WIDTH = 1280;

// Editor do Valor Mensal: parcelas + alternância total/mensal + prévia. Converte
// o BR para decimal em texto (sem float) e delega ao onSubmit (que chama a RPC).
function ContractEditor({
  row,
  onSubmit,
}: {
  row: CsRow;
  onSubmit: (installments: number | null, total: string | null, monthly: string | null) => void;
}) {
  // Parcelas vazias + Tempo conhecido → pré-preenche com os meses (editável).
  const [installments, setInstallments] = useState(
    row.installments != null
      ? String(row.installments)
      : row.monthsTotal != null
        ? String(row.monthsTotal)
        : ""
  );
  const [mode, setMode] = useState<"total" | "monthly">("total");
  const [amount, setAmount] = useState(
    row.projectValue != null ? decimalToBRInput(row.projectValue) : ""
  );
  const [err, setErr] = useState<string | null>(null);

  const n = Number(installments);
  const nValid = /^\d+$/.test(installments.trim()) && n > 0;
  const dec = brToDecimalString(amount);
  const amountValid = dec != null;

  let preview: string | null = null;
  if (nValid && amountValid && dec) {
    const cents = decimalToCents(dec);
    const totalCents = mode === "total" ? cents : cents * n;
    const monthlyCents = mode === "monthly" ? cents : Math.round(totalCents / n);
    preview = `Total ${centsToBRL(totalCents)} em ${n} ${
      n === 1 ? "parcela" : "parcelas"
    } de ${centsToBRL(monthlyCents)}`;
  }

  function submit() {
    if (!nValid) return setErr("Informe o número de parcelas (inteiro maior que zero).");
    if (!amountValid) return setErr("Informe um valor válido (ex.: 2.980,00).");
    onSubmit(n, mode === "total" ? dec : null, mode === "monthly" ? dec : null);
  }

  const field =
    "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd";

  return (
    <div className="w-[20rem] max-w-[calc(100vw-1.5rem)] p-1.5 text-left">
      <label className="mb-1 block text-xs font-medium text-fg-muted">Parcelas</label>
      <input
        type="text"
        inputMode="numeric"
        value={installments}
        onChange={(e) => {
          setInstallments(e.target.value.replace(/[^\d]/g, ""));
          setErr(null);
        }}
        placeholder="Ex.: 12"
        className={`mb-3 ${field} tabular-nums`}
      />

      <div className="mb-1.5 flex gap-1 rounded-lg border border-line p-0.5">
        {(["total", "monthly"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
              mode === m ? "bg-risd text-white" : "text-fg-muted hover:bg-surface-2"
            }`}
          >
            {m === "total" ? "Valor total do projeto" : "Valor mensal"}
          </button>
        ))}
      </div>
      <input
        type="text"
        inputMode="decimal"
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
        placeholder={mode === "total" ? "Total (ex.: 35.760,00)" : "Mensal (ex.: 2.980,00)"}
        className={`${field} tabular-nums`}
      />

      {preview && <p className="mt-2 text-xs text-fg-muted">{preview}</p>}
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
          onClick={() => onSubmit(null, null, null)}
          className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-fg-muted transition hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
        >
          Limpar
        </button>
      </div>
    </div>
  );
}

function ValorMensalCell({ row, ctx }: { row: CsRow; ctx: CellCtx }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const monthly = formatBRL(row.monthlyValue);
  const total = formatBRL(row.projectValue);
  const title =
    monthly && total && row.installments != null
      ? `${total} em ${row.installments} ${row.installments === 1 ? "parcela" : "parcelas"}`
      : "Definir valores do contrato";
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
        className={`rounded px-1 font-medium tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
          monthly ? "text-fg" : "text-fg-subtle"
        }`}
      >
        {monthly ?? "Não informado"}
      </button>
      {open && ref.current && (
        <AnchoredPopover anchor={ref.current} onClose={() => setOpen(false)} width={320}>
          <ContractEditor
            row={row}
            onSubmit={(i, t, m) => {
              setOpen(false);
              ctx.setContract(row, i, t, m);
            }}
          />
        </AnchoredPopover>
      )}
    </>
  );
}

function alignClass(a: CsColumn["align"]): string {
  return a === "right"
    ? "justify-end text-right"
    : a === "center"
      ? "justify-center text-center"
      : "justify-start text-left";
}

// --- Seção ------------------------------------------------------------------ //

function CsSection({
  group,
  items,
  collapsed,
  onToggle,
  ctx,
}: {
  group: CompanyGroup | null;
  items: CsRow[];
  collapsed: boolean;
  onToggle: () => void;
  ctx: CellCtx;
}) {
  return (
    <GroupSection
      group={group}
      count={items.length}
      collapsed={collapsed}
      onToggleCollapse={onToggle}
    >
      {items.length === 0 ? (
        <p className="px-1 py-4 text-center text-sm text-fg-subtle">
          Nenhuma empresa neste grupo.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <div style={{ minWidth: MIN_WIDTH }}>
            <div
              className="grid items-center border-b border-line"
              style={{ gridTemplateColumns: GRID_TEMPLATE }}
            >
              {COLUMNS.map((col) => (
                <div
                  key={col.id}
                  className={`flex px-3 py-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle ${alignClass(
                    col.align
                  )} ${col.sticky ? "sticky left-0 z-[1] border-r border-line bg-surface" : ""}`}
                >
                  {col.label}
                </div>
              ))}
            </div>

            {items.map((row) => (
              <div
                key={row.id}
                className="group/row grid border-b border-line transition last:border-b-0 hover:bg-surface-2"
                style={{ gridTemplateColumns: GRID_TEMPLATE }}
              >
                {COLUMNS.map((col) => (
                  <div
                    key={col.id}
                    className={`flex items-center px-3 py-3 text-sm ${alignClass(col.align)} ${
                      col.sticky
                        ? "sticky left-0 z-[1] border-r border-line bg-surface group-hover/row:bg-surface-2"
                        : ""
                    }`}
                  >
                    {col.cell(row, ctx)}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </GroupSection>
  );
}

// --- Quadro ----------------------------------------------------------------- //

export default function CsBoard({
  companies,
  groups,
  userId,
}: {
  companies: CsRow[];
  groups: CompanyGroup[];
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

  // Estado local para edição OTIMISTA; ressincroniza quando o servidor manda
  // dados novos (após router.refresh em outra navegação).
  const [rows, setRows] = useState(companies);
  useEffect(() => setRows(companies), [companies]);

  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<CsRow | null>(null);

  async function doSetCompanyNps(row: CsRow, status: CsNpsStatus | null) {
    if (status === row.npsStatus) return;
    const snapshot = rows;
    setNotice(null);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, npsStatus: status } : r)));
    const res = await setCompanyNps(row.id, status);
    if (res.error) {
      setRows(snapshot);
      setNotice(res.error);
    }
  }

  async function doSetMeeting(row: CsRow, date: string | null) {
    if (date === row.meetingOn) return;
    const snapshot = rows;
    setNotice(null);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, meetingOn: date } : r)));
    const res = await setMeetingOn(row.id, date);
    if (res.error) {
      setRows(snapshot);
      setNotice(res.error);
    }
  }

  async function doSetPersonNps(row: CsRow, userId: string, status: CsNpsStatus | null) {
    const current = row.responsibles.find((p) => p.id === userId)?.status ?? null;
    if (status === current) return;
    const snapshot = rows;
    setNotice(null);
    setRows((rs) =>
      rs.map((r) =>
        r.id === row.id
          ? {
              ...r,
              responsibles: r.responsibles.map((p) =>
                p.id === userId ? { ...p, status } : p
              ),
            }
          : r
      )
    );
    const res = await setPersonNps(row.id, userId, status);
    if (res.error) {
      setRows(snapshot);
      setNotice(res.error);
    }
  }

  async function doSetContract(
    row: CsRow,
    installments: number | null,
    total: string | null,
    monthly: string | null
  ) {
    const snapshot = rows;
    setNotice(null);

    // Reflexo otimista (projectValue/installments + mensal derivado), em centavos
    // inteiros — espelha a conta exata que o banco faz. Nunca float de dinheiro.
    let newProject: string | null = null;
    if (total != null) {
      newProject = total;
    } else if (monthly != null && installments != null) {
      newProject = centsToDecimal(decimalToCents(monthly) * installments);
    }
    let newMonthly: string | null = null;
    if (newProject != null && installments != null && installments > 0) {
      newMonthly = centsToDecimal(Math.round(decimalToCents(newProject) / installments));
    }
    setRows((rs) =>
      rs.map((r) =>
        r.id === row.id
          ? {
              ...r,
              projectValue: newProject,
              installments: installments ?? null,
              monthlyValue: newMonthly,
            }
          : r
      )
    );

    const res = await setContractValues(row.id, installments, total, monthly);
    if (res.error) {
      setRows(snapshot);
      setNotice(res.error);
    }
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
  const visibleSections = filtersActive
    ? sections.filter((s) => s.items.length > 0)
    : sections;

  const ctx: CellCtx = {
    userId,
    onOpenCompany: openCompany,
    openingId,
    setCompanyNps: doSetCompanyNps,
    setPersonNps: doSetPersonNps,
    setMeeting: doSetMeeting,
    setContract: doSetContract,
    openHistory: setHistory,
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
        <EmptyState>Nenhuma empresa cadastrada ainda.</EmptyState>
      ) : visibleSections.length === 0 ? (
        <EmptyState>Nenhuma empresa corresponde à busca.</EmptyState>
      ) : (
        <div className="space-y-4 pb-10">
          {visibleSections.map((section) => (
            <CsSection
              key={section.key}
              group={section.group}
              items={section.items}
              collapsed={!filtersActive && collapsed.has(section.key)}
              onToggle={() => toggleCollapse(section.key)}
              ctx={ctx}
            />
          ))}
        </div>
      )}

      {history && (
        <CsHistoryPanel
          companyId={history.id}
          companyName={history.name}
          onClose={() => setHistory(null)}
        />
      )}
    </>
  );
}

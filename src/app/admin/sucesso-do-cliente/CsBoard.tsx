"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History } from "lucide-react";
import { FilterBar, SearchBox, EmptyState, norm } from "@/components/ListControls";
import GroupSection from "@/components/company-groups/GroupSection";
import { groupCompanies, type CompanyGroup } from "@/lib/company-groups";
import AnchoredPopover from "@/components/AnchoredPopover";
import { WrenchIcon } from "@/components/ResponsibleChips";
import {
  formatBRL,
  brToDecimalString,
  decimalToBRInput,
  decimalToCents,
  centsToDecimal,
  centsToBRL,
} from "@/lib/money-br";
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
  setCompanyLabel,
} from "./actions";
import CsHistoryPanel from "./CsHistoryPanel";
import NotesButton from "@/components/notes-panel/NotesButton";
import { csNotesSource } from "@/components/notes-panel/notes-source";
import { formatProjectTime } from "@/lib/contract-time";
import BoardGrid, { type BoardColumn } from "@/components/board/BoardGrid";

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
  // Etiquetas ALERTA/RISCO (manuais) — editáveis aqui; refletem em Empresas.
  alerta: boolean;
  risco: boolean;
  // Pausa de contrato: fim EFETIVO (ends_on + dias pausados), dias pausados e se
  // o período aberto está sem data de entrada.
  effectiveEnd: string | null; // 'AAAA-MM-DD' | null
  pausedDays: number;
  pauseNoDate: boolean;
};

type LabelKey = "alerta" | "risco";

const COLLAPSE_KEY = "crm:cs:grupos-recolhidos";

// --- Formatação (só exibição; nada de Date/fuso em dinheiro ou datas) ------- //

function formatDateBR(iso: string | null): string {
  if (!iso) return "Não informado";
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : "Não informado";
}

function roleLabel(role: Responsible["role"]): string {
  if (role === "ambos") return "Consultor e Colaborador";
  return role === "consultor" ? "Consultor" : "Colaborador";
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
  setLabel: (row: CsRow, which: LabelKey, on: boolean) => void;
  // ids das etiquetas ALERTA/RISCO (null = catálogo sem a etiqueta → toggle off).
  alertaId: string | null;
  riscoId: string | null;
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
      {/* Chip 100% da largura da célula: nome (flex, reticências) | papel | NPS
          individual (mini-chip à direita, largura mínima = maior rótulo), para
          os status alinharem numa coluna visual entre pessoas e linhas. */}
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${person.name} — ${rl}${statusTitle}`}
        className="flex w-full min-w-0 items-center gap-2 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-xs text-fg transition hover:ring-2 hover:ring-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
      >
        {/* Marca de COLABORADOR (chave inglesa) — mesma do ResponsibleChips, para
            coerência. Aparece em 'colaborador' e 'ambos'. */}
        {person.role !== "consultor" && (
          <WrenchIcon className="h-3 w-3 shrink-0 text-violet-600 dark:text-violet-300" />
        )}
        <span className="min-w-0 flex-1 truncate text-left font-medium">{person.name}</span>
        <span className="shrink-0 whitespace-nowrap text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
          {rl}
        </span>
        <span
          style={{ minWidth: "4.5rem" }}
          className={`shrink-0 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-center text-[10px] font-medium ${
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
  // Chips empilhados na vertical, cada um 100% da largura da célula. A coluna é
  // recortada (clip) no BoardGrid: nada invade a coluna NPS Geral. O `pr-1` dá o
  // respiro horizontal até a coluna vizinha.
  return (
    <div className="flex w-full min-w-0 flex-col gap-1 pr-1">
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

// Toggle de uma etiqueta de alerta (ALERTA/RISCO): aceso = vermelho preenchido,
// apagado = contorno. O texto vai SEMPRE junto (nunca só a cor).
function LabelToggle({
  label,
  on,
  disabled,
  onToggle,
}: {
  label: string;
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={on}
      title={
        disabled
          ? `Etiqueta "${label}" indisponível no catálogo`
          : on
            ? `Remover ${label}`
            : `Adicionar ${label}`
      }
      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd disabled:cursor-not-allowed disabled:opacity-40 ${
        on
          ? "border-transparent bg-red-700 text-white shadow-sm"
          : "border-line text-fg-subtle hover:border-red-600/50 hover:text-red-700 dark:hover:text-red-300"
      }`}
    >
      {label}
    </button>
  );
}

function LabelsCell({ row, ctx }: { row: CsRow; ctx: CellCtx }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-1">
      <LabelToggle
        label="ALERTA"
        on={row.alerta}
        disabled={!ctx.alertaId}
        onToggle={() => ctx.setLabel(row, "alerta", !row.alerta)}
      />
      <LabelToggle
        label="RISCO"
        on={row.risco}
        disabled={!ctx.riscoId}
        onToggle={() => ctx.setLabel(row, "risco", !row.risco)}
      />
    </div>
  );
}

// --- Colunas (fonte única; ordem final da fatia 2) -------------------------- //

type CsColumn = BoardColumn<CsRow, CellCtx>;

const COLUMNS: CsColumn[] = [
  {
    id: "company",
    label: "Empresa",
    width: "minmax(220px, 1.6fr)",
    align: "left",
    stickyLeft: 0,
    borderRight: true,
    cell: (row, ctx) => <EmpresaCell row={row} ctx={ctx} />,
  },
  {
    id: "responsibles",
    label: "Responsáveis",
    width: "minmax(260px, 1.6fr)",
    align: "left",
    clip: true,
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
    id: "labels",
    label: "Etiquetas",
    width: "150px",
    align: "center",
    cell: (row, ctx) => <LabelsCell row={row} ctx={ctx} />,
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
    width: "190px",
    align: "center",
    // Somente leitura no CS — duração CONTRATADA (deriva do período). Com pausa,
    // mostra o FIM EFETIVO abaixo ("Fim: DD/MM, +N dias de pausa"); período aberto
    // sem data vira um aviso discreto.
    cell: (row) => (
      <div className="flex flex-col items-center gap-0.5">
        <span
          className={row.monthsTotal != null ? "text-fg" : "text-fg-subtle"}
          title="Editável em Editar empresa > Informações do cliente."
        >
          {formatProjectTime(row.monthsTotal, row.periodDays)}
        </span>
        {row.pausedDays > 0 && row.effectiveEnd && (
          <span className="text-[11px] text-amber-700 dark:text-amber-400">
            Fim: {formatDateBR(row.effectiveEnd)} · +{row.pausedDays}{" "}
            {row.pausedDays === 1 ? "dia" : "dias"} de pausa
          </span>
        )}
        {row.pauseNoDate && (
          <span className="text-[11px] text-fg-subtle" title="Defina a data em Editar empresa > Informações do cliente.">
            Pausa sem data de entrada
          </span>
        )}
      </div>
    ),
  },
];

const MIN_WIDTH = 1450;

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
        <BoardGrid columns={COLUMNS} rows={items} ctx={ctx} minWidth={MIN_WIDTH} />
      )}
    </GroupSection>
  );
}

// --- Quadro ----------------------------------------------------------------- //

export default function CsBoard({
  companies,
  groups,
  userId,
  alertaId,
  riscoId,
}: {
  companies: CsRow[];
  groups: CompanyGroup[];
  userId: string;
  alertaId: string | null;
  riscoId: string | null;
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

  async function doSetLabel(row: CsRow, which: LabelKey, on: boolean) {
    const labelId = which === "alerta" ? alertaId : riscoId;
    if (!labelId || row[which] === on) return;
    const snapshot = rows;
    setNotice(null);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, [which]: on } : r)));
    const res = await setCompanyLabel(row.id, labelId, on);
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
    setLabel: doSetLabel,
    alertaId,
    riscoId,
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

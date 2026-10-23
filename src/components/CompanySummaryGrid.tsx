"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SearchBox, EmptyState, norm } from "@/components/ListControls";
import LabelChips from "@/components/LabelChips";
import NewClientChip from "@/components/NewClientChip";
import type { Label } from "@/lib/labels";
import type { DayColor } from "@/lib/followup";
import type { ChipPerson } from "@/lib/people";
import ResponsibleChips from "@/components/ResponsibleChips";
import { FarolBadge } from "@/components/followup/FarolBadge";
import NotesButton from "@/components/notes-panel/NotesButton";
import GroupSection from "@/components/company-groups/GroupSection";
import { groupCompanies, type CompanyGroup } from "@/lib/company-groups";
import AttendanceCell from "@/components/attendance/AttendanceCell";
import { seedOpenFromDb, hydratePaused } from "@/lib/attendance-store";

// Config da coluna "Atendimento" (calibração, 0126): só chega aqui para quem
// tem a flag ligada. todayByCompany = segundos de hoje por empresa (do banco);
// open = atendimento aberto (do banco) para semear o estado compartilhado.
export type AttendanceGridConfig = {
  todayByCompany: Record<string, number>;
  open: { companyId: string; companyNumber: string | null; startedAt: string } | null;
};

// Número da empresa = prefixo numérico do nome (mesmo critério do diagnóstico).
function companyNumberOf(name: string): string | null {
  return name.match(/^\s*(\d+)/)?.[1] ?? null;
}

export type CompanyCardItem = {
  id: string;
  name: string;
  href: string;
  done: number;
  total: number;
  pending: number;
  overdue: number;
  // Só o painel do colaborador usa estes dois; ficam ocultos quando ausentes.
  dueSoon?: number;
  labels?: Label[];
  // Início do contrato (company_details.started_on, data pura) para a etiqueta
  // DERIVADA "Cliente Novo" (≤ 90 dias). Ausente/null → sem selo. Ver [[new-client]].
  startedOn?: string | null;
  // Semáforo de contato (cor do dia; mesma fonte da /acompanhamento). Presente só
  // onde há acompanhamento (painel do consultor) E a empresa está em grupo ativo
  // (tem score). Ausente ⇒ a linha não mostra a coluna Contato nem o filtro de
  // atenção aparece.
  contact?: { color: DayColor };
  // Contagem de anotações (balão de atalho). Presente nos dois painéis; ausente
  // só quando não deve haver balão. Quando ausente, sem coluna Atualizações.
  noteCount?: number;
  // FORA DA CARTEIRA: a pessoa não é responsável declarada por esta empresa, mas
  // ainda tem tarefa em aberto aqui (não pode sumir da vista). Marca discreta.
  // Só o painel do colaborador usa; ausente/false → sem marca. Ver âncora 0090.
  outOfPortfolio?: boolean;
  // Grupo da empresa (resolveCompanyGroupId no servidor). Alimenta as seções por
  // grupo; null = "Sem grupo". Ausente quando a tela não agrupa (modo plano).
  groupId?: string | null;
  // Responsáveis (balões): consultores + colaboradores. Presentes nos painéis do
  // consultor/colaborador; ausentes → sem balões. Vêm de company_responsibles.
  consultants?: ChipPerson[];
  collaborators?: ChipPerson[];
};

// Contexto de renderização das LINHAS: largura das colunas (grid) e quais colunas
// opcionais existem neste painel. É calculado uma vez e repassado ao cabeçalho de
// colunas E a cada linha, para que tudo fique alinhado entre linhas e entre seções.
type RowCtx = {
  template: string; // grid-template-columns (aplica só no desktop, sm+)
  hasContact: boolean; // coluna Contato (painel do consultor)
  hasNotes: boolean; // coluna Atualizações (balão)
  hasAttendance: boolean; // coluna Atendimento (calibração, só com a flag)
  attendanceToday?: Record<string, number>; // segundos de hoje por empresa
  viewerId?: string;
  viewerIsAdmin: boolean;
  notesHrefSuffix: string;
};

// Larguras FIXAS por coluna (minmax: teto fixo, mas encolhem antes de estourar a
// tela em desktops estreitos). A coluna Empresa é a flexível (1fr) e absorve a
// sobra. A ORDEM aqui é a mesma do cabeçalho e das células da linha.
function buildGridTemplate(
  hasContact: boolean,
  hasNotes: boolean,
  hasAttendance: boolean
): string {
  const cols = [
    "minmax(0, 1fr)", // Empresa
    "minmax(7rem, 11rem)", // Etiquetas
    "minmax(6rem, 9rem)", // Progresso
    "minmax(6rem, 10rem)", // Pendentes
  ];
  if (hasAttendance) cols.push("minmax(8rem, 12rem)"); // Atendimento
  if (hasContact) cols.push("minmax(7rem, 11rem)"); // Contato
  if (hasNotes) cols.push("minmax(3.5rem, 6rem)"); // Atualizações
  return cols.join(" ");
}

// Lista "Minhas empresas" dos painéis do consultor e do colaborador, em LINHAS
// (estilo Monday): colunas alinhadas Empresa | Etiquetas | Progresso | Pendentes |
// [Contato] | [Atualizações]. Busca por nome (qualquer trecho, sem acentos). Com
// `groups`, separa em SEÇÕES por grupo (ordem por position, "Sem grupo" por último,
// cor só no cabeçalho); sem `groups`, uma lista única. A busca/filtro agem sobre
// TODAS as empresas ANTES de agrupar; seções sem empresa não aparecem. É só
// visualização — mesmos valores de antes, sem seleção nem arrastar.
export default function CompanySummaryGrid({
  items,
  // Usuário logado — autor das anotações escritas pelo balão. Presente onde o
  // balão aparece (painel do consultor e do colaborador); ausente só quando
  // não deve haver balão.
  viewerId,
  // Papel do usuário logado — controla só a interface (o botão Editar em nota
  // alheia); a permissão real é a RLS cn_*. Admin em "Meu Trabalho" edita todas.
  viewerIsAdmin = false,
  // Sufixo do link para a aba/seção completa de Anotações da empresa. Consultor
  // usa a aba (?aba=notes); colaborador usa a âncora da seção (#anotacoes).
  notesHrefSuffix = "?aba=notes",
  // Grupos para montar as seções (admin, consultor e colaborador leem desde a
  // 0099). Ausente → lista única (sem agrupar).
  groups,
  // Chave do localStorage para persistir recolhido/expandido POR USUÁRIO (uma
  // por painel). Ausente → o estado vive só na sessão.
  collapseKey,
  // Config da coluna "Atendimento" (calibração). Ausente → sem coluna (ninguém
  // além dos colaboradores do teste a recebe).
  attendance,
}: {
  items: CompanyCardItem[];
  viewerId?: string;
  viewerIsAdmin?: boolean;
  notesHrefSuffix?: string;
  groups?: CompanyGroup[];
  collapseKey?: string;
  attendance?: AttendanceGridConfig;
}) {
  const [query, setQuery] = useState("");
  // Filtro rápido "só quem precisa de atenção" (amarelo + vermelho + sem
  // registro = tudo que NÃO é verde). NÃO reordena as linhas — a ordem serve para
  // ENCONTRAR uma empresa; a cor é que chama atenção. Só aparece onde há dado de
  // contato (painel do consultor).
  const [attentionOnly, setAttentionOnly] = useState(false);

  // Há acompanhamento nestas linhas? (colaborador não tem → sem coluna Contato
  // nem filtro). Há balão de anotações? (define a coluna Atualizações.)
  const hasContact = useMemo(
    () => items.some((c) => c.contact !== undefined),
    [items]
  );
  const hasNotes = useMemo(
    () => !!viewerId && items.some((c) => c.noteCount !== undefined),
    [items, viewerId]
  );
  const hasAttendance = !!attendance;

  // Semeia o estado compartilhado (aberto + tarefa pausada) a partir do banco,
  // uma vez ao montar. Depois disso, ações e o poll do indicador mantêm.
  useEffect(() => {
    if (!attendance) return;
    hydratePaused();
    seedOpenFromDb(attendance.open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ctx: RowCtx = useMemo(
    () => ({
      template: buildGridTemplate(hasContact, hasNotes, hasAttendance),
      hasContact,
      hasNotes,
      hasAttendance,
      attendanceToday: attendance?.todayByCompany,
      viewerId,
      viewerIsAdmin,
      notesHrefSuffix,
    }),
    [hasContact, hasNotes, hasAttendance, attendance, viewerId, viewerIsAdmin, notesHrefSuffix]
  );

  // Precisa de atenção = amarelo (contato só à tarde) ou vermelho (após 17h/sem
  // contato). Verde e aguardando (dia em andamento, neutro) não entram.
  const needsAttention = (c: CompanyCardItem) =>
    c.contact !== undefined &&
    (c.contact.color === "amarelo" || c.contact.color === "vermelho");
  const attentionCount = useMemo(
    () => (hasContact ? items.filter(needsAttention).length : 0),
    [items, hasContact]
  );

  const filtersActive = !!query.trim() || attentionOnly;

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    let list = q ? items.filter((c) => norm(c.name).includes(q)) : items;
    if (attentionOnly) list = list.filter(needsAttention);
    return list;
  }, [items, query, attentionOnly]);

  const grouping = !!groups;

  return (
    <>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Buscar empresa…"
        />
        {hasContact && (
          <button
            type="button"
            onClick={() => setAttentionOnly((v) => !v)}
            aria-pressed={attentionOnly}
            className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${
              attentionOnly
                ? "border-risd/50 bg-brand-tint text-fg"
                : "border-line bg-surface text-fg-muted hover:text-fg"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                attentionOnly ? "bg-amber-500" : "bg-fg-subtle"
              }`}
              aria-hidden="true"
            />
            Só quem precisa de atenção
            <span className="tabular-nums text-fg-subtle">{attentionCount}</span>
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState>
          {attentionOnly && attentionCount === 0
            ? "Nenhuma empresa precisando de atenção agora. 🎉"
            : "Nenhuma empresa corresponde à busca."}
        </EmptyState>
      ) : grouping ? (
        <GroupedRows
          items={filtered}
          groups={groups!}
          filtersActive={filtersActive}
          collapseKey={collapseKey}
          ctx={ctx}
        />
      ) : (
        <CompanyRows items={filtered} ctx={ctx} />
      )}
    </>
  );
}

// --- Seções por grupo -------------------------------------------------------

function GroupedRows({
  items,
  groups,
  filtersActive,
  collapseKey,
  ctx,
}: {
  items: CompanyCardItem[];
  groups: CompanyGroup[];
  filtersActive: boolean;
  collapseKey?: string;
  ctx: RowCtx;
}) {
  // Recolher/expandir guarda só as ESCOLHAS EXPLÍCITAS do usuário (sectionKey →
  // recolhido?). O padrão de cada seção vem do kind do grupo: grupos PARADOS
  // nascem recolhidos; os demais, abertos. Assim um grupo parado novo já aparece
  // recolhido mesmo sem registro, e, uma vez que o usuário alterna, a escolha
  // dele vale e persiste. Persistido por usuário em localStorage (chave do painel).
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!collapseKey) return;
    try {
      const raw = localStorage.getItem(collapseKey);
      if (raw) setChoices(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      /* localStorage indisponível — segue nos padrões por kind */
    }
  }, [collapseKey]);

  function toggle(sectionKey: string, defaultCollapsed: boolean) {
    setChoices((prev) => {
      const current = prev[sectionKey] ?? defaultCollapsed;
      const next = { ...prev, [sectionKey]: !current };
      if (collapseKey) {
        try {
          localStorage.setItem(collapseKey, JSON.stringify(next));
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  }

  const withGroup = items.map((c) => ({ ...c, groupId: c.groupId ?? null }));
  const sections = groupCompanies(withGroup, groups);
  // Seções sem empresa não aparecem (regra do painel).
  const visibleSections = sections.filter((s) => s.items.length > 0);

  return (
    <div className="space-y-4">
      {visibleSections.map((section) => {
        const defaultCollapsed = section.group?.kind === "paused";
        // Durante busca/filtro, tudo expandido (não esconder correspondências).
        const collapsed = filtersActive
          ? false
          : choices[section.key] ?? defaultCollapsed;
        const openCount = section.items.filter((c) => c.pending > 0).length;
        return (
          <GroupSection
            key={section.key}
            group={section.group}
            count={section.items.length}
            collapsed={collapsed}
            onToggleCollapse={() => toggle(section.key, defaultCollapsed)}
            meta={
              openCount > 0 ? (
                <span className="shrink-0 text-xs font-medium text-fg-subtle">
                  {openCount} com tarefa sua em aberto
                </span>
              ) : undefined
            }
          >
            <CompanyRows items={section.items} ctx={ctx} />
          </GroupSection>
        );
      })}
    </div>
  );
}

// --- Cabeçalho de colunas + lista de linhas ---------------------------------

function CompanyRows({
  items,
  ctx,
}: {
  items: CompanyCardItem[];
  ctx: RowCtx;
}) {
  return (
    <div>
      <ColumnHeader ctx={ctx} />
      <ul className="space-y-1.5">
        {items.map((c) => (
          <CompanyRow key={c.id} company={c} ctx={ctx} />
        ))}
      </ul>
    </div>
  );
}

// Cabeçalho de colunas, em texto discreto. Some no celular (hidden). Usa a MESMA
// grade (template) e o mesmo gap/px das linhas, então os rótulos ficam exatamente
// sobre as colunas. `border border-transparent` casa o 1px de borda das linhas.
function ColumnHeader({ ctx }: { ctx: RowCtx }) {
  return (
    <div
      className="hidden items-center gap-3 border border-transparent px-3 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-subtle sm:grid"
      style={{ gridTemplateColumns: ctx.template }}
    >
      <span>Empresa</span>
      <span>Etiquetas</span>
      <span>Progresso</span>
      <span>Pendentes</span>
      {ctx.hasAttendance && <span>Atendimento</span>}
      {ctx.hasContact && <span>Contato</span>}
      {ctx.hasNotes && <span className="text-right">Atualizações</span>}
    </div>
  );
}

// --- Linha de uma empresa ---------------------------------------------------

function CompanyRow({
  company: c,
  ctx,
}: {
  company: CompanyCardItem;
  ctx: RowCtx;
}) {
  const percent = c.total > 0 ? Math.round((c.done / c.total) * 100) : 0;
  const showNotes = ctx.hasNotes && !!ctx.viewerId && c.noteCount !== undefined;
  return (
    // Celular: bloco de duas faixas (flex-col) — nome em cima, o resto embaixo.
    // Desktop (sm+): grade de colunas alinhada (gridTemplateColumns). O overlay
    // é absoluto (fora da grade); as células entram na grade — no desktop o
    // invólucro "resto" vira display:contents para seus filhos ocuparem as colunas.
    <li
      className="group relative flex flex-col gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 shadow-card transition hover:border-risd/40 hover:shadow-pop focus-within:ring-2 focus-within:ring-risd focus-within:ring-offset-2 focus-within:ring-offset-canvas sm:grid sm:items-center sm:gap-3"
      style={{ gridTemplateColumns: ctx.template }}
    >
      {/* Empresa — quebra em até 2 linhas; além disso, reticências + nome no title. */}
      <div className="min-w-0">
        <h3
          title={c.name}
          className="line-clamp-2 break-words font-medium text-fg group-hover:text-risd"
        >
          {c.name}
        </h3>
        {/* Responsáveis (consultores + colaboradores) — fica ACIMA do overlay
            (z-10) para os tooltips funcionarem sem navegar. */}
        {((c.consultants?.length ?? 0) > 0 || (c.collaborators?.length ?? 0) > 0) && (
          <ResponsibleChips
            consultants={c.consultants ?? []}
            collaborators={c.collaborators ?? []}
            size={16}
            className="relative z-10 mt-1"
          />
        )}
      </div>

      {/* O "resto" é um bloco horizontal no celular (faixa 2) e, no desktop, vira
          display:contents para que seus filhos ocupem as colunas da grade. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:contents">
        {/* Etiquetas: fora da carteira + etiquetas comuns + selo "Cliente Novo".
            Vazia no celular some; no desktop fica (sm:empty:block) para a coluna
            não deslocar as seguintes. */}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 empty:hidden sm:empty:block">
          {c.outOfPortfolio && (
            <span
              className="inline-flex items-center rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-fg-subtle"
              title="Você não é responsável por esta empresa, mas tem tarefa em aberto aqui."
            >
              fora da carteira
            </span>
          )}
          {c.labels && c.labels.length > 0 && <LabelChips labels={c.labels} />}
          <NewClientChip startedOn={c.startedOn ?? null} />
        </div>

        {/* Progresso: barra + "% · x/y" (mesmos valores do cartão). */}
        <div className="w-full min-w-0 sm:w-auto">
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Progresso: ${percent}%, ${c.done} de ${c.total}`}
          >
            <div
              className="h-full rounded-full bg-risd transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[11px] tabular-nums text-fg-muted">
            <span>{percent}%</span>
            <span>
              {c.done}/{c.total}
            </span>
          </div>
        </div>

        {/* Pendentes (+ atrasadas / vencendo em 24h quando houver). */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-fg-muted">
            {c.pending} pendente{c.pending === 1 ? "" : "s"}
          </span>
          {c.overdue > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300">
              {c.overdue} atrasada{c.overdue === 1 ? "" : "s"}
            </span>
          )}
          {(c.dueSoon ?? 0) > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              {c.dueSoon} vencendo em 24h
            </span>
          )}
        </div>

        {/* Atendimento (calibração) — play/pause + tempo ao vivo. Fica ACIMA do
            overlay (a própria célula é z-10), então o botão não navega. */}
        {ctx.hasAttendance && (
          <div className="min-w-0">
            <AttendanceCell
              companyId={c.id}
              companyNumber={companyNumberOf(c.name)}
              todaySeconds={ctx.attendanceToday?.[c.id] ?? 0}
            />
          </div>
        )}

        {/* Contato (só painel do consultor) — cor do dia relevante. */}
        {ctx.hasContact && (
          <div className="min-w-0">
            {c.contact ? <FarolBadge color={c.contact.color} /> : null}
          </div>
        )}

        {/* Atualizações — fica ACIMA do overlay (z-10) para o balão abrir o painel
            lateral sem navegar. A célula existe sempre que há coluna, para a grade
            não deslocar; o botão aparece quando há contagem. */}
        {ctx.hasNotes && (
          <div className="relative z-10 flex sm:justify-end">
            {showNotes && (
              <NotesButton
                companyId={c.id}
                companyName={c.name}
                userId={ctx.viewerId!}
                isAdmin={ctx.viewerIsAdmin}
                notesHref={`${c.href}${ctx.notesHrefSuffix}`}
                initialCount={c.noteCount!}
              />
            )}
          </div>
        )}
      </div>

      {/* Link-overlay: a linha inteira é clicável (mesmo destino do cartão). Fica
          abaixo da célula de Atualizações (z-0 < z-10), então o balão recebe o
          próprio clique e o resto da linha navega. */}
      <Link
        href={c.href}
        aria-label={`Abrir ${c.name}`}
        className="absolute inset-0 z-0 rounded-xl focus:outline-none"
      >
        <span className="sr-only">{c.name}</span>
      </Link>
    </li>
  );
}

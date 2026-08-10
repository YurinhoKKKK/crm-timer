"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FilterBar,
  SearchBox,
  SelectFilter,
  EmptyState,
  norm,
  type SelectOption,
} from "@/components/ListControls";
import LabelChips, { labelChipStyle } from "@/components/LabelChips";
import Avatar from "@/components/Avatar";
import ConfirmDialog from "@/components/ConfirmDialog";
import type { Label } from "@/lib/labels";
import {
  colorTints,
  groupCompanies,
  SEM_GRUPO,
  type CompanyGroup,
} from "@/lib/company-groups";
import GroupDialog from "./GroupDialog";
import {
  createGroup,
  updateGroup,
  deleteGroup,
  reorderGroups,
  moveCompanies,
} from "./group-actions";

export type CompanyItem = {
  id: string;
  name: string;
  whatsappGroupName: string | null;
  whatsappContactId: string | null;
  consultants: { id: string; name: string; avatarUrl?: string | null }[];
  labels: Label[];
  groupId: string | null;
};

const COLLAPSE_KEY = "crm:empresas:grupos-recolhidos";

// Tela de empresas AGRUPADA (no espírito dos grupos do Monday). Carrega TODAS as
// empresas (a página impõe .limit() + aviso de corte) e agrupa em seções
// coloridas, retráteis. Mover empresas: seleção múltipla (obrigatória — funciona
// no celular e por teclado) nesta fatia; arrastar vem depois. Busca e filtros
// COMPÕEM com os grupos (padrão /acompanhamento): agem sobre TODAS as empresas
// antes de qualquer corte de exibição; grupos sem resultado somem durante a busca.
export default function CompanyGroupsBoard({
  companies,
  groups,
  total,
  truncated,
  inUseLabels,
  consultores,
}: {
  companies: CompanyItem[];
  groups: CompanyGroup[];
  total: number; // total no banco (para detectar corte de desempenho)
  truncated: boolean;
  inUseLabels: Label[];
  consultores: SelectOption[];
}) {
  const router = useRouter();

  // Estado LOCAL espelhando os props, para movimento/reordenação OTIMISTAS. Os
  // efeitos ressincronizam quando o servidor manda dados novos (após refresh).
  const [items, setItems] = useState(companies);
  const [localGroups, setLocalGroups] = useState(groups);
  useEffect(() => setItems(companies), [companies]);
  useEffect(() => setLocalGroups(groups), [groups]);

  // Filtros (client-side, compõem entre si).
  const [search, setSearch] = useState("");
  const [labelFilter, setLabelFilter] = useState<Set<string>>(new Set());
  const [consultantId, setConsultantId] = useState("");

  // Seleção múltipla.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Recolhidos (persistido por usuário em localStorage). Vazio até o efeito ler.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      if (raw) setCollapsed(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* localStorage indisponível — segue tudo expandido */
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

  // Diálogos.
  const [dialog, setDialog] = useState<
    | { mode: "create" }
    | { mode: "edit"; group: CompanyGroup; focusColor: boolean }
    | null
  >(null);
  const [deleting, setDeleting] = useState<CompanyGroup | null>(null);

  // Aviso (erro/parcial) no topo.
  const [notice, setNotice] = useState<string | null>(null);

  // Arrastar-e-soltar (atalho; a seleção múltipla é o caminho obrigatório porque
  // arrastar não existe no celular nem por teclado). `draggingId` = empresa sendo
  // arrastada; `dragOverKey` = seção destacada sob o cursor.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const filtersActive =
    !!search.trim() || labelFilter.size > 0 || !!consultantId;

  // Filtro sobre TODAS as empresas (antes de agrupar/cortar).
  const filtered = useMemo(() => {
    const q = norm(search.trim());
    return items.filter((c) => {
      if (q && !norm(c.name).includes(q)) return false;
      if (consultantId && !c.consultants.some((x) => x.id === consultantId))
        return false;
      if (labelFilter.size > 0) {
        if (!c.labels.some((l) => labelFilter.has(l.id))) return false;
      }
      return true;
    });
  }, [items, search, consultantId, labelFilter]);

  const sections = useMemo(
    () => groupCompanies(filtered, localGroups),
    [filtered, localGroups]
  );

  // Durante a busca, grupos sem resultado somem; e mostramos tudo expandido para
  // não esconder correspondências atrás de um grupo recolhido.
  const visibleSections = filtersActive
    ? sections.filter((s) => s.items.length > 0)
    : sections;

  const filteredCount = filtered.length;

  // --- Seleção -------------------------------------------------------------
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function setMany(ids: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }

  // --- Mover empresas (RPC em lote, otimista, revertido se falhar/parcial) ---
  // Núcleo único usado pela seleção múltipla E pelo arrastar-soltar.
  async function doMove(ids: string[], targetGroupId: string | null) {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const snapshot = items;
    setNotice(null);
    // Otimista: as linhas pulam de seção na hora.
    setItems((prev) =>
      prev.map((c) => (idSet.has(c.id) ? { ...c, groupId: targetGroupId } : c))
    );
    clearSelection();

    const res = await moveCompanies(ids, targetGroupId);
    if (res.error || res.moved < res.requested) {
      setItems(snapshot); // nunca deixar a tela mostrar o que o banco não confirmou
      setNotice(
        res.error
          ? `Não foi possível mover: ${res.error}`
          : `Apenas ${res.moved} de ${res.requested} empresas foram movidas (as demais foram barradas). Nada foi alterado.`
      );
      return;
    }
    router.refresh();
  }
  function moveSelected(targetGroupId: string | null) {
    return doMove(Array.from(selected), targetGroupId);
  }

  // Soltar sobre uma seção. Se a empresa arrastada faz parte da seleção atual,
  // move a seleção inteira (como no Monday); senão, só a arrastada. Empresas já
  // no destino são ignoradas (sem escrita à toa).
  function handleDropOn(groupId: string | null) {
    const dragId = draggingId;
    setDragOverKey(null);
    setDraggingId(null);
    if (!dragId) return;
    const ids =
      selected.size > 0 && selected.has(dragId)
        ? Array.from(selected)
        : [dragId];
    const toMove = ids.filter((id) => {
      const it = items.find((c) => c.id === id);
      return it && it.groupId !== groupId;
    });
    if (toMove.length > 0) doMove(toMove, groupId);
  }

  // --- Grupos: criar / editar / reordenar / excluir ------------------------
  async function handleCreate(input: { name: string; color: string }) {
    const res = await createGroup(input);
    if (!res.error) router.refresh();
    return res;
  }
  async function handleEdit(group: CompanyGroup, input: { name: string; color: string }) {
    const res = await updateGroup(group.id, input);
    if (!res.error) router.refresh();
    return res;
  }
  async function moveGroup(groupId: string, dir: -1 | 1) {
    const idx = localGroups.findIndex((g) => g.id === groupId);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= localGroups.length) return;
    const next = [...localGroups];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setLocalGroups(next); // otimista
    const res = await reorderGroups(next.map((g) => g.id));
    if (res.error) {
      setLocalGroups(localGroups); // reverte
      setNotice(`Não foi possível reordenar: ${res.error}`);
      return;
    }
    router.refresh();
  }
  async function handleDelete(group: CompanyGroup) {
    const res = await deleteGroup(group.id);
    if (res.error) return { error: res.error };
    // Otimista: some o grupo; as empresas dele voltam para "Sem grupo".
    setLocalGroups((prev) => prev.filter((g) => g.id !== group.id));
    setItems((prev) =>
      prev.map((c) => (c.groupId === group.id ? { ...c, groupId: null } : c))
    );
    router.refresh();
    return { error: null };
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setDialog({ mode: "create" })}
          className="inline-flex items-center gap-1.5 rounded-lg bg-risd px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-chrysler focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Novo grupo
        </button>
      </div>

      <FilterBar>
        <SearchBox value={search} onChange={setSearch} placeholder="Buscar por nome…" />
        {consultores.length > 0 && (
          <SelectFilter
            value={consultantId}
            onChange={setConsultantId}
            allLabel="Todos os consultores"
            ariaLabel="Filtrar por consultor responsável"
            options={consultores}
          />
        )}
      </FilterBar>

      {inUseLabels.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-fg-subtle">Etiquetas:</span>
          {inUseLabels.map((l) => {
            const on = labelFilter.has(l.id);
            return (
              <button
                key={l.id}
                type="button"
                onClick={() =>
                  setLabelFilter((prev) => {
                    const next = new Set(prev);
                    if (next.has(l.id)) next.delete(l.id);
                    else next.add(l.id);
                    return next;
                  })
                }
                aria-pressed={on}
                style={labelChipStyle(l)}
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${
                  on
                    ? "ring-2 ring-fg ring-offset-2 ring-offset-canvas"
                    : "opacity-70 hover:opacity-100"
                }`}
              >
                {l.name}
              </button>
            );
          })}
          {filtersActive && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setLabelFilter(new Set());
                setConsultantId("");
              }}
              className="ml-1 rounded-full border border-line px-3 py-1 text-xs font-medium text-fg-muted transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
            >
              Limpar filtros
            </button>
          )}
        </div>
      )}

      {truncated && (
        <p className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Exibindo as primeiras {items.length} de {total} empresas (limite de
          desempenho). A busca e os filtros agem sobre estas.
        </p>
      )}

      <p className="mb-3 text-sm text-fg-muted">
        {filtersActive ? (
          <>
            {filteredCount} {filteredCount === 1 ? "resultado" : "resultados"} de{" "}
            {items.length}
          </>
        ) : (
          <>
            {items.length} {items.length === 1 ? "empresa" : "empresas"}
          </>
        )}
      </p>

      {notice && (
        <div className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="shrink-0 text-red-700/70 hover:text-red-700 dark:text-red-300/70"
            aria-label="Dispensar aviso"
          >
            ✕
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState>Nenhuma empresa cadastrada ainda.</EmptyState>
      ) : visibleSections.length === 0 ? (
        <EmptyState>Nenhuma empresa corresponde aos filtros.</EmptyState>
      ) : (
        <div className="space-y-4 pb-24">
          {visibleSections.map((section) => (
            <GroupSection
              key={section.key}
              sectionKey={section.key}
              group={section.group}
              items={section.items}
              collapsed={!filtersActive && collapsed.has(section.key)}
              onToggleCollapse={() => toggleCollapse(section.key)}
              selected={selected}
              onToggleOne={toggleOne}
              onToggleMany={setMany}
              canMoveUp={
                section.group
                  ? localGroups.findIndex((g) => g.id === section.group!.id) > 0
                  : false
              }
              canMoveDown={
                section.group
                  ? localGroups.findIndex((g) => g.id === section.group!.id) <
                    localGroups.length - 1
                  : false
              }
              onEdit={(focusColor) =>
                section.group &&
                setDialog({ mode: "edit", group: section.group, focusColor })
              }
              onMoveUp={() => section.group && moveGroup(section.group.id, -1)}
              onMoveDown={() => section.group && moveGroup(section.group.id, 1)}
              onDelete={() => section.group && setDeleting(section.group)}
              dragActive={draggingId !== null}
              dragOver={dragOverKey === section.key}
              onDragEnterSection={() => setDragOverKey(section.key)}
              onDragLeaveSection={() =>
                setDragOverKey((k) => (k === section.key ? null : k))
              }
              onDropSection={() =>
                handleDropOn(section.group ? section.group.id : null)
              }
              onRowDragStart={setDraggingId}
              onRowDragEnd={() => {
                setDraggingId(null);
                setDragOverKey(null);
              }}
            />
          ))}
        </div>
      )}

      {/* Barra fixa de ações da seleção múltipla (o caminho obrigatório de mover:
          funciona no celular e por teclado). */}
      {selected.size > 0 && (
        <SelectionBar
          count={selected.size}
          groups={localGroups}
          onMove={moveSelected}
          onClear={clearSelection}
        />
      )}

      {dialog && (
        <GroupDialog
          open
          mode={dialog.mode}
          group={dialog.mode === "edit" ? dialog.group : null}
          focusColor={dialog.mode === "edit" ? dialog.focusColor : false}
          onClose={() => setDialog(null)}
          onSubmit={(input) =>
            dialog.mode === "create"
              ? handleCreate(input)
              : handleEdit(dialog.group, input)
          }
        />
      )}

      {deleting && (
        <ConfirmDialog
          open
          title={`Excluir o grupo “${deleting.name}”?`}
          description={(() => {
            const n = items.filter((c) => c.groupId === deleting.id).length;
            return (
              <>
                {n === 0 ? (
                  "Este grupo não tem empresas."
                ) : (
                  <>
                    As <strong>{n}</strong> {n === 1 ? "empresa" : "empresas"}{" "}
                    deste grupo voltarão para <strong>Sem grupo</strong>.
                  </>
                )}{" "}
                As empresas não são excluídas.
              </>
            );
          })()}
          confirmLabel="Excluir grupo"
          onClose={() => setDeleting(null)}
          onConfirm={() => handleDelete(deleting)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Seção de um grupo (ou o balde "Sem grupo").
// ---------------------------------------------------------------------------
function GroupSection({
  sectionKey,
  group,
  items,
  collapsed,
  onToggleCollapse,
  selected,
  onToggleOne,
  onToggleMany,
  canMoveUp,
  canMoveDown,
  onEdit,
  onMoveUp,
  onMoveDown,
  onDelete,
  dragActive,
  dragOver,
  onDragEnterSection,
  onDragLeaveSection,
  onDropSection,
  onRowDragStart,
  onRowDragEnd,
}: {
  sectionKey: string;
  group: CompanyGroup | null;
  items: CompanyItem[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  selected: Set<string>;
  onToggleOne: (id: string) => void;
  onToggleMany: (ids: string[], on: boolean) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onEdit: (focusColor: boolean) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  dragActive: boolean;
  dragOver: boolean;
  onDragEnterSection: () => void;
  onDragLeaveSection: () => void;
  onDropSection: () => void;
  onRowDragStart: (id: string) => void;
  onRowDragEnd: () => void;
}) {
  const tint = group ? colorTints(group.color) : null;
  const isSemGrupo = sectionKey === SEM_GRUPO;

  const ids = items.map((c) => c.id);
  const selectedHere = ids.filter((id) => selected.has(id)).length;
  const allSelected = ids.length > 0 && selectedHere === ids.length;
  const someSelected = selectedHere > 0 && !allSelected;

  const headerCheckRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerCheckRef.current) headerCheckRef.current.indeterminate = someSelected;
  }, [someSelected]);

  // Alvo de soltura = a seção inteira (cabeçalho E corpo), com destaque claro
  // enquanto o item paira. preventDefault no dragOver é o que AUTORIZA o drop.
  const dropProps = dragActive
    ? {
        onDragOver: (e: DragEvent) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          onDragEnterSection();
        },
        onDragLeave: (e: DragEvent) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node))
            onDragLeaveSection();
        },
        onDrop: (e: DragEvent) => {
          e.preventDefault();
          onDropSection();
        },
      }
    : {};

  return (
    <section
      {...dropProps}
      className={`rounded-2xl border bg-surface shadow-card transition ${
        dragOver
          ? "border-risd ring-2 ring-risd ring-offset-2 ring-offset-canvas"
          : dragActive
          ? "border-dashed border-line-strong"
          : "border-line"
      }`}
    >
      {/* Cabeçalho: barra/bolinha na cor do grupo + nome + contagem + recolher +
          menu. A COR só tinge barra, bolinha e fundo do cabeçalho em baixa
          opacidade — o texto usa sempre as cores de tema (regra de uso da cor).
          rounded-t-2xl (em vez de overflow-hidden na seção) para o fundo tingido
          respeitar os cantos SEM recortar o dropdown do menu. */}
      <div
        className={`flex items-center gap-2 border-b border-line px-3 py-2.5 rounded-t-2xl ${
          collapsed ? "rounded-b-2xl border-b-0" : ""
        }`}
        style={tint ? { backgroundColor: tint.headerBg } : undefined}
      >
        {tint && (
          <span
            className="h-6 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: tint.dot }}
            aria-hidden="true"
          />
        )}

        <input
          ref={headerCheckRef}
          type="checkbox"
          checked={allSelected}
          onChange={(e) => onToggleMany(ids, e.target.checked)}
          disabled={ids.length === 0}
          aria-label={`Selecionar todas as empresas de ${group?.name ?? "Sem grupo"}`}
          className="h-4 w-4 shrink-0 cursor-pointer rounded border-line text-risd focus-visible:ring-2 focus-visible:ring-risd disabled:opacity-40"
        />

        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd rounded"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={`shrink-0 text-fg-subtle transition-transform ${collapsed ? "-rotate-90" : ""}`}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
          {tint && (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: tint.dot }}
              aria-hidden="true"
            />
          )}
          <span className="truncate font-semibold text-fg">
            {group?.name ?? "Sem grupo"}
          </span>
          <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium tabular-nums text-fg-muted">
            {items.length}
          </span>
        </button>

        {/* "Sem grupo" não se renomeia, não se colore, não se reordena, não se
            exclui — só o menu dos grupos reais aparece. */}
        {group && (
          <GroupMenu
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onRename={() => onEdit(false)}
            onRecolor={() => onEdit(true)}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            onDelete={onDelete}
          />
        )}
      </div>

      {!collapsed && (
        <div className="p-3">
          {items.length === 0 ? (
            <p className="px-1 py-4 text-center text-sm text-fg-subtle">
              {isSemGrupo
                ? "Todas as empresas estão em algum grupo."
                : "Nenhuma empresa neste grupo. Selecione empresas e use “Transferir para grupo…”."}
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((company) => (
                <CompanyRow
                  key={company.id}
                  company={company}
                  selected={selected.has(company.id)}
                  onToggle={() => onToggleOne(company.id)}
                  onDragStart={onRowDragStart}
                  onDragEnd={onRowDragEnd}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function CompanyRow({
  company,
  selected,
  onToggle,
  onDragStart,
  onDragEnd,
}: {
  company: CompanyItem;
  selected: boolean;
  onToggle: () => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}) {
  return (
    <li
      className={`flex items-stretch gap-1 rounded-xl border bg-surface transition ${
        selected ? "border-risd ring-1 ring-risd" : "border-line"
      }`}
    >
      {/* Alça de arraste DEDICADA (não a linha inteira, para não competir com o
          clique que abre a empresa). NÃO é <a> (o globals.css desliga arrasto em
          links); é um <span> arrastável. Escondida no celular (sm:) — lá o
          arrastar não existe e a seleção múltipla é o caminho. */}
      <span
        role="button"
        aria-label={`Arraste ${company.name} para mover de grupo`}
        title="Arraste para mover de grupo"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", company.id);
          onDragStart(company.id);
        }}
        onDragEnd={onDragEnd}
        className="hidden shrink-0 cursor-grab items-center px-1.5 text-fg-subtle transition hover:text-fg active:cursor-grabbing sm:flex"
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
      <label className="flex cursor-pointer items-center pl-1.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Selecionar ${company.name}`}
          className="h-4 w-4 cursor-pointer rounded border-line text-risd focus-visible:ring-2 focus-visible:ring-risd"
        />
      </label>
      <Link
        href={`/admin/empresas/${company.id}`}
        className="group block min-w-0 flex-1 rounded-xl p-3 transition hover:bg-surface-2/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-medium text-fg group-hover:text-risd">
              {company.name}
            </span>
            <LabelChips labels={company.labels} />
          </div>
          <span className="shrink-0 text-fg-subtle transition group-hover:translate-x-0.5 group-hover:text-risd">
            →
          </span>
        </div>
        {company.whatsappGroupName || company.whatsappContactId ? (
          <span className="mt-1 block text-sm text-fg-muted">
            WhatsApp: {company.whatsappGroupName ?? "(sem nome)"}
          </span>
        ) : (
          <span className="mt-1 block text-sm text-fg-subtle">
            Sem grupo de WhatsApp vinculado.
          </span>
        )}
        {company.consultants.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {company.consultants.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 py-0.5 pl-1 pr-2 text-xs text-fg-muted"
              >
                <Avatar name={c.name} url={c.avatarUrl} size={18} />
                {c.name}
              </span>
            ))}
          </div>
        )}
      </Link>
    </li>
  );
}

// Menu de ações do grupo (renomear, trocar cor, mover, excluir). Dropdown leve
// com fechar ao clicar fora / ESC.
function GroupMenu({
  canMoveUp,
  canMoveDown,
  onRename,
  onRecolor,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  canMoveUp: boolean;
  canMoveDown: boolean;
  onRename: () => void;
  onRecolor: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const itemClass =
    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40";

  function run(fn: () => void) {
    setOpen(false);
    fn();
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Ações do grupo"
        className="rounded-lg p-1.5 text-fg-subtle transition hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-overlay mt-1 w-44 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-pop"
        >
          <button type="button" role="menuitem" className={itemClass} onClick={() => run(onRename)}>
            Renomear
          </button>
          <button type="button" role="menuitem" className={itemClass} onClick={() => run(onRecolor)}>
            Trocar cor
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            disabled={!canMoveUp}
            onClick={() => run(onMoveUp)}
          >
            Mover para cima
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            disabled={!canMoveDown}
            onClick={() => run(onMoveDown)}
          >
            Mover para baixo
          </button>
          <div className="my-1 border-t border-line" />
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 transition hover:bg-red-500/10 dark:text-red-400"
            onClick={() => run(onDelete)}
          >
            Excluir
          </button>
        </div>
      )}
    </div>
  );
}

// Barra fixa de ações da seleção múltipla.
function SelectionBar({
  count,
  groups,
  onMove,
  onClear,
}: {
  count: number;
  groups: CompanyGroup[];
  onMove: (groupId: string | null) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(groupId: string | null) {
    setOpen(false);
    onMove(groupId);
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-pill flex justify-center px-4 pb-4">
      <div className="flex w-full max-w-2xl items-center gap-2 rounded-2xl border border-line bg-surface px-3 py-2.5 shadow-pop sm:gap-3 sm:px-4">
        <span className="text-sm font-medium text-fg">
          {count} {count === 1 ? "selecionada" : "selecionadas"}
        </span>
        <div className="relative ml-auto" ref={ref}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={open}
            className="inline-flex items-center gap-1.5 rounded-lg bg-risd px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-chrysler focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            Transferir para grupo…
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m18 15-6-6-6 6" />
            </svg>
          </button>
          {open && (
            <div
              role="menu"
              className="absolute bottom-full right-0 z-overlay mb-1 max-h-72 w-56 overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-pop"
            >
              {groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  role="menuitem"
                  onClick={() => pick(g.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg transition hover:bg-surface-2"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: colorTints(g.color).dot }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{g.name}</span>
                </button>
              ))}
              {groups.length > 0 && <div className="my-1 border-t border-line" />}
              <button
                type="button"
                role="menuitem"
                onClick={() => pick(null)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg-muted transition hover:bg-surface-2"
              >
                Sem grupo
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClear}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-fg-muted shadow-sm transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
        >
          Limpar
        </button>
      </div>
    </div>
  );
}

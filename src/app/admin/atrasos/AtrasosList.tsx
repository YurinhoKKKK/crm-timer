"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Loader2 } from "lucide-react";
import {
  FilterBar,
  SearchBox,
  SelectFilter,
  EmptyState,
  norm,
  type SelectOption,
} from "@/components/ListControls";
import { ComboFilter } from "@/components/Combobox";
import { formatDue } from "@/lib/format";
import TaskDetailLink from "@/components/TaskDetailLink";
import Person from "@/components/Person";
import {
  SITUATION_META,
  SITUATION_FILTER_OPTIONS,
  LIST_ORDER_OPTIONS,
  PARAM,
  displayTypeLabel,
  formatSpan,
  normalizeListOrder,
  type AtrasoRow,
  type ListOrder,
} from "./atrasos-shared";
import { loadAtrasosList } from "./actions";

const PAGE_SIZE = 50;

type CreatorOpt = { id: string; name: string };

type Committed = {
  status: string;
  creatorId: string;
  responsibleId: string;
  companyId: string;
  type: string;
  order: ListOrder;
  search: string;
  includeStandard: boolean;
};

function committedFromParams(sp: URLSearchParams): Committed {
  return {
    status: sp.get(PARAM.status) ?? "",
    creatorId: sp.get(PARAM.creator) ?? "",
    responsibleId: sp.get(PARAM.responsible) ?? "",
    companyId: sp.get(PARAM.company) ?? "",
    type: sp.get(PARAM.type) ?? "",
    order: normalizeListOrder(sp.get(PARAM.order) ?? undefined),
    search: sp.get(PARAM.search) ?? "",
    includeStandard: sp.get(PARAM.standard) === "1",
  };
}

function sigOf(c: Committed): string {
  return [
    c.status, c.creatorId, c.responsibleId, c.companyId, c.type, c.order,
    c.search, c.includeStandard ? "1" : "0",
  ].join("|");
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AtrasosList({
  start,
  end,
  companies,
  types,
  creators,
  responsibles,
  initialRows,
  initialTotal,
}: {
  start: string | null;
  end: string | null;
  companies: SelectOption[];
  types: SelectOption[];
  creators: CreatorOpt[];
  responsibles: CreatorOpt[];
  initialRows: AtrasoRow[];
  initialTotal: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const committed = useMemo(
    () => committedFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams]
  );
  const sig = sigOf(committed);
  const initialSig = useRef(sig);

  const [searchInput, setSearchInput] = useState(committed.search);

  const [data, setData] = useState<{
    sig: string;
    rows: AtrasoRow[];
    total: number;
  }>({ sig, rows: initialRows, total: initialTotal });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Atualiza os parâmetros da tela na URL, preservando os demais (período).
  const pushParams = useCallback(
    (patch: Partial<Record<keyof typeof PARAM, string>>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        const key = PARAM[k as keyof typeof PARAM];
        if (v) params.set(key, v);
        else params.delete(key);
      }
      const qs = params.toString();
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    },
    [router, pathname, searchParams]
  );

  // Debounce da busca → URL.
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== committed.search) {
        pushParams({ search: searchInput.trim() });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, committed.search, pushParams]);

  // Recarrega a página 0 quando a assinatura dos filtros muda (menos no 1º
  // render — os dados iniciais vieram do servidor com a mesma URL).
  useEffect(() => {
    if (sig === initialSig.current && data.sig === initialSig.current) return;
    if (sig === data.sig) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadAtrasosList({
      start, end,
      includeStandard: committed.includeStandard,
      status: committed.status,
      creatorId: committed.creatorId,
      responsibleId: committed.responsibleId,
      companyId: committed.companyId,
      type: committed.type,
      search: committed.search,
      order: committed.order,
      limit: PAGE_SIZE,
      offset: 0,
    }).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.error) { setError(res.error); return; }
      setData({ sig, rows: res.rows, total: res.total });
    });
    return () => { cancelled = true; };
  }, [sig, data.sig, start, end, committed]);

  const loadMore = useCallback(() => {
    setLoadingMore(true);
    setError(null);
    const currentSig = data.sig;
    loadAtrasosList({
      start, end,
      includeStandard: committed.includeStandard,
      status: committed.status,
      creatorId: committed.creatorId,
      responsibleId: committed.responsibleId,
      companyId: committed.companyId,
      type: committed.type,
      search: committed.search,
      order: committed.order,
      limit: PAGE_SIZE,
      offset: data.rows.length,
    }).then((res) => {
      setLoadingMore(false);
      if (res.error) { setError(res.error); return; }
      setData((prev) => {
        if (prev.sig !== currentSig) return prev;
        const seen = new Set(prev.rows.map((r) => r.id));
        const merged = [...prev.rows, ...res.rows.filter((r) => !seen.has(r.id))];
        return { sig: prev.sig, rows: merged, total: res.total };
      });
    });
  }, [start, end, committed, data.sig, data.rows.length]);

  const hasMore = data.rows.length < data.total;

  const typeOptions: SelectOption[] = useMemo(
    () => types.map((t) => ({ value: t.value, label: displayTypeLabel(t.value, t.label) })),
    [types]
  );
  const creatorOptions: SelectOption[] = useMemo(
    () => creators.map((c) => ({ value: c.id, label: c.name })),
    [creators]
  );
  const responsibleOptions: SelectOption[] = useMemo(
    () => responsibles.map((c) => ({ value: c.id, label: c.name })),
    [responsibles]
  );

  const exportHref = `/api/admin/atrasos/export?${searchParams.toString()}`;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-fg-muted">
          <span className="font-semibold text-fg">{data.total}</span>{" "}
          {data.total === 1 ? "atraso encontrado" : "atrasos encontrados"}
          {isPending || loading ? (
            <span className="ml-2 text-xs text-fg-subtle">atualizando…</span>
          ) : null}
        </p>
        <ExportButton href={exportHref} />
      </div>

      <FilterBar>
        <SearchBox
          value={searchInput}
          onChange={setSearchInput}
          placeholder="Buscar por título, empresa, descrição ou criador…"
        />
        <SelectFilter
          value={committed.status}
          onChange={(v) => pushParams({ status: v })}
          allLabel="Todas as situações"
          ariaLabel="Filtrar por situação"
          options={SITUATION_FILTER_OPTIONS}
        />
        <ComboFilter
          value={committed.companyId}
          onChange={(v) => pushParams({ company: v })}
          allLabel="Todas as empresas"
          ariaLabel="Filtrar por empresa"
          searchPlaceholder="Buscar empresa…"
          options={companies}
        />
        <ComboFilter
          value={committed.type}
          onChange={(v) => pushParams({ type: v })}
          allLabel="Todos os tipos"
          ariaLabel="Filtrar por tipo de tarefa"
          searchPlaceholder="Buscar tipo…"
          options={typeOptions}
        />
        <ComboFilter
          value={committed.creatorId}
          onChange={(v) => pushParams({ creator: v })}
          allLabel="Todos os criadores"
          ariaLabel="Filtrar por criador"
          searchPlaceholder="Buscar criador…"
          options={creatorOptions}
        />
        <ComboFilter
          value={committed.responsibleId}
          onChange={(v) => pushParams({ responsible: v })}
          allLabel="Todos os responsáveis"
          ariaLabel="Filtrar por responsável"
          searchPlaceholder="Buscar responsável…"
          options={responsibleOptions}
        />
        <SelectFilter
          value={committed.order === "atraso" ? "" : committed.order}
          onChange={(v) => pushParams({ order: v })}
          allLabel="Mais atrasadas"
          ariaLabel="Ordenar"
          options={LIST_ORDER_OPTIONS.filter((o) => o.value !== "atraso")}
        />
        <label className="flex cursor-pointer select-none items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg-muted shadow-sm transition hover:border-risd/50">
          <input
            type="checkbox"
            checked={committed.includeStandard}
            onChange={(e) => pushParams({ standard: e.target.checked ? "1" : "" })}
            className="h-4 w-4 rounded border-line text-risd focus-visible:ring-risd"
          />
          Incluir tarefas padrão diárias
        </label>
      </FilterBar>

      {error && (
        <p className="mb-3 rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </p>
      )}

      {data.rows.length === 0 ? (
        <EmptyState>
          {loading ? "Carregando…" : "Nenhum atraso corresponde aos filtros. 🎉"}
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {data.rows.map((r) => (
            <AtrasoRowCard key={r.id} row={r} />
          ))}
        </ul>
      )}

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="w-full rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg shadow-sm transition hover:border-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:opacity-60 sm:w-auto"
          >
            {loadingMore ? "Carregando…" : "Carregar mais"}{" "}
            <span className="text-fg-subtle">
              ({data.total - data.rows.length} restante
              {data.total - data.rows.length === 1 ? "" : "s"})
            </span>
          </button>
        </div>
      )}
    </>
  );
}

function AtrasoRowCard({ row }: { row: AtrasoRow }) {
  const meta = SITUATION_META[row.situation];
  const tipo = displayTypeLabel(row.typeKey, row.typeLabel);
  const showTitle = norm(row.title) !== norm(tipo);
  const delayTone =
    row.situation === "open_overdue"
      ? "text-red-600 dark:text-red-400"
      : row.situation === "completed_late"
      ? "text-amber-600 dark:text-amber-400"
      : "text-fg-muted";

  return (
    <li className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <TaskDetailLink
              taskId={row.id}
              className="font-medium text-fg transition hover:text-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              {tipo}
            </TaskDetailLink>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${meta.badge}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
              {meta.label}
            </span>
          </div>
          <p className="mt-1 text-sm text-fg-muted">{row.companyName}</p>
          {showTitle && <p className="mt-0.5 text-sm text-fg-subtle">{row.title}</p>}

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-subtle">
            <span className="inline-flex items-center gap-1">
              Resp.:
              <Person name={row.responsible.name} avatarUrl={row.responsible.avatarUrl} size={16} />
            </span>
            {row.creator.name ? (
              <span className="inline-flex items-center gap-1">
                Criador:
                <Person name={row.creator.name} avatarUrl={row.creator.avatarUrl} size={16} />
              </span>
            ) : (
              <span>Criada pelo sistema</span>
            )}
            {row.createdAt && <span>Criada em {formatDateTime(row.createdAt)}</span>}
            <span>Prazo: {formatDue(row.dueAt)}</span>
            <span>Prazo concedido: {formatSpan(row.grantedSeconds)}</span>
            {row.finishedAt && <span>Concluída em {formatDateTime(row.finishedAt)}</span>}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-[11px] uppercase tracking-wide text-fg-subtle">Atraso</p>
          <p className={`font-mono text-lg font-semibold tabular-nums ${delayTone}`}>
            {formatSpan(row.delaySeconds)}
          </p>
        </div>
      </div>
    </li>
  );
}

function ExportButton({ href }: { href: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(href);
      if (!res.ok) {
        throw new Error(
          res.status === 403 ? "Sem permissão para exportar." : "Não foi possível gerar a planilha."
        );
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] ?? "atrasos.xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao exportar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleExport}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-fg shadow-sm transition hover:border-risd/60 hover:text-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {loading ? "Gerando…" : "Exportar Excel"}
      </button>
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}

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
import { STATUS_META, STATUS_FILTER_OPTIONS } from "@/lib/status";
import { formatDuration, formatDue } from "@/lib/format";
import {
  FilterBar,
  SearchBox,
  SelectFilter,
  EmptyState,
  norm,
  type SelectOption,
} from "@/components/ListControls";
import { ComboFilter } from "@/components/Combobox";
import { inputClass, labelClass, btnPrimary, btnSecondary } from "@/lib/ui";
import TaskDetailLink from "@/components/TaskDetailLink";
import {
  displayTypeLabel,
  dueDayMonth,
  groupByDueDay,
  normalizeOrder,
  TASK_ORDER_OPTIONS,
  type CollaboratorTask,
  type TaskOrder,
  type TypeOption,
} from "./collaborator-tasks";
import { adjustTaskTime, loadCollaboratorTasks } from "./actions";

const PAGE_SIZE = 50;

// Nomes dos parâmetros de URL desta lista (namespaced p/ conviver com os do
// período — periodo/de/ate/mes — na mesma URL).
const PARAM = {
  status: "fstatus",
  company: "fempresa",
  type: "ftipo",
  order: "fordem",
  search: "fbusca",
} as const;

type Committed = {
  status: string;
  companyId: string;
  type: string;
  order: TaskOrder;
  search: string;
};

function committedFromParams(sp: URLSearchParams): Committed {
  return {
    status: sp.get(PARAM.status) ?? "",
    companyId: sp.get(PARAM.company) ?? "",
    type: sp.get(PARAM.type) ?? "",
    order: normalizeOrder(sp.get(PARAM.order) ?? undefined),
    search: sp.get(PARAM.search) ?? "",
  };
}

function sigOf(c: Committed): string {
  return [c.status, c.companyId, c.type, c.order, c.search].join("|");
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

export default function CollaboratorTaskList({
  collaboratorId,
  start,
  end,
  companies,
  types,
  initialTasks,
  initialTotal,
  todayYmd,
  yesterdayYmd,
}: {
  collaboratorId: string;
  start: string | null;
  end: string | null;
  companies: SelectOption[];
  types: TypeOption[];
  initialTasks: CollaboratorTask[];
  initialTotal: number;
  todayYmd: string;
  yesterdayYmd: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Fonte da verdade dos filtros COMMITADOS = a URL (reload/voltar preservam).
  const committed = useMemo(
    () => committedFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams]
  );
  const sig = sigOf(committed);
  const initialSig = useRef(sig);

  // Input de busca: estado local (digitação fluida) + debounce → URL.
  const [searchInput, setSearchInput] = useState(committed.search);

  // Dados carregados (página 0 + páginas apensas por "Carregar mais").
  const [data, setData] = useState<{
    sig: string;
    tasks: CollaboratorTask[];
    total: number;
  }>({ sig, tasks: initialTasks, total: initialTotal });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Atualiza os parâmetros da lista na URL, preservando os demais (período).
  // scroll:false + startTransition: mudar filtro não leva a página ao topo.
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

  // Debounce de 300 ms da busca: só commita na URL quando o texto estabiliza.
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== committed.search) {
        pushParams({ search: searchInput.trim() });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, committed.search, pushParams]);

  // Busca a PÁGINA 0 sempre que a assinatura dos filtros muda (menos no 1º
  // render, já que os dados iniciais vieram do servidor com a mesma URL).
  useEffect(() => {
    if (sig === initialSig.current && data.sig === initialSig.current) return;
    if (sig === data.sig) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadCollaboratorTasks({
      collaboratorId,
      start,
      end,
      status: committed.status,
      companyId: committed.companyId,
      type: committed.type,
      search: committed.search,
      order: committed.order,
      limit: PAGE_SIZE,
      offset: 0,
    }).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.error) {
        setError(res.error);
        return;
      }
      setData({ sig, tasks: res.tasks, total: res.total });
    });
    return () => {
      cancelled = true;
    };
  }, [sig, data.sig, collaboratorId, start, end, committed]);

  const loadMore = useCallback(() => {
    setLoadingMore(true);
    setError(null);
    const currentSig = data.sig;
    loadCollaboratorTasks({
      collaboratorId,
      start,
      end,
      status: committed.status,
      companyId: committed.companyId,
      type: committed.type,
      search: committed.search,
      order: committed.order,
      limit: PAGE_SIZE,
      offset: data.tasks.length,
    }).then((res) => {
      setLoadingMore(false);
      if (res.error) {
        setError(res.error);
        return;
      }
      setData((prev) => {
        // Descartamos se os filtros mudaram no meio do caminho.
        if (prev.sig !== currentSig) return prev;
        const seen = new Set(prev.tasks.map((t) => t.id));
        const merged = [...prev.tasks, ...res.tasks.filter((t) => !seen.has(t.id))];
        return { sig: prev.sig, tasks: merged, total: res.total };
      });
    });
  }, [collaboratorId, start, end, committed, data.sig, data.tasks.length]);

  // Recarrega a janela já aberta (após um ajuste de tempo) mantendo a contagem.
  const reload = useCallback(() => {
    const currentSig = data.sig;
    loadCollaboratorTasks({
      collaboratorId,
      start,
      end,
      status: committed.status,
      companyId: committed.companyId,
      type: committed.type,
      search: committed.search,
      order: committed.order,
      limit: Math.max(PAGE_SIZE, data.tasks.length),
      offset: 0,
    }).then((res) => {
      if (res.error) return;
      setData((prev) =>
        prev.sig !== currentSig
          ? prev
          : { sig: prev.sig, tasks: res.tasks, total: res.total }
      );
    });
  }, [collaboratorId, start, end, committed, data.sig, data.tasks.length]);

  const groups = useMemo(
    () => groupByDueDay(data.tasks, todayYmd, yesterdayYmd),
    [data.tasks, todayYmd, yesterdayYmd]
  );
  const hasMore = data.tasks.length < data.total;

  const typeOptions: SelectOption[] = useMemo(
    () => types.map((t) => ({ value: t.key, label: displayTypeLabel(t.key, t.label) })),
    [types]
  );

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="text-sm text-fg-muted">
          <span className="font-semibold text-fg">{data.total}</span>{" "}
          {data.total === 1 ? "tarefa encontrada" : "tarefas encontradas"}
          {isPending || loading ? (
            <span className="ml-2 text-xs text-fg-subtle">atualizando…</span>
          ) : null}
        </p>
      </div>

      <FilterBar>
        <SearchBox
          value={searchInput}
          onChange={setSearchInput}
          placeholder="Buscar por título, empresa (nº ou nome) ou descrição…"
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
        <SelectFilter
          value={committed.status}
          onChange={(v) => pushParams({ status: v })}
          allLabel="Todos os status"
          ariaLabel="Filtrar por status"
          options={STATUS_FILTER_OPTIONS}
        />
        <SelectFilter
          value={committed.order === "recentes" ? "" : committed.order}
          onChange={(v) => pushParams({ order: v })}
          allLabel="Mais recentes"
          ariaLabel="Ordenar"
          options={TASK_ORDER_OPTIONS.filter((o) => o.value !== "recentes")}
        />
      </FilterBar>

      {error && (
        <p className="mb-3 rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </p>
      )}

      {data.tasks.length === 0 ? (
        <EmptyState>
          {loading ? "Carregando…" : "Nenhuma tarefa corresponde aos filtros."}
        </EmptyState>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.key}>
              <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                {g.label}
                <span className="font-normal normal-case text-fg-subtle/70">
                  · {g.items.length}
                </span>
              </h4>
              <ul className="space-y-3">
                {g.items.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    collaboratorId={collaboratorId}
                    onAdjusted={reload}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
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
              ({data.total - data.tasks.length} restante
              {data.total - data.tasks.length === 1 ? "" : "s"})
            </span>
          </button>
        </div>
      )}
    </>
  );
}

function TaskRow({
  task,
  collaboratorId,
  onAdjusted,
}: {
  task: CollaboratorTask;
  collaboratorId: string;
  onAdjusted: () => void;
}) {
  const meta = STATUS_META[task.status];
  const tipo = displayTypeLabel(task.typeKey, task.typeLabel);
  // Mostra o título só quando difere do "tipo" (evita repetir "Cadastro / Cadastro").
  const showTitle = norm(task.title) !== norm(tipo);

  const [editing, setEditing] = useState(false);
  const [hours, setHours] = useState(Math.floor(task.totalSeconds / 3600));
  const [minutes, setMinutes] = useState(Math.floor((task.totalSeconds % 3600) / 60));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setHours(Math.floor(task.totalSeconds / 3600));
    setMinutes(Math.floor((task.totalSeconds % 3600) / 60));
    setReason("");
    setError(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reason.trim()) {
      setError("A justificativa do ajuste é obrigatória.");
      return;
    }
    const newSeconds = hours * 3600 + minutes * 60;
    const { error: actionError } = await adjustTaskTime(
      task.id,
      collaboratorId,
      newSeconds,
      reason,
      task.companyId
    );
    if (actionError) {
      setError(actionError);
      return;
    }
    setEditing(false);
    setReason("");
    startTransition(() => onAdjusted());
  }

  const hasAdjustments = task.adjustments.length > 0;
  const historyTitle = hasAdjustments
    ? task.adjustments
        .map(
          (a) =>
            `${formatDateTime(a.at)} · ${formatDuration(a.oldSeconds)} → ${formatDuration(
              a.newSeconds
            )} · ${a.by}${a.reason ? ` · ${a.reason}` : ""}`
        )
        .join("\n")
    : undefined;

  return (
    <li className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <TaskDetailLink
              taskId={task.id}
              className="font-medium text-fg transition hover:text-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              {tipo}
            </TaskDetailLink>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${meta.badge}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
              {meta.label}
            </span>
            {hasAdjustments && (
              <span
                className="cursor-help rounded-full border border-amber-300/60 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
                title={historyTitle}
              >
                tempo ajustado
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-fg-muted">{task.companyName}</p>
          {task.onlyByWork && (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-sky-300/60 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300">
              Trabalhada no período · prazo {dueDayMonth(task.dueAt)}
            </span>
          )}
          {showTitle && (
            <p className="mt-0.5 text-sm text-fg-subtle">{task.title}</p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-fg-subtle">
            <span>Prazo: {formatDue(task.dueAt)}</span>
            {task.finishedAt && (
              <span>Concluída em {formatDateTime(task.finishedAt)}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-sm tabular-nums text-fg">
            {formatDuration(task.totalSeconds)}
          </span>
          {!editing && (
            <button
              type="button"
              onClick={() => {
                reset();
                setEditing(true);
              }}
              className={btnSecondary}
            >
              Ajustar tempo
            </button>
          )}
        </div>
      </div>

      {editing && (
        <form
          onSubmit={save}
          className="mt-4 space-y-4 rounded-lg border border-risd/40 bg-surface-2/40 p-4"
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-24">
              <label htmlFor={`h-${task.id}`} className={labelClass}>
                Horas
              </label>
              <input
                id={`h-${task.id}`}
                type="number"
                min={0}
                max={999}
                value={hours}
                onChange={(e) => setHours(Math.max(0, Number(e.target.value) || 0))}
                className={inputClass}
              />
            </div>
            <div className="w-24">
              <label htmlFor={`m-${task.id}`} className={labelClass}>
                Minutos
              </label>
              <input
                id={`m-${task.id}`}
                type="number"
                min={0}
                max={59}
                value={minutes}
                onChange={(e) =>
                  setMinutes(Math.min(59, Math.max(0, Number(e.target.value) || 0)))
                }
                className={inputClass}
              />
            </div>
            <p className="pb-2 text-xs text-fg-subtle">
              Atual: {formatDuration(task.totalSeconds)}
            </p>
          </div>

          <div>
            <label htmlFor={`r-${task.id}`} className={labelClass}>
              Justificativa <span className="text-red-500">*</span>
            </label>
            <input
              id={`r-${task.id}`}
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: esqueceu de pausar o timer"
              required
              className={inputClass}
            />
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={isPending || !reason.trim()}
              className={btnPrimary}
            >
              {isPending ? "Salvando…" : "Salvar ajuste"}
            </button>
            <button
              type="button"
              onClick={() => {
                reset();
                setEditing(false);
              }}
              className={btnSecondary}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

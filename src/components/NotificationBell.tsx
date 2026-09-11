"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bell, Check, X } from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import { avatarUrl } from "@/lib/avatar";
import Avatar from "./Avatar";
import {
  notificationHref,
  relativeTimeBRT,
  fullTimeBRT,
  type NotificationType,
  type NotificationView,
  type ShellRole,
} from "@/lib/notifications";

const PAGE = 15;

type Filter = "unread" | "all";

// Linha crua da RPC notifications_feed (já com redação de acesso do banco).
type FeedRow = {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  company_id: string | null;
  company_name: string | null;
  reachable: boolean;
  source_type: string | null;
  source_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_avatar_path: string | null;
  created_at: string;
  read_at: string | null;
};

function mapRow(r: FeedRow): NotificationView {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    companyId: r.company_id,
    companyName: r.company_name,
    reachable: r.reachable,
    sourceType: r.source_type,
    sourceId: r.source_id,
    actorId: r.actor_id,
    actorName: r.actor_name,
    actorAvatarUrl: avatarUrl(r.actor_avatar_path),
    createdAtISO: r.created_at,
    readAtISO: r.read_at,
  };
}

// Nome de quem "causou" para o avatar/rótulo. Cliente (listagem) e sistema não
// têm ator — mostramos um rótulo neutro.
function actorLabel(n: NotificationView): string {
  if (n.actorName) return n.actorName;
  if (n.type === "listagem_ajuste_solicitado") return "Cliente";
  return "Sistema";
}

// Sino de notificações no topo. Contador de NÃO LIDAS agregado no banco (teto
// "9+"). Sem tempo real: recarrega ao navegar (pathname), ao voltar à aba e ao
// abrir o painel — mesma disciplina de custo do resto (nada de poll/laço).
export default function NotificationBell({ role }: { role: ShellRole }) {
  const router = useRouter();
  const pathname = usePathname();

  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<NotificationView[] | null>(null); // null = carregando
  const [error, setError] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(async () => {
    const supabase = createClient();
    const { data, error: err } = await supabase.rpc(
      "notifications_unread_count"
    );
    if (!err && data != null) setCount(Number(data));
  }, []);

  // Contador: no mount, a cada navegação e ao voltar à aba.
  useEffect(() => {
    refreshCount();
  }, [refreshCount, pathname]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshCount();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [refreshCount]);

  const load = useCallback(
    async (f: Filter, off: number, append: boolean) => {
      const supabase = createClient();
      const { data, error: err } = await supabase.rpc("notifications_feed", {
        p_filter: f,
        p_limit: PAGE,
        p_offset: off,
      });
      if (err) {
        if (!append) {
          setError(true);
          setItems([]);
        }
        return;
      }
      setError(false);
      const rows = ((data as FeedRow[] | null) ?? []).map(mapRow);
      setHasMore(rows.length === PAGE);
      setItems((prev) => (append && prev ? [...prev, ...rows] : rows));
    },
    []
  );

  // Abrir o painel busca a 1ª página e ressincroniza o contador.
  function togglePanel() {
    setOpen((v) => {
      const next = !v;
      if (next) {
        setItems(null);
        setError(false);
        setOffset(0);
        void load(filter, 0, false);
        void refreshCount();
      }
      return next;
    });
  }

  // Troca de filtro recarrega do zero.
  function changeFilter(f: Filter) {
    if (f === filter) return;
    setFilter(f);
    setItems(null);
    setOffset(0);
    void load(f, 0, false);
  }

  async function showMore() {
    const next = offset + PAGE;
    setLoadingMore(true);
    setOffset(next);
    await load(filter, next, true);
    setLoadingMore(false);
  }

  // Fecha ao clicar fora / Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markRead(ids: string[]) {
    if (ids.length === 0) return;
    const supabase = createClient();
    // Otimista: some do contador, mas PERMANECE na lista (só muda de estado).
    setItems((prev) =>
      prev
        ? prev.map((n) =>
            ids.includes(n.id) && !n.readAtISO
              ? { ...n, readAtISO: new Date().toISOString() }
              : n
          )
        : prev
    );
    setCount((c) => Math.max(0, c - ids.length));
    await supabase.rpc("notifications_mark_read", { p_ids: ids });
    void refreshCount();
  }

  async function markAll() {
    const supabase = createClient();
    const nowISO = new Date().toISOString();
    setItems((prev) =>
      prev ? prev.map((n) => (n.readAtISO ? n : { ...n, readAtISO: nowISO })) : prev
    );
    setCount(0);
    await supabase.rpc("notifications_mark_all_read");
    void refreshCount();
    // Se o filtro for "não lidas", recarrega para esvaziar coerentemente.
    if (filter === "unread") void load("unread", 0, false);
  }

  function onItemClick(n: NotificationView) {
    if (!n.readAtISO) void markRead([n.id]);
    const href = notificationHref(role, n);
    if (href) {
      setOpen(false);
      router.push(href);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={togglePanel}
        aria-label={
          count > 0 ? `${count} notificações não lidas` : "Notificações"
        }
        aria-expanded={open}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-fg-muted transition hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
      >
        <Bell size={18} aria-hidden="true" />
        {count > 0 && (
          <span
            className="absolute -right-1 -top-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-risd px-1 text-[10px] font-bold leading-none text-white"
            aria-hidden="true"
          >
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notificações"
          className="absolute right-0 top-full z-overlay mt-2 flex max-h-[70vh] w-[min(360px,90vw)] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-pop"
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
            <h2 className="text-sm font-semibold text-fg">Notificações</h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={markAll}
                title="Marcar todas como lidas"
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-fg-muted transition hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
              >
                <Check size={13} aria-hidden="true" />
                Marcar todas
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar"
                className="rounded-md p-1 text-fg-subtle transition hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          <div className="flex gap-1 border-b border-line px-3 py-2">
            {(["unread", "all"] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => changeFilter(f)}
                aria-pressed={filter === f}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
                  filter === f
                    ? "bg-brand-tint text-risd"
                    : "text-fg-muted hover:bg-surface-2 hover:text-fg"
                }`}
              >
                {f === "unread" ? "Não lidas" : "Todas"}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {items === null ? (
              <p className="px-3 py-8 text-center text-sm text-fg-subtle">
                Carregando…
              </p>
            ) : error ? (
              <div className="px-3 py-8 text-center">
                <p className="text-sm text-red-600 dark:text-red-400">
                  Não foi possível carregar as notificações.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setItems(null);
                    void load(filter, 0, false);
                  }}
                  className="mt-2 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-fg-muted transition hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
                >
                  Tentar de novo
                </button>
              </div>
            ) : items.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-fg-subtle">
                {filter === "unread"
                  ? "Nenhuma notificação não lida."
                  : "Nenhuma notificação ainda."}
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {items.map((n) => {
                  const unread = !n.readAtISO;
                  const href = notificationHref(role, n);
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => onItemClick(n)}
                        className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-risd ${
                          unread ? "bg-brand-tint/40" : ""
                        }`}
                      >
                        <span className="mt-0.5 shrink-0">
                          <Avatar
                            name={actorLabel(n)}
                            url={n.actorAvatarUrl}
                            size={28}
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span
                              className={`min-w-0 flex-1 truncate text-sm ${
                                unread
                                  ? "font-semibold text-fg"
                                  : "font-medium text-fg-muted"
                              }`}
                            >
                              {actorLabel(n)}
                            </span>
                            {unread && (
                              <span
                                className="h-2 w-2 shrink-0 rounded-full bg-risd"
                                aria-hidden="true"
                              />
                            )}
                          </span>
                          <span className="block text-sm text-fg">
                            {n.title}
                          </span>
                          {n.body && (
                            <span className="mt-0.5 block truncate text-xs text-fg-muted">
                              {n.body}
                            </span>
                          )}
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-fg-subtle">
                            {n.companyName && (
                              <>
                                <span className="truncate font-medium">
                                  {n.companyName}
                                </span>
                                <span aria-hidden="true">·</span>
                              </>
                            )}
                            <span title={fullTimeBRT(n.createdAtISO)}>
                              {relativeTimeBRT(n.createdAtISO)}
                            </span>
                            {!n.reachable && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="italic">sem acesso</span>
                              </>
                            )}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {items && items.length > 0 && hasMore && (
              <div className="p-2">
                <button
                  type="button"
                  onClick={showMore}
                  disabled={loadingMore}
                  className="w-full rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-fg-muted transition hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd disabled:opacity-60"
                >
                  {loadingMore ? "Carregando…" : "Ver mais"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

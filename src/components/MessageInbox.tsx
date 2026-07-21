"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { MESSAGES_READ_EVENT } from "@/lib/message-sync";
import { fetchMessageInbox } from "@/app/message-actions";
import type { InboxRow } from "@/lib/messages";

// Caixa de entrada de mensagens (passos 32 e 32.1) — componente VIVO,
// compartilhado pelos três painéis.
//
// Fonte de verdade ÚNICA: estas linhas e o badge da sidebar saem da MESMA
// consulta (message_inbox; o badge é literalmente a soma dos contadores
// daqui, definida no banco) — não têm como divergir.
//
// A lista nunca fica presa em cache: ressincroniza ao montar (mata o Router
// Cache), no Realtime de company_messages (a entrega já vem filtrada pelo
// RLS por assinante — consultor não recebe evento de empresa alheia), no
// evento local de leitura e em foco/reconexão. Mesmo padrão do 31.1: o
// evento é só o sinal, o estado é refeito pela consulta.

type Role = "admin" | "consultor" | "colaborador";

// Destino do clique por painel: aba Mensagens da central (admin/consultor)
// ou âncora na tela da empresa (colaborador).
function hrefFor(role: Role, companyId: string): string {
  switch (role) {
    case "admin":
      return `/admin/empresas/${companyId}?aba=mensagens`;
    case "consultor":
      return `/consultor/${companyId}?aba=mensagens`;
    case "colaborador":
      return `/colaborador/${companyId}#mensagens`;
  }
}

// Horário legível: hora se for hoje, "Ontem", data nos demais.
function formatWhen(at: string): string {
  const d = new Date(at);
  const now = new Date();
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (dayDiff === 0) {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  if (dayDiff === 1) return "Ontem";
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

export default function MessageInbox({
  role,
  initial,
}: {
  role: Role;
  initial: InboxRow[];
}) {
  const [rows, setRows] = useState<InboxRow[]>(initial);
  const [query, setQuery] = useState("");
  const debounceRef = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    const fresh = await fetchMessageInbox();
    if (fresh) setRows(fresh);
  }, []);

  useEffect(() => {
    const supabase = createClient();

    refresh();

    const channel = supabase
      .channel("message-inbox")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "company_messages" },
        () => {
          window.clearTimeout(debounceRef.current);
          debounceRef.current = window.setTimeout(refresh, 300);
        }
      )
      .subscribe();

    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    window.addEventListener(MESSAGES_READ_EVENT, refresh);
    return () => {
      window.clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      window.removeEventListener(MESSAGES_READ_EVENT, refresh);
    };
  }, [refresh]);

  const q = query.trim().toLocaleLowerCase("pt-BR");
  const visible = q
    ? rows.filter((r) => r.companyName.toLocaleLowerCase("pt-BR").includes(q))
    : rows;

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-surface px-6 py-12 text-center">
        <p className="text-sm font-medium text-fg">Nenhuma conversa ainda</p>
        <p className="mt-1 text-sm text-fg-muted">
          Quando um cliente escrever pelo portal — ou alguém da equipe iniciar
          uma conversa — ela aparece aqui.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Busca por empresa (escala: evita rolar uma lista gigante) */}
      <div className="mb-4">
        <label htmlFor="inbox-search" className="sr-only">
          Buscar empresa
        </label>
        <input
          id="inbox-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar empresa…"
          className="w-full max-w-sm rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm transition placeholder:text-fg-subtle focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
        />
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface px-4 py-8 text-center text-sm text-fg-muted">
          Nenhuma conversa encontrada para “{query.trim()}”.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          {visible.map((r) => {
            const unread = r.unread > 0;
            return (
              <li key={r.companyId} className="border-b border-line last:border-b-0">
                <Link
                  href={hrefFor(role, r.companyId)}
                  className={`relative flex items-center gap-3 py-3.5 pl-4 pr-4 transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-risd sm:pl-5 sm:pr-5 ${
                    unread ? "bg-brand-tint/40 dark:bg-risd/5" : ""
                  }`}
                >
                  {/* Barra de acento discreta nas não lidas */}
                  {unread && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 left-0 w-1 bg-risd"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p
                        className={`truncate text-sm ${
                          unread
                            ? "font-semibold text-fg"
                            : "font-medium text-fg-muted"
                        }`}
                      >
                        {r.companyName}
                      </p>
                      <span
                        className={`shrink-0 text-xs tabular-nums ${
                          unread ? "font-medium text-fg-muted" : "text-fg-subtle"
                        }`}
                      >
                        {formatWhen(r.lastAt)}
                      </span>
                    </div>
                    <p
                      className={`mt-0.5 truncate text-sm ${
                        unread ? "text-fg" : "text-fg-subtle"
                      }`}
                    >
                      <span className={unread ? "text-fg-muted" : "text-fg-subtle"}>
                        {r.lastAuthorType === "cliente"
                          ? "Cliente: "
                          : `${r.lastAuthor ?? "Equipe"}: `}
                      </span>
                      {r.lastBody}
                    </p>
                  </div>
                  {unread && (
                    <span
                      aria-label={`${r.unread} não lidas`}
                      className="inline-flex min-w-[1.5rem] shrink-0 items-center justify-center rounded-full bg-risd px-1.5 py-0.5 text-xs font-semibold leading-none text-white"
                    >
                      {r.unread > 99 ? "99+" : r.unread}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

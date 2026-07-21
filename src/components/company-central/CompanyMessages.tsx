"use client";

import { useCallback, useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { createClient } from "@/lib/supabase-browser";
import { useConversation } from "@/lib/use-conversation";
import { useChatScroll } from "@/lib/use-chat-scroll";
import type { CompanyMessage } from "@/lib/messages";
import {
  sendCompanyMessage,
  companyMessagesPage,
  markMessagesRead,
} from "@/app/message-actions";
import { emitMessagesRead } from "@/lib/message-sync";

// Lado INTERNO da conversa com o cliente (passos 31 e 31.1). Aparece na
// central da empresa (admin e consultor) e na tela da empresa do colaborador.
//
// TEMPO REAL: assinatura Supabase Realtime de INSERT em company_messages,
// SÓ enquanto esta tela está montada (a aba Mensagens da central monta só o
// conteúdo ativo — nada de canal aberto em todas as telas, disciplina do
// passo 29). A conexão usa o JWT do usuário, então a ENTREGA passa pelo RLS:
// um consultor não recebe evento de empresa que não é dele — o filtro por
// company_id no canal é eficiência, a segurança é a policy cm_select.
//
// O evento é só um SINAL: a tela ressincroniza pela página mais recente
// (merge por id), o que também cobre eventos perdidos — foco e reconexão
// disparam a mesma ressincronização.
//
// A autoria continua carimbada no SERVIDOR e as mensagens seguem IMUTÁVEIS
// (nada disso mudou com o tempo real).

type Pending = { tempId: string; body: string; failed: boolean };

function formatWhen(at: string): string {
  return new Date(at).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CompanyMessages({
  companyId,
  companyName,
  initial,
}: {
  companyId: string;
  companyName: string;
  initial: { items: CompanyMessage[]; total: number };
}) {
  const [body, setBody] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    (offset: number) => companyMessagesPage(companyId, offset),
    [companyId]
  );

  const { items, remaining, loadingMore, refresh, showOlder } =
    useConversation<CompanyMessage>({
      initial,
      fetchPage,
      idOf: (m) => m.id,
      orderOf: (m) => m.createdAt,
    });

  // Estar COM a conversa aberta e visível = leu (passo 32). Marca a leitura
  // deste usuário (por usuário, nunca global) e avisa o badge da sidebar na
  // mesma aba. Reexecuta quando chega mensagem nova com a tela visível.
  useEffect(() => {
    if (items.length === 0) return;
    if (document.visibilityState !== "visible") return;
    let cancelled = false;
    markMessagesRead(companyId).then((res) => {
      if (!cancelled && !res.error) emitMessagesRead();
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, items.length]);

  // Rolagem de chat (passo 32.1): abre no FIM (mais recentes), subir ao topo
  // carrega as antigas preservando a posição, e mensagem nova só arrasta quem
  // já está no fim — senão acende o indicador "nova mensagem".
  const { containerRef, topSentinelRef, hasNew, jumpToEnd } = useChatScroll({
    lastItemKey: items.length > 0 ? items[items.length - 1].id : null,
    itemCount: items.length + pending.length,
    loadOlder: showOlder,
    hasOlder: remaining > 0,
    loadingOlder: loadingMore,
  });

  // Causa A (cache de navegação): ao montar, ressincroniza — a conversa nunca
  // fica presa no payload antigo do cache do router. Foco/reconexão idem.
  // Causa B (tempo real): canal Realtime dispara a mesma ressincronização,
  // com um pequeno debounce para rajadas.
  useEffect(() => {
    const supabase = createClient();
    let debounce: number | undefined;

    const channel = supabase
      .channel(`company-messages-${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "company_messages",
          filter: `company_id=eq.${companyId}`,
        },
        () => {
          window.clearTimeout(debounce);
          debounce = window.setTimeout(() => refresh(), 200);
        }
      )
      .subscribe();

    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };

    refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      window.clearTimeout(debounce);
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [companyId, refresh]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;

    // Envio otimista: aparece na hora como "enviando"; o registro real chega
    // pela ressincronização (ou pelo próprio evento Realtime) e o rascunho sai.
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setPending((prev) => [...prev, { tempId, body: text, failed: false }]);
    setBody("");
    setError(null);
    // Enviar leva ao fim da conversa (a própria mensagem, "Enviando…").
    requestAnimationFrame(jumpToEnd);

    const res = await sendCompanyMessage(companyId, text);
    if (res.error) {
      setPending((prev) =>
        prev.map((p) => (p.tempId === tempId ? { ...p, failed: true } : p))
      );
      setError(res.error);
      return;
    }
    await refresh();
    setPending((prev) => prev.filter((p) => p.tempId !== tempId));
  }

  function discardFailed(tempId: string) {
    setPending((prev) => prev.filter((p) => p.tempId !== tempId));
    setError(null);
  }

  return (
    <div>
      <p className="mb-4 text-sm text-fg-muted">
        Conversa com o cliente. O que você escrever aqui aparece no portal
        dele. Mensagens não podem ser editadas nem apagadas.
      </p>

      {items.length === 0 && pending.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface-2 px-4 py-6 text-center text-sm text-fg-muted">
          Nenhuma mensagem ainda. O cliente vê esta conversa no portal dele.
        </p>
      ) : (
        <div className="relative">
          <div
            ref={containerRef}
            className="max-h-[60vh] overflow-y-auto overscroll-contain pr-1"
          >
            {/* Sentinela do topo: entrar na viewport carrega as antigas. */}
            <div ref={topSentinelRef} aria-hidden="true" />
            {loadingMore && (
              <p className="py-2 text-center text-xs text-fg-subtle">
                Carregando mensagens antigas…
              </p>
            )}
            <ol className="space-y-3">
              {items.map((m) => (
                <Bubble key={m.id} message={m} companyName={companyName} />
              ))}
              {pending.map((p) => (
                <PendingBubble
                  key={p.tempId}
                  pending={p}
                  onDiscard={() => discardFailed(p.tempId)}
                />
              ))}
            </ol>
          </div>
          {hasNew && (
            <button
              type="button"
              onClick={jumpToEnd}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-risd px-3.5 py-1.5 text-xs font-semibold text-white shadow-pop transition hover:bg-chrysler focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              Nova mensagem ↓
            </button>
          )}
        </div>
      )}

      <form onSubmit={send} className="mt-5 border-t border-line pt-5">
        <label htmlFor="company-msg" className="sr-only">
          Responder ao cliente
        </label>
        <textarea
          id="company-msg"
          rows={3}
          maxLength={2000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Responder ao cliente…"
          className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm transition placeholder:text-fg-subtle focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-fg-subtle">{body.length}/2000</span>
          <button
            type="submit"
            disabled={body.trim().length === 0}
            className="rounded-xl bg-risd px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-chrysler focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-60"
          >
            Enviar ao cliente
          </button>
        </div>
        {error && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
      </form>
    </div>
  );
}

// Cliente à esquerda, equipe à direita — do lado interno "nós" somos a equipe.
function Bubble({
  message,
  companyName,
}: {
  message: CompanyMessage;
  companyName: string;
}) {
  const fromTeam = message.authorType === "interno";
  const who = fromTeam ? (message.authorName ?? "Equipe") : companyName;
  return (
    <li className={`flex gap-2 ${fromTeam ? "justify-end" : "justify-start"}`}>
      {!fromTeam && (
        <span className="mt-5 grid h-7 w-7 flex-shrink-0 place-items-center rounded-full bg-surface-2 text-[11px] font-semibold text-fg-muted">
          CL
        </span>
      )}
      <div className={`max-w-[80%] ${fromTeam ? "text-right" : "text-left"}`}>
        <p className="mb-1 px-1 text-[11px] text-fg-subtle">
          {who} · {formatWhen(message.createdAt)}
        </p>
        <div
          className={`inline-block rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
            fromTeam
              ? "rounded-br-sm bg-risd text-white"
              : "rounded-bl-sm border border-line bg-surface-2 text-fg"
          }`}
        >
          <p className="whitespace-pre-wrap break-words text-left">
            {message.body}
          </p>
        </div>
      </div>
      {fromTeam && (
        <span className="mt-5 flex-shrink-0">
          <Avatar name={who} url={message.authorAvatarUrl} size={28} />
        </span>
      )}
    </li>
  );
}

function PendingBubble({
  pending,
  onDiscard,
}: {
  pending: Pending;
  onDiscard: () => void;
}) {
  return (
    <li className="flex justify-end">
      <div className="max-w-[80%] text-right">
        <p className="mb-1 px-1 text-[11px] text-fg-subtle">
          {pending.failed ? (
            <>
              Falhou ao enviar ·{" "}
              <button
                type="button"
                onClick={onDiscard}
                className="underline underline-offset-2 hover:text-fg focus-visible:outline-none"
              >
                descartar
              </button>
            </>
          ) : (
            "Enviando…"
          )}
        </p>
        <div
          className={`inline-block rounded-2xl rounded-br-sm px-4 py-2.5 text-sm text-white shadow-sm ${
            pending.failed ? "bg-risd/50" : "bg-risd/75"
          }`}
        >
          <p className="whitespace-pre-wrap break-words text-left">
            {pending.body}
          </p>
        </div>
      </div>
    </li>
  );
}

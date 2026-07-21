"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ShowMore } from "@/components/ListControls";
import type {
  PortalMessage,
  PortalMessages as PortalMessagesData,
  PortalSource,
} from "@/lib/client-portal";
import { useConversation } from "@/lib/use-conversation";
import {
  clientPortalSendMessage,
  clientPortalMessagesPage,
} from "../actions";
import { clientPreviewMessagesPage } from "@/app/client-preview-actions";

// Aba "Mensagens" do portal do cliente (passos 31 e 31.1) — a primeira
// superfície de ESCRITA do portal, agora em tempo real.
//
// TEMPO REAL (modo portal): um EventSource na rota SSE /cliente/[token]/events.
// O evento é só o SINAL — a tela sempre ressincroniza pela página mais
// recente (merge por id), então evento perdido/duplicado não corrompe nada.
// A conexão só vive com a aba VISÍVEL; ao ocultar, fecha; ao voltar,
// ressincroniza e reconecta (também em "online"). Na PRÉ-VISUALIZAÇÃO
// interna não há SSE: mount + foco bastam, e o envio fica desativado.
//
// O corpo é TEXTO PURO: renderizado como texto (JSX escapa por construção),
// nunca com dangerouslySetInnerHTML — esta rota segue sem jsdom (passo 29).

type Pending = { tempId: string; body: string; at: string; failed: boolean };

function formatWhen(at: string): string {
  return new Date(at).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PortalMessages({
  source,
  initial,
}: {
  source: PortalSource;
  initial: PortalMessagesData;
}) {
  const canWrite = source.mode === "portal";
  const [body, setBody] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);

  const fetchPage = useCallback(
    (offset: number) =>
      source.mode === "portal"
        ? clientPortalMessagesPage(source.token, offset)
        : clientPreviewMessagesPage(source.companyId, offset),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source.mode, source.mode === "portal" ? source.token : source.companyId]
  );

  const { items, itemsRef, remaining, loadingMore, refresh, showOlder } =
    useConversation<PortalMessage>({
      initial,
      fetchPage,
      idOf: (m) => m.id,
      orderOf: (m) => m.at,
    });

  // Rolagem: só acompanha as mensagens novas se o usuário já estiver no fim
  // da conversa — nunca arrasta quem está lendo mensagens antigas acima.
  const endRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(false);
  useEffect(() => {
    const el = endRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      stickRef.current = e.isIntersecting;
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (stickRef.current) endRef.current?.scrollIntoView({ block: "nearest" });
  }, [items.length, pending.length]);

  // Causa A (cache de navegação): o payload servido pelo Next pode ser uma
  // versão antiga da rota — ao montar, a conversa se ressincroniza sozinha e
  // nunca fica presa nele. Foco e reconexão idem.
  useEffect(() => {
    refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [refresh]);

  // Causa B (tempo real) — SSE, só no modo portal e só com a aba visível.
  useEffect(() => {
    if (source.mode !== "portal") return;
    const token = source.token;
    let es: EventSource | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed || es || document.visibilityState !== "visible") return;
      // "after" ancora no que já temos, para o stream não reenviar o mundo.
      const last = itemsRef.current[itemsRef.current.length - 1]?.at;
      es = new EventSource(
        `/cliente/${token}/events${last ? `?after=${encodeURIComponent(last)}` : ""}`
      );
      // O dado do evento é ignorado de propósito: ressincronizar pela página
      // mais recente é o que garante dedup e ordem (uma fonte de verdade só).
      es.onmessage = () => refresh();
      es.addEventListener("end", () => {
        // Sessão morreu (senha trocada / acesso revogado): não reconecta.
        disposed = true;
        es?.close();
        es = null;
        setSessionEnded(true);
      });
      // Em erro transitório o próprio EventSource reconecta (retry do stream).
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        connect();
      } else {
        // Aba oculta: derruba a conexão — não segura função de servidor à toa.
        es?.close();
        es = null;
      }
    };

    connect();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      es?.close();
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.mode, source.mode === "portal" ? source.token : "", refresh]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (source.mode !== "portal") return;
    const text = body.trim();
    if (!text) return;

    // Envio OTIMISTA: aparece na hora como "enviando"; o registro real chega
    // pela ressincronização e o rascunho some. Se falhar, fica marcado.
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setPending((prev) => [
      ...prev,
      { tempId, body: text, at: new Date().toISOString(), failed: false },
    ]);
    setBody("");
    setError(null);

    const res = await clientPortalSendMessage(source.token, text);
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
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-brand-tint text-risd">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        </span>
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-fg">
            Mensagens
          </h2>
          <p className="mt-0.5 text-sm text-fg-muted">
            Fale direto com a equipe da Monvatti sobre o seu projeto.
          </p>
        </div>
      </div>

      <div className="mt-6">
        {remaining > 0 && !loadingMore && (
          <ShowMore remaining={remaining} onClick={showOlder} />
        )}
        {loadingMore && (
          <p className="mb-4 text-center text-sm text-fg-subtle">Carregando…</p>
        )}

        {items.length === 0 && pending.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line bg-surface-2 px-4 py-6 text-center text-sm text-fg-muted">
            Nenhuma mensagem ainda.
            {canWrite && " Escreva abaixo — a equipe responde por aqui."}
          </p>
        ) : (
          <ol className="space-y-3">
            {items.map((m) => (
              <Bubble key={m.id} message={m} />
            ))}
            {pending.map((p) => (
              <PendingBubble
                key={p.tempId}
                pending={p}
                onDiscard={() => discardFailed(p.tempId)}
              />
            ))}
          </ol>
        )}
        <div ref={endRef} aria-hidden="true" />
      </div>

      {sessionEnded && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          Seu acesso foi atualizado. Recarregue a página e entre novamente.
        </p>
      )}

      {canWrite && (
        <form onSubmit={send} className="mt-5 border-t border-line pt-5">
          <label htmlFor="portal-msg" className="sr-only">
            Sua mensagem
          </label>
          <textarea
            id="portal-msg"
            rows={3}
            maxLength={2000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Escreva sua mensagem…"
            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm transition placeholder:text-fg-subtle focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-fg-subtle">{body.length}/2000</span>
            <button
              type="submit"
              disabled={body.trim().length === 0}
              className="rounded-xl bg-risd px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-chrysler focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-60"
            >
              Enviar
            </button>
          </div>
          {error && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </form>
      )}

      {!canWrite && (
        <p className="mt-5 border-t border-line pt-5 text-xs text-fg-subtle">
          Na pré-visualização o envio fica desativado. Responda pela central da
          empresa.
        </p>
      )}
    </section>
  );
}

// Cliente à direita (é "a voz dele" nesta tela), equipe à esquerda e assinada
// com o primeiro nome de quem respondeu.
function Bubble({ message }: { message: PortalMessage }) {
  const mine = message.author_type === "cliente";
  return (
    <li className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] ${mine ? "text-right" : "text-left"}`}>
        <div
          className={`inline-block rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
            mine
              ? "rounded-br-sm bg-risd text-white"
              : "rounded-bl-sm border border-line bg-surface-2 text-fg"
          }`}
        >
          <p className="whitespace-pre-wrap break-words text-left">
            {message.body}
          </p>
        </div>
        <p className="mt-1 px-1 text-[11px] text-fg-subtle">
          {mine ? "Você" : (message.author ?? "Equipe")} ·{" "}
          {formatWhen(message.at)}
        </p>
      </div>
    </li>
  );
}

// Rascunho otimista: some quando o registro real chega; se o envio falhar,
// fica marcado com a opção de descartar (o texto continua no erro à vista).
function PendingBubble({
  pending,
  onDiscard,
}: {
  pending: Pending;
  onDiscard: () => void;
}) {
  return (
    <li className="flex justify-end">
      <div className="max-w-[85%] text-right">
        <div
          className={`inline-block rounded-2xl rounded-br-sm px-4 py-2.5 text-sm shadow-sm ${
            pending.failed ? "bg-risd/50 text-white" : "bg-risd/75 text-white"
          }`}
        >
          <p className="whitespace-pre-wrap break-words text-left">
            {pending.body}
          </p>
        </div>
        <p className="mt-1 px-1 text-[11px] text-fg-subtle">
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
      </div>
    </li>
  );
}

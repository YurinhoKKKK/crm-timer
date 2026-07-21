"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// Rolagem de conversa (passo 32.1), compartilhada pelas duas janelas (portal
// e lado interno). A conversa vive num CONTAINER rolável próprio e:
//
//  · ABRE NO FIM (mensagens mais recentes), posicionada ANTES da primeira
//    pintura (useLayoutEffect) — o usuário não vê o scroll acontecer.
//  · Subir até o topo carrega as mensagens ANTIGAS automaticamente
//    (sentinela + IntersectionObserver) e PRESERVA a posição de leitura:
//    medimos o scrollHeight antes da carga e compensamos o deslocamento
//    depois, ainda antes da pintura — sem pulo nem solavanco.
//  · Mensagem nova rola para o fim SÓ se o usuário já estiver no fim; se
//    estiver lendo o histórico, acende um indicador discreto ("nova
//    mensagem") que leva ao fim ao ser clicado.
export function useChatScroll({
  lastItemKey,
  itemCount,
  loadOlder,
  hasOlder,
  loadingOlder,
}: {
  // Id do último item (detecta chegada no FIM — mensagem nova).
  lastItemKey: string | null;
  itemCount: number;
  loadOlder: () => Promise<void>;
  hasOlder: boolean;
  loadingOlder: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);

  const atBottomRef = useRef(true);
  const readyRef = useRef(false);
  const lastKeyRef = useRef<string | null>(null);
  const countRef = useRef(0);
  // Medição pendente de uma carga de antigas (para compensar a posição).
  const prependRef = useRef<{ height: number; top: number } | null>(null);
  const [hasNew, setHasNew] = useState(false);

  // Posição inicial: fim da conversa, antes da primeira pintura.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    lastKeyRef.current = lastItemKey;
    countRef.current = itemCount;
    atBottomRef.current = true;
    readyRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rastreia se o usuário está no fim (com uma folga pequena).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      atBottomRef.current = atBottom;
      if (atBottom) setHasNew(false);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Reage a mudanças na lista, ainda antes da pintura:
  //  · carga de antigas -> compensa a posição;
  //  · mensagem nova no fim -> acompanha ou acende o indicador.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || !readyRef.current) return;

    if (prependRef.current) {
      el.scrollTop =
        prependRef.current.top + (el.scrollHeight - prependRef.current.height);
      prependRef.current = null;
    } else if (lastItemKey !== lastKeyRef.current && itemCount >= countRef.current) {
      if (atBottomRef.current) {
        el.scrollTop = el.scrollHeight;
      } else {
        setHasNew(true);
      }
    }
    lastKeyRef.current = lastItemKey;
    countRef.current = itemCount;
  }, [lastItemKey, itemCount]);

  const loadOlderPreserving = useCallback(async () => {
    const el = containerRef.current;
    if (el) prependRef.current = { height: el.scrollHeight, top: el.scrollTop };
    await loadOlder();
    // Se a carga não mudou nada (falha/fim), a medição não pode sobrar para
    // ser consumida por engano num append futuro.
    requestAnimationFrame(() => {
      prependRef.current = null;
    });
  }, [loadOlder]);

  // Chegar ao topo carrega as antigas sozinho.
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const root = containerRef.current;
    if (!sentinel || !root || !hasOlder) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && readyRef.current && !loadingOlder) {
          loadOlderPreserving();
        }
      },
      { root, rootMargin: "80px 0px 0px 0px" }
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [hasOlder, loadingOlder, loadOlderPreserving]);

  const jumpToEnd = useCallback(() => {
    const el = containerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setHasNew(false);
  }, []);

  return { containerRef, topSentinelRef, hasNew, jumpToEnd };
}

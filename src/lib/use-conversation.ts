"use client";

import { useCallback, useRef, useState } from "react";

// Núcleo de estado da conversa (passo 31.1), compartilhado pelas duas janelas
// (portal do cliente e lado interno). O princípio é o mesmo do timer no passo
// 28.1: eventos são só um SINAL de "há coisa nova" — o estado exibido é sempre
// RECONSTRUÍDO buscando a página mais recente e fazendo merge por id. Assim,
// evento perdido, evento duplicado ou chegada fora de ordem não corrompem a
// tela: a próxima ressincronização corrige tudo.

export type ConversationPage<T> = { items: T[]; total: number } | null;

export function useConversation<T>({
  initial,
  fetchPage,
  idOf,
  orderOf,
}: {
  initial: { items: T[]; total: number };
  // offset 0 = página mais recente; offsets maiores voltam no histórico.
  fetchPage: (offset: number) => Promise<ConversationPage<T>>;
  idOf: (m: T) => string;
  orderOf: (m: T) => string; // ISO timestamp — ordena a timeline
}) {
  const [items, setItems] = useState<T[]>(initial.items);
  const [total, setTotal] = useState(initial.total);
  const [loadingMore, setLoadingMore] = useState(false);

  // Espelho para callbacks estáveis (SSE/realtime) lerem o estado atual.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const merge = useCallback(
    (prev: T[], incoming: T[]): T[] => {
      const byId = new Map<string, T>();
      for (const m of prev) byId.set(idOf(m), m);
      for (const m of incoming) byId.set(idOf(m), m);
      return Array.from(byId.values()).sort((a, b) =>
        orderOf(a) < orderOf(b) ? -1 : orderOf(a) > orderOf(b) ? 1 : 0
      );
    },
    [idOf, orderOf]
  );

  // Ressincroniza com a página mais recente (mount, evento, foco, reconexão).
  const refresh = useCallback(async (): Promise<boolean> => {
    const page = await fetchPage(0);
    if (!page) return false;
    setItems((prev) => merge(prev, page.items));
    setTotal(page.total);
    return true;
  }, [fetchPage, merge]);

  // "Ver mais" (mensagens antigas). O offset é aproximado quando chegam
  // mensagens novas entre um clique e outro — o merge por id absorve a
  // sobreposição sem duplicar.
  const showOlder = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    const page = await fetchPage(itemsRef.current.length);
    if (page) {
      setItems((prev) => merge(prev, page.items));
      setTotal(page.total);
    }
    setLoadingMore(false);
  }, [fetchPage, loadingMore, merge]);

  const remaining = Math.max(0, total - items.length);

  return { items, itemsRef, total, remaining, loadingMore, refresh, showOlder };
}

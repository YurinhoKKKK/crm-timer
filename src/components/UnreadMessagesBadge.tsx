"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { MESSAGES_READ_EVENT } from "@/lib/message-sync";

// Badge de mensagens não lidas na sidebar (passo 32).
//
// CUSTO (requisito explícito do passo): nada de consulta pesada a cada
// navegação. A contagem é UM inteiro (my_unread_messages, SECURITY INVOKER,
// escopada pelo RLS), buscada de forma NÃO bloqueante depois do render — a
// navegação nunca espera por ela. Entre navegações, quem atualiza é:
//   · o Realtime de company_messages (assinatura SEM filtro de empresa — a
//     entrega já é filtrada pelo RLS por assinante, então só chegam eventos
//     de empresas que o usuário pode ler);
//   · o evento local crm-messages-read (a conversa marca lida na mesma aba);
//   · visibilitychange/online, cobrindo eventos perdidos.
// Sem poll periódico: o sinal em tempo real + foco bastam.
export default function UnreadMessagesBadge() {
  const [count, setCount] = useState<number | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  const fetchCount = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("my_unread_messages");
    if (!error && typeof data === "number") setCount(data);
    else if (!error && data !== null) setCount(Number(data));
  }, []);

  useEffect(() => {
    const supabase = createClient();

    fetchCount();

    // INSERT em qualquer conversa que o RLS deixe este usuário ler.
    const channel = supabase
      .channel("unread-messages-badge")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "company_messages" },
        () => {
          window.clearTimeout(debounceRef.current);
          debounceRef.current = window.setTimeout(fetchCount, 300);
        }
      )
      .subscribe();

    const onVisible = () => {
      if (document.visibilityState === "visible") fetchCount();
    };
    const onRead = () => fetchCount();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    window.addEventListener(MESSAGES_READ_EVENT, onRead);
    return () => {
      window.clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      window.removeEventListener(MESSAGES_READ_EVENT, onRead);
    };
  }, [fetchCount]);

  if (!count) return null;

  return (
    <span
      aria-label={`${count} mensagens não lidas`}
      className="ml-auto inline-flex min-w-[1.35rem] items-center justify-center rounded-full bg-risd px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

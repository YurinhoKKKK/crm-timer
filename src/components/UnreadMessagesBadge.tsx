"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { MESSAGES_READ_EVENT, VALIDATIONS_READ_EVENT } from "@/lib/message-sync";

// Badge de notificações não lidas na sidebar (passo 32 + 33).
//
// FONTE ÚNICA: a contagem é UM inteiro de my_unread_total (SECURITY INVOKER,
// escopada pelo RLS) = mensagens não lidas + validações de listagem acionáveis
// não vistas. Nada de segundo badge paralelo.
//
// CUSTO (requisito explícito): buscada de forma NÃO bloqueante depois do render
// — a navegação nunca espera por ela. Entre navegações, quem atualiza é:
//   · o Realtime de company_messages e listing_validations (assinatura SEM
//     filtro — a entrega já é filtrada pelo RLS por assinante, então só chegam
//     eventos que o usuário pode ler);
//   · os eventos locais crm-messages-read / crm-validations-read (mesma aba);
//   · visibilitychange/online, cobrindo eventos perdidos.
// Sem poll periódico: o sinal em tempo real + foco bastam.
export default function UnreadMessagesBadge() {
  const [count, setCount] = useState<number | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  const fetchCount = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("my_unread_total");
    if (!error && typeof data === "number") setCount(data);
    else if (!error && data !== null) setCount(Number(data));
  }, []);

  useEffect(() => {
    const supabase = createClient();

    fetchCount();

    const bump = () => {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(fetchCount, 300);
    };

    // INSERT em qualquer conversa ou validação que o RLS deixe este usuário ler.
    const channel = supabase
      .channel("unread-notifications-badge")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "company_messages" },
        bump
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "listing_validations" },
        bump
      )
      .subscribe();

    const onVisible = () => {
      if (document.visibilityState === "visible") fetchCount();
    };
    const onRead = () => fetchCount();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    window.addEventListener(MESSAGES_READ_EVENT, onRead);
    window.addEventListener(VALIDATIONS_READ_EVENT, onRead);
    return () => {
      window.clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      window.removeEventListener(MESSAGES_READ_EVENT, onRead);
      window.removeEventListener(VALIDATIONS_READ_EVENT, onRead);
    };
  }, [fetchCount]);

  if (!count) return null;

  return (
    <span
      aria-label={`${count} notificações não lidas`}
      className="ml-auto inline-flex min-w-[1.35rem] items-center justify-center rounded-full bg-risd px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

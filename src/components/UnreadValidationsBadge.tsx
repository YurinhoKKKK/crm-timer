"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { VALIDATIONS_READ_EVENT } from "@/lib/message-sync";

// Badge de VALIDAÇÕES de listagem não vistas na sidebar (tela "Validações").
//
// FONTE ÚNICA da fila interna: um inteiro de my_unread_validations() (SECURITY
// INVOKER, escopado pelo RLS lv_select) = listagens acionáveis (ajuste solicitado
// / contestação) ainda não vistas por este usuário. Substitui a parte de
// validações que antes vivia dentro do badge de mensagens.
//
// Mesma disciplina de custo do antigo badge: buscado de forma NÃO bloqueante
// depois do render; entre navegações quem atualiza é o Realtime de
// listing_validations (assinatura SEM filtro — a entrega já vem filtrada pelo RLS
// por assinante), o evento local crm-validations-read (mesma aba, ao abrir a
// fila) e visibilitychange/online. Sem poll periódico.
export default function UnreadValidationsBadge() {
  const [count, setCount] = useState<number | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  const fetchCount = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("my_unread_validations");
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

    const channel = supabase
      .channel("unread-validations-badge")
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
    window.addEventListener(VALIDATIONS_READ_EVENT, onRead);
    return () => {
      window.clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      window.removeEventListener(VALIDATIONS_READ_EVENT, onRead);
    };
  }, [fetchCount]);

  if (!count) return null;

  return (
    <span
      aria-label={`${count} validações não vistas`}
      className="ml-auto inline-flex min-w-[1.35rem] items-center justify-center rounded-full bg-risd px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

// Contador de CHAMADOS ABERTOS no item "Suporte" da sidebar. Substitui a
// notificação de "chamado novo": hoje não há responsável por chamado, então
// avisar seria notificar a equipe toda — em vez disso, este número discreto no
// menu. Quando existir responsável, aí sim vira notificação de verdade.
//
// Sem tempo real (mesma decisão do sino): recarrega ao navegar e ao voltar à
// aba. Fonte: RPC support_ticket_counts (open/finished), agregada no banco.
export default function OpenTicketsBadge() {
  const [count, setCount] = useState(0);
  const pathname = usePathname();

  const fetchCount = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("support_ticket_counts");
    if (error) return;
    const row = (data as { open_count: number }[] | null)?.[0];
    if (row) setCount(Number(row.open_count ?? 0));
  }, []);

  useEffect(() => {
    fetchCount();
  }, [fetchCount, pathname]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchCount();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [fetchCount]);

  if (!count) return null;

  return (
    <span
      aria-label={`${count} chamados abertos`}
      className="ml-auto inline-flex min-w-[1.35rem] items-center justify-center rounded-full bg-white/15 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

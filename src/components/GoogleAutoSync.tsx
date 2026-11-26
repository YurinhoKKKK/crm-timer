"use client";

import { useEffect } from "react";
import { syncMyGoogleCalendar } from "@/app/google-import-actions";
import { scanGoogleReconciliation } from "@/app/meeting-reconcile-actions";
import { tryBeginAutoSync, endAutoSync } from "@/lib/google-sync-guard";
import { createClient } from "@/lib/supabase-browser";

// =====================================================================
// B15 (0174) — sincronização da agenda pessoal no CARREGAMENTO DO APP, não só na
// tela Agenda. Mesma action e mesma regra de 10 min do Calendar; o guard é o
// COMPARTILHADO de google-sync-guard (localStorage + mutex), para este disparo e
// o do Calendar nunca rodarem em dobro.
//
// SEM service_role e SEM cron: roda com a SESSÃO do próprio usuário, no
// navegador dele — só a agenda DELE é alcançável (google_get_account/auth.uid).
// Quem não tem Google conectado recebe "nao_conectado" e o guard evita repetir.
// =====================================================================

export default function GoogleAutoSync() {
  useEffect(() => {
    let cancelled = false;
    // Logo após conectar o Google o callback redireciona para /perfil?google=connected.
    // Nesse primeiro carregamento, FORÇA o sync: um auto-sync recente de quando a
    // conta ainda não estava conectada pode ter carimbado o guard há < 10 min, e sem
    // o force a agenda só sincronizaria no clique manual (bug investigado).
    const justConnected =
      new URLSearchParams(window.location.search).get("google") === "connected";
    // O guard é POR USUÁRIO (chave com o id); a sessão sai do storage local do
    // Supabase (getSession não vai à rede).
    void createClient()
      .auth.getSession()
      .then(({ data: { session } }) => {
        const userId = session?.user?.id;
        if (cancelled || !userId) return;
        if (!tryBeginAutoSync(userId, { force: justConnected })) return;
        void syncMyGoogleCalendar()
          .then((res) => {
            if (res.status === "ok") {
              void scanGoogleReconciliation().catch(() => {});
            }
          })
          .catch(() => {})
          .finally(endAutoSync);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

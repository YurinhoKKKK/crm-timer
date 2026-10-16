import { createClient } from "@/lib/supabase-server";

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

// Status da sincronização Digisac (etapa 1) para o cabeçalho da tela de calibração.
// Só admin alcança as tabelas digisac_* (RLS); a página já é admin-only.

export type DigisacSyncStatus = {
  lastRun: {
    started_at: string;
    finished_at: string | null;
    status: string | null;
    messages_upserted: number;
    contacts_processed: number;
    error_message: string | null;
    error_kind: string | null;
  } | null;
  contactsWithCursor: number;
  totalContacts: number;
  totalMessages: number;
  // Carga concluída = já houve ao menos UMA execução 'ok' (processou todos os
  // contatos sem parar por orçamento). O critério antigo (cursor >= contatos)
  // nunca completava: grupos sem mensagem desde 01/09 não ganham cursor.
  loadComplete: boolean;
};

export async function loadDigisacSyncStatus(
  supabase: SupabaseServer
): Promise<DigisacSyncStatus> {
  const [lastRunRes, cursorCountRes, contactsRes, msgCountRes, okRunRes] = await Promise.all([
    supabase
      .from("digisac_sync_runs")
      .select(
        "started_at, finished_at, status, messages_upserted, contacts_processed, error_message, error_kind"
      )
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("digisac_sync_cursor").select("contact_id", { count: "exact", head: true }),
    supabase.from("companies").select("whatsapp_contact_id").not("whatsapp_contact_id", "is", null),
    supabase.from("digisac_messages").select("id", { count: "exact", head: true }),
    supabase.from("digisac_sync_runs").select("id", { count: "exact", head: true }).eq("status", "ok"),
  ]);

  const totalContacts = new Set(
    (contactsRes.data ?? []).map((c) => c.whatsapp_contact_id as string)
  ).size;

  return {
    lastRun: (lastRunRes.data as DigisacSyncStatus["lastRun"]) ?? null,
    contactsWithCursor: cursorCountRes.count ?? 0,
    totalContacts,
    totalMessages: msgCountRes.count ?? 0,
    loadComplete: (okRunRes.count ?? 0) > 0,
  };
}

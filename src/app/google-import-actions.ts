"use server";

import { createClient } from "@/lib/supabase-server";
import {
  getValidAccessToken,
  listCalendarEvents,
  SyncTokenExpired,
  type RawGoogleEvent,
} from "@/lib/google-calendar";
import { GoogleError } from "@/lib/google-oauth";

// =====================================================================
// Reuniões — Fatia 2: sincronizar a agenda do Google PARA DENTRO do sistema.
//
// SEGURANÇA — ninguém sincroniza a agenda de outra pessoa:
//   1. getValidAccessToken(supabase) chama google_get_account() (SECURITY
//      DEFINER, 0043), que descobre o dono por auth.uid() e SÓ devolve a linha
//      dele. Não existe service_role nem função que aceite "o token de fulano".
//      Logo o servidor só consegue um access_token: o do usuário LOGADO.
//   2. As gravações (google_import_replace / _apply, migration 0050) também
//      derivam o dono por auth.uid() e NÃO recebem p_user — então escrevem só as
//      linhas do próprio usuário, mesmo chamadas direto do navegador.
// O par (token só do próprio + escrita só do próprio) fecha o círculo: esta
// action, rodando com a sessão de A, não tem como ler nem gravar a agenda de B.
//
// Só ESPELHA (somente leitura): não cria/edita/apaga nada no Google.
// =====================================================================

// Janela importada (decisão de produto): 3 meses atrás, 12 à frente. Janela
// ROLANTE — re-ancorada a cada sync COMPLETO (ver FULL_RESYNC_MS).
const MONTHS_BACK = 3;
const MONTHS_FORWARD = 12;
// Força um sync completo (re-ancorando a janela) se o último completo tiver mais
// que isto — mantém as bordas da janela rolante frescas sem depender só do token.
const FULL_RESYNC_MS = 24 * 60 * 60 * 1000;

export type SyncResult =
  | { status: "ok"; imported: number; lastSyncedAt: string }
  | { status: "nao_conectado" }
  | { status: "erro"; message: string };

// Linha pronta para o banco (formato aceito pelos RPCs de escrita, via jsonb).
type ImportRow = {
  calendar_id: string;
  event_id: string;
  title: string | null;
  starts_at: string;
  ends_at: string;
  is_private: boolean;
};

type StateRow = {
  sync_token: string | null;
  last_full_sync_at: string | null;
};

export async function syncMyGoogleCalendar(): Promise<SyncResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "erro", message: "Sessão expirada. Faça login de novo." };

  // (1) Token do PRÓPRIO usuário — a única agenda que esta sessão alcança.
  const token = await getValidAccessToken(supabase);
  if (token.status === "nao_conectado") return { status: "nao_conectado" };
  if (token.status === "falhou") return { status: "erro", message: token.error };

  // Estado atual da sincronização (RLS: só a própria linha).
  const { data: stateData } = await supabase
    .from("google_calendar_import_state")
    .select("sync_token, last_full_sync_at")
    .maybeSingle();
  const state = (stateData as StateRow | null) ?? null;

  // IDs dos eventos que o PRÓPRIO sistema criou na agenda deste usuário: não os
  // reimportamos como "externos" (evita duplicar a reunião do sistema).
  const { data: mine } = await supabase
    .from("meetings")
    .select("google_event_id")
    .eq("created_by", user.id)
    .not("google_event_id", "is", null);
  const systemIds = new Set(
    ((mine as { google_event_id: string | null }[] | null) ?? [])
      .map((m) => m.google_event_id)
      .filter((x): x is string => !!x)
  );

  const wantsFull =
    !state?.sync_token ||
    !state?.last_full_sync_at ||
    Date.now() - new Date(state.last_full_sync_at).getTime() > FULL_RESYNC_MS;

  try {
    if (wantsFull) {
      return await fullSync(supabase, token.accessToken, systemIds);
    }
    // Incremental; se o token venceu (410), cai para completo.
    try {
      return await incrementalSync(
        supabase,
        token.accessToken,
        systemIds,
        state!.sync_token as string
      );
    } catch (e) {
      if (e instanceof SyncTokenExpired) {
        return await fullSync(supabase, token.accessToken, systemIds);
      }
      throw e;
    }
  } catch (e) {
    const message =
      e instanceof GoogleError
        ? e.message
        : "Não foi possível sincronizar sua agenda do Google.";
    return { status: "erro", message };
  }
}

// Sync COMPLETO: relê a janela inteira e troca todo o espelho do usuário.
async function fullSync(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accessToken: string,
  systemIds: Set<string>
): Promise<SyncResult> {
  const now = new Date();
  const timeMin = monthsFrom(now, -MONTHS_BACK).toISOString();
  const timeMax = monthsFrom(now, MONTHS_FORWARD).toISOString();

  const { events, nextSyncToken } = await listCalendarEvents(accessToken, {
    timeMin,
    timeMax,
  });

  const rows: ImportRow[] = [];
  for (const ev of events) {
    const row = toImportRow(ev, systemIds);
    if (row) rows.push(row);
  }

  const { error } = await supabase.rpc("google_import_replace", {
    p_events: rows,
    p_window_start: timeMin,
    p_window_end: timeMax,
    p_sync_token: nextSyncToken,
  });
  if (error) {
    return {
      status: "erro",
      message: "Não foi possível salvar os eventos importados.",
    };
  }
  return { status: "ok", imported: rows.length, lastSyncedAt: new Date().toISOString() };
}

// Sync INCREMENTAL: aplica só o que mudou desde o último token. Eventos que
// deixaram de valer (cancelados, viraram all-day, foram recusados) entram como
// REMOÇÃO — assim o espelho não guarda lixo.
async function incrementalSync(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accessToken: string,
  systemIds: Set<string>,
  syncToken: string
): Promise<SyncResult> {
  const { events, nextSyncToken } = await listCalendarEvents(accessToken, {
    syncToken,
  });

  const upserts: ImportRow[] = [];
  const deletes: string[] = [];
  for (const ev of events) {
    if (!ev.id) continue;
    const row = toImportRow(ev, systemIds);
    if (row) upserts.push(row);
    else deletes.push(ev.id); // cancelado / fora do filtro => remove se existia
  }

  const { error } = await supabase.rpc("google_import_apply", {
    p_upserts: upserts,
    p_deletes: deletes,
    p_sync_token: nextSyncToken,
  });
  if (error) {
    return {
      status: "erro",
      message: "Não foi possível salvar as mudanças da agenda.",
    };
  }
  return { status: "ok", imported: upserts.length, lastSyncedAt: new Date().toISOString() };
}

// Filtra + transforma um evento cru numa linha do espelho, ou null se ele NÃO
// deve ser importado. Regras (documentadas na Fatia 2):
//   · cancelado                       => fora (na incremental vira remoção)
//   · criado pelo próprio sistema     => fora (não duplica a reunião do sistema)
//   · sem horário (all-day/date-only) => fora desta fatia (a grade não tem faixa)
//   · duração <= 0                     => fora (dado inconsistente)
//   · recusado por mim (declined)     => fora (não me ocupa — conflito real)
// Privado (visibility private/confidential): IMPORTA com título (o dono vê); a
// curadoria que esconde o título dos colegas mora no banco (0050).
function toImportRow(
  ev: RawGoogleEvent,
  systemIds: Set<string>
): ImportRow | null {
  if (!ev.id) return null;
  if (ev.status === "cancelled") return null;
  if (systemIds.has(ev.id)) return null;

  const startDT = ev.start?.dateTime;
  const endDT = ev.end?.dateTime;
  if (!startDT || !endDT) return null; // all-day não tem dateTime

  const s = new Date(startDT).getTime();
  const e = new Date(endDT).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null;

  if (Array.isArray(ev.attendees)) {
    const self = ev.attendees.find((a) => a.self);
    if (self?.responseStatus === "declined") return null;
  }

  const isPrivate =
    ev.visibility === "private" || ev.visibility === "confidential";
  const title = (ev.summary ?? "").trim();

  return {
    calendar_id: "primary",
    event_id: ev.id,
    title: title || null,
    starts_at: new Date(s).toISOString(),
    ends_at: new Date(e).toISOString(),
    is_private: isPrivate,
  };
}

// Soma meses a uma data preservando o instante (sem depender de fuso — a janela
// é folgada, não precisa de precisão civil).
function monthsFrom(base: Date, months: number): Date {
  const d = new Date(base);
  d.setMonth(d.getMonth() + months);
  return d;
}

"use server";

import { createClient } from "@/lib/supabase-server";
import {
  getValidAccessToken,
  listCalendarEvents,
  getCalendarEventFull,
  meetLinkOf,
  EventGone,
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
  // `queued` = mudanças do Google que foram para a fila de reconciliação do admin
  // nesta sincronização (auto-aplicadas não contam). A Agenda usa para avisar.
  | { status: "ok"; imported: number; queued: number; lastSyncedAt: string }
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

// Operação de auto-sync Google→CRM (0172/0174): o evento casou com uma reunião
// do CRM (systemIds). `cancel` = o Google devolveu status=cancelled EXPLÍCITO
// (decisão A1 — 404 nunca passa por aqui; só a varredura da fila o detecta).
// `motivo` = o evento não é aplicável (dia inteiro, horário inválido, virou
// recorrente): a RPC o manda direto para a fila de revisão com esse rótulo.
// `updated` é a guarda (só aplica se mais novo que a meeting). A RPC só aplica
// para usuário JÁ RECONCILIADO e revalida tudo (conta, status, horários, teto).
type ForwardOp = {
  eventId: string;
  cancel?: boolean;
  // Os três primeiros valem no auto-sync E na fila; nao_encontrada e
  // conta_diferente só nascem na checagem de AUSENTES do sync completo, que vai
  // direto para a fila de revisão (meeting_reconcile_enqueue).
  motivo?:
    | "sem_horario"
    | "horario_invalido"
    | "recorrente"
    | "nao_encontrada"
    | "conta_diferente";
  title?: string | null;
  startsAt?: string;
  endsAt?: string;
  meetLink?: string | null;
  updated?: string | null;
};

type StateRow = {
  sync_token: string | null;
  last_full_sync_at: string | null;
};

// Reunião própria já sincronizada com o Google (para exclusão do espelho e para
// a checagem de AUSENTES do sync completo).
type OwnMeetingRow = {
  google_event_id: string | null;
  starts_at: string;
  google_removed_at: string | null;
  google_email: string | null;
};

// Teto de GETs dirigidos por sync completo na checagem de ausentes — proteção
// contra um estouro (ex.: listagem truncada no teto de páginas gerando falsos
// ausentes). O que passar do teto fica para o próximo sync completo.
const MAX_MISSING_CHECKS = 25;

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

  // (1b) FALHA 1: libera o auto-sync ANTES de aplicar as mudanças deste ciclo,
  // se o usuário não tem nada a reconciliar (reunião futura ligada ao Google
  // criada antes da conexão atual). Sem isto, quem conectou e não tinha backlog
  // ficava "não reconciliado" e toda mudança do Google ia calada para a fila.
  // Idempotente e nunca sobrescreve auto_apply_from já setado. Erro não derruba
  // o sync (fire-and-forget).
  await supabase.rpc("google_mark_reconciled_if_clean");

  // Estado atual da sincronização (RLS: só a própria linha).
  const { data: stateData } = await supabase
    .from("google_calendar_import_state")
    .select("sync_token, last_full_sync_at")
    .maybeSingle();
  const state = (stateData as StateRow | null) ?? null;

  // Reuniões do PRÓPRIO usuário já no Google: os ids não são reimportados como
  // "externos" (evita duplicar a reunião do sistema) e, no sync COMPLETO, as que
  // estão DENTRO da janela e não vierem na listagem vão para a fila de revisão
  // (evento sumiu/cancelou enquanto o syncToken esteve vencido — nunca apagamos).
  const { data: mine } = await supabase
    .from("meetings")
    .select("google_event_id, starts_at, google_removed_at, google_email")
    .eq("created_by", user.id)
    .not("google_event_id", "is", null);
  const ownRows = ((mine as OwnMeetingRow[] | null) ?? []).filter(
    (m): m is OwnMeetingRow & { google_event_id: string } => !!m.google_event_id
  );
  const systemIds = new Set(ownRows.map((m) => m.google_event_id));

  const wantsFull =
    !state?.sync_token ||
    !state?.last_full_sync_at ||
    Date.now() - new Date(state.last_full_sync_at).getTime() > FULL_RESYNC_MS;

  try {
    if (wantsFull) {
      return await fullSync(supabase, token.accessToken, systemIds, ownRows, token.email);
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
        return await fullSync(supabase, token.accessToken, systemIds, ownRows, token.email);
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
  systemIds: Set<string>,
  ownRows: (OwnMeetingRow & { google_event_id: string })[],
  tokenEmail: string | null
): Promise<SyncResult> {
  const now = new Date();
  const timeMin = monthsFrom(now, -MONTHS_BACK).toISOString();
  const timeMax = monthsFrom(now, MONTHS_FORWARD).toISOString();

  const { events, nextSyncToken } = await listCalendarEvents(accessToken, {
    timeMin,
    timeMax,
  });

  const rows: ImportRow[] = [];
  // Map por eventId: dedupe — uma reunião que virou recorrente gera N instâncias
  // apontando o mesmo mestre, e basta UMA op 'recorrente' (A11).
  const forwardOps = new Map<string, ForwardOp>();
  // Ids vistos na janela (inclusive mestres de recorrência) — para a checagem de
  // AUSENTES abaixo.
  const seenIds = new Set<string>();
  for (const ev of events) {
    if (ev.id) seenIds.add(ev.id);
    if (ev.recurringEventId) seenIds.add(ev.recurringEventId);
    const op = toForwardOp(ev, systemIds);
    if (op) forwardOps.set(op.eventId, op);
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
  const queuedApply = await applyForwardSync(supabase, Array.from(forwardOps.values()));
  // AUSENTES: reunião do CRM dentro da janela cujo evento não veio na listagem —
  // cancelada/apagada enquanto o syncToken esteve vencido (o 410 engole os
  // "deleted") ou movida para fora da janela. Vai para a FILA DE REVISÃO, nunca
  // para o auto-apply: respeita A1 (404 não é cancelamento), A2 (nada é apagado
  // aqui), A3 (conta diferente não consulta o Google) e A4 (sem cancel automático).
  const queuedMissing = await enqueueMissingFromFull(
    supabase, accessToken, ownRows, tokenEmail, seenIds, timeMin, timeMax
  );
  return {
    status: "ok",
    imported: rows.length,
    queued: queuedApply + queuedMissing,
    lastSyncedAt: new Date().toISOString(),
  };
}

// Confirma no Google, UMA a UMA (GET dirigido), as reuniões próprias da janela
// que não apareceram no sync completo, e enfileira o estado real na fila de
// revisão do admin (meeting_reconcile_enqueue — que revalida conta/horários e
// ignora ops sem divergência). Erros não derrubam o sync: o espelho já salvou.
async function enqueueMissingFromFull(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accessToken: string,
  ownRows: (OwnMeetingRow & { google_event_id: string })[],
  tokenEmail: string | null,
  seenIds: Set<string>,
  timeMinISO: string,
  timeMaxISO: string
): Promise<number> {
  const timeMin = new Date(timeMinISO).getTime();
  const timeMax = new Date(timeMaxISO).getTime();
  const missing = ownRows.filter((m) => {
    if (m.google_removed_at) return false; // já marcada como removida no Google
    if (seenIds.has(m.google_event_id)) return false;
    const t = new Date(m.starts_at).getTime();
    return t >= timeMin && t < timeMax; // fora da janela, a ausência é esperada
  });
  if (missing.length === 0) return 0;
  if (missing.length > MAX_MISSING_CHECKS) {
    console.warn(
      `[syncMyGoogleCalendar] ${missing.length} reuniões ausentes na janela; verificando só as ${MAX_MISSING_CHECKS} primeiras neste sync.`
    );
  }

  const ops: ForwardOp[] = [];
  for (const m of missing.slice(0, MAX_MISSING_CHECKS)) {
    // A3: conta diferente/incerta — NÃO consulta o Google (o GET na conta atual
    // daria 404 falso). A RPC revalida e classifica como conta_diferente.
    if (!m.google_email || !tokenEmail || m.google_email !== tokenEmail) {
      ops.push({ eventId: m.google_event_id, motivo: "conta_diferente" });
      continue;
    }
    try {
      const g = await getCalendarEventFull(accessToken, m.google_event_id);
      if (g.status === "cancelled") {
        ops.push({ eventId: m.google_event_id, cancel: true }); // fila decide manter×excluir
      } else if (g.recurring) {
        ops.push({ eventId: m.google_event_id, motivo: "recorrente" });
      } else if (!g.startISO || !g.endISO) {
        ops.push({ eventId: m.google_event_id, motivo: "sem_horario" });
      } else {
        // O evento EXISTE (ex.: movido para fora da janela): manda o estado real;
        // a RPC descarta se não houver divergência.
        ops.push({
          eventId: m.google_event_id,
          title: g.title,
          startsAt: new Date(g.startISO).toISOString(),
          endsAt: new Date(g.endISO).toISOString(),
          meetLink: g.meetLink,
          updated: g.updatedISO,
        });
      }
    } catch (e) {
      if (e instanceof EventGone) {
        ops.push({ eventId: m.google_event_id, motivo: "nao_encontrada" });
      }
      // Erro de rede: pula esta; o próximo sync completo tenta de novo.
    }
  }
  if (ops.length === 0) return 0;

  const { data, error } = await supabase.rpc("meeting_reconcile_enqueue", { p_ops: ops });
  if (error) {
    console.error("[syncMyGoogleCalendar] enfileirar ausentes falhou", {
      code: error.code,
      message: error.message,
    });
    return 0;
  }
  return (data as { enqueued?: number } | null)?.enqueued ?? 0;
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
  const forwardOps = new Map<string, ForwardOp>(); // dedupe (instâncias de recorrência)
  for (const ev of events) {
    if (!ev.id) continue;
    // Reunião do CRM (direta ou via recurringEventId): vira auto-sync (0172/0174).
    const op = toForwardOp(ev, systemIds);
    if (op) forwardOps.set(op.eventId, op);
    // Reunião do CRM nunca entra no espelho.
    if (systemIds.has(ev.id)) continue;
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
  const queued = await applyForwardSync(supabase, Array.from(forwardOps.values()));
  return {
    status: "ok",
    imported: upserts.length,
    queued,
    lastSyncedAt: new Date().toISOString(),
  };
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

// Transforma um evento que CASA com uma reunião do CRM (systemIds) numa operação
// de auto-sync (0172/0174). Regras:
//   · status=cancelled EXPLÍCITO => op de cancelamento (A1; 404 nunca chega aqui);
//   · instância de recorrência cujo MESTRE é reunião do CRM => motivo 'recorrente'
//     (A11 — a reunião virou recorrente no Google; nunca aplicar);
//   · all-day/sem dateTime => motivo 'sem_horario'; fim <= início => 'horario_invalido'
//     (A6 — vão para a fila com o motivo, não são aplicados);
//   · título vazio vira "(sem título)" no banco (A6).
function toForwardOp(
  ev: RawGoogleEvent,
  systemIds: Set<string>
): ForwardOp | null {
  // Reunião do CRM que virou RECORRENTE: com singleEvents=true o Google manda as
  // INSTÂNCIAS (id derivado) apontando o mestre em recurringEventId.
  if (ev.recurringEventId && systemIds.has(ev.recurringEventId)) {
    return { eventId: ev.recurringEventId, motivo: "recorrente" };
  }
  if (!ev.id || !systemIds.has(ev.id)) return null;
  if (ev.status === "cancelled") return { eventId: ev.id, cancel: true };

  const startDT = ev.start?.dateTime;
  const endDT = ev.end?.dateTime;
  if (!startDT || !endDT) return { eventId: ev.id, motivo: "sem_horario" };

  const s = new Date(startDT).getTime();
  const e = new Date(endDT).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) {
    return { eventId: ev.id, motivo: "horario_invalido" };
  }

  return {
    eventId: ev.id,
    title: (ev.summary ?? "").trim() || null,
    startsAt: new Date(s).toISOString(),
    endsAt: new Date(e).toISOString(),
    meetLink: meetLinkOf(ev),
    updated: ev.updated ?? null,
  };
}

// Leva as mudanças do Google nas reuniões do CRM do PRÓPRIO usuário à RPC. Dono
// RECONCILIADO (auto_apply_from setado): aplica direto com as travas A1–A7. Dono
// NÃO reconciliado: a RPC ENFILEIRA tudo na revisão do admin — nada é descartado
// (o sync incremental consome o syncToken; sem a fila a mudança se perderia em
// silêncio). Nunca derruba o sync do espelho: o import já salvou; erro só loga.
async function applyForwardSync(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ops: ForwardOp[]
): Promise<number> {
  if (ops.length === 0) return 0;
  const { data, error } = await supabase.rpc("meetings_apply_google_sync", {
    p_ops: ops,
  });
  if (error) {
    console.error("[syncMyGoogleCalendar] auto-sync Google→CRM falhou", {
      code: error.code,
      message: error.message,
    });
    return 0;
  }
  // Para o dono reconciliado, divergências travadas (conta/edição/horário) ainda
  // vão para a fila; para o não reconciliado, TUDO vai. `queued` alimenta o aviso.
  return (data as { queued?: number } | null)?.queued ?? 0;
}

// Soma meses a uma data preservando o instante (sem depender de fuso — a janela
// é folgada, não precisa de precisão civil).
function monthsFrom(base: Date, months: number): Date {
  const d = new Date(base);
  d.setMonth(d.getMonth() + months);
  return d;
}

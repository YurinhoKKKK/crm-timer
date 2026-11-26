"use server";

import { createClient } from "@/lib/supabase-server";
import {
  getValidAccessToken,
  getCalendarEventFull,
  EventGone,
} from "@/lib/google-calendar";
import { syncMyGoogleCalendar } from "@/app/google-import-actions";

// =====================================================================
// Reconciliação Google→CRM (0172) — a PRÉVIA e a aplicação.
//
// POR QUE AQUI: só a sessão do PRÓPRIO dono lê a agenda dele (token via
// google_get_account por auth.uid(), sem service_role). Então a VARREDURA que
// monta a prévia roda na sessão do dono (scanGoogleReconciliation); o APLICAR é
// banco puro e fica com o admin (meeting_reconcile_*). Nada é alterado sem o OK
// do admin: o dono só ENFILEIRA.
//
// A varredura só roda enquanto o dono NÃO foi reconciliado (auto_apply_from nulo).
// Depois disso o auto-sync do ciclo de import (google-import-actions) assume.
// =====================================================================

// Revarre no máximo a cada 6h (a prévia não precisa ser de tempo real; evita
// uma rajada de GETs ao Google a cada carga da /agenda).
const SCAN_STALE_MS = 6 * 60 * 60 * 1000;
// Janela do backlog: reuniões futuras + dos últimos 30 dias (decisão 6).
const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

type ScanOp = {
  eventId: string;
  cancel?: boolean; // SÓ para status=cancelled explícito (A1)
  // Motivos que mandam a linha direto para a fila como 'revisar'/'cancel_*':
  //   nao_encontrada (404/410 — nunca apaga), conta_diferente, recorrente,
  //   sem_horario (dia inteiro), horario_invalido.
  motivo?:
    | "nao_encontrada"
    | "conta_diferente"
    | "recorrente"
    | "sem_horario"
    | "horario_invalido";
  title?: string | null;
  startsAt?: string;
  endsAt?: string;
  meetLink?: string | null;
  updated?: string | null;
};

export type ScanResult =
  | { status: "ok"; enqueued: number }
  | { status: "reconciliado" } // auto-sync já ativo; não varre mais
  | { status: "recente" } // varreu há pouco; nada a fazer
  | { status: "nao_conectado" }
  | { status: "erro"; message?: string };

// Varredura do backlog na sessão do dono: compara cada reunião do CRM com o
// estado ATUAL no Google (distingue MOVIDA de APAGADA) e enfileira as divergências.
export async function scanGoogleReconciliation(opts?: {
  force?: boolean;
}): Promise<ScanResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "erro", message: "Sessão expirada." };

  const { data: stateRow } = await supabase
    .from("google_calendar_import_state")
    .select("auto_apply_from, last_reconcile_scan_at")
    .maybeSingle();
  const state = stateRow as
    | { auto_apply_from: string | null; last_reconcile_scan_at: string | null }
    | null;

  // Já reconciliado → o auto-sync do import cuida; não varre.
  if (state?.auto_apply_from) return { status: "reconciliado" };
  if (
    !opts?.force &&
    state?.last_reconcile_scan_at &&
    Date.now() - new Date(state.last_reconcile_scan_at).getTime() < SCAN_STALE_MS
  ) {
    return { status: "recente" };
  }

  const token = await getValidAccessToken(supabase);
  if (token.status !== "ok") return { status: "nao_conectado" };

  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const { data: meetingRows } = await supabase
    .from("meetings")
    .select("id, google_event_id, starts_at, google_email")
    .eq("created_by", user.id)
    .not("google_event_id", "is", null)
    .is("google_removed_at", null)
    .gte("starts_at", since);

  const meetings =
    (meetingRows as
      | {
          id: string;
          google_event_id: string;
          starts_at: string;
          google_email: string | null;
        }[]
      | null) ?? [];

  const ops: ScanOp[] = [];
  for (const m of meetings) {
    // A3: conta diferente (ou incerta) — NÃO consulta o Google: o evento vive em
    // OUTRA agenda; o GET na conta atual daria 404 e viraria um "não encontrada"
    // falso. Vai direto para a fila; o banco revalida e avisa dono + admin.
    if (!m.google_email || !token.email || m.google_email !== token.email) {
      ops.push({ eventId: m.google_event_id, motivo: "conta_diferente" });
      continue;
    }
    try {
      const g = await getCalendarEventFull(token.accessToken, m.google_event_id);
      if (g.status === "cancelled") {
        // Cancelamento EXPLÍCITO (A1) — a fila decide excluir×manter (A2/timer).
        ops.push({ eventId: m.google_event_id, cancel: true });
        continue;
      }
      if (g.recurring) {
        ops.push({ eventId: m.google_event_id, motivo: "recorrente" }); // A11
        continue;
      }
      if (g.startISO === null || g.endISO === null) {
        ops.push({ eventId: m.google_event_id, motivo: "sem_horario" }); // A6
        continue;
      }
      if (new Date(g.endISO).getTime() <= new Date(g.startISO).getTime()) {
        ops.push({ eventId: m.google_event_id, motivo: "horario_invalido" });
        continue;
      }
      ops.push({
        eventId: m.google_event_id,
        title: g.title,
        startsAt: new Date(g.startISO).toISOString(),
        endsAt: new Date(g.endISO).toISOString(),
        meetLink: g.meetLink,
        updated: g.updatedISO,
      });
    } catch (e) {
      // 404/410: NÃO é cancelamento (A1) — marca "não encontrada" e enfileira
      // para revisão; nada é apagado. Erro de rede: pula este, segue os outros.
      if (e instanceof EventGone) {
        ops.push({ eventId: m.google_event_id, motivo: "nao_encontrada" });
      }
    }
  }

  // A RPC filtra updates sem divergência real e carimba last_reconcile_scan_at.
  const { data: res, error } = await supabase.rpc("meeting_reconcile_enqueue", {
    p_ops: ops,
  });
  if (error) {
    console.error("[scanGoogleReconciliation] enqueue falhou", {
      code: error.code,
      message: error.message,
    });
    return { status: "erro" };
  }
  const enqueued = (res as { enqueued?: number } | null)?.enqueued ?? 0;
  return { status: "ok", enqueued };
}

// ---------------------------------------------------------------------
// ADMIN — prévia + aplicação. A autorização mora nas RPCs (is_admin()); aqui é
// repasse que traduz 42501 numa mensagem clara.
// ---------------------------------------------------------------------
export type ReconcileAction = "update" | "cancel_delete" | "cancel_keep" | "revisar";

export type ReconcileRow = {
  id: string;
  meetingId: string | null;
  ownerId: string;
  ownerName: string | null;
  companyId: string | null;
  companyName: string | null;
  action: ReconcileAction;
  motivo: string | null;
  crmTitle: string | null;
  crmStartsAt: string | null;
  crmEndsAt: string | null;
  crmMeetLink: string | null;
  googleTitle: string | null;
  googleStartsAt: string | null;
  googleEndsAt: string | null;
  googleMeetLink: string | null;
  hasTimer: boolean;
  googleUpdatedAt: string | null;
  detectedAt: string;
  ownerAutoApplyFrom: string | null;
};

type RawReconcileRow = {
  id: string;
  meeting_id: string | null;
  owner_id: string;
  owner_name: string | null;
  company_id: string | null;
  company_name: string | null;
  proposed_action: ReconcileAction;
  motivo: string | null;
  crm_title: string | null;
  crm_starts_at: string | null;
  crm_ends_at: string | null;
  crm_meet_link: string | null;
  google_title: string | null;
  google_starts_at: string | null;
  google_ends_at: string | null;
  google_meet_link: string | null;
  has_timer: boolean;
  google_updated_at: string | null;
  detected_at: string;
  owner_auto_apply_from: string | null;
};

export async function listReconciliation(): Promise<ReconcileRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("meeting_reconcile_list");
  if (error || !data) return [];
  return (data as RawReconcileRow[]).map((r) => ({
    id: r.id,
    meetingId: r.meeting_id,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    companyId: r.company_id,
    companyName: r.company_name,
    action: r.proposed_action,
    motivo: r.motivo,
    crmTitle: r.crm_title,
    crmStartsAt: r.crm_starts_at,
    crmEndsAt: r.crm_ends_at,
    crmMeetLink: r.crm_meet_link,
    googleTitle: r.google_title,
    googleStartsAt: r.google_starts_at,
    googleEndsAt: r.google_ends_at,
    googleMeetLink: r.google_meet_link,
    hasTimer: r.has_timer,
    googleUpdatedAt: r.google_updated_at,
    detectedAt: r.detected_at,
    ownerAutoApplyFrom: r.owner_auto_apply_from,
  }));
}

type MutationResult = { ok: boolean; error?: string };

const ADMIN_ONLY = "Apenas administradores podem fazer isto.";

// ---------------------------------------------------------------------
// Roster da reconciliação (admin): todos os usuários com Google conectado, com
// último sync, estado do auto-sync e pendências na fila. É onde mora o
// "Concluir": usuário sem divergência também precisa aparecer para ser
// concluído (antes o botão só existia dentro do bloco de pendências).
// ---------------------------------------------------------------------
export type ReconcileOwner = {
  userId: string;
  name: string | null;
  googleEmail: string | null;
  lastSyncedAt: string | null;
  autoApplyFrom: string | null;
  pending: number;
};

export async function listReconcileOwners(): Promise<ReconcileOwner[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("meeting_reconcile_owners");
  if (error || !data) return [];
  return (
    data as {
      user_id: string;
      full_name: string | null;
      google_email: string | null;
      last_synced_at: string | null;
      auto_apply_from: string | null;
      pending: number;
    }[]
  ).map((r) => ({
    userId: r.user_id,
    name: r.full_name,
    googleEmail: r.google_email,
    lastSyncedAt: r.last_synced_at,
    autoApplyFrom: r.auto_apply_from,
    pending: r.pending ?? 0,
  }));
}

export async function applyReconciliation(id: string): Promise<MutationResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("meeting_reconcile_apply", { p_id: id });
  if (error) {
    console.error("[applyReconciliation]", { code: error.code, message: error.message });
    if (error.code === "42501") return { ok: false, error: ADMIN_ONLY };
    // P0001 = raise exception da função com mensagem PENSADA para o admin (linha
    // velha/A8, linha "só revisão", reunião que não existe mais). Repassar — o
    // genérico esconderia a instrução ("rode uma nova varredura").
    if (error.code === "P0001") return { ok: false, error: error.message };
    return { ok: false, error: "Não foi possível aplicar esta reconciliação." };
  }
  return { ok: true };
}

export async function dismissReconciliation(id: string): Promise<MutationResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("meeting_reconcile_dismiss", { p_id: id });
  if (error) {
    if (error.code === "42501") return { ok: false, error: ADMIN_ONLY };
    return { ok: false, error: "Não foi possível dispensar esta linha." };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------
// B13 — reuniões FUTURAS do PRÓPRIO usuário que ficaram fora do Google
// (nao_conectado/falhou). Alimenta o banner persistente da Agenda, com botão
// "Enviar para o Google" por reunião. RLS: o criador sempre vê as suas.
// ---------------------------------------------------------------------
export type PendingGoogleMeeting = {
  id: string;
  title: string;
  startsAt: string;
  companyName: string | null;
  syncStatus: "nao_conectado" | "falhou";
  syncError: string | null;
};

export async function listMyPendingGoogleMeetings(): Promise<
  PendingGoogleMeeting[]
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("meetings")
    .select("id, title, starts_at, google_sync_status, google_sync_error, company:companies(name)")
    .eq("created_by", user.id)
    .in("google_sync_status", ["nao_conectado", "falhou"])
    .gt("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true });
  type Row = {
    id: string;
    title: string;
    starts_at: string;
    google_sync_status: "nao_conectado" | "falhou";
    google_sync_error: string | null;
    company: { name: string } | { name: string }[] | null;
  };
  return ((data as Row[] | null) ?? []).map((r) => {
    const c = Array.isArray(r.company) ? r.company[0] : r.company;
    return {
      id: r.id,
      title: r.title,
      startsAt: r.starts_at,
      companyName: c?.name ?? null,
      syncStatus: r.google_sync_status,
      syncError: r.google_sync_error,
    };
  });
}

// ---------------------------------------------------------------------
// B15 — quando a agenda importada de cada pessoa foi sincronizada pela última
// vez (RPC agenda_sync_status, 0174). Alimenta o "atualizada há X" por pessoa na
// Agenda e o alerta de agenda velha (>24h) no aviso de conflito.
// ---------------------------------------------------------------------
export type AgendaSyncInfo = {
  userId: string;
  googleConnected: boolean;
  lastSyncedAt: string | null;
};

export async function fetchAgendaSyncStatus(): Promise<AgendaSyncInfo[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("agenda_sync_status");
  if (error || !data) return [];
  return (
    data as { user_id: string; google_connected: boolean; last_synced_at: string | null }[]
  ).map((r) => ({
    userId: r.user_id,
    googleConnected: r.google_connected,
    lastSyncedAt: r.last_synced_at,
  }));
}

// Conclui a reconciliação de um dono: liga o auto-sync Google→CRM dali pra frente.
// A RPC exige sincronização RECENTE (≤30 min) do dono — com o sync enfileirando
// toda divergência enquanto não reconciliado, isso garante que a fila fecha sem
// buraco. Quando o admin conclui a PRÓPRIA reconciliação, dá para garantir aqui
// mesmo: sincroniza e varre (força) antes de chamar a RPC. Para outros donos o
// token Google não é alcançável (sem service_role) — vale a trava do banco, e a
// mensagem orienta a pedir que a pessoa abra a Agenda.
export async function finalizeReconciliation(
  ownerId: string
): Promise<MutationResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sessão expirada. Faça login de novo." };

  if (user.id === ownerId) {
    // Erros aqui não barram: se o sync falhar, a trava de frescor da RPC recusa
    // com a mensagem certa.
    await syncMyGoogleCalendar().catch(() => null);
    await scanGoogleReconciliation({ force: true }).catch(() => null);
  }

  const { error } = await supabase.rpc("meeting_reconcile_finalize", {
    p_owner: ownerId,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: ADMIN_ONLY };
    // Trava de frescor (P0001): a mensagem diz exatamente o que fazer.
    if (error.code === "P0001") return { ok: false, error: error.message };
    return { ok: false, error: "Não foi possível concluir a reconciliação." };
  }
  return { ok: true };
}

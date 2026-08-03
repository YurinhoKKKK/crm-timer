"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase-server";
import { getValidAccessToken, insertCalendarEvent } from "@/lib/google-calendar";
import { GoogleError } from "@/lib/google-oauth";
import type { GoogleSyncStatus, MeetingType } from "@/lib/meetings";

// =====================================================================
// Reuniões (Fatia 1) — criação e aviso de conflito.
//
// REGRA CENTRAL: grava no banco PRIMEIRO, depois tenta o Google. Se não há
// conta conectada ou o Google falha, a reunião FICA salva, com aviso e
// google_sync_status registrado — nunca se perde a reunião pela integração.
// Token só transita no servidor (lib server-only google-calendar).
// =====================================================================

const MEETING_TYPES: MeetingType[] = [
  "meet",
  "presencial_escritorio",
  "presencial_cliente",
];

export type CreateMeetingInput = {
  companyId: string;
  // Só para compor o corpo do evento na agenda pessoal do criador; a autoria e
  // o acesso à empresa são garantidos pela RLS de meetings_insert, não por isto.
  companyName: string;
  title: string;
  description: string;
  type: MeetingType;
  startISO: string;
  endISO: string;
  participantIds: string[];
};

export type CreateMeetingResult =
  | { ok: false; error: string }
  | {
      ok: true;
      meetingId: string;
      sync: GoogleSyncStatus;
      warning: string | null;
    };

export async function createMeeting(
  input: CreateMeetingInput
): Promise<CreateMeetingResult> {
  // ---- validação (espelha a do formulário; a fonte da verdade é o servidor)
  const title = input.title.trim();
  if (!input.companyId) return { ok: false, error: "Escolha a empresa." };
  if (!title) return { ok: false, error: "Informe um título para a reunião." };
  if (title.length > 200)
    return { ok: false, error: "O título pode ter no máximo 200 caracteres." };
  if (!MEETING_TYPES.includes(input.type))
    return { ok: false, error: "Tipo de reunião inválido." };

  const start = new Date(input.startISO).getTime();
  const end = new Date(input.endISO).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end))
    return { ok: false, error: "Datas de início e fim inválidas." };
  if (end <= start)
    return { ok: false, error: "O fim deve ser depois do início." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sessão expirada. Faça login de novo." };

  // ---- 1. grava no banco PRIMEIRO (RLS meetings_insert cuida do acesso)
  const { data: created, error: insErr } = await supabase
    .from("meetings")
    .insert({
      company_id: input.companyId,
      title,
      description: input.description.trim() || null,
      starts_at: new Date(start).toISOString(),
      ends_at: new Date(end).toISOString(),
      meeting_type: input.type,
      created_by: user.id,
      google_sync_status: "pendente",
    })
    .select("id")
    .single();

  if (insErr || !created) {
    // NUNCA engolir o erro do banco: registra o código/mensagem/detalhe reais no
    // log do servidor (é o que diz a causa) e devolve uma mensagem CLASSIFICADA,
    // sem chutar. Ver describeInsertError.
    console.error("[createMeeting] insert em meetings falhou", {
      code: insErr?.code,
      message: insErr?.message,
      details: insErr?.details,
      hint: insErr?.hint,
      companyId: input.companyId,
      userId: user.id,
    });
    return { ok: false, error: describeInsertError(insErr) };
  }
  const meetingId = created.id as string;

  // ---- 2. participantes internos (RLS mp_write só deixa o criador escrever)
  const participantIds = Array.from(
    new Set(input.participantIds.filter(Boolean))
  );
  if (participantIds.length > 0) {
    await supabase
      .from("meeting_participants")
      .insert(
        participantIds.map((uid) => ({ meeting_id: meetingId, user_id: uid }))
      );
  }

  // ---- 3. tenta o Google (nunca derruba a reunião já salva)
  const token = await getValidAccessToken(supabase);

  if (token.status === "nao_conectado") {
    await setSync(supabase, meetingId, "nao_conectado", null);
    return {
      ok: true,
      meetingId,
      sync: "nao_conectado",
      warning:
        "Reunião criada e salva. Sua conta Google não está conectada, então ela não foi adicionada à sua agenda. Conecte no seu perfil para sincronizar as próximas.",
    };
  }
  if (token.status === "falhou") {
    await setSync(supabase, meetingId, "falhou", token.error);
    return {
      ok: true,
      meetingId,
      sync: "falhou",
      warning: `Reunião criada e salva, mas não foi possível sincronizar com o Google: ${token.error}`,
    };
  }

  const attendeeEmails = await participantEmails(supabase, participantIds);
  try {
    const event = await insertCalendarEvent(token.accessToken, {
      summary: title,
      description: buildEventDescription(input.description, input.companyName),
      startISO: new Date(start).toISOString(),
      endISO: new Date(end).toISOString(),
      attendeeEmails,
      withMeet: input.type === "meet",
    });
    await setSync(supabase, meetingId, "sincronizado", null, {
      eventId: event.eventId,
      meetLink: event.meetLink,
    });
    return {
      ok: true,
      meetingId,
      sync: "sincronizado",
      warning:
        input.type === "meet" && !event.meetLink
          ? "Reunião criada e adicionada à sua agenda, mas o Google não retornou um link do Meet."
          : null,
    };
  } catch (e) {
    const msg =
      e instanceof GoogleError
        ? e.message
        : "Erro inesperado ao criar o evento no Google.";
    await setSync(supabase, meetingId, "falhou", msg);
    return {
      ok: true,
      meetingId,
      sync: "falhou",
      warning: `Reunião criada e salva, mas houve um erro ao adicioná-la à sua agenda do Google: ${msg}`,
    };
  }
}

// Traduz o erro do INSERT em meetings numa mensagem que DISTINGUE as causas —
// nunca adivinha. A action só chega aqui com sessão já validada (getUser acima),
// então um 42501 aqui é a policy de escrita (acesso à empresa), não sessão.
// O texto cru completo já foi para o log do servidor; aqui é só a mensagem ao
// usuário. Códigos: https://www.postgresql.org/docs/current/errcodes-appendix.html
function describeInsertError(err: PostgrestError | null): string {
  switch (err?.code) {
    case "42501": // insufficient_privilege — violação da policy de escrita (RLS)
      return "Você não tem acesso a esta empresa para criar reuniões nela.";
    case "23502": // not_null_violation — faltou um campo obrigatório
      return "Faltou preencher um campo obrigatório da reunião. Recarregue a página e tente de novo.";
    case "23514": // check_violation — tipo ou intervalo de horário inválido
    case "22007": // invalid_datetime_format
    case "22008": // datetime_field_overflow
      return "Há um dado inválido na reunião (tipo ou horário). Revise e tente de novo.";
    case "23503": // foreign_key_violation — empresa inexistente
      return "A empresa selecionada não foi encontrada. Recarregue a página e escolha de novo.";
    case "PGRST301": // JWT ausente/expirado no PostgREST — falha de sessão
      return "Sua sessão expirou. Faça login novamente e tente de novo.";
    default:
      return "Não foi possível criar a reunião. Tente novamente em instantes.";
  }
}

// Grava o resultado da sincronização. Em sucesso, guarda o event_id/agenda/meet.
async function setSync(
  supabase: Awaited<ReturnType<typeof createClient>>,
  meetingId: string,
  status: GoogleSyncStatus,
  error: string | null,
  google?: { eventId: string; meetLink: string | null }
): Promise<void> {
  const patch: Record<string, unknown> = {
    google_sync_status: status,
    google_sync_error: error,
    updated_at: new Date().toISOString(),
  };
  if (google) {
    patch.google_event_id = google.eventId || null;
    patch.google_calendar_id = "primary";
    patch.meet_link = google.meetLink;
  }
  await supabase.from("meetings").update(patch).eq("id", meetingId);
}

// E-mails dos participantes para o convite. A RLS de profiles não deixa o
// criador ler perfis alheios; meeting_directory() (DEFINER) resolve. Fica no
// servidor — nunca chega ao navegador.
async function participantEmails(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[]
): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase.rpc("meeting_directory");
  const rows = (data as { id: string; email: string | null }[] | null) ?? [];
  const wanted = new Set(ids);
  const emails: string[] = [];
  for (const r of rows) {
    if (wanted.has(r.id) && r.email && r.email.includes("@")) {
      emails.push(r.email);
    }
  }
  return emails;
}

function buildEventDescription(
  description: string,
  companyName: string
): string | null {
  const parts = [
    description.trim(),
    companyName ? `Empresa: ${companyName}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

// ---------------------------------------------------------------------
// Aviso de conflito — reuniões DO SISTEMA que se sobrepõem à janela para o
// criador ou os participantes. É AVISO, não bloqueio: o formulário mostra e
// deixa seguir. Eventos criados direto no Google ainda não são vistos (Fatia 2).
// ---------------------------------------------------------------------
export type ConflictRow = {
  meetingId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  companyName: string;
  userIds: string[]; // quais dos consultados batem
};

export async function checkMeetingConflicts(
  startISO: string,
  endISO: string,
  participantIds: string[]
): Promise<ConflictRow[]> {
  const start = new Date(startISO).getTime();
  const end = new Date(endISO).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return [];
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // O criador entra sempre na verificação (a agenda dele também importa).
  const ids = Array.from(
    new Set([
      ...(participantIds ?? []).filter(Boolean),
      ...(user ? [user.id] : []),
    ])
  );
  if (ids.length === 0) return [];

  const { data, error } = await supabase.rpc("meeting_conflicts", {
    p_starts: new Date(start).toISOString(),
    p_ends: new Date(end).toISOString(),
    p_user_ids: ids,
    p_exclude: null,
  });
  if (error || !data) return [];

  return (
    data as {
      meeting_id: string;
      title: string;
      starts_at: string;
      ends_at: string;
      company_name: string;
      conflicting_user_ids: string[] | null;
    }[]
  ).map((r) => ({
    meetingId: r.meeting_id,
    title: r.title,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    companyName: r.company_name,
    userIds: r.conflicting_user_ids ?? [],
  }));
}

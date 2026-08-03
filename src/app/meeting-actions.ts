"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase-server";
import {
  getValidAccessToken,
  insertCalendarEvent,
  patchCalendarEvent,
  deleteCalendarEvent,
} from "@/lib/google-calendar";
import { GoogleError } from "@/lib/google-oauth";
import type { GoogleSyncStatus, MeetingType } from "@/lib/meetings";

// =====================================================================
// Reuniões (Fatia 1 + 1.1) — criar, editar, excluir, sincronizar depois.
//
// REGRA CENTRAL: o SISTEMA é a fonte da verdade; o Google é destino. Grava no
// banco PRIMEIRO, depois fala com o Google. Se não há conta conectada ou o
// Google falha, a reunião FICA salva, com aviso e google_sync_status registrado
// — nunca se perde a reunião pela integração. Token só transita no servidor.
//
// PERMISSÃO (ver migration 0048): só QUEM CRIOU edita/exclui/sincroniza (é quem
// tem o token Google do evento). O admin não edita nem exclui pelo fluxo normal;
// para reunião ÓRFÃ ele tem adminRemoveMeeting (remove só do sistema, sem tocar
// no Google). As actions abaixo checam a autoria no servidor E o RLS reforça.
// =====================================================================

const MEETING_TYPES: MeetingType[] = [
  "meet",
  "presencial_escritorio",
  "presencial_cliente",
];

const SESSION_MSG = "Sessão expirada. Faça login de novo.";
const NOT_CREATOR_EDIT =
  "Só quem criou a reunião pode editá-la — o evento pertence à agenda Google de quem criou.";
const NOT_CREATOR_DELETE =
  "Só quem criou a reunião pode excluí-la — o evento pertence à agenda Google de quem criou.";

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

export type UpdateMeetingInput = CreateMeetingInput & { meetingId: string };

export type CreateMeetingResult =
  | { ok: false; error: string }
  | {
      ok: true;
      meetingId: string;
      sync: GoogleSyncStatus;
      warning: string | null;
    };

export type MutationResult =
  | { ok: false; error: string }
  | { ok: true; warning: string | null };

// ---------------------------------------------------------------------
// CRIAR
// ---------------------------------------------------------------------
export async function createMeeting(
  input: CreateMeetingInput
): Promise<CreateMeetingResult> {
  const fields = validateMeetingFields(input);
  if ("error" in fields) return { ok: false, error: fields.error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: SESSION_MSG };

  // ---- 1. grava no banco PRIMEIRO (RLS meetings_insert cuida do acesso)
  const { data: created, error: insErr } = await supabase
    .from("meetings")
    .insert({
      company_id: input.companyId,
      title: fields.title,
      description: input.description.trim() || null,
      starts_at: new Date(fields.start).toISOString(),
      ends_at: new Date(fields.end).toISOString(),
      meeting_type: input.type,
      created_by: user.id,
      google_sync_status: "pendente",
    })
    .select("id")
    .single();

  if (insErr || !created) {
    // NUNCA engolir o erro do banco: registra o código/mensagem/detalhe reais no
    // log do servidor (é o que diz a causa) e devolve mensagem CLASSIFICADA.
    logDbError("createMeeting", insErr, { companyId: input.companyId, userId: user.id });
    return {
      ok: false,
      error: describeWriteError(insErr, {
        permission: "Você não tem acesso a esta empresa para criar reuniões nela.",
      }),
    };
  }
  const meetingId = created.id as string;

  // ---- 2. participantes internos (RLS mp_write só deixa o criador escrever)
  const participantIds = uniqueIds(input.participantIds);
  if (participantIds.length > 0) {
    await supabase
      .from("meeting_participants")
      .insert(
        participantIds.map((uid) => ({ meeting_id: meetingId, user_id: uid }))
      );
  }

  // ---- 3. tenta o Google (nunca derruba a reunião já salva)
  const outcome = await pushToGoogle(
    supabase,
    meetingId,
    {
      title: fields.title,
      description: input.description,
      companyName: input.companyName,
      startISO: new Date(fields.start).toISOString(),
      endISO: new Date(fields.end).toISOString(),
      attendeeIds: participantIds,
      withMeet: input.type === "meet",
    },
    { existingEventId: null, hadMeet: false }
  );

  return {
    ok: true,
    meetingId,
    sync: outcome.sync,
    warning: warningFor("criar", outcome),
  };
}

// ---------------------------------------------------------------------
// EDITAR — mesmos campos; atualiza o banco e faz PATCH no Google (avisa
// convidados). Troca de tipo trata o Meet coerentemente (gera/remove).
// ---------------------------------------------------------------------
export async function updateMeeting(
  input: UpdateMeetingInput
): Promise<CreateMeetingResult> {
  const fields = validateMeetingFields(input);
  if ("error" in fields) return { ok: false, error: fields.error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: SESSION_MSG };

  // Carrega a reunião atual: precisa do event_id e do tipo antigo para o Google,
  // e confirma a autoria (o RLS também barra, mas assim a mensagem é clara).
  const { data: existing, error: exErr } = await supabase
    .from("meetings")
    .select("created_by, google_event_id, meeting_type")
    .eq("id", input.meetingId)
    .single();
  if (exErr || !existing) return { ok: false, error: "Reunião não encontrada." };
  if (existing.created_by !== user.id)
    return { ok: false, error: NOT_CREATOR_EDIT };

  // ---- 1. atualiza o banco (RLS meetings_update: só o criador). Sem .select()
  // (não precisa do RETORNO) — e por isso sem a armadilha do RETURNING.
  const { error: updErr } = await supabase
    .from("meetings")
    .update({
      company_id: input.companyId,
      title: fields.title,
      description: input.description.trim() || null,
      starts_at: new Date(fields.start).toISOString(),
      ends_at: new Date(fields.end).toISOString(),
      meeting_type: input.type,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.meetingId);
  if (updErr) {
    logDbError("updateMeeting", updErr, { meetingId: input.meetingId, userId: user.id });
    return {
      ok: false,
      error: describeWriteError(updErr, { permission: NOT_CREATOR_EDIT }),
    };
  }

  // ---- 2. participantes: substitui o conjunto (apaga todos + reinsere o novo)
  const participantIds = uniqueIds(input.participantIds);
  await supabase.from("meeting_participants").delete().eq("meeting_id", input.meetingId);
  if (participantIds.length > 0) {
    await supabase
      .from("meeting_participants")
      .insert(
        participantIds.map((uid) => ({ meeting_id: input.meetingId, user_id: uid }))
      );
  }

  // ---- 3. Google: PATCH se o evento já existe; se a reunião nunca chegou ao
  // Google (criada offline), cria agora. O aviso de conflito roda no cliente.
  const outcome = await pushToGoogle(
    supabase,
    input.meetingId,
    {
      title: fields.title,
      description: input.description,
      companyName: input.companyName,
      startISO: new Date(fields.start).toISOString(),
      endISO: new Date(fields.end).toISOString(),
      attendeeIds: participantIds,
      withMeet: input.type === "meet",
    },
    {
      existingEventId: existing.google_event_id ?? null,
      hadMeet: existing.meeting_type === "meet" && !!existing.google_event_id,
    }
  );

  return {
    ok: true,
    meetingId: input.meetingId,
    sync: outcome.sync,
    warning: warningFor("editar", outcome),
  };
}

// ---------------------------------------------------------------------
// EXCLUIR (criador) — apaga o evento no Google e depois a reunião no sistema.
// Decisão de produto: se o Google falhar (fora 404), exclui do sistema MESMO
// ASSIM e avisa que o evento pode ter ficado na agenda (ver docs/REUNIOES.md).
// ---------------------------------------------------------------------
export async function deleteMeeting(meetingId: string): Promise<MutationResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: SESSION_MSG };

  const { data: m, error } = await supabase
    .from("meetings")
    .select("created_by, google_event_id")
    .eq("id", meetingId)
    .single();
  if (error || !m) return { ok: false, error: "Reunião não encontrada." };
  if (m.created_by !== user.id) return { ok: false, error: NOT_CREATOR_DELETE };

  // ---- 1. Google primeiro. 404/410 já é tratado como sucesso na lib.
  let warning: string | null = null;
  if (m.google_event_id) {
    const token = await getValidAccessToken(supabase);
    if (token.status === "ok") {
      try {
        await deleteCalendarEvent(token.accessToken, m.google_event_id);
      } catch (e) {
        warning =
          "A reunião foi removida do sistema, mas o Google recusou apagar o evento" +
          (e instanceof GoogleError ? ` (${e.message})` : "") +
          ". Ele pode ter permanecido na sua agenda.";
      }
    } else if (token.status === "falhou") {
      warning = `A reunião foi removida do sistema, mas não foi possível falar com o Google (${token.error}). O evento pode ter permanecido na sua agenda.`;
    } else {
      warning =
        "A reunião foi removida do sistema. Como sua conta Google não está conectada agora, o evento pode ter permanecido na sua agenda.";
    }
  }

  // ---- 2. exclui no banco (RLS meetings_delete: só o criador). Segue mesmo com
  // falha no Google — foi a decisão de produto.
  const { error: delErr } = await supabase
    .from("meetings")
    .delete()
    .eq("id", meetingId);
  if (delErr) {
    logDbError("deleteMeeting", delErr, { meetingId, userId: user.id });
    return { ok: false, error: describeWriteError(delErr, { permission: NOT_CREATOR_DELETE }) };
  }
  return { ok: true, warning };
}

// ---------------------------------------------------------------------
// FAXINA DO ADMIN — reunião órfã (criador saiu / conta Google se foi). Remove
// SÓ do sistema via função SECURITY DEFINER; NÃO toca no Google. A UI deixa
// explícito. Qualquer não-admin recebe 42501 da função.
// ---------------------------------------------------------------------
export async function adminRemoveMeeting(
  meetingId: string
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: SESSION_MSG };

  const { error } = await supabase.rpc("admin_delete_meeting", {
    p_meeting: meetingId,
  });
  if (error) {
    logDbError("adminRemoveMeeting", error, { meetingId, userId: user.id });
    if (error.code === "42501")
      return {
        ok: false,
        error: "Apenas administradores podem remover reuniões de outras pessoas.",
      };
    return { ok: false, error: "Não foi possível remover a reunião do sistema." };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------
// ENVIAR PARA O GOOGLE (criador) — para reuniões que ficaram fora da agenda
// (nao_conectado/falhou) quando ele agora está conectado. Cria o evento e
// atualiza o status.
// ---------------------------------------------------------------------
export async function syncMeetingToGoogle(
  meetingId: string
): Promise<CreateMeetingResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: SESSION_MSG };

  const { data: m, error } = await supabase
    .from("meetings")
    .select(
      "created_by, google_sync_status, google_event_id, meeting_type, title, description, starts_at, ends_at, company:companies(name)"
    )
    .eq("id", meetingId)
    .single();
  if (error || !m) return { ok: false, error: "Reunião não encontrada." };
  if (m.created_by !== user.id)
    return {
      ok: false,
      error: "Só quem criou a reunião pode enviá-la para o Google.",
    };
  if (m.google_sync_status === "sincronizado" && m.google_event_id)
    return { ok: false, error: "Esta reunião já está na sua agenda Google." };

  const { data: parts } = await supabase
    .from("meeting_participants")
    .select("user_id")
    .eq("meeting_id", meetingId);
  const attendeeIds = ((parts as { user_id: string }[] | null) ?? []).map(
    (p) => p.user_id
  );

  const outcome = await pushToGoogle(
    supabase,
    meetingId,
    {
      title: m.title as string,
      description: (m.description as string | null) ?? "",
      companyName: companyNameOf(m.company),
      startISO: m.starts_at as string,
      endISO: m.ends_at as string,
      attendeeIds,
      withMeet: m.meeting_type === "meet",
    },
    { existingEventId: null, hadMeet: false }
  );

  if (outcome.sync === "nao_conectado")
    return {
      ok: false,
      error: "Conecte sua conta Google no seu perfil antes de enviar a reunião.",
    };
  if (outcome.sync === "falhou")
    return {
      ok: false,
      error: `Não foi possível enviar a reunião ao Google: ${outcome.error}`,
    };
  return {
    ok: true,
    meetingId,
    sync: "sincronizado",
    warning: outcome.meetMissing
      ? "Reunião enviada à sua agenda, mas o Google não retornou um link do Meet."
      : null,
  };
}

// =====================================================================
// Núcleo compartilhado
// =====================================================================

// Empurra a reunião para o Google e grava o status. INSERT se não há evento;
// PATCH se já existe (edição). NUNCA lança — devolve o efeito para o chamador
// frasear o aviso. A reunião no banco é a fonte da verdade e não se perde aqui.
type SyncDetails = {
  title: string;
  description: string; // descrição crua; buildEventDescription compõe o corpo
  companyName: string;
  startISO: string;
  endISO: string;
  attendeeIds: string[];
  withMeet: boolean;
};
type GoogleOutcome =
  | { sync: "sincronizado"; meetMissing: boolean }
  | { sync: "nao_conectado" }
  | { sync: "falhou"; error: string };

async function pushToGoogle(
  supabase: Awaited<ReturnType<typeof createClient>>,
  meetingId: string,
  details: SyncDetails,
  opts: { existingEventId: string | null; hadMeet: boolean }
): Promise<GoogleOutcome> {
  const token = await getValidAccessToken(supabase);
  if (token.status === "nao_conectado") {
    await setSync(supabase, meetingId, "nao_conectado", null);
    return { sync: "nao_conectado" };
  }
  if (token.status === "falhou") {
    await setSync(supabase, meetingId, "falhou", token.error);
    return { sync: "falhou", error: token.error };
  }

  const attendeeEmails = await participantEmails(supabase, details.attendeeIds);
  const payload = {
    summary: details.title,
    description: buildEventDescription(details.description, details.companyName),
    startISO: details.startISO,
    endISO: details.endISO,
    attendeeEmails,
    withMeet: details.withMeet,
  };
  try {
    const event = opts.existingEventId
      ? await patchCalendarEvent(token.accessToken, opts.existingEventId, payload, {
          hadMeet: opts.hadMeet,
        })
      : await insertCalendarEvent(token.accessToken, payload);
    await setSync(supabase, meetingId, "sincronizado", null, {
      eventId: event.eventId,
      meetLink: event.meetLink,
    });
    return {
      sync: "sincronizado",
      meetMissing: details.withMeet && !event.meetLink,
    };
  } catch (e) {
    const msg =
      e instanceof GoogleError
        ? e.message
        : "Erro inesperado ao falar com o Google.";
    await setSync(supabase, meetingId, "falhou", msg);
    return { sync: "falhou", error: msg };
  }
}

// Frase do aviso conforme a ação (criar/editar) e o efeito no Google. Mantém o
// banco como fonte da verdade: sempre deixa claro que a reunião ficou salva.
function warningFor(
  action: "criar" | "editar",
  outcome: GoogleOutcome
): string | null {
  const saved = action === "criar" ? "Reunião criada e salva" : "Alterações salvas";
  if (outcome.sync === "nao_conectado")
    return `${saved}. Sua conta Google não está conectada, então ela não foi ${
      action === "criar" ? "adicionada à" : "atualizada na"
    } sua agenda. Conecte no seu perfil para sincronizar.`;
  if (outcome.sync === "falhou")
    return `${saved}, mas não foi possível sincronizar com o Google: ${outcome.error}`;
  if (outcome.meetMissing)
    return `${saved} e sincronizada, mas o Google não retornou um link do Meet.`;
  return null;
}

// Validação dos campos (espelha a do formulário; a fonte da verdade é o servidor).
function validateMeetingFields(input: {
  companyId: string;
  title: string;
  type: MeetingType;
  startISO: string;
  endISO: string;
}): { error: string } | { title: string; start: number; end: number } {
  const title = input.title.trim();
  if (!input.companyId) return { error: "Escolha a empresa." };
  if (!title) return { error: "Informe um título para a reunião." };
  if (title.length > 200)
    return { error: "O título pode ter no máximo 200 caracteres." };
  if (!MEETING_TYPES.includes(input.type))
    return { error: "Tipo de reunião inválido." };
  const start = new Date(input.startISO).getTime();
  const end = new Date(input.endISO).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end))
    return { error: "Datas de início e fim inválidas." };
  if (end <= start) return { error: "O fim deve ser depois do início." };
  return { title, start, end };
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set((ids ?? []).filter(Boolean)));
}

function companyNameOf(
  company: { name: string } | { name: string }[] | null
): string {
  if (!company) return "";
  const c = Array.isArray(company) ? company[0] : company;
  return c?.name ?? "";
}

function logDbError(
  where: string,
  err: PostgrestError | null,
  ctx: Record<string, unknown>
): void {
  console.error(`[${where}] escrita em meetings falhou`, {
    code: err?.code,
    message: err?.message,
    details: err?.details,
    hint: err?.hint,
    ...ctx,
  });
}

// Traduz o erro de escrita numa mensagem que DISTINGUE as causas — nunca
// adivinha. A action chega aqui com sessão já validada, então 42501 é a policy
// (o `permission` do chamador diz o que significa naquele contexto). O texto cru
// já foi ao log. Códigos: https://www.postgresql.org/docs/current/errcodes-appendix.html
function describeWriteError(
  err: PostgrestError | null,
  opts?: { permission?: string }
): string {
  switch (err?.code) {
    case "42501": // insufficient_privilege — violação de policy (RLS)
      return opts?.permission ?? "Você não tem permissão para esta ação.";
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
      return "Não foi possível concluir a operação. Tente novamente em instantes.";
  }
}

// Grava o resultado da sincronização. Em sucesso, guarda o event_id/agenda/meet.
// Em nao_conectado/falhou LIMPA event_id/meet_link (a reunião não está no Google).
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
// deixa seguir. Na EDIÇÃO, exclua a própria reunião (excludeMeetingId) para ela
// não conflitar consigo mesma. Eventos criados direto no Google ainda não são
// vistos (Fatia 2).
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
  participantIds: string[],
  excludeMeetingId?: string
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
    p_exclude: excludeMeetingId ?? null,
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

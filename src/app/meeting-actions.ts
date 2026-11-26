"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase-server";
import {
  getValidAccessToken,
  insertCalendarEvent,
  patchCalendarEvent,
  deleteCalendarEvent,
  getCalendarEvent,
  setMyResponseStatus,
  EventGone,
} from "@/lib/google-calendar";
import { GoogleError } from "@/lib/google-oauth";
import { loadAgendaItems } from "@/lib/meetings";
import type {
  GoogleSyncStatus,
  GridItem,
  MeetingResponse,
  MeetingRoom,
  MeetingType,
} from "@/lib/meetings";
import { roomCalendarEmail } from "@/lib/rooms";

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
  // Sala do escritório a reservar. Só vale para presencial_escritorio; a action
  // NORMALIZA (força null nos outros tipos) — o servidor é a fonte da verdade.
  room: MeetingRoom | null;
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

  const room = normalizeRoom(input.type, input.room);

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
      room,
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

  // ---- 2. participantes internos (RLS mp_write só deixa o criador escrever).
  // Erro aqui não é mais engolido (B16): a reunião fica criada, mas o aviso diz
  // que a lista de convidados não foi gravada.
  let participantsWarning: string | null = null;
  const participantIds = uniqueIds(input.participantIds);
  if (participantIds.length > 0) {
    const { error: partErr } = await supabase
      .from("meeting_participants")
      .insert(
        participantIds.map((uid) => ({ meeting_id: meetingId, user_id: uid }))
      );
    if (partErr) {
      logDbError("createMeeting.participants", partErr, { meetingId, userId: user.id });
      participantsWarning =
        "Reunião criada, mas não foi possível gravar os convidados — revise a lista.";
    }
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
      roomEmail: roomCalendarEmail(room),
      withMeet: input.type === "meet",
    },
    { existingEventId: null, hadMeet: false, existingEmail: null }
  );

  const googleWarning = warningFor("criar", outcome);
  return {
    ok: true,
    meetingId,
    // conta_diferente não altera o status no banco (o evento segue na conta
    // antiga); o campo não é lido pelo front, mas mantemos um GoogleSyncStatus válido.
    sync: outcome.sync === "conta_diferente" ? "sincronizado" : outcome.sync,
    warning:
      [participantsWarning, googleWarning].filter(Boolean).join(" ") || null,
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
    .select("created_by, google_event_id, meeting_type, google_email")
    .eq("id", input.meetingId)
    .single();
  if (exErr || !existing) return { ok: false, error: "Reunião não encontrada." };
  if (existing.created_by !== user.id)
    return { ok: false, error: NOT_CREATOR_EDIT };

  const room = normalizeRoom(input.type, input.room);

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
      room,
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

  // ---- 2. participantes: DIFF em vez de apagar-e-reinserir (B16) — quem
  // continua na reunião PRESERVA o response já espelhado (aceitou/recusou).
  // Erros de escrita não são mais engolidos: viram aviso no retorno.
  let participantsWarning: string | null = null;
  const participantIds = uniqueIds(input.participantIds);
  const { data: curParts, error: curErr } = await supabase
    .from("meeting_participants")
    .select("user_id")
    .eq("meeting_id", input.meetingId);
  if (curErr) {
    logDbError("updateMeeting.participants.read", curErr, {
      meetingId: input.meetingId, userId: user.id,
    });
    participantsWarning =
      "Alterações salvas, mas não foi possível ler os convidados atuais — a lista pode não ter sido atualizada.";
  } else {
    const current = new Set(
      ((curParts as { user_id: string }[] | null) ?? []).map((p) => p.user_id)
    );
    const wanted = new Set(participantIds);
    const toRemove = Array.from(current).filter((id) => !wanted.has(id));
    const toAdd = participantIds.filter((id) => !current.has(id));
    if (toRemove.length > 0) {
      const { error: delErr } = await supabase
        .from("meeting_participants")
        .delete()
        .eq("meeting_id", input.meetingId)
        .in("user_id", toRemove);
      if (delErr) {
        logDbError("updateMeeting.participants.delete", delErr, {
          meetingId: input.meetingId, userId: user.id,
        });
        participantsWarning =
          "Alterações salvas, mas não foi possível remover alguns convidados.";
      }
    }
    if (toAdd.length > 0) {
      const { error: insErr } = await supabase
        .from("meeting_participants")
        .insert(toAdd.map((uid) => ({ meeting_id: input.meetingId, user_id: uid })));
      if (insErr) {
        logDbError("updateMeeting.participants.insert", insErr, {
          meetingId: input.meetingId, userId: user.id,
        });
        participantsWarning =
          "Alterações salvas, mas não foi possível adicionar alguns convidados.";
      }
    }
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
      roomEmail: roomCalendarEmail(room),
      withMeet: input.type === "meet",
    },
    {
      existingEventId: existing.google_event_id ?? null,
      hadMeet: existing.meeting_type === "meet" && !!existing.google_event_id,
      existingEmail: (existing.google_email as string | null) ?? null,
    }
  );

  const googleWarning = warningFor("editar", outcome);
  return {
    ok: true,
    meetingId: input.meetingId,
    // conta_diferente não altera o status no banco (o evento segue na conta
    // antiga); o campo não é lido pelo front, mas mantemos um GoogleSyncStatus válido.
    sync: outcome.sync === "conta_diferente" ? "sincronizado" : outcome.sync,
    warning:
      [participantsWarning, googleWarning].filter(Boolean).join(" ") || null,
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
      "created_by, google_sync_status, google_event_id, google_email, meeting_type, room, title, description, starts_at, ends_at, company:companies(name)"
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

  // B14: se a reunião JÁ tem event_id (ex.: edição cujo push falhou), tenta
  // PATCH naquele evento; o pushToGoogle só cria um novo se o Google devolver
  // 404/410. Antes era sempre INSERT — duplicava o evento na agenda.
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
      roomEmail: roomCalendarEmail(m.room as string | null),
      withMeet: m.meeting_type === "meet",
    },
    {
      existingEventId: (m.google_event_id as string | null) ?? null,
      hadMeet: m.meeting_type === "meet" && !!m.google_event_id,
      existingEmail: (m.google_email as string | null) ?? null,
    }
  );

  if (outcome.sync === "nao_conectado")
    return {
      ok: false,
      error: "Conecte sua conta Google no seu perfil antes de enviar a reunião.",
    };
  if (outcome.sync === "conta_diferente")
    return {
      ok: false,
      error: `Esta reunião está na conta Google ${outcome.email}, que não está mais conectada.`,
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

// ---------------------------------------------------------------------
// OCULTAR / MOSTRAR AO CLIENTE — opt-out por exceção do portal (aba Reuniões).
// A autorização (criador OU admin OU consultor da empresa) é feita no BANCO,
// dentro de set_meeting_client_hidden (SECURITY DEFINER). A action é um repasse:
// não decide nada; 42501 vira mensagem clara.
// ---------------------------------------------------------------------
export async function setMeetingClientHidden(
  meetingId: string,
  hidden: boolean
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: SESSION_MSG };

  const { error } = await supabase.rpc("set_meeting_client_hidden", {
    p_meeting: meetingId,
    p_hidden: hidden,
  });
  if (error) {
    logDbError("setMeetingClientHidden", error, { meetingId, userId: user.id });
    if (error.code === "42501")
      return {
        ok: false,
        error:
          "Só o criador ou admin/consultor da empresa podem alterar a visibilidade ao cliente.",
      };
    return {
      ok: false,
      error: "Não foi possível alterar a visibilidade ao cliente.",
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------
// ATUALIZAR STATUS DOS PARTICIPANTES (Fatia B) — leitura DIRIGIDA por
// google_event_id. Só o CRIADOR pode (só ele tem o token da agenda onde o evento
// vive). A importação em massa descarta as reuniões do sistema (systemIds), então
// o status delas nunca chega por lá — este é o único caminho. Grava no ESPELHO
// display-only (meeting_participants.response + meetings.room_response); os demais
// internos só LEEM. Google é a verdade; o espelho nunca é autoridade.
// ---------------------------------------------------------------------
export type RefreshResponsesResult =
  | { ok: false; error: string }
  | {
      ok: true;
      syncedAt: string;
      participants: { userId: string; response: MeetingResponse | null }[];
      room: MeetingResponse | null;
    };

export async function refreshMeetingResponses(
  meetingId: string
): Promise<RefreshResponsesResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: SESSION_MSG };

  const { data: m, error } = await supabase
    .from("meetings")
    .select("created_by, google_event_id, google_sync_status, room")
    .eq("id", meetingId)
    .single();
  if (error || !m) return { ok: false, error: "Reunião não encontrada." };
  if (m.created_by !== user.id)
    return {
      ok: false,
      error:
        "Só quem criou a reunião pode atualizar o status — o evento está na agenda Google dela.",
    };
  if (!m.google_event_id || m.google_sync_status !== "sincronizado")
    return {
      ok: false,
      error: "Esta reunião ainda não está na sua agenda Google.",
    };

  const token = await getValidAccessToken(supabase);
  if (token.status === "nao_conectado")
    return {
      ok: false,
      error: "Conecte sua conta Google no seu perfil para ler o status.",
    };
  if (token.status === "falhou") return { ok: false, error: token.error };

  let event;
  try {
    event = await getCalendarEvent(token.accessToken, m.google_event_id as string);
  } catch (e) {
    if (e instanceof EventGone)
      return {
        ok: false,
        error:
          "O evento não está mais na sua agenda Google — pode ter sido apagado por fora.",
      };
    return {
      ok: false,
      error:
        e instanceof GoogleError
          ? e.message
          : "Não foi possível ler o status no Google.",
    };
  }

  // e-mail (minúsculo) -> status. Já vêm minúsculos de getCalendarEvent.
  const statusByEmail = new Map<string, MeetingResponse>();
  for (const a of event.attendees) {
    statusByEmail.set(a.email, normalizeResponse(a.responseStatus));
  }

  // Participantes internos desta reunião e o e-mail de cada um (server-side).
  const { data: partRows } = await supabase
    .from("meeting_participants")
    .select("user_id")
    .eq("meeting_id", meetingId);
  const participantIds = ((partRows as { user_id: string }[] | null) ?? []).map(
    (p) => p.user_id
  );
  const emailById = await directoryEmailById(supabase);

  // Agrupa os user_ids por status (incluindo null = não está no evento) e grava.
  const perUser: { userId: string; response: MeetingResponse | null }[] = [];
  const byResponse = new Map<MeetingResponse | null, string[]>();
  for (const uid of participantIds) {
    const email = emailById.get(uid) ?? null;
    const resp = email ? statusByEmail.get(email) ?? null : null;
    perUser.push({ userId: uid, response: resp });
    const list = byResponse.get(resp) ?? [];
    list.push(uid);
    byResponse.set(resp, list);
  }
  for (const [resp, uids] of Array.from(byResponse.entries())) {
    if (uids.length === 0) continue;
    // Sem .select(): update não-retornante (evita a armadilha do RETURNING, 0047).
    await supabase
      .from("meeting_participants")
      .update({ response: resp })
      .eq("meeting_id", meetingId)
      .in("user_id", uids);
  }

  // Sala: status do attendee cujo e-mail é o da agenda da sala reservada.
  const roomEmail = roomCalendarEmail(m.room as string | null);
  const roomResp = roomEmail ? statusByEmail.get(roomEmail) ?? null : null;

  const syncedAt = new Date().toISOString();
  await supabase
    .from("meetings")
    .update({ room_response: roomResp, responses_synced_at: syncedAt })
    .eq("id", meetingId);

  return { ok: true, syncedAt, participants: perUser, room: roomResp };
}

// ---------------------------------------------------------------------
// RESPONDER AO CONVITE (Fatia D) — o PRÓPRIO participante aceita/recusa dentro do
// sistema. O write vai ao Google com o token DELE (muda só o próprio
// responseStatus na cópia do evento na agenda dele). O criador é o organizador —
// não tem RSVP. Espelha a própria resposta via set_my_meeting_response (DEFINER,
// só a própria linha). Google é a verdade; se o espelho falhar, a resposta já
// valeu lá e o próximo "Atualizar status" reconcilia.
// ---------------------------------------------------------------------
export type RespondResult =
  | { ok: false; error: string }
  | { ok: true; response: MeetingResponse };

export async function respondToMeeting(
  meetingId: string,
  response: MeetingResponse
): Promise<RespondResult> {
  // needsAction não é escolha do usuário — só as três respostas ativas.
  if (response !== "accepted" && response !== "tentative" && response !== "declined")
    return { ok: false, error: "Resposta inválida." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: SESSION_MSG };

  const { data: m, error } = await supabase
    .from("meetings")
    .select("google_event_id, google_sync_status, created_by")
    .eq("id", meetingId)
    .single();
  if (error || !m) return { ok: false, error: "Reunião não encontrada." };
  if (m.created_by === user.id)
    return {
      ok: false,
      error: "Você é o organizador desta reunião — não há convite para responder.",
    };
  if (!m.google_event_id || m.google_sync_status !== "sincronizado")
    return { ok: false, error: "Esta reunião ainda não está no Google." };

  const token = await getValidAccessToken(supabase);
  if (token.status === "nao_conectado")
    return {
      ok: false,
      error:
        "Conecte sua conta Google no seu perfil para responder aqui — ou responda pelo convite no Google Agenda.",
    };
  if (token.status === "falhou") return { ok: false, error: token.error };

  try {
    await setMyResponseStatus(token.accessToken, m.google_event_id as string, response);
  } catch (e) {
    if (e instanceof EventGone)
      return {
        ok: false,
        error: "O evento não está mais na sua agenda Google.",
      };
    return {
      ok: false,
      error:
        e instanceof GoogleError
          ? e.message
          : "Não foi possível registrar sua resposta no Google.",
    };
  }

  // Espelha a própria resposta (DEFINER: só a linha do próprio usuário). Se
  // falhar, a resposta no Google — a verdade — já valeu; loga e segue.
  const { error: mirrorErr } = await supabase.rpc("set_my_meeting_response", {
    p_meeting: meetingId,
    p_response: response,
  });
  if (mirrorErr) {
    logDbError("respondToMeeting.mirror", mirrorErr, {
      meetingId,
      userId: user.id,
    });
  }

  return { ok: true, response };
}

// ---------------------------------------------------------------------
// Leitura por INTERVALO — para o calendário navegar (semana/dia/mês) buscando só
// a janela visível (+ folga), nunca a base inteira. A RLS já escopa (todo interno
// vê tudo); o filtro de pessoas é aplicado no cliente sobre esta janela. Traz as
// reuniões do sistema E os eventos importados do Google (Fatia 2), já unidos.
// ---------------------------------------------------------------------
export async function fetchMeetingsRange(
  fromISO: string,
  toISO: string
): Promise<GridItem[]> {
  const from = new Date(fromISO).getTime();
  const to = new Date(toISO).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
  const supabase = await createClient();
  return loadAgendaItems(supabase, { fromISO, toISO });
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
  // Endereço de agenda da SALA a convidar (Fatia A), ou null. Entra como mais um
  // participante do evento — o accepted/declined dela é a confirmação da reserva.
  roomEmail: string | null;
  withMeet: boolean;
};
type GoogleOutcome =
  | { sync: "sincronizado"; meetMissing: boolean }
  | { sync: "nao_conectado" }
  | { sync: "falhou"; error: string }
  // FALHA 3.4: a reunião pertence a uma conta Google que não é a conectada agora.
  // NÃO cria evento novo (deixaria o antigo órfão) e NÃO altera google_email.
  | { sync: "conta_diferente"; email: string };

async function pushToGoogle(
  supabase: Awaited<ReturnType<typeof createClient>>,
  meetingId: string,
  details: SyncDetails,
  opts: {
    existingEventId: string | null;
    hadMeet: boolean;
    // google_email da reunião (conta dona do evento). Quando difere da conta
    // conectada, o envio é recusado em vez de criar um evento novo na conta errada.
    existingEmail: string | null;
  }
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

  // FALHA 3.4: evento numa conta diferente da conectada. Um PATCH naquele event_id
  // daria 404 na conta nova e o fallback criaria um evento DUPLICADO/órfão. Recusa
  // sem tocar no banco (google_email intacto); o CRM já guardou a edição.
  if (
    opts.existingEventId &&
    opts.existingEmail &&
    token.email &&
    opts.existingEmail !== token.email
  ) {
    return { sync: "conta_diferente", email: opts.existingEmail };
  }

  const participants = await participantEmails(supabase, details.attendeeIds);
  // A sala entra como participante (a reserva). Sem duplicar caso, por acaso, já
  // esteja entre os e-mails dos internos.
  const attendeeEmails = details.roomEmail
    ? Array.from(new Set([...participants, details.roomEmail]))
    : participants;
  const payload = {
    summary: details.title,
    description: buildEventDescription(details.description, details.companyName),
    startISO: details.startISO,
    endISO: details.endISO,
    attendeeEmails,
    withMeet: details.withMeet,
  };
  try {
    // B14: com event_id existente, SEMPRE tenta PATCH primeiro; só cria um evento
    // NOVO se o Google disser que aquele não existe mais (404/410 → EventGone).
    // Antes, o reenvio pós-falha fazia INSERT direto e duplicava o evento.
    let event: Awaited<ReturnType<typeof insertCalendarEvent>>;
    if (opts.existingEventId) {
      try {
        event = await patchCalendarEvent(
          token.accessToken,
          opts.existingEventId,
          payload,
          { hadMeet: opts.hadMeet }
        );
      } catch (e) {
        if (!(e instanceof EventGone)) throw e;
        event = await insertCalendarEvent(token.accessToken, payload);
      }
    } else {
      event = await insertCalendarEvent(token.accessToken, payload);
    }
    const saved = await setSync(supabase, meetingId, "sincronizado", null, {
      eventId: event.eventId,
      meetLink: event.meetLink,
      email: token.email,
    });
    if (!saved) {
      // O Google gravou, o CRM não (achado 5): sem registrar o event_id, um
      // reenvio criaria evento DUPLICADO na agenda. Avisa com instrução clara
      // em vez de fingir sucesso.
      return {
        sync: "falhou",
        error:
          "a reunião chegou à sua agenda Google, mas o CRM não conseguiu registrar o vínculo. Tente “Enviar para o Google” daqui a pouco.",
      };
    }
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
  if (outcome.sync === "conta_diferente")
    return `${saved}. Esta reunião está na conta Google ${outcome.email}, que não está mais conectada, então ela não foi atualizada no Google.`;
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

// Sala só faz sentido em presencial no escritório. Nos outros tipos, força null
// (o servidor é a fonte da verdade; não confia no que o formulário mandar). Valor
// fora do domínio também vira null — o CHECK do banco recusaria, mas nem chega lá.
function normalizeRoom(
  type: MeetingType,
  room: MeetingRoom | null
): MeetingRoom | null {
  if (type !== "presencial_escritorio") return null;
  return room === "grande" || room === "pequena" ? room : null;
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

// Grava o resultado da sincronização via RPC meetings_set_sync (0175): o banco
// valida criador/status/conta e, em sucesso com evento, limpa as marcas de
// removida/não encontrada. Em nao_conectado/falhou o event_id anterior é MANTIDO
// de propósito: o reenvio tenta PATCH nele e só cria evento novo se o Google
// disser 404/410 (B14 — evita duplicar). O ERRO é checado (achado 5): retorna
// false quando a gravação falhou mesmo após uma nova tentativa — sem isto, um
// evento criado no Google com event_id não gravado duplicava no reenvio.
async function setSync(
  supabase: Awaited<ReturnType<typeof createClient>>,
  meetingId: string,
  status: GoogleSyncStatus,
  error: string | null,
  google?: { eventId: string; meetLink: string | null; email: string | null }
): Promise<boolean> {
  const args = {
    p_meeting: meetingId,
    p_status: status,
    p_error: error,
    p_has_event: !!google,
    p_event_id: google?.eventId ?? null,
    p_meet_link: google?.meetLink ?? null,
    p_email: google?.email ?? null,
  };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { error: rpcErr } = await supabase.rpc("meetings_set_sync", args);
    if (!rpcErr) return true;
    logDbError("setSync", rpcErr, { meetingId, status, attempt });
  }
  return false;
}

// E-mails dos participantes para o convite. A RLS de profiles não deixa o
// criador ler perfis alheios; meeting_directory() (DEFINER) resolve. Fica no
// servidor — nunca chega ao navegador.
// Domínio do responseStatus do Google → nosso enum. Qualquer coisa fora do
// esperado vira 'needsAction' (não inventa "confirmou").
function normalizeResponse(raw: string): MeetingResponse {
  return raw === "accepted" ||
    raw === "declined" ||
    raw === "tentative" ||
    raw === "needsAction"
    ? raw
    : "needsAction";
}

// Mapa user_id -> e-mail (minúsculo) do diretório. Fica no servidor (o e-mail
// nunca vai ao navegador); casa o attendee do Google com o participante interno.
async function directoryEmailById(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<Map<string, string>> {
  const { data } = await supabase.rpc("meeting_directory");
  const rows = (data as { id: string; email: string | null }[] | null) ?? [];
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.email && r.email.includes("@")) map.set(r.id, r.email.toLowerCase());
  }
  return map;
}

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
// Aviso de conflito — sobreposições de horário para o criador ou os
// participantes, tanto de reuniões DO SISTEMA quanto de eventos IMPORTADOS do
// Google (Fatia 2). É AVISO, não bloqueio: o formulário/arrasto mostra e deixa
// seguir. Na EDIÇÃO, exclua a própria reunião (excludeMeetingId) para ela não
// conflitar consigo mesma. `source` distingue a origem; `title`/`companyName`
// podem ser null (evento particular de outro / evento sem empresa).
// ---------------------------------------------------------------------
export type ConflictRow = {
  source: "sistema" | "google";
  refId: string;
  title: string | null;
  startsAt: string;
  endsAt: string;
  companyName: string | null;
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

  const { data, error } = await supabase.rpc("schedule_conflicts", {
    p_starts: new Date(start).toISOString(),
    p_ends: new Date(end).toISOString(),
    p_user_ids: ids,
    p_exclude: excludeMeetingId ?? null,
  });
  if (error || !data) return [];

  return (
    data as {
      source: "sistema" | "google";
      ref_id: string;
      title: string | null;
      starts_at: string;
      ends_at: string;
      company_name: string | null;
      conflicting_user_ids: string[] | null;
    }[]
  ).map((r) => ({
    source: r.source,
    refId: r.ref_id,
    title: r.title,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    companyName: r.company_name,
    userIds: r.conflicting_user_ids ?? [],
  }));
}

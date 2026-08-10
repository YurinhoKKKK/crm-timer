import "server-only";
import crypto from "node:crypto";
import type { createClient } from "@/lib/supabase-server";
import {
  GoogleError,
  refreshAccessToken,
  expiryFromNow,
} from "@/lib/google-oauth";

// =====================================================================
// Google Calendar — ESCRITA de eventos (Fatia 1). SERVER-ONLY.
//
// O import "server-only" faz o build falhar se este módulo vazar para um
// componente client. O access_token só transita aqui e nas rotas /api/google/*.
// NÃO há leitura de agenda nesta fatia — só criação de evento.
// =====================================================================

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

// Linha devolvida por google_get_account() (SECURITY DEFINER, própria do usuário).
type GoogleAccountRow = {
  google_email: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expiry: string | null;
  scope: string | null;
};

const CALENDAR_EVENTS_ENDPOINT =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const TIME_ZONE = "America/Sao_Paulo";
// Teto defensivo de páginas na LEITURA (250 eventos/página): ~10k eventos na
// janela é folga larga; se estourar, para em vez de laçar sem fim.
const MAX_LIST_PAGES = 40;
// Renova o access_token se faltar menos que isto para vencer (evita usar um
// token que expira no meio da chamada).
const EXPIRY_BUFFER_MS = 2 * 60 * 1000;

export type AccessResult =
  | { status: "ok"; accessToken: string }
  | { status: "nao_conectado" }
  | { status: "falhou"; error: string };

// Access token válido do PRÓPRIO usuário (a sessão do supabase é dele). Renova
// pelo refresh_token quando vencido, regravando cifrado pela função DEFINER.
export async function getValidAccessToken(
  supabase: SupabaseServer
): Promise<AccessResult> {
  const { data, error } = await supabase.rpc("google_get_account");
  if (error) {
    return {
      status: "falhou",
      error: "Não foi possível ler a sua conexão com o Google.",
    };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | GoogleAccountRow
    | undefined;
  if (!row || !row.access_token) return { status: "nao_conectado" };

  const expiry = row.token_expiry ? new Date(row.token_expiry).getTime() : 0;
  if (expiry - Date.now() > EXPIRY_BUFFER_MS) {
    return { status: "ok", accessToken: row.access_token };
  }

  // Vencido (ou quase): precisa renovar. Sem refresh_token não dá — reconectar.
  if (!row.refresh_token) {
    return {
      status: "falhou",
      error:
        "Sua conexão com o Google expirou. Reconecte a conta no seu perfil.",
    };
  }
  try {
    const refreshed = await refreshAccessToken(row.refresh_token);
    await supabase.rpc("google_update_access", {
      p_access: refreshed.access_token,
      p_expiry: expiryFromNow(refreshed.expires_in),
    });
    return { status: "ok", accessToken: refreshed.access_token };
  } catch (e) {
    return {
      status: "falhou",
      error:
        e instanceof GoogleError
          ? e.message
          : "Falha ao renovar o acesso ao Google.",
    };
  }
}

export type CalendarEventInput = {
  summary: string;
  description: string | null;
  startISO: string;
  endISO: string;
  attendeeEmails: string[];
  withMeet: boolean;
};

export type CalendarEventResult = {
  eventId: string;
  meetLink: string | null;
  htmlLink: string | null;
};

// Cria o evento na agenda primária do usuário. conferenceDataVersion=1 permite
// pedir o link do Meet; sendUpdates=all dispara os convites por e-mail aos
// participantes (o cliente NUNCA está entre eles — quem monta a lista é o app).
export async function insertCalendarEvent(
  accessToken: string,
  input: CalendarEventInput
): Promise<CalendarEventResult> {
  const body: Record<string, unknown> = {
    summary: input.summary,
    description: input.description || undefined,
    start: { dateTime: input.startISO, timeZone: TIME_ZONE },
    end: { dateTime: input.endISO, timeZone: TIME_ZONE },
  };
  if (input.attendeeEmails.length > 0) {
    body.attendees = input.attendeeEmails.map((email) => ({ email }));
  }
  if (input.withMeet) {
    body.conferenceData = {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  const url = new URL(CALENDAR_EVENTS_ENDPOINT);
  url.searchParams.set("conferenceDataVersion", "1");
  url.searchParams.set("sendUpdates", "all");

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new GoogleError(
      "Não foi possível falar com o Google Calendar. Tente de novo."
    );
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = json.error;
    const msg =
      err &&
      typeof err === "object" &&
      typeof (err as { message?: unknown }).message === "string"
        ? (err as { message: string }).message
        : "O Google recusou a criação do evento.";
    throw new GoogleError(msg);
  }

  return {
    eventId: typeof json.id === "string" ? json.id : "",
    meetLink: extractMeetLink(json),
    htmlLink: typeof json.htmlLink === "string" ? json.htmlLink : null,
  };
}

// Atualiza o evento existente (edição). PATCH = mescla: os campos enviados
// substituem, os omitidos ficam. `attendees` é enviado SEMPRE (mesmo vazio) para
// que remoções de convidados reflitam. sendUpdates=all avisa os convidados da
// mudança. O Meet é tratado conforme a troca de tipo (ver `hadMeet`):
//   virou meet (withMeet && !hadMeet)  → cria a conferência
//   deixou de ser (!withMeet && hadMeet) → conferenceData:null remove o Meet
//   continua igual → não mexe na conferência (não recria link à toa)
export async function patchCalendarEvent(
  accessToken: string,
  eventId: string,
  input: CalendarEventInput,
  opts: { hadMeet: boolean }
): Promise<CalendarEventResult> {
  const body: Record<string, unknown> = {
    summary: input.summary,
    description: input.description || null,
    start: { dateTime: input.startISO, timeZone: TIME_ZONE },
    end: { dateTime: input.endISO, timeZone: TIME_ZONE },
    attendees: input.attendeeEmails.map((email) => ({ email })),
  };
  if (input.withMeet && !opts.hadMeet) {
    body.conferenceData = {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  } else if (!input.withMeet && opts.hadMeet) {
    body.conferenceData = null; // remove a conferência do evento
  }

  const url = new URL(`${CALENDAR_EVENTS_ENDPOINT}/${encodeURIComponent(eventId)}`);
  url.searchParams.set("conferenceDataVersion", "1");
  url.searchParams.set("sendUpdates", "all");

  let res: Response;
  try {
    res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new GoogleError(
      "Não foi possível falar com o Google Calendar. Tente de novo."
    );
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = json.error;
    const msg =
      err &&
      typeof err === "object" &&
      typeof (err as { message?: unknown }).message === "string"
        ? (err as { message: string }).message
        : "O Google recusou a atualização do evento.";
    throw new GoogleError(msg);
  }

  return {
    eventId: typeof json.id === "string" ? json.id : eventId,
    meetLink: extractMeetLink(json),
    htmlLink: typeof json.htmlLink === "string" ? json.htmlLink : null,
  };
}

// Remove o evento da agenda do usuário. 404/410 = já não existe lá → tratamos
// como SUCESSO (não travar o usuário por algo removido por fora). sendUpdates=all
// avisa os convidados do cancelamento.
export async function deleteCalendarEvent(
  accessToken: string,
  eventId: string
): Promise<void> {
  const url = new URL(`${CALENDAR_EVENTS_ENDPOINT}/${encodeURIComponent(eventId)}`);
  url.searchParams.set("sendUpdates", "all");

  let res: Response;
  try {
    res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
  } catch {
    throw new GoogleError(
      "Não foi possível falar com o Google Calendar. Tente de novo."
    );
  }

  if (res.ok || res.status === 404 || res.status === 410) return; // já não existe = ok
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const err = json.error;
  const msg =
    err &&
    typeof err === "object" &&
    typeof (err as { message?: unknown }).message === "string"
      ? (err as { message: string }).message
      : "O Google recusou a exclusão do evento.";
  throw new GoogleError(msg);
}

// =====================================================================
// LEITURA de eventos (Fatia 2 — importação). O escopo calendar.events.owned já
// concedido (0043) PERMITE ler os eventos da conta; ninguém reconecta. Lemos SÓ
// a agenda primária do PRÓPRIO usuário (o access_token é dele, via
// google_get_account) — jamais a de outra pessoa. Nada aqui escreve no Google.
// =====================================================================

// Evento cru do Google que nos interessa. Campos além destes são ignorados.
export type RawGoogleEvent = {
  id?: string;
  status?: string; // 'confirmed' | 'tentative' | 'cancelled'
  summary?: string;
  visibility?: string; // 'default' | 'public' | 'private' | 'confidential'
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
};

export type EventsPage = {
  events: RawGoogleEvent[];
  nextSyncToken: string | null;
};

// syncToken vencido/ inválido (HTTP 410) — o chamador refaz um sync COMPLETO.
export class SyncTokenExpired extends Error {
  constructor() {
    super("O token de sincronização do Google expirou; refazendo do zero.");
    this.name = "SyncTokenExpired";
  }
}

// Lista eventos da agenda primária, paginando até o fim e devolvendo o
// nextSyncToken (para o próximo sync incremental). Dois modos:
//  · completo:    { timeMin, timeMax } — janela limitada (passado+futuro).
//  · incremental: { syncToken } — só o que mudou desde a última vez; showDeleted
//    para receber os cancelados (o chamador os remove do espelho). 410 => refaz.
// singleEvents=true expande recorrências em ocorrências concretas (com horário),
// e precisa ser CONSISTENTE entre o sync que criou o token e os seguintes.
export async function listCalendarEvents(
  accessToken: string,
  mode: { timeMin: string; timeMax: string } | { syncToken: string }
): Promise<EventsPage> {
  const events: RawGoogleEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;

  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const url = new URL(CALENDAR_EVENTS_ENDPOINT);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("maxResults", "250");
    if ("syncToken" in mode) {
      url.searchParams.set("syncToken", mode.syncToken);
      url.searchParams.set("showDeleted", "true"); // recebe cancelados p/ remover
    } else {
      url.searchParams.set("timeMin", mode.timeMin);
      url.searchParams.set("timeMax", mode.timeMax);
      url.searchParams.set("showDeleted", "false");
    }
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
    } catch {
      throw new GoogleError(
        "Não foi possível ler sua agenda do Google. Tente de novo."
      );
    }

    // 410 GONE: syncToken inválido (janela passou / token velho) — refaz do zero.
    if (res.status === 410) throw new SyncTokenExpired();

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = json.error;
      const msg =
        err &&
        typeof err === "object" &&
        typeof (err as { message?: unknown }).message === "string"
          ? (err as { message: string }).message
          : "O Google recusou a leitura da agenda.";
      throw new GoogleError(msg);
    }

    if (Array.isArray(json.items)) {
      events.push(...(json.items as RawGoogleEvent[]));
    }
    nextSyncToken =
      typeof json.nextSyncToken === "string" ? json.nextSyncToken : nextSyncToken;
    pageToken =
      typeof json.nextPageToken === "string" ? json.nextPageToken : undefined;
    if (!pageToken) break; // última página
  }

  return { events, nextSyncToken };
}

// ---------------------------------------------------------------------
// LEITURA DIRIGIDA de UM evento (Fatia B). A importação em massa
// (listCalendarEvents) descarta as reuniões que o próprio sistema criou
// (systemIds), então o status de resposta dos participantes DELAS nunca chega
// por lá. Aqui buscamos o evento específico por id e lemos attendees[].email +
// responseStatus. Continua só-leitura, na agenda primária do PRÓPRIO usuário.
// ---------------------------------------------------------------------
export type EventAttendee = {
  email: string;
  responseStatus: string; // 'needsAction' | 'declined' | 'tentative' | 'accepted'
  self: boolean;
  organizer: boolean;
  resource: boolean; // true p/ salas/recursos (quando o Google marca)
};

export type EventResponses = {
  eventStatus: string; // 'confirmed' | 'tentative' | 'cancelled'
  attendees: EventAttendee[];
};

// Evento sumiu do Google (apagado por fora): o espelho local fica defasado e o
// chamador precisa avisar — não é erro de rede.
export class EventGone extends Error {
  constructor() {
    super("O evento não está mais na agenda do Google.");
    this.name = "EventGone";
  }
}

export async function getCalendarEvent(
  accessToken: string,
  eventId: string
): Promise<EventResponses> {
  const url = new URL(
    `${CALENDAR_EVENTS_ENDPOINT}/${encodeURIComponent(eventId)}`
  );

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
  } catch {
    throw new GoogleError(
      "Não foi possível ler o evento na sua agenda do Google. Tente de novo."
    );
  }

  if (res.status === 404 || res.status === 410) throw new EventGone();

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = json.error;
    const msg =
      err &&
      typeof err === "object" &&
      typeof (err as { message?: unknown }).message === "string"
        ? (err as { message: string }).message
        : "O Google recusou a leitura do evento.";
    throw new GoogleError(msg);
  }

  // Evento cancelado no Google também é "sumiu" para efeito do espelho.
  if (json.status === "cancelled") throw new EventGone();

  const rawAttendees = Array.isArray(json.attendees) ? json.attendees : [];
  const attendees: EventAttendee[] = [];
  for (const a of rawAttendees) {
    if (!a || typeof a !== "object") continue;
    const email = (a as { email?: unknown }).email;
    if (typeof email !== "string" || !email) continue;
    const rs = (a as { responseStatus?: unknown }).responseStatus;
    attendees.push({
      email: email.toLowerCase(),
      responseStatus: typeof rs === "string" ? rs : "needsAction",
      self: (a as { self?: unknown }).self === true,
      organizer: (a as { organizer?: unknown }).organizer === true,
      resource: (a as { resource?: unknown }).resource === true,
    });
  }

  return {
    eventStatus: typeof json.status === "string" ? json.status : "confirmed",
    attendees,
  };
}

// ---------------------------------------------------------------------
// RSVP DO PRÓPRIO PARTICIPANTE (Fatia D). Escrita, mas na PRÓPRIA agenda: o
// participante muda SÓ o seu responseStatus na cópia do evento que caiu na
// agenda dele (mesmo google_event_id do organizador). Como ele NÃO é o
// organizador, o Google só persiste a mudança do attendee `self` — por isso
// relemos a lista inteira e devolvemos com apenas a nossa entrada alterada
// (não dá para PATCH só do self sem substituir o array). sendUpdates=none: o
// Google já avisa o organizador do RSVP; não precisamos disparar e-mails.
// ---------------------------------------------------------------------
export async function setMyResponseStatus(
  accessToken: string,
  eventId: string,
  response: string
): Promise<void> {
  const url = new URL(
    `${CALENDAR_EVENTS_ENDPOINT}/${encodeURIComponent(eventId)}`
  );

  // (1) GET cru — precisamos da lista de attendees para devolvê-la intacta.
  let getRes: Response;
  try {
    getRes = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
  } catch {
    throw new GoogleError(
      "Não foi possível falar com o Google Calendar. Tente de novo."
    );
  }
  if (getRes.status === 404 || getRes.status === 410) throw new EventGone();
  const ev = (await getRes.json().catch(() => ({}))) as Record<string, unknown>;
  if (!getRes.ok) {
    const err = ev.error;
    const msg =
      err &&
      typeof err === "object" &&
      typeof (err as { message?: unknown }).message === "string"
        ? (err as { message: string }).message
        : "O Google recusou a leitura do evento.";
    throw new GoogleError(msg);
  }
  if (ev.status === "cancelled") throw new EventGone();

  const attendees = Array.isArray(ev.attendees)
    ? (ev.attendees as Record<string, unknown>[])
    : [];
  let changed = false;
  for (const a of attendees) {
    if (a && typeof a === "object" && a.self === true) {
      a.responseStatus = response;
      changed = true;
    }
  }
  if (!changed) {
    throw new GoogleError(
      "Seu e-mail do Google não está entre os convidados desta reunião — responda pelo convite original."
    );
  }

  // (2) PATCH devolvendo a lista; o Google só grava a mudança do próprio self.
  const patchUrl = new URL(
    `${CALENDAR_EVENTS_ENDPOINT}/${encodeURIComponent(eventId)}`
  );
  patchUrl.searchParams.set("sendUpdates", "none");

  let res: Response;
  try {
    res = await fetch(patchUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ attendees }),
      cache: "no-store",
    });
  } catch {
    throw new GoogleError(
      "Não foi possível falar com o Google Calendar. Tente de novo."
    );
  }
  if (res.status === 404 || res.status === 410) throw new EventGone();
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const err = json.error;
    const msg =
      err &&
      typeof err === "object" &&
      typeof (err as { message?: unknown }).message === "string"
        ? (err as { message: string }).message
        : "O Google recusou registrar sua resposta.";
    throw new GoogleError(msg);
  }
}

// Link do Meet: prefere o entryPoint de vídeo do conferenceData; cai no
// hangoutLink legado. Null se o Google não gerou (o chamador avisa).
function extractMeetLink(event: Record<string, unknown>): string | null {
  const conf = event.conferenceData;
  if (conf && typeof conf === "object") {
    const entryPoints = (conf as { entryPoints?: unknown }).entryPoints;
    if (Array.isArray(entryPoints)) {
      for (const ep of entryPoints) {
        if (
          ep &&
          typeof ep === "object" &&
          (ep as { entryPointType?: unknown }).entryPointType === "video" &&
          typeof (ep as { uri?: unknown }).uri === "string"
        ) {
          return (ep as { uri: string }).uri;
        }
      }
    }
  }
  if (typeof event.hangoutLink === "string") return event.hangoutLink;
  return null;
}

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

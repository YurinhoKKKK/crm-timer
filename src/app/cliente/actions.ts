"use server";

import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase-server";
import {
  CLIENT_SESSION_COOKIE as SESSION_COOKIE,
  PORTAL_PROGRESS_PAGE,
  PORTAL_MEETINGS_PAGE,
  type PortalProgress,
  type PortalMeetings,
  type PortalPastMeetings,
  type ListingValidationEvent,
} from "@/lib/client-portal";

// Ações do PORTAL DO CLIENTE (passo 25). O cliente não tem conta: o login
// valida token + senha no banco (client_portal_login, com trava anti força-
// bruta) e o segredo da sessão fica num cookie HttpOnly — nunca em URL nem
// acessível a JavaScript. A senha só trafega no corpo do POST (HTTPS).

export async function clientPortalLogin(
  token: string,
  password: string
): Promise<{ error: string | null }> {
  if (!token || !password) return { error: "Informe a senha." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("client_portal_login", {
    p_token: token,
    p_password: password,
  });
  if (error) return { error: "Não foi possível validar o acesso. Tente novamente." };

  const row = (data as { result: string; secret: string | null }[] | null)?.[0];
  if (row?.result === "ok" && row.secret) {
    cookies().set(SESSION_COOKIE, row.secret, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/cliente",
      maxAge: 7 * 24 * 60 * 60, // mesma validade da sessão no banco
    });
    return { error: null };
  }
  if (row?.result === "locked") {
    return {
      error:
        "Muitas tentativas de senha. Por segurança, o acesso ficou bloqueado por 15 minutos.",
    };
  }
  // Token inexistente/revogado e senha errada respondem igual (sem sondagem).
  return { error: "Senha incorreta ou link inválido." };
}

export async function clientPortalLogout(): Promise<void> {
  cookies().set(SESSION_COOKIE, "", { path: "/cliente", maxAge: 0 });
}

// Página seguinte do feed "Andamento" (passo 25.1). O segredo da sessão vem
// SEMPRE do cookie HttpOnly (nunca do client); client_portal_progress
// (SECURITY DEFINER) valida a sessão e escopa à empresa do token. Sessão
// inválida/expirada => null (o feed para de crescer; o refresh cai na senha).
export async function clientPortalProgressPage(
  token: string,
  offset: number
): Promise<PortalProgress | null> {
  const secret = cookies().get(SESSION_COOKIE)?.value ?? null;
  if (!secret || !token) return null;

  const supabase = await createClient();
  const { data } = await supabase.rpc("client_portal_progress", {
    p_token: token,
    p_session: secret,
    p_limit: PORTAL_PROGRESS_PAGE,
    p_offset: Math.max(0, Math.floor(offset)),
  });
  return (data as PortalProgress | null) ?? null;
}

// --- Validação das listagens (passo 33) ------------------------------------
// O VEREDITO do cliente sobre uma listagem (aprovar / solicitar ajuste /
// contestar). Append-only: cada ação é um evento imutável. A empresa e a
// autoria são carimbadas no banco pela SESSÃO (nunca do navegador); a função
// client_portal_listing_validate valida que o item é da empresa do token e que
// o evento é coerente com o estado do item.

const VALIDATION_ERROR: Record<string, string> = {
  sessao: "Sua sessão expirou. Recarregue a página e entre de novo.",
  item: "Não foi possível identificar esta listagem. Recarregue a página.",
  estado: "Esta ação não é válida para esta listagem. Recarregue a página.",
  tipo: "Ação inválida.",
  comentario: "Escreva um comentário para a equipe.",
  longo: "O comentário pode ter no máximo 2000 caracteres.",
  limite:
    "Você fez muitas ações em pouco tempo. Aguarde um instante e continue de onde parou.",
};

export async function clientPortalValidateListing(
  token: string,
  listingResultId: string,
  event: ListingValidationEvent,
  comment: string
): Promise<{ error: string | null }> {
  const secret = cookies().get(SESSION_COOKIE)?.value ?? null;
  if (!secret || !token) return { error: VALIDATION_ERROR.sessao };

  const trimmed = comment.trim();
  if (event !== "aprovado" && !trimmed) {
    return { error: VALIDATION_ERROR.comentario };
  }
  if (trimmed.length > 2000) return { error: VALIDATION_ERROR.longo };

  const h = headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("client_portal_listing_validate", {
    p_token: token,
    p_session: secret,
    p_listing_result: listingResultId,
    p_event_type: event,
    p_comment: trimmed || null,
    p_ip: ip,
    p_user_agent: h.get("user-agent"),
  });
  if (error) {
    return { error: "Não foi possível registrar. Tente novamente." };
  }

  const res = data as { ok: boolean; error?: string } | null;
  if (!res?.ok) {
    return { error: VALIDATION_ERROR[res?.error ?? ""] ?? "Não foi possível registrar." };
  }
  return { error: null };
}

// "Ver mais" das reuniões ANTERIORES (as próximas vêm inteiras no primeiro
// load). O segredo vem SEMPRE do cookie HttpOnly; a função no banco deriva a
// empresa da sessão. Sessão inválida => null (o histórico para de crescer).
export async function clientPortalMeetingsPage(
  token: string,
  offset: number
): Promise<PortalPastMeetings | null> {
  const secret = cookies().get(SESSION_COOKIE)?.value ?? null;
  if (!secret || !token) return null;

  const supabase = await createClient();
  const { data } = await supabase.rpc("client_portal_meetings", {
    p_token: token,
    p_session: secret,
    p_limit: PORTAL_MEETINGS_PAGE,
    p_offset: Math.max(0, Math.floor(offset)),
  });
  return (data as PortalMeetings | null)?.past ?? null;
}

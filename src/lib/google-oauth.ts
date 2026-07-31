import "server-only";
import crypto from "node:crypto";

// =====================================================================
// OAuth do Google Calendar — ETAPA 1 (só escrita). SERVER-ONLY.
//
// O import "server-only" acima FAZ O BUILD FALHAR se este módulo for puxado
// para um componente client. É a barreira que sustenta a promessa combinada:
// token e client_secret nunca chegam ao navegador. Todo token só transita aqui
// e nas rotas /api/google/*.
//
// Escopos:
//   - calendar.events.owned — cria/gere os eventos que a própria conta cria.
//     PERMITE ler esses eventos, mas NÃO lemos agenda nesta etapa (disciplina;
//     ver migration 0043). É o único escopo SENSÍVEL, e já existia.
//   - openid + email — SÓ identidade (o endereço de e-mail da conta). Não é
//     agenda nem dado sensível; serve para mostrar QUAL conta foi conectada e
//     alertar quando ela difere do e-mail do usuário no sistema (muita gente
//     tem conta pessoal + da empresa; conectar a errada seria falha silenciosa).
// LEMBRETE: openid e email precisam estar declarados no Google Cloud Console
// (OAuth consent screen / Data Access), senão o consentimento diverge do código.
// =====================================================================

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events.owned",
  "openid",
  "email",
];

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

// Cookie httpOnly que carrega o nonce do fluxo. Path restrito às rotas do Google.
export const NONCE_COOKIE = "g_oauth_nonce";
export const NONCE_COOKIE_PATH = "/api/google";
const STATE_MAX_AGE_MS = 10 * 60 * 1000; // o callback tem 10 min para voltar

export class GoogleError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "GoogleError";
    this.code = code;
  }
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new GoogleError(`Configuração ausente no servidor (${name}).`);
  return v;
}

export function siteUrl(): string {
  return env("NEXT_PUBLIC_SITE_URL").replace(/\/+$/, "");
}

// Redirect derivado do SITE_URL — não é variável própria (evita sincronizar dois
// lugares). Precisa estar registrado no Google Cloud Console (local e prod).
export function redirectUri(): string {
  return `${siteUrl()}/api/google/callback`;
}

// ---------------------------------------------------------------------
// state assinado (HMAC-SHA256) — proteção CSRF
// ---------------------------------------------------------------------
function hmac(payload: string): string {
  return crypto
    .createHmac("sha256", env("GOOGLE_OAUTH_STATE_SECRET"))
    .update(payload)
    .digest("base64url");
}

export function newNonce(): string {
  return crypto.randomBytes(32).toString("hex");
}

// Empacota {uid, nonce, iat} e assina. O nonce também vai num cookie httpOnly;
// o callback exige que os dois batam (state + cookie) e que o uid seja o da
// sessão atual — assim um callback avulso ou de outra sessão é recusado.
export function signState(data: { uid: string; nonce: string }): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: data.uid, nonce: data.nonce, iat: Date.now() })
  ).toString("base64url");
  return `${payload}.${hmac(payload)}`;
}

export function verifyState(
  state: string
): { uid: string; nonce: string } | null {
  const dot = state.indexOf(".");
  if (dot < 0) return null;
  const payload = state.slice(0, dot);
  const sig = state.slice(dot + 1);

  const expected = hmac(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let obj: { uid?: unknown; nonce?: unknown; iat?: unknown };
  try {
    obj = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return null;
  }
  if (
    typeof obj.uid !== "string" ||
    typeof obj.nonce !== "string" ||
    typeof obj.iat !== "number"
  ) {
    return null;
  }
  if (Date.now() - obj.iat > STATE_MAX_AGE_MS) return null;
  return { uid: obj.uid, nonce: obj.nonce };
}

// ---------------------------------------------------------------------
// URL de autorização
// ---------------------------------------------------------------------
export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env("GOOGLE_CLIENT_ID"),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline", // queremos refresh token
    // select_account: deixa o usuário ESCOLHER a conta (essencial p/ quem tem
    // conta pessoal + da empresa). consent: força o consentimento -> garante o
    // refresh token mesmo em reconexões.
    prompt: "select_account consent",
    include_granted_scopes: "false",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

// ---------------------------------------------------------------------
// Troca de code / refresh / revogação
// ---------------------------------------------------------------------
export type TokenSet = {
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
  scope: string;
  email: string | null; // da conta conectada (via id_token), quando openid+email
};

// Extrai o e-mail do id_token (JWT) devolvido no token exchange quando o escopo
// inclui openid+email. Não verificamos a assinatura: o id_token veio DIRETO do
// endpoint de token do Google, por TLS servidor-a-servidor — não passou pelo
// navegador. Só decodificamos o payload para ler o e-mail.
function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  const parts = idToken.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString()
    ) as { email?: unknown };
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

async function tokenRequest(
  body: URLSearchParams,
  falha: string
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });
  } catch {
    throw new GoogleError("Não foi possível falar com o Google. Tente de novo.");
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof json.error === "string" ? json.error : undefined;
    const desc =
      typeof json.error_description === "string"
        ? (json.error_description as string)
        : falha;
    throw new GoogleError(desc, code);
  }
  return json;
}

export async function exchangeCode(code: string): Promise<TokenSet> {
  const json = await tokenRequest(
    new URLSearchParams({
      code,
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
    "Falha ao concluir a conexão com o Google."
  );
  return {
    access_token: String(json.access_token ?? ""),
    refresh_token:
      typeof json.refresh_token === "string" ? json.refresh_token : null,
    expires_in: typeof json.expires_in === "number" ? json.expires_in : 3600,
    scope:
      typeof json.scope === "string" ? json.scope : GOOGLE_SCOPES.join(" "),
    email: emailFromIdToken(json.id_token),
  };
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<{ access_token: string; expires_in: number }> {
  const json = await tokenRequest(
    new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    "Falha ao renovar o acesso ao Google."
  );
  return {
    access_token: String(json.access_token ?? ""),
    expires_in: typeof json.expires_in === "number" ? json.expires_in : 3600,
  };
}

// Revoga o grant no Google. Revogar o refresh token derruba o acesso inteiro.
// Retorna true só se o Google confirmou (2xx). Nunca lança: a desconexão local
// acontece de qualquer forma; o chamador audita a falha.
export async function revokeToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function expiryFromNow(expiresIn: number): string {
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

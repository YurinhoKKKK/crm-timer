import { timingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";

// Utilidades compartilhadas pelas rotas de INTAKE do CRM comercial
// (/api/crm/companies e /api/crm/companies/check-duplicate).
//
// Autenticação por SEGREDO COMPARTILHADO em cabeçalho, comparado de forma
// SEGURA (tempo constante). O segredo mora em CRM_INTAKE_SECRET (env, nunca no
// código, nunca no navegador). "quem" chamou é registrado a partir do IP e de um
// cabeçalho livre de origem.

// Cabeçalho que carrega o segredo compartilhado.
export const CRM_SECRET_HEADER = "x-crm-secret";
// Cabeçalho livre com o identificador do chamador (ex.: "crm-comercial"). Só
// para auditoria — não é credencial.
export const CRM_SOURCE_HEADER = "x-crm-source";

// Comparação em tempo constante. O check de tamanho vaza só o COMPRIMENTO (não o
// conteúdo) e é exigido porque timingSafeEqual requer buffers do mesmo tamanho.
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Verifica o segredo. Devolve null se OK; senão, a resposta HTTP a retornar.
//  · 500 se o servidor não tem o segredo configurado (misconfig).
//  · 401 se o cabeçalho falta ou não bate.
export function checkCrmSecret(req: NextRequest): NextResponse | null {
  const expected = process.env.CRM_INTAKE_SECRET;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "server_misconfig", message: "Integração não configurada no servidor." },
      { status: 500 }
    );
  }
  const got = req.headers.get(CRM_SECRET_HEADER) ?? "";
  if (!got || !safeEqual(got, expected)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized", message: "Segredo inválido." },
      { status: 401 }
    );
  }
  return null;
}

// Identificador de origem (cabeçalho livre) — só auditoria. Truncado.
export function sourceOf(req: NextRequest): string | null {
  const s = req.headers.get(CRM_SOURCE_HEADER);
  return s ? s.slice(0, 120) : null;
}

// IP do chamador (primeiro de x-forwarded-for). É hasheado no banco; nunca
// gravamos o IP cru.
export function ipOf(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim() || null;
  return req.headers.get("x-real-ip");
}

// Mapa código-de-erro-da-RPC -> status HTTP. A RPC devolve { ok:false, error }.
export function statusForError(error: string | undefined): number {
  switch (error) {
    case undefined:
      return 200;
    case "validation":
      return 422;
    case "number_in_use":
    case "cnpj_in_use":
    case "duplicate":
      return 409;
    case "rate_limited":
      return 429;
    case "unauthorized":
      return 401;
    case "internal":
      return 500;
    default:
      return 400;
  }
}

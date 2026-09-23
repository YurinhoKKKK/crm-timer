import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { checkCrmSecret, sourceOf, ipOf, statusForError } from "@/lib/crm-intake";

// INTAKE do CRM comercial — CONFERÊNCIA DE DUPLICADO. Recebe uma razão social e
// devolve as empresas PARECIDAS já existentes (id, nome, grupo, similarity).
// Comparação tolerante (ignora maiúsculas, acentos, pontuação e o número do
// início do nome). É consultiva: NÃO cria nada. A criação faz o próprio bloqueio.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const unauthorized = checkCrmSecret(req);
  if (unauthorized) return unauthorized;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "bad_json", message: "Corpo não é um JSON válido." },
      { status: 400 }
    );
  }
  const obj =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const razao = obj.razao_social;
  if (typeof razao !== "string") {
    return NextResponse.json(
      { ok: false, error: "validation", message: "Informe razao_social (texto)." },
      { status: 422 }
    );
  }
  // cnpj é OPCIONAL nesta conferência. Aceita com ou sem máscara; a RPC
  // normaliza e sinaliza a correspondência por CNPJ (certeza) além do nome.
  const cnpj = typeof obj.cnpj === "string" ? obj.cnpj : null;

  let supabase;
  try {
    supabase = createAdminClient();
  } catch {
    return NextResponse.json(
      { ok: false, error: "server_misconfig", message: "Integração não configurada no servidor." },
      { status: 500 }
    );
  }
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "server_misconfig", message: "Integração não configurada no servidor." },
      { status: 500 }
    );
  }

  const { data, error } = await supabase.rpc("crm_intake_check_duplicate", {
    p_razao: razao,
    p_source: sourceOf(req),
    p_ip: ipOf(req),
    p_cnpj: cnpj,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, error: "rpc_error", message: "Falha ao processar a solicitação." },
      { status: 502 }
    );
  }

  const result = (data ?? { ok: false, error: "internal" }) as {
    ok: boolean;
    error?: string;
  };
  const status = result.ok ? 200 : statusForError(result.error);
  return NextResponse.json(result, { status });
}

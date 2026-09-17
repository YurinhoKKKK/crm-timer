import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { checkCrmSecret, sourceOf, ipOf, statusForError } from "@/lib/crm-intake";

// INTAKE do CRM comercial — CRIAÇÃO de empresa fechada, em "On Boarding".
//
// Porta ESTREITA: valida o segredo, repassa o corpo para a RPC crm_intake_create
// (SECURITY DEFINER, service_role) e devolve o resultado. TODA a lógica —
// validação, dedup, número em uso, rate limit, transação e auditoria — mora na
// RPC. Aqui não há regra de negócio nem escrita direta.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const unauthorized = checkCrmSecret(req);
  if (unauthorized) return unauthorized;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "bad_json", message: "Corpo não é um JSON válido." },
      { status: 400 }
    );
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json(
      { ok: false, error: "bad_json", message: "O corpo deve ser um objeto JSON." },
      { status: 400 }
    );
  }

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

  const { data, error } = await supabase.rpc("crm_intake_create", {
    p_payload: payload,
    p_source: sourceOf(req),
    p_ip: ipOf(req),
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
  const status = result.ok ? 201 : statusForError(result.error);
  return NextResponse.json(result, { status });
}

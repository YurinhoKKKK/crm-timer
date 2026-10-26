import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { clampMonth } from "@/lib/followup";
import {
  loadPontuacaoExport,
  buildPontuacaoWorkbook,
  pontuacaoExportFilename,
} from "@/lib/pontuacao-export";

// Download da Pontuação do Acompanhamento em Excel. Admin-only: além do gate
// is_admin dentro das RPCs, confirmamos o cargo aqui e devolvemos 403 (é uma
// rota de download, não uma página). O mês vem em ?mes=AAAA-MM (clampeado à
// janela válida: setembro/2026 → mês corrente).
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const month = clampMonth(params.get("mes") ?? undefined);
  // Filtros do quadro (decisão 4). Aceita só UUID; qualquer outra coisa vira null.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const asUuid = (v: string | null) => (v && UUID.test(v) ? v : null);
  const consultant = asUuid(params.get("consultor"));
  const collaborator = asUuid(params.get("colaborador"));

  const data = await loadPontuacaoExport(supabase, month, consultant, collaborator);
  const buffer = await buildPontuacaoWorkbook(data, month);

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${pontuacaoExportFilename(month)}"`,
      "Cache-Control": "no-store",
    },
  });
}

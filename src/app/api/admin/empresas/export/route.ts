import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import {
  loadEmpresasExportData,
  buildEmpresasWorkbook,
  empresasExportFilename,
} from "@/lib/empresas-export";

// Download do quadro de empresas em Excel. Admin-only: além da RLS (que já
// escopa os vínculos), confirmamos o cargo aqui e devolvemos 403 em vez de
// redirecionar — é uma rota de download, não uma página.
export const dynamic = "force-dynamic";

export async function GET() {
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

  const data = await loadEmpresasExportData(supabase);
  const buffer = await buildEmpresasWorkbook(data);

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${empresasExportFilename()}"`,
      "Cache-Control": "no-store",
    },
  });
}

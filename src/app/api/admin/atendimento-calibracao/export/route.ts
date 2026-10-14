import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { resolveDashboardPeriod } from "@/lib/period";
import {
  buildAttendanceWorkbook,
  attendanceExportFilename,
  type AttendanceExportRow,
} from "@/lib/attendance-export";

// Download da calibração de atendimento em Excel. Admin-only (confirma o cargo e
// devolve 403, por ser rota de download). Respeita o período da URL (mesmos
// parâmetros do PeriodPicker) e exporta em nível de DIA.
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

  const sp = new URL(request.url).searchParams;
  const period = resolveDashboardPeriod({
    periodo: sp.get("periodo") ?? undefined,
    de: sp.get("de") ?? undefined,
    ate: sp.get("ate") ?? undefined,
  });

  const { data, error } = await supabase.rpc("attendance_admin_report", {
    p_start: period.start,
    p_end: period.end,
    p_bucket: "day",
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows: AttendanceExportRow[] = ((data as AttendanceExportRow[]) ?? []).map((r) => ({
    user_name: r.user_name,
    company_number: r.company_number,
    company_name: r.company_name,
    bucket: r.bucket,
    minutes: Number(r.minutes) || 0,
    auto_closed: !!r.auto_closed,
    entries: Number(r.entries) || 0,
  }));

  const buffer = await buildAttendanceWorkbook(rows, { periodLabel: period.label });

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${attendanceExportFilename()}"`,
      "Cache-Control": "no-store",
    },
  });
}

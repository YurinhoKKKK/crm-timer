import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { resolvePeople } from "@/lib/creator";
import {
  resolvePeriodValue,
  periodPhrase,
  DASHBOARD_PERIOD_CONFIG,
} from "@/lib/period";
import {
  normalizeListOrder,
  METRIC_LABEL,
  type CellMetric,
  type PanelDimension,
} from "@/app/admin/atrasos/atrasos-shared";
import { loadCellTasks } from "@/app/admin/atrasos/actions";
import {
  loadAtrasosExportData,
  buildAtrasosWorkbook,
  buildAtrasosCellWorkbook,
  atrasosExportFilename,
} from "@/lib/atrasos-export";

// Download da auditoria de atrasos em Excel. Admin-only: além da RLS/gate das
// RPCs, confirmamos o cargo aqui e devolvemos 403 (é rota de download, não
// página). Os filtros vêm na query (mesmos nomes da tela).
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

  const url = new URL(request.url);
  const sp = Object.fromEntries(url.searchParams.entries());
  const period = resolvePeriodValue(sp, DASHBOARD_PERIOD_CONFIG);

  const commonFilters = {
    start: period.start,
    end: period.end,
    includeStandard: (sp.fpadrao ?? "") === "1",
    status: sp.fstatus ?? "",
    creatorId: sp.fcriador ?? "",
    responsibleId: sp.fresp ?? "",
    companyId: sp.fempresa ?? "",
    type: sp.ftipo ?? "",
    search: sp.fbusca ?? "",
  };

  let buffer: Awaited<ReturnType<typeof buildAtrasosWorkbook>>;

  // Recorte de uma célula do resumo (drill-down): aba única com aquelas tarefas.
  // cpers ausente = modo global ('all', totais do cabeçalho).
  if (sp.cdim && sp.cmet) {
    const cell = await loadCellTasks({
      ...commonFilters,
      dimension: sp.cdim as PanelDimension,
      person: sp.cpers ?? "",
      metric: sp.cmet as CellMetric,
      limit: 5000,
      offset: 0,
    });
    const metricLabel = METRIC_LABEL[sp.cmet as CellMetric] ?? "Tarefas";
    let heading = `${metricLabel} (${cell.total})`;
    if (sp.cpers) {
      const people = await resolvePeople(supabase, [sp.cpers]);
      const personName = people.get(sp.cpers)?.name ?? "(pessoa)";
      heading = `${personName} · ${metricLabel} (${cell.total})`;
    }
    buffer = await buildAtrasosCellWorkbook({ rows: cell.rows, heading });
  } else {
    const data = await loadAtrasosExportData(supabase, {
      ...commonFilters,
      order: normalizeListOrder(sp.fordem),
    });
    buffer = await buildAtrasosWorkbook({ ...data, periodLabel: periodPhrase(period) });
  }

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${atrasosExportFilename()}"`,
      "Cache-Control": "no-store",
    },
  });
}

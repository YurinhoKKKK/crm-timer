import React from "react";
import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase-server";
import { loadCompanyCentral } from "@/lib/company-central";
import { loadCompanyNotes } from "@/lib/notes";
import { noteAreaLabel, NOTE_AREA_COLORS } from "@/lib/note-areas";
import { resolvePeriodValue, brtToday } from "@/lib/period";
import {
  EXPORT_PERIOD_CONFIG,
  PDF_INCLUDE_ACTIVITIES,
  PDF_INCLUDE_NOTES,
  PDF_MAX_ITEMS,
} from "@/lib/historico-pdf";
import {
  htmlToPdfBlocks,
  brtDateKey,
  brtNowStamp,
  buildHistoricoFilename,
  groupByMonth,
  stampHistoricoFooter,
  type ActivityEntry,
  type NoteEntry,
} from "@/lib/historico-pdf-build";
import HistoricoPdfDocument, {
  type CoverInfo,
} from "@/components/pdf/HistoricoPdfDocument";

// Exportação em PDF do histórico completo de uma empresa (Histórico de
// atividades + Anotações), numa linha do tempo única. USO INTERNO.
//
// Geração no servidor (runtime nodejs; o @react-pdf/renderer e o parser de HTML
// pedem Node). Os dados são buscados com a SESSÃO do usuário — mesmas RPCs/
// loaders e a mesma RLS da tela da empresa; nada de service_role. Quem gera vê
// no PDF exatamente o que veria na tela. O gate replica o da página (admin), e
// a RLS escopa o acesso à empresa (empresa inalcançável → 404).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ActivityRpcItem = {
  id: string;
  type: string;
  typeLabel: string;
  at: string;
  authorName: string | null;
  summary: string;
  content: string;
};

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const companyId = params.id;
  const supabase = await createClient();

  // --- Gate: autenticado + admin (replica a página; não redireciona) ---
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  // --- Período (mesmo PeriodPicker do modal; params x*) e o que incluir ---
  const sp = new URL(request.url).searchParams;
  const period = resolvePeriodValue(
    {
      xperiodo: sp.get("xperiodo") ?? undefined,
      xde: sp.get("xde") ?? undefined,
      xate: sp.get("xate") ?? undefined,
      xmes: sp.get("xmes") ?? undefined,
    },
    EXPORT_PERIOD_CONFIG
  );
  const inc = (sp.get("inc") ?? "").split(",").map((s) => s.trim());
  const includeActivities = inc.includes(PDF_INCLUDE_ACTIVITIES);
  const includeNotes = inc.includes(PDF_INCLUDE_NOTES);
  if (!includeActivities && !includeNotes) {
    return NextResponse.json(
      { error: "Selecione ao menos um conteúdo (Atividades ou Anotações)." },
      { status: 400 }
    );
  }

  // --- Cabeçalho (mesmo loader da tela; RLS decide o acesso) ---
  const central = await loadCompanyCentral(
    supabase,
    { id: profile.id, full_name: profile.full_name },
    companyId,
    { start: null, end: null },
    true
  );
  if (central.notFound || !central.data) {
    return NextResponse.json({ error: "Empresa não encontrada." }, { status: 404 });
  }
  const company = central.data.company;

  // Nome do grupo atual (não exposto pelo loader) — consulta própria, mesma RLS.
  const { data: groupRow } = await supabase
    .from("companies")
    .select("group:company_groups(name)")
    .eq("id", companyId)
    .maybeSingle();
  const rawGroup = (groupRow as { group?: { name?: string } | { name?: string }[] } | null)
    ?.group;
  const groupName = Array.isArray(rawGroup)
    ? rawGroup[0]?.name ?? null
    : rawGroup?.name ?? null;

  const start = period.start; // YYYY-MM-DD BRT (inclusivo) ou null (tudo)
  const end = period.end;

  // --- Anotações no período (mesmo loader; filtro por data = o da tela) ---
  let noteEntries: NoteEntry[] = [];
  if (includeNotes) {
    const allNotes = await loadCompanyNotes(supabase, companyId);
    const inPeriod = allNotes.filter((n) => {
      if (!start && !end) return true;
      const day = brtDateKey(n.createdAtISO);
      if (start && day < start) return false;
      if (end && day > end) return false;
      return true;
    });
    noteEntries = inPeriod.map((n) => ({
      kind: "note",
      at: n.createdAtISO,
      authorName: n.authorName,
      blocks: htmlToPdfBlocks(n.contentHtml),
      areas: n.areas.map((a) => ({
        label: noteAreaLabel(a),
        bg: NOTE_AREA_COLORS[a]?.bg ?? "#F5F5F4",
        fg: NOTE_AREA_COLORS[a]?.fg ?? "#2B333B",
      })),
      visibleToClient: n.visibleToClient,
      attachments: n.attachments.map((a) => a.name),
      edited: !!n.updatedAtISO && n.updatedAtISO !== n.createdAtISO,
    }));
  }

  // --- Atividades no período (RPC paginada até o fim; total do banco) ---
  let activityEntries: ActivityEntry[] = [];
  let activitiesTotal = 0;
  if (includeActivities) {
    const PAGE = 100; // o banco limita p_limit a 100
    const first = await fetchActivityPage(supabase, companyId, start, end, 0, PAGE);
    if (first.error) {
      return NextResponse.json(
        { error: "Não foi possível carregar o histórico." },
        { status: 500 }
      );
    }
    activitiesTotal = first.total;

    // Teto duro ANTES de puxar tudo: evita montar um PDF gigante.
    const combined = activitiesTotal + noteEntries.length;
    if (combined > PDF_MAX_ITEMS) {
      return NextResponse.json(
        {
          error: `O período selecionado tem ${combined} itens (limite de ${PDF_MAX_ITEMS}). Reduza o período e tente de novo.`,
        },
        { status: 400 }
      );
    }

    const items: ActivityRpcItem[] = [...first.items];
    for (let offset = PAGE; items.length < activitiesTotal; offset += PAGE) {
      const next = await fetchActivityPage(
        supabase,
        companyId,
        start,
        end,
        offset,
        PAGE
      );
      if (next.error || next.items.length === 0) break;
      items.push(...next.items);
    }
    activityEntries = items.map((it) => ({
      kind: "activity",
      at: it.at,
      typeLabel: it.typeLabel || it.type,
      authorName: it.authorName || "—",
      content: it.content || it.summary || "",
    }));
  } else {
    // Só anotações: ainda vale o teto.
    if (noteEntries.length > PDF_MAX_ITEMS) {
      return NextResponse.json(
        {
          error: `O período selecionado tem ${noteEntries.length} itens (limite de ${PDF_MAX_ITEMS}). Reduza o período e tente de novo.`,
        },
        { status: 400 }
      );
    }
  }

  // --- Monta a linha do tempo e renderiza ---
  const groups = groupByMonth([...activityEntries, ...noteEntries]);
  const cover: CoverInfo = {
    companyName: company.name,
    groupName,
    consultants: central.data.consultants.map((c) => c.name),
    collaborators: central.data.collaboratorResponsibles.map((c) => c.name),
    entryDateISO: company.createdAt ?? null,
    periodLabel: period.label,
    generatedBy: profile.full_name,
    generatedAtStamp: brtNowStamp(),
  };

  const body = await renderToBuffer(
    React.createElement(HistoricoPdfDocument, { cover, groups }) as React.ReactElement
  );
  // Carimba o rodapé ("Documento interno…" + "Página X de Y") em cada página.
  const buffer = await stampHistoricoFooter(new Uint8Array(body));

  const filename = buildHistoricoFilename(company.name, brtToday());
  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

async function fetchActivityPage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  from: string | null,
  to: string | null,
  offset: number,
  limit: number
): Promise<{ error: boolean; total: number; items: ActivityRpcItem[] }> {
  const { data, error } = await supabase.rpc("company_activity_feed", {
    p_company: companyId,
    p_limit: limit,
    p_offset: offset,
    p_search: null,
    p_types: null,
    p_author: null,
    p_from: from,
    p_to: to,
  });
  if (error) return { error: true, total: 0, items: [] };
  const payload = (data as { total?: number; items?: ActivityRpcItem[] } | null) ?? {};
  return { error: false, total: payload.total ?? 0, items: payload.items ?? [] };
}

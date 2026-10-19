import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import { loadCompanyGroups, resolveCompanyGroupId } from "@/lib/company-groups";
import CsBoard, { type CsRow, type Responsible } from "./CsBoard";
import CsTabs from "./CsTabs";

// Quadro "Sucesso do Cliente" (CS) — FATIA 1, admin-only e somente leitura. É uma
// VISÃO sobre as MESMAS empresas do quadro /admin/empresas (nada é copiado): a
// RPC cs_board() lê ao vivo companies, company_details e company_contract_values,
// com responsáveis agregados em JSON. Uma mudança feita em Empresas aparece aqui
// ao recarregar.
//
// force-dynamic: os dados mudam em Empresas/Informações; a leitura inicial não
// deve servir de cache.
export const dynamic = "force-dynamic";

type RpcRow = {
  id: string;
  name: string;
  group_id: string | null;
  started_on: string | null;
  monthly_value: string | null;
  project_value: string | null;
  installments: number | null;
  months_total: number | null;
  period_days: number | null;
  nps_status: string | null;
  meeting_on: string | null;
  responsibles: Responsible[] | null;
  cs_note_count: number | null;
  effective_end: string | null;
  paused_days: number | null;
  pause_no_date: boolean | null;
};

export default async function SucessoDoClientePage() {
  // Admin-only: guardRole redireciona consultor/colaborador/pending como nas
  // demais rotas admin. A RPC ainda recusa não-admin por dentro (defesa dupla).
  const { supabase, profile } = await guardRole(["admin"]);

  const [rpc, groups, labelRes] = await Promise.all([
    supabase.rpc("cs_board"),
    loadCompanyGroups(supabase),
    // ALERTA/RISCO são etiquetas manuais do catálogo; buscamos os ids por nome
    // (sem fixar uuid no código). O controle do quadro de CS só mexe nessas duas.
    supabase.from("labels").select("id, name").in("name", ["ALERTA", "RISCO"]),
  ]);

  const labelRows = (labelRes.data as { id: string; name: string }[] | null) ?? [];
  const alertaId = labelRows.find((l) => l.name.toUpperCase() === "ALERTA")?.id ?? null;
  const riscoId = labelRows.find((l) => l.name.toUpperCase() === "RISCO")?.id ?? null;

  // Estado atual de ALERTA/RISCO por empresa (linhas em company_labels; admin lê
  // pela cl_select). Mapa company_id → Set<label_id>.
  const wantIds = [alertaId, riscoId].filter((x): x is string => !!x);
  const byCompany = new Map<string, Set<string>>();
  if (wantIds.length > 0) {
    const { data: clData } = await supabase
      .from("company_labels")
      .select("company_id, label_id")
      .in("label_id", wantIds);
    for (const r of (clData as { company_id: string; label_id: string }[] | null) ?? []) {
      const set = byCompany.get(r.company_id) ?? new Set<string>();
      set.add(r.label_id);
      byCompany.set(r.company_id, set);
    }
  }

  const rows = (rpc.data as RpcRow[] | null) ?? [];
  const companies: CsRow[] = rows.map((r) => {
    const set = byCompany.get(r.id);
    return {
      id: r.id,
      name: r.name,
      // Única porta de leitura empresa→grupo (porta aberta a M:N), igual a Empresas.
      groupId: resolveCompanyGroupId({ group_id: r.group_id }),
      startedOn: r.started_on,
      monthlyValue: r.monthly_value,
      projectValue: r.project_value,
      installments: r.installments,
      monthsTotal: r.months_total,
      periodDays: r.period_days,
      npsStatus: (r.nps_status as CsRow["npsStatus"]) ?? null,
      meetingOn: r.meeting_on,
      responsibles: r.responsibles ?? [],
      csNoteCount: r.cs_note_count ?? 0,
      alerta: !!(alertaId && set?.has(alertaId)),
      risco: !!(riscoId && set?.has(riscoId)),
      effectiveEnd: r.effective_end,
      pausedDays: r.paused_days ?? 0,
      pauseNoDate: !!r.pause_no_date,
    };
  });

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title="Sucesso do Cliente"
      subtitle="Visão sobre as empresas: responsáveis, entrada e contrato. As seções e os dados acompanham o quadro de Empresas."
      back={{ href: "/admin", label: "Dashboard" }}
    >
      <CsTabs active="clientes" />
      <CsBoard
        companies={companies}
        groups={groups}
        userId={profile.id}
        alertaId={alertaId}
        riscoId={riscoId}
      />
    </AppShell>
  );
}

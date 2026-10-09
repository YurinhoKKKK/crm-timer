import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import { loadCompanyGroups, resolveCompanyGroupId } from "@/lib/company-groups";
import type { Label } from "@/lib/labels";
import { loadTrafficGroups, asCompanyGroup } from "@/lib/traffic";
import TrafficBoard, { type TrafficBoardRow } from "./TrafficBoard";

// Quadro "Tráfego" — admin + Gestor de Tráfego (Fatia 4). VISÃO sobre as MESMAS
// empresas do quadro de Empresas (nada é copiado), restrita às que contrataram
// Tráfego, com GRUPOS PRÓPRIOS (traffic_groups). A RPC traffic_board() é SECURITY
// DEFINER e entrega TUDO pronto — inclusive o grupo do Tráfego JÁ RESOLVIDO
// (traffic_group_id) e as etiquetas efetivas — para o gestor não precisar ler
// company_details/company_contracted_channels/company_labels/company_groups.
export const dynamic = "force-dynamic";

type RpcLabel = {
  id: string;
  name: string;
  bg_color: string;
  text_color: string;
  highlight: boolean;
};

type RpcRow = {
  id: string;
  name: string;
  group_id: string | null;
  synced: boolean | null;
  months_total: number | null;
  period_days: number | null;
  started_on: string | null; // 'AAAA-MM-DD' | null (data pura)
  ends_on: string | null; // 'AAAA-MM-DD' | null (data pura)
  manual_group_id: string | null;
  focus: string | null;
  platform: string | null;
  status: string | null;
  budget: string | null;
  history_count: number | null;
  traffic_note_count: number | null;
  labels: RpcLabel[] | null;
  traffic_group_id: string | null; // grupo do Tráfego JÁ RESOLVIDO no banco
};

export default async function TrafegoPage() {
  const { supabase, profile } = await guardRole(["admin", "gestor_trafego"]);
  const isAdmin = profile.role === "admin";

  const [rpc, trafficGroups] = await Promise.all([
    supabase.rpc("traffic_board"),
    loadTrafficGroups(supabase),
  ]);

  const rpcRows = (rpc.data as RpcRow[] | null) ?? [];

  const companies: TrafficBoardRow[] = rpcRows.map((r) => ({
    id: r.id,
    name: r.name,
    // Grupo NO TRÁFEGO: resolvido pelo banco (dispensa company_groups do lado do
    // gestor). null = "Sem grupo".
    groupId: r.traffic_group_id ?? null,
    synced: !!r.synced,
    monthsTotal: r.months_total,
    periodDays: r.period_days,
    startedOn: r.started_on,
    endsOn: r.ends_on,
    // Etiquetas efetivas vindas da própria RPC (DEFINER), não de company_labels.
    labels: ((r.labels ?? []) as Label[]),
    focus: (r.focus as TrafficBoardRow["focus"]) ?? null,
    platform: (r.platform as TrafficBoardRow["platform"]) ?? null,
    status: (r.status as TrafficBoardRow["status"]) ?? null,
    budget: r.budget,
    historyCount: r.history_count ?? 0,
    trafficNoteCount: r.traffic_note_count ?? 0,
  }));

  // Aviso (SÓ admin): grupos de Empresas COM empresas no quadro mas SEM
  // correspondência no Tráfego — as empresas caem em "Sem grupo". Depende de
  // company_groups (cg_select), que o gestor não lê; para ele fica vazio.
  const missing = new Set<string>();
  if (isAdmin) {
    const companyGroups = await loadCompanyGroups(supabase);
    const correspondence = new Map<string, string | null>();
    const groupNameById = new Map<string, string>();
    for (const g of companyGroups) {
      correspondence.set(g.id, g.traffic_group_id ?? null);
      groupNameById.set(g.id, g.name);
    }
    for (const r of rpcRows) {
      const empresaGroupId = resolveCompanyGroupId({ group_id: r.group_id });
      if (empresaGroupId && (correspondence.get(empresaGroupId) ?? null) === null) {
        missing.add(groupNameById.get(empresaGroupId) ?? "(grupo)");
      }
    }
  }

  return (
    <AppShell
      user={{
        name: profile.full_name,
        // guardRole garante admin | gestor_trafego aqui.
        role: profile.role as "admin" | "gestor_trafego",
        avatarUrl: profile.avatarUrl,
      }}
      title="Tráfego"
      subtitle="Visão da área de Tráfego Pago sobre as empresas que contrataram Tráfego. As seções têm grupos próprios; os dados acompanham o quadro de Empresas."
      back={isAdmin ? { href: "/admin", label: "Dashboard" } : undefined}
      wide
    >
      <TrafficBoard
        companies={companies}
        groups={trafficGroups.map(asCompanyGroup)}
        missingCorrespondence={Array.from(missing).sort((a, b) =>
          a.localeCompare(b, "pt-BR")
        )}
        userId={profile.id}
        canOpenCompany={isAdmin}
      />
    </AppShell>
  );
}

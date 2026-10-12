import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { Label } from "@/lib/labels";
import { loadDevGroups, asCompanyGroup } from "@/lib/dev";
import type { DevStatus } from "@/lib/dev-options";
import DevBoard, { type DevBoardRow } from "./DevBoard";

// Quadro "Desenvolvimento" (Etapa 1) — admin-only. VISÃO sobre as MESMAS empresas
// do quadro de Empresas (nada é copiado), restrita às que contrataram serviço de
// site (gestao_site e/ou desenvolvimento_site), com GRUPOS PRÓPRIOS (dev_groups) e
// movimentação 100% MANUAL. A RPC dev_board() é SECURITY DEFINER e entrega tudo
// pronto — o grupo JÁ RESOLVIDO (com o padrão Lista de Espera), o status e as
// etiquetas efetivas. Não-admin recebe o tratamento das rotas negadas (guardRole).
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
  group_id: string | null; // grupo do Desenvolvimento JÁ RESOLVIDO no banco
  status: string;
  labels: RpcLabel[] | null;
  history_count: number | null;
  // Etapa 2 (Prazo): o banco (dev_board) devolve tudo pronto — dias úteis usados,
  // total, se corre/já começou, a pausa manual (bool/motivo/quando/por quem) e a
  // previsão de entrega (data pura AAAA-MM-DD, só quando corre e não estourou).
  used_days: number | null;
  deadline_days: number | null;
  running: boolean | null;
  started_ever: boolean | null;
  manual_paused: boolean | null;
  pause_reason: string | null;
  paused_at: string | null;
  paused_by_name: string | null;
  deadline_forecast: string | null;
  // Etapa 3: nº de Atualizações da empresa COM a área 'site' (balão).
  site_note_count: number | null;
};

export default async function DesenvolvimentoPage() {
  const { supabase, profile } = await guardRole(["admin", "desenvolvedor"]);
  const isAdmin = profile.role === "admin";

  const [rpc, devGroups] = await Promise.all([
    supabase.rpc("dev_board"),
    loadDevGroups(supabase),
  ]);

  const rpcRows = (rpc.data as RpcRow[] | null) ?? [];

  const companies: DevBoardRow[] = rpcRows.map((r) => ({
    id: r.id,
    name: r.name,
    groupId: r.group_id ?? null,
    status: r.status as DevStatus,
    labels: (r.labels ?? []) as Label[],
    historyCount: r.history_count ?? 0,
    usedDays: r.used_days ?? 0,
    deadlineDays: r.deadline_days ?? 15,
    running: r.running ?? false,
    startedEver: r.started_ever ?? false,
    manualPaused: r.manual_paused ?? false,
    pauseReason: r.pause_reason,
    pausedAtISO: r.paused_at,
    pausedByName: r.paused_by_name,
    forecast: r.deadline_forecast,
    siteNoteCount: r.site_note_count ?? 0,
  }));

  return (
    <AppShell
      user={{
        name: profile.full_name,
        // guardRole garante admin | desenvolvedor aqui.
        role: profile.role as "admin" | "desenvolvedor",
        avatarUrl: profile.avatarUrl,
      }}
      title="Desenvolvimento"
      subtitle="Visão da área de Desenvolvimento sobre as empresas que contrataram serviço de site. As seções têm grupos próprios; a movimentação é manual."
      back={isAdmin ? { href: "/admin", label: "Dashboard" } : undefined}
      wide
    >
      <DevBoard
        companies={companies}
        groups={devGroups.map(asCompanyGroup)}
        userId={profile.id}
        canOpenCompany={isAdmin}
      />
    </AppShell>
  );
}

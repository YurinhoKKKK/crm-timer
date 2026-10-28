import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import { loadCompanyGroups } from "@/lib/company-groups";
import { resolvePeriodValue, CHURN_PERIOD_CONFIG } from "@/lib/period";
import PeriodPicker from "@/components/PeriodPicker";
import CsTabs from "../CsTabs";
import ChurnSummary, { type ChurnSummaryData } from "./ChurnSummary";
import ChurnBoard, { type ChurnRow } from "./ChurnBoard";

// Controle de Churn — 2ª aba do Sucesso do Cliente. Admin-only (guardRole + as
// RPCs recusam não-admin por dentro). Lê churn_board + churn_summary AO VIVO
// (receita perdida, meses etc. calculados no banco) filtrados pelo período da URL.
export const dynamic = "force-dynamic";

type BoardRpcRow = {
  id: string;
  company_id: string;
  company_name: string;
  churn_type: "finalizado" | "cancelado";
  churned_on: string | null;
  reason: string;
  seller_name: string | null;
  consultants: { id: string; name: string }[] | null;
  mrr: string | null;
  months_contracted: number | null;
  months_stayed: number | null;
  paused_days: number | null;
  lost_revenue: string | null;
  cs_note_count: number | null;
};

type SummaryRpcRow = {
  total: number;
  cancelados: number;
  finalizados: number;
  mrr_total: string;
  mrr_cancelados: string;
  mrr_finalizados: string;
  lost_revenue_total: string;
  reasons: Record<string, number> | null;
  n_sem_mrr: number;
  n_sem_periodo: number;
  n_motivo_nao_informado: number;
  n_sem_data: number;
};

export default async function ControleDeChurnPage({
  searchParams,
}: {
  searchParams: { periodo?: string; de?: string; ate?: string };
}) {
  const { supabase, profile } = await guardRole(["admin"]);

  const period = resolvePeriodValue(searchParams ?? {}, CHURN_PERIOD_CONFIG);

  const [boardRpc, summaryRpc, groups] = await Promise.all([
    supabase.rpc("churn_board", { p_start: period.start, p_end: period.end }),
    supabase.rpc("churn_summary", { p_start: period.start, p_end: period.end }),
    loadCompanyGroups(supabase),
  ]);

  const rows: ChurnRow[] = ((boardRpc.data as BoardRpcRow[] | null) ?? []).map((r) => ({
    id: r.id,
    companyId: r.company_id,
    companyName: r.company_name,
    churnType: r.churn_type,
    churnedOn: r.churned_on,
    reason: r.reason,
    sellerName: r.seller_name,
    consultants: r.consultants ?? [],
    mrr: r.mrr,
    monthsContracted: r.months_contracted,
    monthsStayed: r.months_stayed,
    pausedDays: r.paused_days ?? 0,
    lostRevenue: r.lost_revenue,
    csNoteCount: r.cs_note_count ?? 0,
  }));

  const sr = (summaryRpc.data as SummaryRpcRow[] | null)?.[0];
  const summary: ChurnSummaryData = {
    total: sr?.total ?? 0,
    cancelados: sr?.cancelados ?? 0,
    finalizados: sr?.finalizados ?? 0,
    mrrTotal: sr?.mrr_total ?? "0.00",
    mrrCancelados: sr?.mrr_cancelados ?? "0.00",
    mrrFinalizados: sr?.mrr_finalizados ?? "0.00",
    lostRevenueTotal: sr?.lost_revenue_total ?? "0.00",
    reasons: sr?.reasons ?? {},
    nSemMrr: sr?.n_sem_mrr ?? 0,
    nSemPeriodo: sr?.n_sem_periodo ?? 0,
    nMotivoNaoInformado: sr?.n_motivo_nao_informado ?? 0,
    nSemData: sr?.n_sem_data ?? 0,
  };

  // Nome/cor da seção vêm do grupo de Empresas correspondente (via churn_type),
  // NUNCA por nome fixo.
  const finalizadoGroup = groups.find((g) => g.churn_type === "finalizado") ?? null;
  const canceladoGroup = groups.find((g) => g.churn_type === "cancelado") ?? null;

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title="Sucesso do Cliente"
      subtitle="Controle de Churn: clientes que saíram, por período, com tempo de projeto, tempo permanecido e receita perdida."
      back={{ href: "/admin", label: "Dashboard" }}
      wide
    >
      <CsTabs active="churn" />
      <div className="mb-4">
        <PeriodPicker value={period} config={CHURN_PERIOD_CONFIG} />
      </div>
      <ChurnSummary summary={summary} showNoDate={period.kind === "tudo"} />
      <ChurnBoard
        rows={rows}
        finalizadoGroup={finalizadoGroup}
        canceladoGroup={canceladoGroup}
        userId={profile.id}
      />
    </AppShell>
  );
}

import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import CapacityView from "@/components/capacity/CapacityView";
import AttendanceCapacity, {
  type AtParams,
  type SummaryRow,
  type ClientRow,
  type PersonRow,
} from "@/components/capacity/AttendanceCapacity";
import { loadCapacity, ATTENDANCE_PERIOD_CONFIG } from "@/lib/capacity";
import { resolvePeriodValue, addDays, CAPACITY_TASKS_PERIOD_CONFIG } from "@/lib/period";

// Visão de capacidade da equipe — SÓ ADMIN. A rota é barrada NO SERVIDOR
// (guardRole), não só escondida do menu; as RPCs também checam is_admin() por
// dentro. Não é ranking de desempenho — é distribuição de carga.
//
// DOIS períodos independentes (PeriodPicker compartilhado): o das TAREFAS
// (periodo/de/ate, padrão 30 dias) e o do ATENDIMENTO por WhatsApp
// (wde/wate namespaced), para não misturar os dois controles.
export const dynamic = "force-dynamic";

export default async function CapacidadePage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const { supabase, profile } = await guardRole(["admin"]);

  // Tarefas: o modelo entrega `end` INCLUSIVO; team_capacity espera EXCLUSIVO →
  // soma 1 dia (preserva exatamente os números dos períodos antigos).
  const taskPeriod = resolvePeriodValue(searchParams ?? {}, CAPACITY_TASKS_PERIOD_CONFIG);
  const taskWindow = {
    start: taskPeriod.start,
    end: taskPeriod.end ? addDays(taskPeriod.end, 1) : null,
  };

  // Atendimento: as RPCs tratam p_end como INCLUSIVO → passa start/end direto.
  const atPeriod = resolvePeriodValue(searchParams ?? {}, ATTENDANCE_PERIOD_CONFIG);

  const [rows, paramsRes, summaryRes, clientsRes, peopleRes] = await Promise.all([
    loadCapacity(supabase, taskWindow),
    supabase.rpc("attendance_params_get"),
    supabase.rpc("attendance_capacity_summary", { p_start: atPeriod.start, p_end: atPeriod.end }),
    supabase.rpc("attendance_capacity_clients", { p_start: atPeriod.start, p_end: atPeriod.end }),
    supabase.rpc("attendance_capacity_people", { p_start: atPeriod.start, p_end: atPeriod.end }),
  ]);

  const params = (Array.isArray(paramsRes.data) ? paramsRes.data[0] : paramsRes.data) as AtParams | null;

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title="Capacidade da equipe"
      subtitle="Para distribuir carga e enxergar sobrecarga — não é ranking de desempenho."
    >
      <CapacityView rows={rows} period={taskPeriod} window={taskWindow} />

      <AttendanceCapacity
        period={atPeriod}
        params={params}
        summary={(summaryRes.data as SummaryRow[]) ?? []}
        clients={(clientsRes.data as ClientRow[]) ?? []}
        people={(peopleRes.data as PersonRow[]) ?? []}
      />
    </AppShell>
  );
}

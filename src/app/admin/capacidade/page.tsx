import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import CapacityView from "@/components/capacity/CapacityView";
import AttendanceCapacity, {
  type AtParams,
  type SummaryRow,
  type ClientRow,
  type PersonRow,
} from "@/components/capacity/AttendanceCapacity";
import { loadCapacity, clampCapacityPeriod } from "@/lib/capacity";
import { addDays, brtYesterday, brDate } from "@/lib/period";

// Visão de capacidade da equipe — SÓ ADMIN. A rota é barrada NO SERVIDOR
// (guardRole), não só escondida do menu; as RPCs também checam is_admin() por
// dentro. Não é ranking de desempenho — é distribuição de carga.
//
// A seção "Atendimento por WhatsApp" (etapa 3) tem período PRÓPRIO (wde/wate, estilo
// Dashboard; padrão: últimos 30 dias completos até ontem), separado do período da
// capacidade de tarefas (?periodo), para não misturar os dois controles.
export const dynamic = "force-dynamic";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function resolveAtPeriod(sp: { wde?: string; wate?: string }) {
  const de = sp.wde;
  const ate = sp.wate;
  if (de && ate && YMD.test(de) && YMD.test(ate) && de <= ate) {
    return { start: de, end: ate, label: de === ate ? brDate(de) : `${brDate(de)} a ${brDate(ate)}` };
  }
  // Padrão: últimos 30 dias completos (até ontem).
  const y = brtYesterday();
  const start = addDays(y, -29);
  return { start, end: y, label: `Últimos 30 dias (até ${brDate(y)})` };
}

export default async function CapacidadePage({
  searchParams,
}: {
  searchParams: { periodo?: string | string[]; wde?: string; wate?: string };
}) {
  const { supabase, profile } = await guardRole(["admin"]);
  const period = clampCapacityPeriod(searchParams.periodo);
  const at = resolveAtPeriod(searchParams);

  const [rows, paramsRes, summaryRes, clientsRes, peopleRes] = await Promise.all([
    loadCapacity(supabase, period),
    supabase.rpc("attendance_params_get"),
    supabase.rpc("attendance_capacity_summary", { p_start: at.start, p_end: at.end }),
    supabase.rpc("attendance_capacity_clients", { p_start: at.start, p_end: at.end }),
    supabase.rpc("attendance_capacity_people", { p_start: at.start, p_end: at.end }),
  ]);

  const params = (Array.isArray(paramsRes.data) ? paramsRes.data[0] : paramsRes.data) as AtParams | null;

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title="Capacidade da equipe"
      subtitle="Para distribuir carga e enxergar sobrecarga — não é ranking de desempenho."
    >
      <CapacityView rows={rows} period={period} />

      <AttendanceCapacity
        period={at}
        params={params}
        summary={(summaryRes.data as SummaryRow[]) ?? []}
        clients={(clientsRes.data as ClientRow[]) ?? []}
        people={(peopleRes.data as PersonRow[]) ?? []}
      />
    </AppShell>
  );
}

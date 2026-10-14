import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import PeriodPicker from "../PeriodPicker";
import { resolveDashboardPeriod } from "@/lib/period";
import AttendanceReport, { type ReportRow, type Grouping } from "./AttendanceReport";

// Tela admin-only da CALIBRAÇÃO (0126): tempo real de atendimento por pessoa e
// empresa, com agrupamento Dia/Semana/Mês e período reaproveitado do Dashboard.
// Tudo agregado no banco (RPC attendance_admin_report). Separado do cronômetro
// de tarefas — não cruza com time_entries/dashboards.

export default async function AtendimentoCalibracaoPage({
  searchParams,
}: {
  searchParams: { periodo?: string; de?: string; ate?: string; group?: string };
}) {
  const { supabase, profile } = await guardRole(["admin"]);

  const period = resolveDashboardPeriod(searchParams ?? {});
  const group: Grouping = (["day", "week", "month"].includes(searchParams?.group ?? "")
    ? searchParams!.group
    : "day") as Grouping;

  const { data, error } = await supabase.rpc("attendance_admin_report", {
    p_start: period.start,
    p_end: period.end,
    p_bucket: group,
  });

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title="Calibração de atendimento"
      subtitle="Tempo real de atendimento por pessoa e empresa (teste). Separado do cronômetro de tarefas."
      back={{ href: "/admin", label: "Dashboard" }}
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PeriodPicker value={period} />
      </div>

      {error ? (
        <div className="rounded-xl border border-red-300/60 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Erro ao carregar o relatório: {error.message}
        </div>
      ) : (
        <AttendanceReport rows={(data as ReportRow[]) ?? []} group={group} />
      )}
    </AppShell>
  );
}

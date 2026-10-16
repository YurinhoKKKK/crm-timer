import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import { brtToday, brDate } from "@/lib/period";
import { loadDigisacSyncStatus } from "@/lib/digisac-sync";
import DigisacSyncHeader from "./DigisacSyncHeader";
import CalibrationView, { type ComparisonRow, type PersonOpt } from "./CalibrationView";
import { CALIB_START } from "./constants";

// Tela admin-only da CALIBRAÇÃO do contador de atendimento Digisac. Objetivo único:
// a estimativa está acertando? Compara estimado × cronometrado para quem calibra.
// Tudo agregado no banco (attendance_comparison). force-dynamic: números ao vivo.
export const dynamic = "force-dynamic";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function resolvePeriod(sp: { de?: string; ate?: string }) {
  const today = brtToday();
  const de = sp.de, ate = sp.ate;
  const valid = de && ate && YMD.test(de) && YMD.test(ate) && de <= ate;
  const start = valid ? de! : CALIB_START;
  const end = valid ? ate! : today;
  const label =
    start === CALIB_START && end === today
      ? "Desde o início da calibração"
      : start === end
        ? brDate(start)
        : `${brDate(start)} a ${brDate(end)}`;
  return { start, end, label };
}

export default async function AtendimentoCalibracaoPage({
  searchParams,
}: {
  searchParams: { de?: string; ate?: string; auto?: string };
}) {
  const { supabase, profile } = await guardRole(["admin"]);

  const period = resolvePeriod(searchParams ?? {});
  const includeAuto = searchParams?.auto === "1";

  const [comparison, syncStatus, peopleRes] = await Promise.all([
    supabase.rpc("attendance_comparison", {
      p_start: period.start,
      p_end: period.end,
      p_bucket: "day",
      p_exclude_auto: !includeAuto,
    }),
    loadDigisacSyncStatus(supabase),
    supabase.from("profiles").select("id, full_name").eq("attendance_timer_enabled", true).order("full_name"),
  ]);

  const people: PersonOpt[] = ((peopleRes.data as { id: string; full_name: string }[]) ?? []).map(
    (p) => ({ id: p.id, name: p.full_name })
  );

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title="Calibração de atendimento"
      subtitle="A estimativa do Digisac está acertando? Comparação com o cronômetro dos dois Marcos."
      back={{ href: "/admin", label: "Dashboard" }}
    >
      <DigisacSyncHeader status={syncStatus} />

      {comparison.error ? (
        <div className="rounded-xl border border-red-300/60 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Erro ao carregar a comparação: {comparison.error.message}
        </div>
      ) : (
        <CalibrationView
          rows={(comparison.data as ComparisonRow[]) ?? []}
          period={period}
          includeAuto={includeAuto}
          people={people}
        />
      )}
    </AppShell>
  );
}

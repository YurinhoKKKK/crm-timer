import { createClient } from "@/lib/supabase-server";

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

// Contexto do cronômetro de ATENDIMENTO para o painel "Minhas empresas"
// (calibração, 0126). Só é carregado para quem tem a flag ligada. Agregação
// NO BANCO (RPCs); nada é somado no JS.

export type AttendanceOpenRow = {
  companyId: string;
  companyNumber: string | null;
  startedAt: string;
};

export type AttendanceContext = {
  enabled: boolean;
  open: AttendanceOpenRow | null;
  // company_id -> segundos de atendimento HOJE (BRT), já agregados no banco.
  todayByCompany: Record<string, number>;
};

export async function loadAttendanceContext(
  supabase: SupabaseServer,
  userId: string
): Promise<AttendanceContext> {
  const { data: prof } = await supabase
    .from("profiles")
    .select("attendance_timer_enabled")
    .eq("id", userId)
    .maybeSingle();

  const enabled = !!(prof as { attendance_timer_enabled?: boolean } | null)
    ?.attendance_timer_enabled;
  if (!enabled) return { enabled: false, open: null, todayByCompany: {} };

  const [{ data: cur }, { data: totals }] = await Promise.all([
    supabase.rpc("attendance_current"),
    supabase.rpc("attendance_today_totals"),
  ]);

  const row = (Array.isArray(cur) ? cur[0] : cur) as
    | { company_id: string; company_number: string | null; started_at: string }
    | undefined;
  const open: AttendanceOpenRow | null = row
    ? {
        companyId: row.company_id,
        companyNumber: row.company_number,
        startedAt: row.started_at,
      }
    : null;

  const todayByCompany: Record<string, number> = {};
  for (const r of (totals ?? []) as { company_id: string; seconds: number }[]) {
    todayByCompany[r.company_id] = Number(r.seconds) || 0;
  }

  return { enabled, open, todayByCompany };
}

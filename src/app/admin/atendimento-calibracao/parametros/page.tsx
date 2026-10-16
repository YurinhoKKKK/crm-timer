import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import ParamsForm, { type AttendanceParams } from "./ParamsForm";

// Edição dos parâmetros do cálculo de atendimento (admin). Salvar dispara o
// recálculo completo desde 01/09/2026 (dentro da RPC attendance_params_save).

export default async function ParametrosPage() {
  const { supabase, profile } = await guardRole(["admin"]);
  const { data } = await supabase.rpc("attendance_params_get");
  const params = (Array.isArray(data) ? data[0] : data) as AttendanceParams | undefined;

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title="Parâmetros do atendimento"
      subtitle="Regras do cálculo da estimativa. Salvar recalcula todo o histórico (desde 01/09/2026)."
      back={{ href: "/admin/atendimento-calibracao", label: "Calibração" }}
    >
      {params ? (
        <ParamsForm initial={params} />
      ) : (
        <div className="rounded-xl border border-red-300/60 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Não foi possível carregar os parâmetros.
        </div>
      )}
    </AppShell>
  );
}

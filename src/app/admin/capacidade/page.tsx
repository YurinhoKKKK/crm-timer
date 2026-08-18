import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import CapacityView from "@/components/capacity/CapacityView";
import { loadCapacity, clampCapacityPeriod } from "@/lib/capacity";

// Visão de capacidade da equipe — SÓ ADMIN. A rota é barrada NO SERVIDOR
// (guardRole), não só escondida do menu; a RPC team_capacity também checa
// is_admin() por dentro, então nem por chamada direta um consultor/colaborador
// agrega estes números. Não é ranking de desempenho — é distribuição de carga
// (os avisos na tela deixam isso escrito).
//
// force-dynamic: os números mudam a cada trabalho registrado; o período vem da
// URL e refaz a agregação no servidor.
export const dynamic = "force-dynamic";

export default async function CapacidadePage({
  searchParams,
}: {
  searchParams: { periodo?: string | string[] };
}) {
  const { supabase, profile } = await guardRole(["admin"]);
  const period = clampCapacityPeriod(searchParams.periodo);
  const rows = await loadCapacity(supabase, period);

  return (
    <AppShell
      user={{
        name: profile.full_name,
        role: "admin",
        avatarUrl: profile.avatarUrl,
      }}
      title="Capacidade da equipe"
      subtitle="Para distribuir carga e enxergar sobrecarga — não é ranking de desempenho."
    >
      <CapacityView rows={rows} period={period} />
    </AppShell>
  );
}

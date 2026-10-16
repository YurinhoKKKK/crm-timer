import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import { brtToday, brDate } from "@/lib/period";
import SessoesControls, { type PersonOption } from "./SessoesControls";

// Visão admin "Sessões": para um dia e uma pessoa, lista as sessões ESTIMADAS
// (Digisac) ao lado dos atendimentos CRONOMETRADOS, em ordem de horário, para
// conferir contato a contato. Fonte: attendance_day_timeline (0130).

type Row = {
  kind: "estimada" | "cronometro";
  company_number: string | null;
  company_name: string | null;
  started_at: string;
  ended_at: string | null;
  minutes: number;
  team_msgs: number | null;
  client_msgs: number | null;
  in_task: boolean | null;
  auto_closed: boolean | null;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function hm(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function fmtMin(min: number): string {
  const m = Math.round(Number(min) || 0);
  if (m <= 0) return "—";
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h === 0 ? `${r}min` : `${h}h${r > 0 ? ` ${r}min` : ""}`;
}
function companyLabel(r: Row): string {
  if (!r.company_name) return "—";
  return r.company_number ? `${r.company_number} — ${r.company_name}` : r.company_name;
}

export default async function SessoesPage({
  searchParams,
}: {
  searchParams: { dia?: string; pessoa?: string };
}) {
  const { supabase, profile } = await guardRole(["admin"]);

  const { data: profs } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("attendance_timer_enabled", true)
    .order("full_name");
  const people = (profs as PersonOption[]) ?? [];

  const dia = YMD.test(searchParams?.dia ?? "") ? searchParams!.dia! : brtToday();
  const pessoa =
    people.find((p) => p.id === searchParams?.pessoa)?.id ?? people[0]?.id ?? null;

  const { data: timeline } = pessoa
    ? await supabase.rpc("attendance_day_timeline", { p_day: dia, p_profile_id: pessoa })
    : { data: [] as Row[] };
  const rows = (timeline as Row[]) ?? [];

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title="Sessões do dia"
      subtitle="Sessões estimadas (Digisac) e atendimentos cronometrados, em ordem de horário."
      back={{ href: "/admin/atendimento-calibracao", label: "Calibração" }}
    >
      <SessoesControls people={people} dia={dia} pessoa={pessoa} />

      {!pessoa ? (
        <div className="rounded-2xl border border-line bg-surface p-10 text-center text-fg-subtle shadow-card">
          Nenhuma pessoa com cronômetro de atendimento habilitado.
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-10 text-center text-fg-subtle shadow-card">
          Nada em {brDate(dia)} para esta pessoa.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card">
          <table className="w-full min-w-[48rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-fg-subtle">
                <th className="px-4 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Empresa</th>
                <th className="px-3 py-2 font-medium">Início</th>
                <th className="px-3 py-2 font-medium">Fim</th>
                <th className="px-3 py-2 text-right font-medium">Minutos</th>
                <th className="px-3 py-2 text-right font-medium">Equipe</th>
                <th className="px-3 py-2 text-right font-medium">Cliente</th>
                <th className="px-3 py-2 font-medium">Obs.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-line/60">
                  <td className="px-4 py-2">
                    {r.kind === "estimada" ? (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">estimada</span>
                    ) : (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">cronômetro</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-fg">{companyLabel(r)}</td>
                  <td className="px-3 py-2 tabular-nums text-fg-muted">{hm(r.started_at)}</td>
                  <td className="px-3 py-2 tabular-nums text-fg-muted">{hm(r.ended_at)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg">{fmtMin(r.minutes)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{r.team_msgs ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{r.client_msgs ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.in_task && (
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">em tarefa</span>
                    )}
                    {r.auto_closed && (
                      <span className="rounded-full bg-red-100 px-1.5 py-0.5 font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300">auto-encerrado</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

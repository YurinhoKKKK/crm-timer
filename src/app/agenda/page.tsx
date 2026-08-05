import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import Calendar from "@/components/meetings/calendar/Calendar";
import {
  loadAgendaItems,
  loadMeetingDirectory,
  loadReachableCompanies,
  loadGoogleConnected,
  loadManagedCompanyIds,
  loadLastGoogleSync,
} from "@/lib/meetings";
import {
  addDays,
  civilMidnightMs,
  todayCivil,
  weekStart,
} from "@/components/meetings/calendar/datetime";

// Página dedicada de agenda — o calendário do módulo de reuniões (visões
// Dia/Semana/Mês, espírito do Google Calendar). A aba "Reuniões" da central da
// empresa segue como lista; esta é a visão de calendário.
//
// force-dynamic: as ações (criar/editar/excluir) mudam a base; a leitura inicial
// não pode servir de cache. A navegação entre períodos busca só o intervalo
// visível (fetchMeetingsRange), nunca a base inteira.
export const dynamic = "force-dynamic";

export default async function AgendaPage() {
  const { supabase, profile } = await guardRole([
    "admin",
    "consultor",
    "colaborador",
  ]);

  // Semana atual (BRT, domingo→sábado) — a janela padrão ao abrir. O calendário
  // já nasce com essa fatia em cache; navegar busca as demais sob demanda.
  const wk = weekStart(todayCivil());
  const fromISO = new Date(civilMidnightMs(wk)).toISOString();
  const toISO = new Date(civilMidnightMs(addDays(wk, 7))).toISOString();

  const [items, directory, companies, googleConnected, managedCompanyIds, lastSync] =
    await Promise.all([
      loadAgendaItems(supabase, { fromISO, toISO }),
      loadMeetingDirectory(supabase),
      loadReachableCompanies(supabase),
      loadGoogleConnected(supabase),
      loadManagedCompanyIds(supabase),
      loadLastGoogleSync(supabase),
    ]);

  return (
    <AppShell
      user={{
        name: profile.full_name,
        role: profile.role as "admin" | "consultor" | "colaborador",
        avatarUrl: profile.avatarUrl,
      }}
      title="Agenda"
      subtitle="Calendário de reuniões da equipe"
    >
      <Calendar
        currentUserId={profile.id}
        isAdmin={profile.role === "admin"}
        googleConnected={googleConnected}
        directory={directory}
        companies={companies}
        managedCompanyIds={managedCompanyIds}
        initialItems={items}
        initialLastSync={lastSync}
      />
    </AppShell>
  );
}

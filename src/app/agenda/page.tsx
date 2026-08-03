import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import NewMeetingForm from "@/components/meetings/NewMeetingForm";
import MeetingList from "@/components/meetings/MeetingList";
import {
  loadMeetings,
  loadMeetingDirectory,
  loadReachableCompanies,
} from "@/lib/meetings";

// Página dedicada de agenda — o lar do módulo de reuniões. Lista as próximas
// reuniões (todas as que o usuário vê; a RLS deixa todo interno ver todas),
// agrupadas por dia. A visão de calendário/grade vem numa fatia seguinte.
//
// force-dynamic: as ações (criar) mudam a lista; a leitura não pode servir de
// cache. O cliente ainda revalida com router.refresh após criar (como no /perfil).
export const dynamic = "force-dynamic";

// Início do dia de HOJE em BRT, convertido para UTC — filtra as reuniões que
// ainda não terminaram (inclui as em andamento agora). Offset fixo -03:00
// (Brasília sem horário de verão; ver docs/REUNIOES.md).
function startOfTodayBRTasISO(): string {
  const brt = new Date(Date.now() - 3 * 3600 * 1000);
  brt.setUTCHours(0, 0, 0, 0);
  return new Date(brt.getTime() + 3 * 3600 * 1000).toISOString();
}

export default async function AgendaPage() {
  const { supabase, profile } = await guardRole([
    "admin",
    "consultor",
    "colaborador",
  ]);

  const [meetings, directory, companies] = await Promise.all([
    loadMeetings(supabase, { fromISO: startOfTodayBRTasISO() }),
    loadMeetingDirectory(supabase),
    loadReachableCompanies(supabase),
  ]);

  return (
    <AppShell
      user={{
        name: profile.full_name,
        role: profile.role as "admin" | "consultor" | "colaborador",
        avatarUrl: profile.avatarUrl,
      }}
      title="Agenda"
      subtitle="Próximas reuniões da equipe"
    >
      <NewMeetingForm directory={directory} companies={companies} />
      <MeetingList
        rows={meetings}
        emptyLabel="Nenhuma reunião futura. Clique em “Nova reunião” para criar a primeira."
      />
    </AppShell>
  );
}

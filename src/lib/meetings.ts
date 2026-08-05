import type { createClient } from "@/lib/supabase-server";
import { avatarUrl } from "@/lib/avatar";
import { resolvePeople } from "@/lib/creator";

// =====================================================================
// Reuniões (Fatia 1) — tipos, formatação (fuso de Brasília) e leitura.
// O sistema é a fonte da verdade; o Google é destino (ver docs/REUNIOES.md).
// =====================================================================

type Client = Awaited<ReturnType<typeof createClient>>;

export type MeetingType = "meet" | "presencial_escritorio" | "presencial_cliente";
export type GoogleSyncStatus =
  | "pendente"
  | "sincronizado"
  | "nao_conectado"
  | "falhou";

export const MEETING_TYPE_LABEL: Record<MeetingType, string> = {
  meet: "Google Meet",
  presencial_escritorio: "Presencial · escritório",
  presencial_cliente: "Presencial · no cliente",
};

export const MEETING_TYPE_OPTIONS: { value: MeetingType; label: string }[] = [
  { value: "meet", label: "Google Meet" },
  { value: "presencial_escritorio", label: "Presencial · escritório" },
  { value: "presencial_cliente", label: "Presencial · no cliente" },
];

export type MeetingPerson = { id: string; name: string; avatarUrl: string | null };

export type MeetingRow = {
  id: string;
  companyId: string;
  companyName: string;
  title: string;
  description: string | null;
  startsAt: string; // ISO (UTC)
  endsAt: string; // ISO (UTC)
  type: MeetingType;
  syncStatus: GoogleSyncStatus;
  syncError: string | null;
  meetLink: string | null;
  // Opt-out do portal do cliente (default false = aparece). Só criador/admin/
  // consultor da empresa alteram, via setMeetingClientHidden.
  clientHidden: boolean;
  creator: MeetingPerson;
  participants: MeetingPerson[];
};

// Evento IMPORTADO da agenda Google de um interno (Fatia 2). Somente-leitura:
// não tem empresa, participantes, tipo nem sincronização — é um espelho. `title`
// null = evento PARTICULAR de outro (o banco escondeu o título; a grade mostra
// "Ocupado"). `ownerId` é o dono da agenda; a cor/label sai daí. O `kind`
// discrimina do MeetingRow na grade (ver GridItem/isImported).
export type ImportedEventRow = {
  kind: "imported";
  id: string;
  ownerId: string;
  title: string | null;
  startsAt: string; // ISO (UTC)
  endsAt: string; // ISO (UTC)
  isPrivate: boolean;
};

// A grade do calendário renderiza os dois: reuniões do sistema e eventos
// importados. MeetingRow não tem `kind` (fica implícito "sistema"); isImported
// estreita para o caso importado.
export type GridItem = MeetingRow | ImportedEventRow;

export function isImported(item: GridItem): item is ImportedEventRow {
  return (item as ImportedEventRow).kind === "imported";
}

// Usuário interno para o seletor de participantes (sem e-mail: o cliente do
// navegador só precisa de nome/foto; o e-mail fica no servidor, ver meetings
// actions). Vem de meeting_directory() (SECURITY DEFINER).
export type DirectoryUser = {
  id: string;
  name: string;
  avatarUrl: string | null;
  role: string;
};

export type ReachableCompany = { id: string; name: string };

// Contexto que a lista precisa para decidir e explicar as AÇÕES por reunião
// (editar/excluir só do criador; enviar ao Google; faxina do admin). Montado no
// servidor (página/central) e passado para os cartões (client).
export type MeetingActionsContext = {
  currentUserId: string;
  isAdmin: boolean;
  googleConnected: boolean; // o usuário ATUAL tem conta Google conectada agora
  directory: DirectoryUser[]; // para o seletor de participantes na edição
  companies?: ReachableCompany[]; // /agenda: empresa editável
  lockedCompany?: ReachableCompany; // central: empresa travada
  // Empresas que o usuário gerencia como CONSULTOR (na /agenda, cross-empresa).
  // Habilita o toggle "ocultar do cliente" para o consultor nas reuniões da
  // empresa dele mesmo quando ele não é o criador. Admin usa isAdmin; na central
  // o acesso já implica gestão (lockedCompany).
  managedCompanyIds?: string[];
};

// Forma estrutural de uma linha de conflito de horário — o que o aviso do
// formulário precisa exibir. Compatível com o ConflictRow devolvido por
// checkMeetingConflicts (ver src/app/meeting-actions.ts).
// Uma sobreposição de horário — de reunião DO SISTEMA ('sistema') ou de evento
// IMPORTADO do Google ('google'). `title` null = evento particular de outro
// (mostra "Ocupado"); `companyName` null = importado (não tem empresa).
export type ConflictLike = {
  source: "sistema" | "google";
  refId: string;
  title: string | null;
  startsAt: string;
  endsAt: string;
  companyName: string | null;
  userIds: string[];
};

// ---------------------------------------------------------------------
// Formatação em horário de Brasília (fuso fixo do usuário; ver [[timezone]]).
// ---------------------------------------------------------------------
const TZ = "America/Sao_Paulo";

// Chave AAAA-MM-DD no fuso BRT (en-CA formata ISO-like) — para agrupar por dia.
export function meetingDayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
}

// "Terça-feira, 05 de agosto" — cabeçalho de grupo do dia.
export function formatMeetingDay(iso: string): string {
  const label = new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: TZ,
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatMeetingTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
}

// "14:30 – 15:30"; se cruzar a meia-noite, mostra o dia do fim junto.
export function formatMeetingRange(startISO: string, endISO: string): string {
  const start = formatMeetingTime(startISO);
  const sameDay = meetingDayKey(startISO) === meetingDayKey(endISO);
  const end = sameDay
    ? formatMeetingTime(endISO)
    : `${formatMeetingDay(endISO)}, ${formatMeetingTime(endISO)}`;
  return `${start} – ${end}`;
}

// Frase de um conflito para a UI (arrasto e formulário compartilham). Devolve o
// "quem" separado para a tela poder destacá-lo. Trata as origens e os nulos:
// evento particular de outro (title null) vira "um compromisso particular";
// importado não tem empresa. `who` = nomes dos consultados que batem.
export function describeConflict(
  c: ConflictLike,
  nameById: Map<string, string>
): { who: string; tail: string } {
  const who = c.userIds.map((id) => nameById.get(id) ?? "alguém").join(", ");
  const when = formatMeetingRange(c.startsAt, c.endsAt);
  if (c.source === "google") {
    const label = c.title ? `“${c.title}”` : "um compromisso particular";
    return { who, tail: ` tem ${label} na agenda do Google das ${when}.` };
  }
  const label = c.title ?? "(sem título)";
  const co = c.companyName ? ` (${c.companyName})` : "";
  return { who, tail: ` já tem “${label}”${co} das ${when}.` };
}

// ---------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------
type MeetingDbRow = {
  id: string;
  company_id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  meeting_type: MeetingType;
  created_by: string;
  meet_link: string | null;
  google_sync_status: GoogleSyncStatus;
  google_sync_error: string | null;
  client_hidden: boolean;
  company: { name: string } | { name: string }[] | null;
};

function companyName(
  company: MeetingDbRow["company"]
): string {
  if (!company) return "(empresa)";
  const c = Array.isArray(company) ? company[0] : company;
  return c?.name ?? "(empresa)";
}

function person(
  id: string,
  people: Map<string, { name: string; avatarUrl: string | null }>
): MeetingPerson {
  const p = people.get(id);
  return { id, name: p?.name ?? "(sem nome)", avatarUrl: p?.avatarUrl ?? null };
}

// Reuniões visíveis ao usuário (RLS: todos os internos veem todas). `companyId`
// filtra por empresa (aba da central); `fromISO` traz só as que ainda não
// terminaram (agenda "próximas primeiro"). Ordena por início ascendente.
export async function loadMeetings(
  supabase: Client,
  opts: { companyId?: string; fromISO?: string; toISO?: string } = {}
): Promise<MeetingRow[]> {
  let query = supabase
    .from("meetings")
    .select(
      "id, company_id, title, description, starts_at, ends_at, meeting_type, created_by, meet_link, google_sync_status, google_sync_error, client_hidden, company:companies(name)"
    )
    .order("starts_at", { ascending: true });

  if (opts.companyId) query = query.eq("company_id", opts.companyId);
  // Janela [fromISO, toISO): sobreposição meia-aberta — traz o que ainda não
  // terminou antes do início E que começa antes do fim. Para o calendário buscar
  // SÓ o intervalo visível (+ folga), nunca a base inteira (ver perf do passo 29).
  if (opts.fromISO) query = query.gte("ends_at", opts.fromISO);
  if (opts.toISO) query = query.lt("starts_at", opts.toISO);

  const { data, error } = await query;
  if (error || !data) return [];
  const rows = data as unknown as MeetingDbRow[];
  if (rows.length === 0) return [];

  // Participantes de todas as reuniões numa consulta só.
  const ids = rows.map((r) => r.id);
  const { data: partData } = await supabase
    .from("meeting_participants")
    .select("meeting_id, user_id")
    .in("meeting_id", ids);
  const parts = (partData as { meeting_id: string; user_id: string }[]) ?? [];

  const byMeeting = new Map<string, string[]>();
  for (const p of parts) {
    const list = byMeeting.get(p.meeting_id) ?? [];
    list.push(p.user_id);
    byMeeting.set(p.meeting_id, list);
  }

  // Nome+foto de criadores e participantes numa chamada agrupada (display_profiles).
  const everyId = [
    ...rows.map((r) => r.created_by),
    ...parts.map((p) => p.user_id),
  ];
  const people = await resolvePeople(supabase, everyId);

  return rows.map((r) => ({
    id: r.id,
    companyId: r.company_id,
    companyName: companyName(r.company),
    title: r.title,
    description: r.description,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    type: r.meeting_type,
    syncStatus: r.google_sync_status,
    syncError: r.google_sync_error,
    meetLink: r.meet_link,
    clientHidden: r.client_hidden,
    creator: person(r.created_by, people),
    participants: (byMeeting.get(r.id) ?? []).map((uid) => person(uid, people)),
  }));
}

// Roster interno para o seletor de participantes. Descarta o e-mail (fica no
// servidor); o navegador vê só id/nome/foto/cargo.
export async function loadMeetingDirectory(
  supabase: Client
): Promise<DirectoryUser[]> {
  const { data } = await supabase.rpc("meeting_directory");
  const rows =
    (data as
      | {
          id: string;
          full_name: string | null;
          email: string | null;
          avatar_path: string | null;
          role: string;
        }[]
      | null) ?? [];
  return rows.map((r) => ({
    id: r.id,
    name: (r.full_name ?? "").trim() || r.email || "(sem nome)",
    avatarUrl: avatarUrl(r.avatar_path),
    role: r.role,
  }));
}

// O usuário ATUAL tem uma conta Google conectada agora? (existe linha própria em
// google_accounts — RLS ga_select_own só devolve a dele). Habilita "Enviar para
// o Google" e sinaliza que a edição vai sincronizar.
export async function loadGoogleConnected(supabase: Client): Promise<boolean> {
  const { data } = await supabase
    .from("google_accounts")
    .select("user_id")
    .maybeSingle();
  return !!data;
}

// Empresas que o usuário alcança (RLS companies_select = exatamente as em que
// ele pode criar reunião). Para o seletor de empresa quando não está travada.
export async function loadReachableCompanies(
  supabase: Client
): Promise<ReachableCompany[]> {
  const { data } = await supabase
    .from("companies")
    .select("id, name")
    .order("name");
  return ((data as { id: string; name: string }[]) ?? []).map((c) => ({
    id: c.id,
    name: c.name,
  }));
}

// Eventos IMPORTADOS do Google que tocam a janela (Fatia 2), de TODOS os
// internos — a grade cruza agendas. Vem de imported_events_range() (SECURITY
// DEFINER), que já esconde o título de eventos particulares de terceiros
// (title null => a grade mostra "Ocupado"). anon nunca recebe nada.
export async function loadImportedEvents(
  supabase: Client,
  range: { fromISO: string; toISO: string }
): Promise<ImportedEventRow[]> {
  const { data } = await supabase.rpc("imported_events_range", {
    p_from: range.fromISO,
    p_to: range.toISO,
  });
  const rows =
    (data as
      | {
          id: string;
          owner_id: string;
          title: string | null;
          starts_at: string;
          ends_at: string;
          is_private: boolean;
        }[]
      | null) ?? [];
  return rows.map((r) => ({
    kind: "imported" as const,
    id: r.id,
    ownerId: r.owner_id,
    title: r.title,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    isPrivate: r.is_private,
  }));
}

// Tudo que a grade mostra num período: reuniões do sistema + eventos importados,
// já unidos. As duas leituras são independentes — em paralelo.
export async function loadAgendaItems(
  supabase: Client,
  range: { fromISO: string; toISO: string }
): Promise<GridItem[]> {
  const [meetings, imported] = await Promise.all([
    loadMeetings(supabase, range),
    loadImportedEvents(supabase, range),
  ]);
  return [...meetings, ...imported];
}

// Última sincronização da agenda Google do próprio usuário (para "sincronizado
// há X" na /agenda). RLS gcis_select_own só devolve a linha dele.
export async function loadLastGoogleSync(
  supabase: Client
): Promise<string | null> {
  const { data } = await supabase
    .from("google_calendar_import_state")
    .select("last_synced_at")
    .maybeSingle();
  return (data as { last_synced_at: string | null } | null)?.last_synced_at ?? null;
}

// Empresas que o usuário gerencia como CONSULTOR (para habilitar o toggle
// "ocultar do cliente" na /agenda em reuniões da empresa dele, mesmo sem ser o
// criador). cc_select deixa o consultor ler as PRÓPRIAS linhas; admin usa o
// isAdmin; colaborador não gerencia nenhuma (fica vazio).
export async function loadManagedCompanyIds(supabase: Client): Promise<string[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("company_consultants")
    .select("company_id")
    .eq("consultant_id", user.id);
  return ((data as { company_id: string }[] | null) ?? []).map(
    (r) => r.company_id
  );
}

import type { createClient } from "@/lib/supabase-server";
import type { TaskStatus, TaskKind } from "@/lib/types";
import { formatDuration } from "@/lib/format";
import { avatarUrl } from "@/lib/avatar";
import { withSelf } from "@/lib/people";
import { loadCompanyLabels, type Label } from "@/lib/labels";
import type { GroupStats } from "@/lib/task-grouping";
import {
  resolvePeople,
  describeInstanceCreator,
  type CreatorInfo,
  type InstanceTemplate,
} from "@/lib/creator";

// Central da empresa (Passo 19). Carregador compartilhado por admin e consultor:
// mesma leitura de dados, RLS escopando quem vê o quê. Os agregados pesados
// (contagens, tempo, resumo por colaborador) rodam no banco via RPC, para não
// carregar milhares de instâncias no servidor. A lista de tarefas e o histórico
// usam teto/limite (escala).

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

export type Period = "hoje" | "7d" | "30d" | "tudo";

// Teto de tarefas carregadas por vez; buscamos CAP+1 para saber se há mais.
const TASK_CAP = 300;

const CENTRAL_TASK_SELECT =
  "id, title, status, due_at, task_date, template_id, created_at, total_seconds, completion_note, collaborator:profiles!task_instances_collaborator_id_fkey(full_name, email, avatar_path), template:task_templates!task_instances_template_id_fkey(created_by, created_at, standard_task_id)";

type Joined<T> = T | T[] | null;
function first<T>(value: Joined<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

// Início do período (YYYY-MM-DD) — mesma regra do dashboard, para os números
// baterem. null = todo o período.
function periodStart(period: Period): string | null {
  if (period === "tudo") return null;
  const d = new Date();
  if (period === "7d") d.setDate(d.getDate() - 6);
  else if (period === "30d") d.setDate(d.getDate() - 29);
  return d.toISOString().slice(0, 10);
}

function monthStart(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export type CentralCompany = {
  id: string;
  name: string;
  whatsappGroupName: string | null;
  whatsappContactId: string | null;
  createdAt: string;
  creatorName: string | null; // quem cadastrou (null = anterior ao registro)
  creatorAvatarUrl: string | null;
  labels: Label[]; // etiquetas da empresa (herdadas por todas as tarefas)
};

export type CentralPerson = { name: string; avatarUrl: string | null };

export type CentralOverview = {
  total: number;
  a_fazer: number;
  iniciada: number;
  finalizada: number;
  cancelada: number;
  overdue: number;
  secondsPeriod: number;
  secondsMonth: number;
  secondsAll: number;
  percent: number;
};

export type CentralTaskItem = {
  id: string;
  title: string;
  status: TaskStatus;
  due_at: string | null;
  task_date: string;
  templateId: string | null;
  created_at: string;
  total_seconds: number;
  collaboratorName: string;
  collaboratorAvatarUrl: string | null;
  completionNote: string | null;
  creator: CreatorInfo; // quem criou a tarefa e se veio da recorrência
};

export type CentralAttentionItem = {
  id: string;
  title: string;
  status: TaskStatus;
  due_at: string | null;
  collaboratorName: string;
  collaboratorAvatarUrl: string | null;
  overdue: boolean;
};

export type CentralCollaboratorRow = {
  id: string;
  name: string;
  avatarUrl: string | null;
  timeLabel: string;
  total: number;
  done: number;
  percent: number;
};

export type CentralActivityItem = {
  id: string;
  message: string;
  seconds: number;
  sentWhatsapp: boolean;
  createdAt: string;
  collaboratorName: string;
  collaboratorAvatarUrl: string | null;
};

export type StandardOption = { id: string; title: string; kind: TaskKind };
export type PersonOption = { id: string; full_name: string; email: string };

export type CentralData = {
  company: CentralCompany;
  consultants: CentralPerson[];
  overview: CentralOverview;
  tasks: CentralTaskItem[];
  tasksTruncated: boolean;
  // Contagens por template (banco) para o agrupamento da lista de tarefas.
  groupStats: GroupStats[];
  attention: CentralAttentionItem[];
  collaboratorRows: CentralCollaboratorRow[];
  activity: CentralActivityItem[];
  // Para as ações/edição in-loco (Nova tarefa e Tarefas padrão desta empresa).
  standards: StandardOption[];
  currentStandardTasks: { standardId: string; collaboratorId: string }[];
  collaborators: PersonOption[];
};

export async function loadCompanyCentral(
  supabase: SupabaseServer,
  self: { id: string; full_name: string },
  companyId: string,
  period: Period
): Promise<{ notFound: boolean; error?: string; data?: CentralData }> {
  const start = periodStart(period);
  const month = monthStart();

  const [
    { data: companyData },
    { data: consultantsData },
    { data: overviewData, error: overviewError },
    { data: collabData },
    { data: openData, error: openError },
    { data: closedData, error: closedError },
    { data: statsData },
    { data: activityData },
    { data: standardData },
    { data: assignedData },
    { data: collaboratorsData },
    companyLabels,
  ] = await Promise.all([
    // companies_select (RLS) só devolve a empresa se o usuário tiver acesso.
    supabase
      .from("companies")
      .select(
        "id, name, whatsapp_group_name, whatsapp_contact_id, created_at, created_by"
      )
      .eq("id", companyId)
      .maybeSingle(),
    supabase
      .from("company_consultants")
      .select(
        "consultant:profiles!company_consultants_consultant_id_fkey(full_name, email, avatar_path)"
      )
      .eq("company_id", companyId),
    supabase.rpc("company_overview", {
      p_company_id: companyId,
      p_start: start,
      p_month_start: month,
    }),
    supabase.rpc("company_collaborator_summary", {
      p_company_id: companyId,
      p_start: start,
    }),
    // Tarefas em duas leituras: abertas (todas, até o teto) e fechadas
    // recentes — estas viram GRUPOS por tarefa na lista, com as contagens
    // verdadeiras vindas da RPC task_group_stats (agregada no banco).
    (() => {
      let q = supabase
        .from("task_instances")
        .select(CENTRAL_TASK_SELECT)
        .eq("company_id", companyId)
        .in("status", ["a_fazer", "iniciada"])
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(TASK_CAP + 1);
      if (start) q = q.gte("task_date", start);
      return q;
    })(),
    (() => {
      let q = supabase
        .from("task_instances")
        .select(CENTRAL_TASK_SELECT)
        .eq("company_id", companyId)
        .in("status", ["finalizada", "cancelada"])
        .order("task_date", { ascending: false })
        .limit(TASK_CAP + 1);
      if (start) q = q.gte("task_date", start);
      return q;
    })(),
    supabase.rpc("task_group_stats", {
      p_company_id: companyId,
      p_start: start ?? undefined,
    }),
    (() => {
      let q = supabase
        .from("activity_log")
        .select(
          "id, message, seconds_spent, sent_whatsapp, created_at, collaborator:profiles!activity_log_collaborator_id_fkey(full_name, email, avatar_path)"
        )
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (start) q = q.gte("created_at", `${start}T00:00:00`);
      return q;
    })(),
    supabase
      .from("standard_tasks")
      .select("id, title, kind")
      .order("title", { ascending: true }),
    supabase
      .from("task_templates")
      .select("standard_task_id, collaborator_id")
      .eq("company_id", companyId)
      .eq("active", true)
      .not("standard_task_id", "is", null),
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("role", ["colaborador", "admin"])
      .order("full_name", { ascending: true }),
    loadCompanyLabels(supabase, companyId),
  ]);

  const company = companyData as {
    id: string;
    name: string;
    whatsapp_group_name: string | null;
    whatsapp_contact_id: string | null;
    created_at: string;
    created_by: string | null;
  } | null;
  if (!company) return { notFound: true };

  if (overviewError) return { notFound: false, error: overviewError.message };
  const tasksError = openError ?? closedError;
  if (tasksError) return { notFound: false, error: tasksError.message };

  // --- Cabeçalho: consultores ---
  const consultants: CentralPerson[] = [];
  for (const link of (consultantsData as {
    consultant: Joined<{
      full_name: string | null;
      email: string;
      avatar_path: string | null;
    }>;
  }[]) ?? []) {
    const c = first(link.consultant);
    if (c) {
      consultants.push({
        name: c.full_name || c.email,
        avatarUrl: avatarUrl(c.avatar_path),
      });
    }
  }

  // --- Indicadores --- (a RPC devolve snake_case; normalizamos para camelCase)
  const raw = (overviewData as Record<string, number>[] | null)?.[0];
  const overview: CentralOverview = {
    total: raw?.total ?? 0,
    a_fazer: raw?.a_fazer ?? 0,
    iniciada: raw?.iniciada ?? 0,
    finalizada: raw?.finalizada ?? 0,
    cancelada: raw?.cancelada ?? 0,
    overdue: raw?.overdue ?? 0,
    secondsPeriod: raw?.seconds_period ?? 0,
    secondsMonth: raw?.seconds_month ?? 0,
    secondsAll: raw?.seconds_all ?? 0,
    percent:
      (raw?.total ?? 0) > 0
        ? Math.round(((raw?.finalizada ?? 0) / (raw?.total ?? 1)) * 100)
        : 0,
  };

  // --- Lista de tarefas (abertas + fechadas recentes; teto em cada leitura) ---
  type CentralTaskRow = {
    id: string;
    title: string;
    status: TaskStatus;
    due_at: string | null;
    task_date: string;
    template_id: string | null;
    created_at: string;
    total_seconds: number;
    completion_note: string | null;
    collaborator: Joined<{
      full_name: string | null;
      email: string;
      avatar_path: string | null;
    }>;
    template: Joined<InstanceTemplate>;
  };
  const openRows = (openData as CentralTaskRow[]) ?? [];
  const closedRows = (closedData as CentralTaskRow[]) ?? [];
  const tasksTruncated =
    openRows.length > TASK_CAP || closedRows.length > TASK_CAP;
  const taskRows = [
    ...openRows.slice(0, TASK_CAP),
    ...closedRows.slice(0, TASK_CAP),
  ];

  // Nome+foto de quem criou (empresa + tarefas), legíveis por qualquer cargo
  // via display_profiles. Uma única chamada em lote.
  const creatorIds: (string | null | undefined)[] = [company.created_by];
  for (const r of taskRows) creatorIds.push(first(r.template)?.created_by);
  const people = await resolvePeople(supabase, creatorIds);

  const tasks: CentralTaskItem[] = taskRows.map((r) => {
    const collab = first(r.collaborator);
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      due_at: r.due_at,
      task_date: r.task_date,
      templateId: r.template_id,
      created_at: r.created_at,
      total_seconds: r.total_seconds,
      collaboratorName:
        collab?.full_name || collab?.email || "(sem responsável)",
      collaboratorAvatarUrl: avatarUrl(collab?.avatar_path),
      completionNote: r.completion_note,
      creator: describeInstanceCreator(first(r.template), r.created_at, people),
    };
  });

  // --- Atrasadas / pendentes em destaque (a partir da lista carregada) ---
  const now = Date.now();
  const attention: CentralAttentionItem[] = tasks
    .filter((t) => t.status === "a_fazer" || t.status === "iniciada")
    .map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      due_at: t.due_at,
      collaboratorName: t.collaboratorName,
      collaboratorAvatarUrl: t.collaboratorAvatarUrl,
      overdue: !!t.due_at && new Date(t.due_at).getTime() < now,
    }))
    .sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      if (!a.due_at) return 1;
      if (!b.due_at) return -1;
      return a.due_at.localeCompare(b.due_at);
    });

  // --- Resumo por colaborador (RPC) ---
  const collaboratorRows: CentralCollaboratorRow[] = (
    (collabData as {
      collaborator_id: string;
      full_name: string | null;
      email: string | null;
      avatar_path: string | null;
      seconds: number;
      total: number;
      done: number;
    }[]) ?? []
  ).map((r) => ({
    id: r.collaborator_id,
    name: r.full_name || r.email || "(sem responsável)",
    avatarUrl: avatarUrl(r.avatar_path),
    timeLabel: formatDuration(r.seconds),
    total: r.total,
    done: r.done,
    percent: r.total > 0 ? Math.round((r.done / r.total) * 100) : 0,
  }));

  // --- Histórico de atividades ---
  const activity: CentralActivityItem[] = (
    (activityData as {
      id: string;
      message: string;
      seconds_spent: number;
      sent_whatsapp: boolean;
      created_at: string;
      collaborator: Joined<{
        full_name: string | null;
        email: string;
        avatar_path: string | null;
      }>;
    }[]) ?? []
  ).map((a) => {
    const collab = first(a.collaborator);
    return {
      id: a.id,
      message: a.message,
      seconds: a.seconds_spent,
      sentWhatsapp: a.sent_whatsapp,
      createdAt: a.created_at,
      collaboratorName: collab?.full_name || collab?.email || "—",
      collaboratorAvatarUrl: avatarUrl(collab?.avatar_path),
    };
  });

  // --- Ações: tarefas padrão + responsáveis (com autoatribuição, Passo 14) ---
  const standards = (standardData as StandardOption[]) ?? [];
  const currentStandardTasks = (
    (assignedData as {
      standard_task_id: string | null;
      collaborator_id: string;
    }[]) ?? []
  )
    .filter((a) => a.standard_task_id)
    .map((a) => ({
      standardId: a.standard_task_id as string,
      collaboratorId: a.collaborator_id,
    }));
  const collaborators = withSelf(
    (collaboratorsData as PersonOption[]) ?? [],
    self
  );

  return {
    notFound: false,
    data: {
      company: {
        id: company.id,
        name: company.name,
        whatsappGroupName: company.whatsapp_group_name,
        whatsappContactId: company.whatsapp_contact_id,
        createdAt: company.created_at,
        creatorName: company.created_by
          ? people.get(company.created_by)?.name ?? null
          : null,
        creatorAvatarUrl: company.created_by
          ? people.get(company.created_by)?.avatarUrl ?? null
          : null,
        labels: companyLabels,
      },
      consultants,
      overview,
      tasks,
      tasksTruncated,
      groupStats: (statsData as GroupStats[]) ?? [],
      attention,
      collaboratorRows,
      activity,
      standards,
      currentStandardTasks,
      collaborators,
    },
  };
}

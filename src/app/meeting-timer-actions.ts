"use server";

import { createClient } from "@/lib/supabase-server";

// Timer manual de REUNIÃO (ver migrations 0145 e 0148). Interação simplificada:
// Play / Pause / Finalizar / Editar. Toda a autorização mora nos RPCs DEFINER
// (criador da reunião do CRM; dono do evento do Google; admin/consultor da empresa
// para horas). Aqui só traduzimos erro do banco em mensagem amigável — os RPCs já
// levantam texto em pt-BR, então repassamos error.message.

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

// Estado de um timer visível ao usuário (para os cards da Agenda e da aba).
// baseSeconds NÃO corre (manual OU soma dos trechos fechados); o trecho aberto
// conta no cliente a partir de openStartedAt. serverNow = relógio do servidor no
// fetch, para corrigir a defasagem do navegador (ver lib/timer.ts).
export type MeetingTimerState = {
  timerId: string;
  meetingId: string | null;
  googleEventId: string | null;
  companyId: string;
  title: string | null;
  startedBy: string;
  isOpen: boolean; // há trecho aberto = rodando
  openStartedAt: string | null;
  isFinalized: boolean; // finalizado → sem Play
  baseSeconds: number;
  serverNow: string;
};

export async function startMeetingTimer(input: {
  meetingId?: string | null;
  googleEventId?: string | null;
  companyId?: string | null;
  people?: string[] | null;
}): Promise<{ error: string | null; timerId?: string; startedAt?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { data, error } = await supabase.rpc("meeting_timer_start", {
    p_meeting_id: input.meetingId ?? null,
    p_google_event_id: input.googleEventId ?? null,
    p_company_id: input.companyId ?? null,
    p_people: input.people ?? null,
  });
  if (error) return { error: error.message };
  const res = (data ?? {}) as { timer_id?: string; started_at?: string };
  return { error: null, timerId: res.timer_id, startedAt: res.started_at };
}

// Pausar — fecha o trecho aberto; permite Play de novo.
export async function pauseMeetingTimer(
  timerId: string
): Promise<{ error: string | null }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };
  const { error } = await supabase.rpc("meeting_timer_stop", { p_timer: timerId });
  return { error: error ? error.message : null };
}

// Retomar (Play de novo).
export async function resumeMeetingTimer(
  timerId: string
): Promise<{ error: string | null; startedAt?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };
  const { data, error } = await supabase.rpc("meeting_timer_resume", {
    p_timer: timerId,
  });
  if (error) return { error: error.message };
  const res = (data ?? {}) as { started_at?: string };
  return { error: null, startedAt: res.started_at };
}

// Finalizar — fecha o trecho aberto (se houver) e marca o timer como finalizado.
export async function finalizeMeetingTimer(
  timerId: string
): Promise<{ error: string | null }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };
  const { error } = await supabase.rpc("meeting_timer_finalize", { p_timer: timerId });
  return { error: error ? error.message : null };
}

// Editar — grava um tempo manual (segundos) que SUBSTITUI a soma dos trechos, com
// justificativa (o banco exige ≥ 10 caracteres, 1 min a 6 h, timer não rodando).
export async function editMeetingTimer(
  timerId: string,
  seconds: number,
  justification: string
): Promise<{ error: string | null }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };
  const { error } = await supabase.rpc("meeting_timer_edit", {
    p_timer: timerId,
    p_seconds: seconds,
    p_justification: justification,
  });
  return { error: error ? error.message : null };
}

// Timers que o usuário enxerga (RLS filtra). Para os cards casarem por reunião
// (meeting_id) ou por evento (google_event_id).
export async function fetchReadableMeetingTimers(): Promise<MeetingTimerState[]> {
  const { supabase, user } = await requireUser();
  if (!user) return [];
  const { data, error } = await supabase.rpc("readable_meeting_timers");
  if (error || !data) return [];
  return (
    data as {
      timer_id: string;
      meeting_id: string | null;
      google_event_id: string | null;
      company_id: string;
      title: string | null;
      started_by: string;
      is_open: boolean;
      open_started_at: string | null;
      finalized: boolean;
      base_seconds: number | string;
      server_now: string;
    }[]
  ).map((r) => ({
    timerId: r.timer_id,
    meetingId: r.meeting_id,
    googleEventId: r.google_event_id,
    companyId: r.company_id,
    title: r.title,
    startedBy: r.started_by,
    isOpen: r.is_open,
    openStartedAt: r.open_started_at,
    isFinalized: r.finalized,
    baseSeconds: Number(r.base_seconds),
    serverNow: r.server_now,
  }));
}

// O timer de reunião ABERTO do próprio usuário (confirmação antes de iniciar
// tarefa/atendimento; e para o indicador global).
export async function fetchMyOpenMeetingTimer(): Promise<{
  timerId: string;
  title: string | null;
  companyId: string;
  startedAt: string;
  baseSeconds: number;
  serverNow: string;
} | null> {
  const { supabase, user } = await requireUser();
  if (!user) return null;
  const { data, error } = await supabase.rpc("my_open_meeting_timer");
  if (error || !data || (data as unknown[]).length === 0) return null;
  const r = (data as {
    timer_id: string;
    title: string | null;
    company_id: string;
    started_at: string;
    base_seconds: number | string;
    server_now: string;
  }[])[0];
  return {
    timerId: r.timer_id,
    title: r.title,
    companyId: r.company_id,
    startedAt: r.started_at,
    baseSeconds: Number(r.base_seconds),
    serverNow: r.server_now,
  };
}

// --- Aba Reuniões da empresa (admin + consultor da empresa; colaborador erra) --
// Só o total + por consultor (decisão 9 — sem lista/editor de reuniões).

export type MeetingHoursRow = {
  userId: string;
  userName: string | null;
  avatarPath: string | null;
  baseSeconds: number; // parte que não corre, somada nos timers do período
  openStarts: string[]; // ISO dos trechos abertos (contam ao vivo no cliente)
};

// Devolve `restricted: true` quando o banco recusa por cargo (colaborador), para
// a tela simplesmente não mostrar a linha em vez de dar erro. serverNow serve à
// defasagem de relógio do cálculo ao vivo.
export async function fetchCompanyMeetingHours(
  companyId: string,
  start: string | null,
  end: string | null
): Promise<{
  error: string | null;
  restricted?: boolean;
  rows?: MeetingHoursRow[];
  serverNow?: string;
}> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { data, error } = await supabase.rpc("company_meeting_hours", {
    p_company: companyId,
    p_start: start,
    p_end: end,
  });

  if (error) {
    if (error.code === "42501") return { error: null, restricted: true };
    return { error: error.message };
  }

  const raw =
    (data as {
      user_id: string;
      user_name: string | null;
      avatar_path: string | null;
      base_seconds: number | string;
      open_starts: string[] | null;
      server_now: string;
    }[]) ?? [];

  const rows: MeetingHoursRow[] = raw.map((r) => ({
    userId: r.user_id,
    userName: r.user_name,
    avatarPath: r.avatar_path,
    baseSeconds: Number(r.base_seconds),
    openStarts: r.open_starts ?? [],
  }));

  return { error: null, rows, serverNow: raw[0]?.server_now };
}

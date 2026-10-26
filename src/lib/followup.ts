import type { createClient } from "@/lib/supabase-server";

// Acompanhamento de clientes — tipos e helpers da tela que responde "quem está
// esfriando?". Desde a migration 0150 o contato é medido SÓ pelas mensagens do
// Digisac (digisac_messages), não mais por ações no CRM. A unidade é a COR DO DIA
// (verde/amarelo/vermelho/aguardando), gravada por dia × empresa em
// followup_daily_scores e devolvida pronta pelas RPCs SECURITY DEFINER abaixo —
// aqui só tipamos o retorno. A identidade visual mora em FAROL_UI (FarolBadge),
// fonte única compartilhada com os cards do painel do consultor.
// LGPD: nunca lemos nem guardamos o texto das mensagens.

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

// Cor do dia (decisão 3 da 0150): a 1ª mensagem válida do dia define a cor.
// <12:00 verde (+1) · 12:00–16:59 amarelo (0) · ≥17:00 ou sem contato vermelho
// (−1). 'aguardando' (cinza, 0) é só o dia corrente antes das 17:00 ainda sem
// contato — nunca é falta. Substitui o antigo modelo "dias desde o contato".
export type DayColor = "verde" | "amarelo" | "vermelho" | "aguardando";

// Compat: o tipo histórico. A cor agora vem pronta do banco; mantido como alias
// para quem ainda fala em "farol" (identidade visual em FAROL_UI).
export type Farol = DayColor;

export type FollowupConsultant = {
  id: string;
  name: string | null;
  avatarPath: string | null;
};

// Uma linha do quadro de Acompanhamento (RPC followup_board). A cor é a do DIA
// RELEVANTE (hoje, se dia útil; senão o último dia útil — ex.: no sábado, a
// sexta). As contagens de dias por cor são do período escolhido.
export type BoardRow = {
  companyId: string;
  companyName: string;
  consultants: FollowupConsultant[];
  collaborators: FollowupConsultant[];
  relevantDay: string; // data pura YYYY-MM-DD do dia avaliado
  color: DayColor; // COR DO CLIENTE (semáforo de recuperação) — a que pontua
  contactColor: DayColor; // resultado do CONTATO do dia relevante (crua)
  recoveryNeed: number; // 0/1/2 — dias verdes que ainda faltam (em recuperação)
  redStreak: number; // dias úteis vermelhos consecutivos até o dia relevante (0 = não está vermelho)
  redSince: string | null; // 1º dia do streak vermelho (YYYY-MM-DD) ou null
  relapseAt: string | null; // dia de uma recaída nos últimos 5 dias úteis (YYYY-MM-DD) ou null
  isToday: boolean; // o dia relevante é hoje (dia útil em andamento)
  firstMsgAt: string | null; // 1ª mensagem válida do dia relevante (ISO)
  lastMsgAt: string | null; // última mensagem válida de todas (ISO); null = nunca
  nextMeetingAt: string | null; // próxima reunião marcada (futuro)
  daysVerde: number;
  daysAmarelo: number;
  daysVermelho: number;
  responsibleName: string | null; // colaborador responsável do dia; null = sem responsável
};

// Pontuação do mês por colaborador (RPC followup_scores_month, admin).
// collaboratorId null = empresas sem responsável (aparecem mas não pontuam).
export type ScoreMonthRow = {
  collaboratorId: string | null;
  collaboratorName: string | null;
  avatarPath: string | null;
  points: number;
  daysVerde: number;
  daysAmarelo: number;
  daysVermelho: number;
  companies: number;
};

// Uma célula da grade dia×empresa do drill-down da Pontuação (RPC
// followup_scores_detail, admin).
export type ScoreDetailRow = {
  companyId: string;
  companyName: string;
  day: string; // YYYY-MM-DD
  color: DayColor; // cor do CLIENTE (a que pontua)
  contactColor: DayColor; // resultado do CONTATO do dia
  recoveryNeed: number; // 0/1/2
  evento: string | null; // rótulo do evento do dia (Ficou vermelho / Recuperado / Recaiu / …)
  firstMsgAt: string | null;
  points: number;
};

// Histórico do contato de uma empresa num mês (RPC followup_company_history).
export type ClientEventDay = {
  d: string; // YYYY-MM-DD
  firstMsgAt: string | null;
  contactColor: DayColor;
  color: DayColor;
  points: number;
  recoveryNeed: number;
  evento: string | null;
};
export type CompanyHistory = {
  relevantDay: string;
  days: ClientEventDay[]; // mais recente em cima
  summary: { reds: number; relapses: number; recoveries: number; situacao: string };
};

// As duas abas da tela. 'pontuacao' só existe para o admin (o guard da page
// garante; aqui só normalizamos o parâmetro da URL).
export type FollowupTab = "acompanhamento" | "pontuacao";
export function clampTab(raw: string | string[] | undefined): FollowupTab {
  const v = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  return v === "pontuacao" ? "pontuacao" : "acompanhamento";
}

// --- Meses disponíveis na Pontuação ----------------------------------------
// O histórico começa em setembro/2026 (primeiro mês com backfill do Digisac). O
// mês corrente aparece como "em andamento". Datas em BRT (a virada de mês segue
// America/Sao_Paulo, como todo o resto do app).
const TZ = "America/Sao_Paulo";
const FIRST_MONTH = "2026-09";

export type MonthOption = { value: string; label: string; current: boolean };

function brtYearMonth(): { y: number; m: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === "year")!.value);
  const m = Number(parts.find((p) => p.type === "month")!.value);
  return { y, m };
}

// "2026-09" → "setembro de 2026".
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  const name = d.toLocaleDateString("pt-BR", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Normaliza ?mes= para um YYYY-MM válido dentro da janela; fora da janela cai no
// mês corrente.
export function clampMonth(raw: string | string[] | undefined): string {
  const current = currentMonth();
  const v = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  if (/^\d{4}-\d{2}$/.test(v) && v >= FIRST_MONTH && v <= current) return v;
  return current;
}

export function currentMonth(): string {
  const { y, m } = brtYearMonth();
  return `${y}-${String(m).padStart(2, "0")}`;
}

// Lista do mês corrente (topo) até setembro/2026 — mais recente primeiro.
export function monthOptions(): MonthOption[] {
  const current = currentMonth();
  const out: MonthOption[] = [];
  let [y, m] = current.split("-").map(Number);
  const [fy, fm] = FIRST_MONTH.split("-").map(Number);
  while (y > fy || (y === fy && m >= fm)) {
    const value = `${y}-${String(m).padStart(2, "0")}`;
    out.push({ value, label: monthLabel(value), current: value === current });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

// Primeiro dia do mês (YYYY-MM-01) — o que as RPCs esperam em p_month.
export function monthToDate(ym: string): string {
  return `${ym}-01`;
}

// --- Loaders ----------------------------------------------------------------

// Resultado de leitura que distingue "vazio de verdade" de "deu erro" — um erro
// de RPC NUNCA pode virar lista vazia silenciosa na tela (a tela mostra um aviso
// e o servidor loga). Ver decisão de produto.
export type LoadResult<T> = { rows: T[]; error: string | null };

// Quadro de Acompanhamento de um MÊS. A RPC followup_board é SECURITY DEFINER com
// gate por dentro: admin vê todas as empresas de grupo ativo; consultor só a
// carteira dele. Mês atual = cor do dia relevante; mês passado = cor do último
// dia útil do mês. A ordem já vem pronta (vermelho → amarelo → verde →
// aguardando; dentro da cor, há mais tempo sem mensagem primeiro) — a inversão
// "melhor primeiro" é feita na tela, nunca aqui.
export async function loadFollowupBoard(
  supabase: SupabaseServer,
  month: string
): Promise<LoadResult<BoardRow>> {
  const { data, error } = await supabase.rpc("followup_board", {
    p_month: monthToDate(month),
  });
  if (error) {
    // Não engolir: sem isto, uma RPC que falha apareceria como quadro vazio.
    console.error("[acompanhamento] followup_board falhou:", error.message);
    return { rows: [], error: error.message };
  }
  const rows =
    (data as
      | {
          company_id: string;
          company_name: string;
          consultants:
            | { id: string; name: string | null; avatar_path: string | null }[]
            | null;
          collaborators:
            | { id: string; name: string | null; avatar_path: string | null }[]
            | null;
          relevant_day: string;
          color: DayColor;
          contact_color: DayColor;
          recovery_need: number;
          red_streak: number;
          red_since: string | null;
          relapse_at: string | null;
          is_today: boolean;
          first_msg_at: string | null;
          last_msg_at: string | null;
          next_meeting_at: string | null;
          days_verde: number;
          days_amarelo: number;
          days_vermelho: number;
          responsible_name: string | null;
        }[]
      | null) ?? [];

  return {
    error: null,
    rows: rows.map((r) => ({
      companyId: r.company_id,
      companyName: r.company_name,
      consultants: (r.consultants ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        avatarPath: c.avatar_path,
      })),
      collaborators: (r.collaborators ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        avatarPath: c.avatar_path,
      })),
      relevantDay: r.relevant_day,
      color: r.color,
      contactColor: r.contact_color,
      recoveryNeed: Number(r.recovery_need),
      redStreak: Number(r.red_streak),
      redSince: r.red_since,
      relapseAt: r.relapse_at,
      isToday: r.is_today,
      firstMsgAt: r.first_msg_at,
      lastMsgAt: r.last_msg_at,
      nextMeetingAt: r.next_meeting_at,
      daysVerde: Number(r.days_verde),
      daysAmarelo: Number(r.days_amarelo),
      daysVermelho: Number(r.days_vermelho),
      responsibleName: r.responsible_name,
    })),
  };
}

// "Atualizado às HH:MM" — último sync OK do Digisac (digisac_sync_runs). null se
// nunca sincronizou (ou se a leitura falhou — carimbo não é dado crítico).
export async function loadFollowupLastSync(
  supabase: SupabaseServer
): Promise<string | null> {
  const { data } = await supabase.rpc("followup_last_sync");
  return (data as string | null) ?? null;
}

// Pontuação do mês por colaborador (admin; a RPC rejeita não-admin). Já vem
// ordenada por pontos desc. Erro vira aviso na tela + log no servidor (nunca
// lista vazia silenciosa — foi exatamente o que escondeu o bug do 42702).
export async function loadScoresMonth(
  supabase: SupabaseServer,
  month: string
): Promise<LoadResult<ScoreMonthRow>> {
  const { data, error } = await supabase.rpc("followup_scores_month", {
    p_month: monthToDate(month),
  });
  if (error) {
    console.error("[acompanhamento] followup_scores_month falhou:", error.message);
    return { rows: [], error: error.message };
  }
  const rows =
    (data as
      | {
          collaborator_id: string | null;
          collaborator_name: string | null;
          avatar_path: string | null;
          points: number;
          days_verde: number;
          days_amarelo: number;
          days_vermelho: number;
          companies: number;
        }[]
      | null) ?? [];
  return {
    error: null,
    rows: rows.map((r) => ({
      collaboratorId: r.collaborator_id,
      collaboratorName: r.collaborator_name,
      avatarPath: r.avatar_path,
      points: Number(r.points),
      daysVerde: Number(r.days_verde),
      daysAmarelo: Number(r.days_amarelo),
      daysVermelho: Number(r.days_vermelho),
      companies: Number(r.companies),
    })),
  };
}

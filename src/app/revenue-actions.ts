"use server";

import { createClient } from "@/lib/supabase-server";
import {
  loadCompanyRevenue,
  loadCompanyRevenueInsights,
  loadCompanyRevenueMonthDetail,
  parseCurrencyBR,
  SALES_CHANNELS,
  type RevenueInsights,
  type RevenueMonthDetail,
  type RevenueOverview,
  type RevenueRange,
  type SalesChannel,
} from "@/lib/revenue";

// Faturamento por canal (Fatia 1), lado INTERNO. Só admin e consultor da
// empresa chegam aqui — as páginas que expõem estas ações são guardadas por
// guardRole(["admin"]) / guardRole(["consultor"]), e a RLS das tabelas é a
// fronteira real (o colaborador não passa nem por query direta).

const CHANNEL_VALUES = new Set<string>(SALES_CHANNELS.map((c) => c.value));

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

// Ressincroniza o painel após qualquer mutação (mesma consulta do render
// inicial). Devolve null se a sessão caiu.
export async function fetchRevenueOverview(
  companyId: string,
  range?: RevenueRange
): Promise<RevenueOverview | null> {
  const { supabase, user } = await requireUser();
  if (!user) return null;
  return loadCompanyRevenue(supabase, companyId, range);
}

// Valores AUTORITATIVOS de UM mês (para o formulário pré-preencher com
// segurança). Necessário porque, com filtro por período ativo, o overview só
// traz os meses do intervalo — abrir o formulário num mês FORA do recorte (ex.:
// "Lançar mês" cai no mês corrente, que pode estar fora do filtro) não pode
// assumir "vazio", senão salvar apagaria os lançamentos existentes daquele mês.
// Escopo pela RLS (leitura direta sob o client do usuário).
export async function fetchRevenueMonth(
  companyId: string,
  monthIso: string
): Promise<{ channels: Partial<Record<SalesChannel, number>>; note: string | null } | null> {
  const { supabase, user } = await requireUser();
  if (!user) return null;

  const { data: rows } = await supabase
    .from("company_revenues")
    .select("channel, amount")
    .eq("company_id", companyId)
    .eq("reference_month", monthIso);

  const { data: noteRow } = await supabase
    .from("company_revenue_notes")
    .select("note")
    .eq("company_id", companyId)
    .eq("reference_month", monthIso)
    .maybeSingle();

  const channels: Partial<Record<SalesChannel, number>> = {};
  for (const r of (rows ?? []) as { channel: SalesChannel; amount: number | string }[]) {
    channels[r.channel] = Number(r.amount);
  }
  return { channels, note: (noteRow as { note: string | null } | null)?.note ?? null };
}

// Autoria + histórico de alterações de UM mês, buscado sob demanda quando o
// detalhe do mês é aberto (nunca no render inicial da tabela). Escopo pela RLS.
export async function fetchRevenueMonthDetail(
  companyId: string,
  monthIso: string
): Promise<RevenueMonthDetail | null> {
  const { supabase, user } = await requireUser();
  if (!user) return null;
  return loadCompanyRevenueMonthDetail(supabase, companyId, monthIso);
}

// Insights (variação/acumulado, Fatia 2): mesma ressincronização, mesmo escopo.
export async function fetchRevenueInsights(
  companyId: string,
  range?: RevenueRange
): Promise<RevenueInsights | null> {
  const { supabase, user } = await requireUser();
  if (!user) return null;
  return loadCompanyRevenueInsights(supabase, companyId, range);
}

// Define quais canais a empresa usa (só o filtro do formulário — NÃO apaga
// histórico). Em lote, via RPC set_company_channels.
export async function setCompanyChannels(
  companyId: string,
  active: SalesChannel[]
): Promise<{ error: string | null }> {
  const clean = active.filter((c) => CHANNEL_VALUES.has(c));

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.rpc("set_company_channels", {
    p_company: companyId,
    p_active: clean,
  });
  // A RLS recusa se o usuário não tiver vínculo com a empresa.
  if (error) return { error: "Não foi possível salvar os canais." };
  return { error: null };
}

// Grava o mês inteiro de uma vez (UPSERT). Recebe os valores CRUS do formulário
// (padrão pt-BR) e faz o parse aqui, no servidor: campo vazio → não grava a
// linha ("sem registro"); "0" → grava 0,00. A string decimal canônica vai ao
// banco, que a converte em numeric — nunca passamos por float.
export async function saveRevenueMonth(
  companyId: string,
  monthIso: string, // "YYYY-MM-01"
  rawEntries: { channel: SalesChannel; raw: string }[],
  note: string,
  // Motivo da alteração (opcional; só faz sentido ao corrigir um mês existente).
  // Não bloqueia o salvamento quando vazio — vira null e o trigger de auditoria
  // registra a mudança sem motivo. Diferente da observação do mês (acima).
  reason: string = ""
): Promise<{ error: string | null }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const entries: { channel: SalesChannel; amount: string | null }[] = [];
  for (const { channel, raw } of rawEntries) {
    if (!CHANNEL_VALUES.has(channel)) continue;
    const parsed = parseCurrencyBR(raw);
    if (parsed.error) {
      const label =
        SALES_CHANNELS.find((c) => c.value === channel)?.label ?? channel;
      return { error: `Valor inválido em ${label}. Use o formato 0,00.` };
    }
    entries.push({ channel, amount: parsed.value });
  }

  if (note.length > 280) {
    return { error: "A observação pode ter no máximo 280 caracteres." };
  }
  if (reason.length > 280) {
    return { error: "O motivo pode ter no máximo 280 caracteres." };
  }

  const { error } = await supabase.rpc("company_revenue_upsert", {
    p_company: companyId,
    p_month: monthIso,
    p_entries: entries,
    p_note: note.trim() === "" ? null : note.trim(),
    p_reason: reason.trim() === "" ? null : reason.trim(),
  });
  if (error) return { error: "Não foi possível salvar o lançamento." };
  return { error: null };
}

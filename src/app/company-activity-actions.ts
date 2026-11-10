"use server";

import { createClient } from "@/lib/supabase-server";
import {
  ACTIVITY_PAGE_SIZE,
  type ActivityAuthor,
  type ActivityCategory,
  type ActivityFilters,
  type ActivityItem,
  type ActivityType,
  type ResponsiblePeriod,
  type ResponsibleTimeline,
} from "@/lib/company-activity";

// Leitura do histórico de atividades (Fatia 1). A agregação/ordenação/filtragem/
// paginação mora no banco (RPC company_activity_feed, SECURITY INVOKER — a RLS é
// a fronteira). O cliente NÃO junta fontes nem trunca: o PostgREST corta em 1.000
// linhas em silêncio, então quem pagina é o Postgres. O total também vem do banco.

export type ActivityPage = {
  error: string | null;
  total: number;
  items: ActivityItem[];
};

export async function loadCompanyActivity(
  companyId: string,
  offset: number,
  filters: ActivityFilters
): Promise<ActivityPage> {
  if (!companyId) return { error: "Empresa inválida.", total: 0, items: [] };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: "Sessão expirada. Faça login novamente.",
      total: 0,
      items: [],
    };
  }

  const { data, error } = await supabase.rpc("company_activity_feed", {
    p_company: companyId,
    p_limit: ACTIVITY_PAGE_SIZE,
    p_offset: Math.max(0, Math.floor(offset)),
    p_search: filters.search.trim() || null,
    p_types: filters.type ? [filters.type] : null,
    p_author: filters.authorId || null,
    p_from: filters.from || null,
    p_to: filters.to || null,
    p_categories: filters.category ? [filters.category] : null,
  });

  if (error) {
    return {
      error: "Não foi possível carregar o histórico.",
      total: 0,
      items: [],
    };
  }

  const payload = (data as { total?: number; items?: ActivityItem[] } | null) ?? {};
  return {
    error: null,
    total: payload.total ?? 0,
    items: payload.items ?? [],
  };
}

export async function loadCompanyActivityAuthors(
  companyId: string
): Promise<{ error: string | null; authors: ActivityAuthor[] }> {
  if (!companyId) return { error: "Empresa inválida.", authors: [] };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada.", authors: [] };

  const { data, error } = await supabase.rpc("company_activity_authors", {
    p_company: companyId,
  });
  if (error) return { error: "Não foi possível carregar os autores.", authors: [] };

  return { error: null, authors: (data as ActivityAuthor[] | null) ?? [] };
}

// Tipos de evento presentes nesta empresa (para o filtro por TIPO). Vêm do banco
// (sem lista fixa no código); acompanham a evolução dos eventos automaticamente.
export async function loadCompanyActivityTypes(
  companyId: string
): Promise<{ error: string | null; types: ActivityType[] }> {
  if (!companyId) return { error: "Empresa inválida.", types: [] };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada.", types: [] };

  const { data, error } = await supabase.rpc("company_activity_types", {
    p_company: companyId,
  });
  if (error) return { error: "Não foi possível carregar os tipos.", types: [] };

  return { error: null, types: (data as ActivityType[] | null) ?? [] };
}

// Categorias presentes nesta empresa (filtro por CATEGORIA). Rótulos do banco.
export async function loadCompanyActivityCategories(
  companyId: string
): Promise<{ error: string | null; categories: ActivityCategory[] }> {
  if (!companyId) return { error: "Empresa inválida.", categories: [] };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada.", categories: [] };

  const { data, error } = await supabase.rpc("company_activity_categories", {
    p_company: companyId,
  });
  if (error)
    return { error: "Não foi possível carregar as categorias.", categories: [] };

  return { error: null, categories: (data as ActivityCategory[] | null) ?? [] };
}

// Linha do tempo de responsáveis (consultor/colaborador) da empresa. A RLS da
// RPC (SECURITY INVOKER) é a fronteira — quem já vê a empresa, vê os períodos.
export async function loadCompanyResponsibleTimeline(
  companyId: string
): Promise<{ error: string | null; refDate: string | null; periods: ResponsiblePeriod[] }> {
  if (!companyId) return { error: "Empresa inválida.", refDate: null, periods: [] };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada.", refDate: null, periods: [] };

  const { data, error } = await supabase.rpc("company_responsible_timeline", {
    p_company: companyId,
  });
  if (error)
    return { error: "Não foi possível carregar os responsáveis.", refDate: null, periods: [] };

  const tl = data as ResponsibleTimeline | null;
  return { error: null, refDate: tl?.refDate ?? null, periods: tl?.periods ?? [] };
}

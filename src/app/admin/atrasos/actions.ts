"use server";

import { createClient } from "@/lib/supabase-server";
import { avatarUrl } from "@/lib/avatar";
import type {
  AtrasoRow,
  CellMetric,
  CellRow,
  CellSituation,
  ListOrder,
  PanelDimension,
  SituationKey,
} from "./atrasos-shared";

// --- Lista paginada no banco (migration 0166) -------------------------------
// Busca/filtros/ordenação/paginação moram na RPC atrasos_list (DEFINER + gate
// is_admin()). A action só repassa os parâmetros e normaliza o retorno.

type ListRow = {
  id: string;
  title: string;
  company_id: string;
  company_name: string | null;
  type_key: string;
  type_label: string;
  responsible_id: string | null;
  responsible_name: string | null;
  responsible_avatar_path: string | null;
  creator_id: string | null;
  creator_name: string | null;
  creator_avatar_path: string | null;
  created_at: string | null;
  due_at: string | null;
  granted_seconds: number | null;
  finished_at: string | null;
  delay_seconds: number;
  situation: SituationKey;
  total_count: number;
};

export type LoadAtrasosInput = {
  start: string | null;
  end: string | null;
  includeStandard: boolean;
  status: string;
  creatorId: string;
  responsibleId: string;
  companyId: string;
  type: string;
  search: string;
  order: ListOrder;
  limit: number;
  offset: number;
};

export async function loadAtrasosList(
  input: LoadAtrasosInput
): Promise<{ error: string | null; rows: AtrasoRow[]; total: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return { error: "Sessão expirada. Faça login novamente.", rows: [], total: 0 };

  const { data, error } = await supabase.rpc("atrasos_list", {
    p_start: input.start,
    p_end: input.end,
    p_include_standard: input.includeStandard,
    p_status: input.status || null,
    p_creator: input.creatorId || null,
    p_responsible: input.responsibleId || null,
    p_company: input.companyId || null,
    p_type: input.type || null,
    p_search: input.search.trim() || null,
    p_order: input.order,
    p_limit: input.limit,
    p_offset: input.offset,
  });
  if (error) return { error: error.message, rows: [], total: 0 };

  const raw = (data as ListRow[]) ?? [];
  const total = raw.length > 0 ? Number(raw[0].total_count) : 0;
  const rows: AtrasoRow[] = raw.map((r) => ({
    id: r.id,
    title: r.title,
    companyId: r.company_id,
    companyName: r.company_name ?? "(empresa removida)",
    typeKey: r.type_key,
    typeLabel: r.type_label,
    responsible: {
      id: r.responsible_id,
      name: r.responsible_name ?? "(sem responsável)",
      avatarUrl: avatarUrl(r.responsible_avatar_path),
    },
    creator: {
      id: r.creator_id,
      name: r.creator_name,
      avatarUrl: avatarUrl(r.creator_avatar_path),
    },
    createdAt: r.created_at,
    dueAt: r.due_at,
    grantedSeconds: r.granted_seconds == null ? null : Number(r.granted_seconds),
    finishedAt: r.finished_at,
    delaySeconds: Number(r.delay_seconds),
    situation: r.situation,
  }));
  return { error: null, rows, total };
}

// --- Drill-down: tarefas de uma célula do resumo (atrasos_cell_tasks) --------
type CellRaw = Omit<ListRow, "situation" | "delay_seconds"> & {
  situation: CellSituation;
  delay_seconds: number | null;
};

export type LoadCellInput = {
  start: string | null;
  end: string | null;
  dimension: PanelDimension;
  person: string; // vazio quando dimension = 'all' (totais do cabeçalho)
  metric: CellMetric;
  includeStandard: boolean;
  status: string;
  creatorId: string;
  responsibleId: string;
  companyId: string;
  type: string;
  search: string;
  limit: number;
  offset: number;
};

export async function loadCellTasks(
  input: LoadCellInput
): Promise<{ error: string | null; rows: CellRow[]; total: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return { error: "Sessão expirada. Faça login novamente.", rows: [], total: 0 };

  const { data, error } = await supabase.rpc("atrasos_cell_tasks", {
    p_start: input.start,
    p_end: input.end,
    p_dimension: input.dimension,
    p_person: input.person || null,
    p_metric: input.metric,
    p_include_standard: input.includeStandard,
    p_status: input.status || null,
    p_creator: input.creatorId || null,
    p_responsible: input.responsibleId || null,
    p_company: input.companyId || null,
    p_type: input.type || null,
    p_search: input.search.trim() || null,
    p_limit: input.limit,
    p_offset: input.offset,
  });
  if (error) return { error: error.message, rows: [], total: 0 };

  const raw = (data as CellRaw[]) ?? [];
  const total = raw.length > 0 ? Number(raw[0].total_count) : 0;
  const rows: CellRow[] = raw.map((r) => ({
    id: r.id,
    title: r.title,
    companyId: r.company_id,
    companyName: r.company_name ?? "(empresa removida)",
    typeKey: r.type_key,
    typeLabel: r.type_label,
    responsible: {
      id: r.responsible_id,
      name: r.responsible_name ?? "(sem responsável)",
      avatarUrl: avatarUrl(r.responsible_avatar_path),
    },
    creator: {
      id: r.creator_id,
      name: r.creator_name,
      avatarUrl: avatarUrl(r.creator_avatar_path),
    },
    createdAt: r.created_at,
    dueAt: r.due_at,
    grantedSeconds: r.granted_seconds == null ? null : Number(r.granted_seconds),
    finishedAt: r.finished_at,
    delaySeconds: r.delay_seconds == null ? null : Number(r.delay_seconds),
    situation: r.situation,
  }));
  return { error: null, rows, total };
}

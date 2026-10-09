"use server";

import { guardRole } from "@/components/guardRole";
import { resolvePeople } from "@/lib/creator";
import { TRAFFIC_AUDIT_PAGE } from "@/lib/traffic-options";
import type {
  TrafficFocus,
  TrafficPlatform,
  TrafficStatus,
} from "@/lib/traffic-options";

// Escrita e leitura do quadro "Tráfego". Admin-only: as RPCs recusam não-admin
// por dentro (e a RLS das tabelas é a barreira real); as leituras passam por
// guardRole(["admin"]). A fatia 4 (Gestor de Tráfego) amplia estes dois pontos.

export type TrafficWriteResult = {
  error: string | null;
  kind?: "permission" | "validation" | "failure";
};

type PgError = { code?: string; message?: string };

function classify(err: PgError | null): TrafficWriteResult {
  const code = err?.code ?? "";
  const msg = err?.message ?? "";
  if (code === "42501" || /insufficient_privilege|row-level security/i.test(msg)) {
    return { kind: "permission", error: "Você não tem permissão para esta ação." };
  }
  // check_violation (regras das RPCs) e invalid enum/numeric → validação; a
  // mensagem das RPCs já é amigável (ex.: a do move sincronizado).
  if (code === "23514" || code === "22P02" || code === "P0001") {
    return { kind: "validation", error: msg || "Valor inválido." };
  }
  return { kind: "failure", error: msg || "Não foi possível salvar a alteração." };
}

export async function setTrafficFocus(
  companyId: string,
  value: TrafficFocus | null
): Promise<TrafficWriteResult> {
  const { supabase } = await guardRole(["admin", "gestor_trafego"]);
  const { error } = await supabase.rpc("traffic_set_focus", {
    p_company_id: companyId,
    p_value: value,
  });
  return error ? classify(error) : { error: null };
}

export async function setTrafficPlatform(
  companyId: string,
  value: TrafficPlatform | null
): Promise<TrafficWriteResult> {
  const { supabase } = await guardRole(["admin", "gestor_trafego"]);
  const { error } = await supabase.rpc("traffic_set_platform", {
    p_company_id: companyId,
    p_value: value,
  });
  return error ? classify(error) : { error: null };
}

export async function setTrafficStatus(
  companyId: string,
  value: TrafficStatus | null
): Promise<TrafficWriteResult> {
  const { supabase } = await guardRole(["admin", "gestor_trafego"]);
  const { error } = await supabase.rpc("traffic_set_status", {
    p_company_id: companyId,
    p_value: value,
  });
  return error ? classify(error) : { error: null };
}

// Orçamento: texto decimal "digits.dd" (o front converte o BR → decimal, nunca
// float); null = limpar.
export async function setTrafficBudget(
  companyId: string,
  budget: string | null
): Promise<TrafficWriteResult> {
  const { supabase } = await guardRole(["admin", "gestor_trafego"]);
  const { error } = await supabase.rpc("traffic_set_budget", {
    p_company_id: companyId,
    p_budget: budget,
  });
  return error ? classify(error) : { error: null };
}

// Move uma empresa MANUAL para um grupo do Tráfego. O banco recusa empresa fora
// do quadro ou SINCRONIZADA (com a mensagem própria).
export async function moveTrafficCompany(
  companyId: string,
  trafficGroupId: string
): Promise<TrafficWriteResult> {
  const { supabase } = await guardRole(["admin", "gestor_trafego"]);
  const { error } = await supabase.rpc("traffic_move_company", {
    p_company_id: companyId,
    p_traffic_group_id: trafficGroupId,
  });
  return error ? classify(error) : { error: null };
}

// --- Histórico (traffic_audit), paginado, mais recente primeiro -------------- //

export type TrafficAuditEntry = {
  id: number;
  field: string; // 'grupo_manual' | 'foco' | 'plataforma' | 'status' | 'orcamento'
  oldValue: string | null;
  newValue: string | null;
  changedByName: string | null; // null = "Sistema"
  changedAtISO: string;
};

export async function fetchTrafficAudit(
  companyId: string,
  offset: number
): Promise<{ entries: TrafficAuditEntry[]; hasMore: boolean }> {
  const { supabase } = await guardRole(["admin", "gestor_trafego"]);

  // Pede 1 a mais para saber se há próxima página.
  const { data, error } = await supabase
    .from("traffic_audit")
    .select("id, field, old_value, new_value, changed_by, changed_at")
    .eq("company_id", companyId)
    .order("changed_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + TRAFFIC_AUDIT_PAGE);

  if (error) throw error;

  type Row = {
    id: number;
    field: string;
    old_value: string | null;
    new_value: string | null;
    changed_by: string | null;
    changed_at: string;
  };
  const rows = (data as Row[] | null) ?? [];
  const hasMore = rows.length > TRAFFIC_AUDIT_PAGE;
  const page = rows.slice(0, TRAFFIC_AUDIT_PAGE);

  // Nomes dos autores em lote (changed_by nulo = "Sistema", resolvido no front).
  const people = await resolvePeople(
    supabase,
    page.map((r) => r.changed_by)
  );

  const entries: TrafficAuditEntry[] = page.map((r) => ({
    id: r.id,
    field: r.field,
    oldValue: r.old_value,
    newValue: r.new_value,
    changedByName: r.changed_by
      ? people.get(r.changed_by)?.name ?? "(usuário removido)"
      : null,
    changedAtISO: r.changed_at,
  }));

  return { entries, hasMore };
}

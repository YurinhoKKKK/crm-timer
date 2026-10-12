"use server";

import { guardRole } from "@/components/guardRole";
import { resolvePeople } from "@/lib/creator";
import { DEV_AUDIT_PAGE } from "@/lib/dev-options";
import type { DevStatus } from "@/lib/dev-options";

// Escrita e leitura do quadro "Desenvolvimento". Admin-only nesta etapa: as RPCs
// recusam quem não pode por dentro (dev_can_manage) e a RLS admin-only das tabelas
// é a barreira real; as leituras passam por guardRole(["admin"]). A Etapa 4 (cargo
// "Desenvolvedor") amplia estes dois pontos (guardRole + dev_can_manage no banco).

export type DevWriteResult = {
  error: string | null;
  kind?: "permission" | "validation" | "failure";
};

type PgError = { code?: string; message?: string };

function classify(err: PgError | null): DevWriteResult {
  const code = err?.code ?? "";
  const msg = err?.message ?? "";
  if (code === "42501" || /insufficient_privilege|row-level security/i.test(msg)) {
    return { kind: "permission", error: "Você não tem permissão para esta ação." };
  }
  // check_violation (regras das RPCs) e invalid enum → validação; a mensagem das
  // RPCs já é amigável (ex.: empresa fora do quadro).
  if (code === "23514" || code === "22P02" || code === "P0001") {
    return { kind: "validation", error: msg || "Valor inválido." };
  }
  return { kind: "failure", error: msg || "Não foi possível salvar a alteração." };
}

// Troca o Status. Um status que move (ex.: em_desenvolvimento) reposiciona a
// empresa na seção correspondente — o reposicionamento vem do servidor (a RPC
// resolve o grupo); o front só precisa revalidar depois.
export async function setDevStatus(
  companyId: string,
  value: DevStatus
): Promise<DevWriteResult> {
  const { supabase } = await guardRole(["admin"]);
  const { error } = await supabase.rpc("dev_set_status", {
    p_company_id: companyId,
    p_status: value,
  });
  return error ? classify(error) : { error: null };
}

// Move uma empresa para um grupo do Desenvolvimento. O banco troca o status para o
// status correspondente ao grupo de destino (correspondência mora no banco).
export async function moveDevCompany(
  companyId: string,
  devGroupId: string
): Promise<DevWriteResult> {
  const { supabase } = await guardRole(["admin"]);
  const { error } = await supabase.rpc("dev_move_company", {
    p_company_id: companyId,
    p_dev_group_id: devGroupId,
  });
  return error ? classify(error) : { error: null };
}

// --- Prazo (Etapa 2): pausar/retomar a contagem de dias úteis ---------------- //
// A pausa só vale com a empresa em "Em Desenvolvimento" (a RPC recusa o resto) e
// exige motivo (1..500) — a mensagem de validação das RPCs já é amigável. Retomar
// zera a pausa; se a empresa já saiu de Em Desenvolvimento, o próprio banco a
// desliga sozinho (registrada como "Sistema").
export async function pauseDevDeadline(
  companyId: string,
  reason: string
): Promise<DevWriteResult> {
  const { supabase } = await guardRole(["admin"]);
  const { error } = await supabase.rpc("dev_pause_deadline", {
    p_company_id: companyId,
    p_reason: reason,
  });
  return error ? classify(error) : { error: null };
}

export async function resumeDevDeadline(
  companyId: string
): Promise<DevWriteResult> {
  const { supabase } = await guardRole(["admin"]);
  const { error } = await supabase.rpc("dev_resume_deadline", {
    p_company_id: companyId,
  });
  return error ? classify(error) : { error: null };
}

// --- Histórico (dev_audit), paginado, mais recente primeiro ------------------ //

export type DevAuditEntry = {
  id: number;
  field: string; // 'grupo' | 'status'
  oldValue: string | null;
  newValue: string | null;
  changedByName: string | null; // null = "Sistema"
  changedAtISO: string;
};

export async function fetchDevAudit(
  companyId: string,
  offset: number
): Promise<{ entries: DevAuditEntry[]; hasMore: boolean }> {
  const { supabase } = await guardRole(["admin"]);

  // Pede 1 a mais para saber se há próxima página.
  const { data, error } = await supabase
    .from("dev_audit")
    .select("id, field, old_value, new_value, changed_by, changed_at")
    .eq("company_id", companyId)
    .order("changed_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + DEV_AUDIT_PAGE);

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
  const hasMore = rows.length > DEV_AUDIT_PAGE;
  const page = rows.slice(0, DEV_AUDIT_PAGE);

  // Nomes dos autores em lote (changed_by nulo = "Sistema", resolvido no front).
  const people = await resolvePeople(
    supabase,
    page.map((r) => r.changed_by)
  );

  const entries: DevAuditEntry[] = page.map((r) => ({
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

"use server";

import { guardRole } from "@/components/guardRole";
import { resolvePeople } from "@/lib/creator";
import { CS_AUDIT_PAGE, type CsNpsStatus } from "@/lib/cs-status";

// Escrita e leitura do histórico do quadro "Sucesso do Cliente". Admin-only: as
// RPCs recusam não-admin por dentro (e a RLS das tabelas é a barreira real); as
// leituras passam por guardRole(["admin"]).

export type CsWriteResult = {
  error: string | null;
  kind?: "permission" | "validation" | "failure";
};

type PgError = { code?: string; message?: string };

function classify(err: PgError | null): CsWriteResult {
  const code = err?.code ?? "";
  const msg = err?.message ?? "";
  if (code === "42501" || /insufficient_privilege|row-level security/i.test(msg)) {
    return { kind: "permission", error: "Você não tem permissão para esta ação." };
  }
  if (code === "23514") {
    // A mensagem da RPC de responsável já é amigável; a do CHECK da tabela não.
    return {
      kind: "validation",
      error: /check constraint/i.test(msg) ? "Valor inválido para este campo." : msg,
    };
  }
  return { kind: "failure", error: msg || "Não foi possível salvar a alteração." };
}

export async function setCompanyNps(
  companyId: string,
  status: CsNpsStatus | null
): Promise<CsWriteResult> {
  const { supabase } = await guardRole(["admin"]);
  const { error } = await supabase.rpc("cs_set_company_nps", {
    p_company_id: companyId,
    p_status: status,
  });
  return error ? classify(error) : { error: null };
}

export async function setMeetingOn(
  companyId: string,
  date: string | null
): Promise<CsWriteResult> {
  const { supabase } = await guardRole(["admin"]);
  const { error } = await supabase.rpc("cs_set_meeting_on", {
    p_company_id: companyId,
    p_date: date,
  });
  return error ? classify(error) : { error: null };
}

export async function setPersonNps(
  companyId: string,
  userId: string,
  status: CsNpsStatus | null
): Promise<CsWriteResult> {
  const { supabase } = await guardRole(["admin"]);
  const { error } = await supabase.rpc("cs_set_person_nps", {
    p_company_id: companyId,
    p_user_id: userId,
    p_status: status,
  });
  return error ? classify(error) : { error: null };
}

// Edita os valores do contrato (Valor Mensal). Exatamente um de total/monthly
// como texto decimal "digits.dd" (o front converte o BR → decimal, nunca float);
// os três nulos = limpar. O banco faz a multiplicação exata em numeric.
export async function setContractValues(
  companyId: string,
  installments: number | null,
  total: string | null,
  monthly: string | null
): Promise<CsWriteResult> {
  const { supabase } = await guardRole(["admin"]);
  const { error } = await supabase.rpc("cs_set_contract_values", {
    p_company_id: companyId,
    p_installments: installments,
    p_total: total,
    p_monthly: monthly,
  });
  return error ? classify(error) : { error: null };
}

// --- Histórico (cs_audit), paginado, mais recente primeiro --------------- //

export type CsAuditEntry = {
  id: number;
  field: string; // 'nps_geral' | 'nps_pessoa' | 'data_reuniao' | (fatia 3…)
  oldValue: string | null;
  newValue: string | null;
  subjectName: string | null;
  // Papel ATUAL do sujeito na empresa (resolvido na hora); null se não é mais responsável.
  subjectRole: "consultor" | "colaborador" | "ambos" | null;
  changedByName: string | null;
  changedAtISO: string;
};

export async function fetchCsAudit(
  companyId: string,
  offset: number
): Promise<{ entries: CsAuditEntry[]; hasMore: boolean }> {
  const { supabase } = await guardRole(["admin"]);

  // Pede 1 a mais para saber se há próxima página.
  const { data, error } = await supabase
    .from("cs_audit")
    .select("id, field, old_value, new_value, subject_user_id, changed_by, changed_at")
    .eq("company_id", companyId)
    .order("changed_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + CS_AUDIT_PAGE);

  if (error) throw error;

  type Row = {
    id: number;
    field: string;
    old_value: string | null;
    new_value: string | null;
    subject_user_id: string | null;
    changed_by: string | null;
    changed_at: string;
  };
  const rows = (data as Row[] | null) ?? [];
  const hasMore = rows.length > CS_AUDIT_PAGE;
  const page = rows.slice(0, CS_AUDIT_PAGE);

  // Nomes (autor + sujeito) resolvidos em lote via display_profiles.
  const [people, consultantIds, collaboratorIds] = await Promise.all([
    resolvePeople(
      supabase,
      page.flatMap((r) => [r.changed_by, r.subject_user_id])
    ),
    supabase
      .from("company_consultants")
      .select("consultant_id")
      .eq("company_id", companyId),
    supabase
      .from("company_collaborators")
      .select("collaborator_id")
      .eq("company_id", companyId),
  ]);

  const consSet = new Set(
    ((consultantIds.data as { consultant_id: string }[] | null) ?? []).map(
      (r) => r.consultant_id
    )
  );
  const colabSet = new Set(
    ((collaboratorIds.data as { collaborator_id: string }[] | null) ?? []).map(
      (r) => r.collaborator_id
    )
  );

  function roleOf(userId: string | null): CsAuditEntry["subjectRole"] {
    if (!userId) return null;
    const isC = consSet.has(userId);
    const isK = colabSet.has(userId);
    if (isC && isK) return "ambos";
    if (isC) return "consultor";
    if (isK) return "colaborador";
    return null; // não é mais responsável
  }

  const entries: CsAuditEntry[] = page.map((r) => ({
    id: r.id,
    field: r.field,
    oldValue: r.old_value,
    newValue: r.new_value,
    subjectName: r.subject_user_id
      ? people.get(r.subject_user_id)?.name ?? "(usuário removido)"
      : null,
    subjectRole: roleOf(r.subject_user_id),
    changedByName: r.changed_by
      ? people.get(r.changed_by)?.name ?? "(usuário removido)"
      : null,
    changedAtISO: r.changed_at,
  }));

  return { entries, hasMore };
}

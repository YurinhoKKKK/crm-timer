"use server";

import { guardRole } from "@/components/guardRole";
import type { ChurnReason } from "@/lib/churn";

// Edição do Controle de Churn (2ª aba do Sucesso do Cliente). Admin-only: as RPCs
// (migration 0121) recusam não-admin por dentro e a RLS admin de company_churns é
// a barreira real; as leituras passam por guardRole(["admin"]). Cada ação é UM
// comando no banco e recusa registro revertido; a auditoria vem do gatilho.

type PgError = { code?: string; message?: string };

// Erro classificado (mesma linguagem das ações do CS): permissão / validação /
// falha genérica. A mensagem de validação da RPC já é amigável.
function classify(err: PgError | null): { error: string | null } {
  if (!err) return { error: null };
  const code = err.code ?? "";
  const msg = err.message ?? "";
  if (code === "42501" || /insufficient_privilege|row-level security/i.test(msg)) {
    return { error: "Você não tem permissão para esta ação." };
  }
  if (code === "23514" || code === "P0001") {
    return { error: msg || "Não foi possível salvar a alteração." };
  }
  return { error: msg || "Não foi possível salvar a alteração." };
}

// Data do churn (AAAA-MM-DD ou null = limpar).
export async function setChurnDate(id: string, date: string | null) {
  const { supabase } = await guardRole(["admin"]);
  const { error } = await supabase.rpc("churn_set_date", { p_id: id, p_date: date });
  return classify(error);
}

// Motivo (só cancelados; a RPC recusa qualquer mudança em finalizado).
export async function setChurnReason(id: string, reason: ChurnReason) {
  const { supabase } = await guardRole(["admin"]);
  const { error } = await supabase.rpc("churn_set_reason", { p_id: id, p_reason: reason });
  return classify(error);
}

// "Limpar" o motivo de um cancelado → volta para 'nao_informado' ("Não
// informado"). Mesma RPC (SECURITY DEFINER), que segue recusando finalizado e
// registro revertido.
export async function clearChurnReason(id: string) {
  const { supabase } = await guardRole(["admin"]);
  const { error } = await supabase.rpc("churn_set_reason", {
    p_id: id,
    p_reason: "nao_informado",
  });
  return classify(error);
}

// Vendedor da foto (texto até 200; vazio = limpar).
export async function setChurnSeller(id: string, text: string | null) {
  const { supabase } = await guardRole(["admin"]);
  const { error } = await supabase.rpc("churn_set_seller", { p_id: id, p_text: text });
  return classify(error);
}

// MRR da foto (decimal em texto "digits.dd" convertido do BR no front; vazio =
// limpar). NÃO altera company_contract_values.
export async function setChurnMrr(id: string, text: string | null) {
  const { supabase } = await guardRole(["admin"]);
  const { error } = await supabase.rpc("churn_set_mrr", { p_id: id, p_text: text });
  return classify(error);
}

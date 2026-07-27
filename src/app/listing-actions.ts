"use server";

import { createClient } from "@/lib/supabase-server";

// Marcar uma listagem como REAJUSTADA (lado interno). A empresa, a autoria e a
// coerência (só reajustar o que o cliente deixou pendente) são garantidas no
// banco por mark_listing_readjusted (SECURITY INVOKER + RLS lv_insert_interno):
// o evento nasce sempre author_type='interno' com author_id = auth.uid(), nunca
// como veredito de cliente. Aqui só traduzimos os erros.

const READJUST_ERROR: Record<string, string> = {
  item: "Não foi possível identificar esta listagem. Recarregue a página.",
  sem_pendencia:
    "Esta listagem não tem um ajuste pendente do cliente para reajustar.",
  longo: "O comentário pode ter no máximo 2000 caracteres.",
};

export async function markListingReadjusted(
  listingResultId: string,
  comment: string
): Promise<{ error: string | null }> {
  const trimmed = comment.trim();
  if (trimmed.length > 2000) return { error: READJUST_ERROR.longo };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_listing_readjusted", {
    p_listing_result: listingResultId,
    p_comment: trimmed || null,
  });
  if (error) return { error: "Não foi possível registrar. Tente novamente." };

  const res = data as { ok: boolean; error?: string } | null;
  if (!res?.ok) {
    return {
      error: READJUST_ERROR[res?.error ?? ""] ?? "Não foi possível registrar.",
    };
  }
  return { error: null };
}

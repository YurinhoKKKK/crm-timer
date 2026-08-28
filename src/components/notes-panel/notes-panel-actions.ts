"use server";

import { createClient } from "@/lib/supabase-server";
import { loadCompanyNotes, type CompanyNoteView } from "@/lib/notes";

// Carrega as anotações de UMA empresa para o painel de atalho, sob demanda
// (só quando o painel abre). A sanitização do content_html vive no ponto único
// de leitura (loadCompanyNotes → getNoteSanitizer), então o jsdom só é tocado
// aqui, no servidor, e nunca entra no bundle da lista de empresas.
//
// PERMISSÃO: idêntica à aba de Anotações — a RLS cn_select é a barreira de
// servidor (admin todas, consultor a carteira, colaborador as empresas com
// tarefa). Uma empresa fora do escopo volta simplesmente vazia. Aqui só
// confirmamos que há sessão autenticada.
export async function getPanelNotes(
  companyId: string
): Promise<{ error: string | null; notes?: CompanyNoteView[] }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sua sessão expirou. Recarregue a página." };

  try {
    const notes = await loadCompanyNotes(supabase, companyId);
    return { error: null, notes };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Não foi possível carregar as anotações.",
    };
  }
}

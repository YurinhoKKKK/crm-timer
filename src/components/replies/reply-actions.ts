"use server";

import { guardRole } from "@/components/guardRole";
import { loadNoteReplies, type NoteReplyView } from "@/lib/notes";

// Carrega as respostas de UMA atualização SOB DEMANDA (só quando a conversa é
// expandida no cartão da atualização) — o mesmo padrão do detalhe do chamado.
// Roda no SERVIDOR: a sanitização do body_html fica no ponto único de leitura
// (getNoteSanitizer), sem arrastar o jsdom para o bundle do cliente. guardRole
// barra pending/anon; a RLS cnr_select ainda escopa por empresa (nota fora do
// alcance volta vazia).
export async function fetchNoteReplies(
  noteId: string
): Promise<NoteReplyView[]> {
  const { supabase } = await guardRole(["admin", "consultor", "colaborador"]);
  return loadNoteReplies(supabase, noteId);
}

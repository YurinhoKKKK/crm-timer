"use server";

import { guardRole } from "@/components/guardRole";
import { loadTicketReplies, type TicketReplyView } from "@/lib/support";

// Carrega as respostas de um chamado SOB DEMANDA (o detalhe é client-side e não
// deve abrir pesado). Roda no SERVIDOR: a sanitização do body_html fica no
// mesmo ponto único de leitura (getNoteSanitizer), sem arrastar o jsdom para o
// bundle do cliente nem para o cold start da rota. guardRole barra pending/anon
// (só cargo interno lê chamados).
export async function fetchTicketReplies(
  ticketId: string
): Promise<TicketReplyView[]> {
  const { supabase } = await guardRole(["admin", "consultor", "colaborador"]);
  return loadTicketReplies(supabase, ticketId);
}

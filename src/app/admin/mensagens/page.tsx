import { redirect } from "next/navigation";

// O módulo de mensagens cliente ↔ equipe foi removido (o contato com o cliente
// passou para o WhatsApp/Digisac). A fila de VALIDAÇÕES de listagem, que morava
// nesta página, agora é tela própria em /admin/validacoes. Mantemos este
// redirecionamento porque há links salvos e em conversas antigas apontando aqui.
export default function AdminMensagensRedirect() {
  redirect("/admin/validacoes");
}

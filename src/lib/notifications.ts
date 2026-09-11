// Tipos e utilidades PURAS da central de notificações (sem servidor): usadas
// pelo sino no cliente. A geração e a validação de acesso vivem no banco
// (migration 0077); aqui só desenhamos.

export type NotificationType =
  | "mencionado"
  | "resposta_recebida"
  | "tarefa_atribuida"
  | "tarefa_recorrente_atribuida"
  | "listagem_ajuste_solicitado"
  | "reuniao_convite"
  | "reuniao_cancelada";

export type ShellRole = "admin" | "consultor" | "colaborador";

// Uma notificação pronta para exibir. body/companyName já vêm REDIGIDOS pelo
// banco quando a pessoa perdeu o acesso (reachable=false): nesse caso não
// mostramos nome de cliente nem deixamos abrir o conteúdo.
export type NotificationView = {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  companyId: string | null;
  companyName: string | null;
  reachable: boolean;
  sourceType: string | null;
  sourceId: string | null;
  actorId: string | null;
  actorName: string | null;
  actorAvatarUrl: string | null;
  createdAtISO: string;
  readAtISO: string | null;
};

// Para onde a notificação leva, pela role de quem recebe. Sem acesso
// (reachable=false) → não navega. Chamado não tem empresa → vai para /suporte.
export function notificationHref(
  role: ShellRole,
  n: NotificationView
): string | null {
  if (!n.reachable) return null;

  switch (n.type) {
    case "reuniao_convite":
    case "reuniao_cancelada":
      return "/agenda";
    case "tarefa_atribuida":
    case "tarefa_recorrente_atribuida":
      return role === "admin"
        ? "/admin/tarefas"
        : role === "consultor"
          ? "/consultor/tarefas"
          : "/colaborador/tarefas";
    default: {
      // mencionado / resposta_recebida / listagem
      const isChamado =
        n.sourceType === "chamado" ||
        n.sourceType === "chamado_resposta" ||
        n.companyId === null;
      if (isChamado) return "/suporte";
      const suffix =
        n.type === "listagem_ajuste_solicitado" ? "?aba=listings" : "";
      if (role === "admin") return `/admin/empresas/${n.companyId}${suffix}`;
      if (role === "consultor") return `/consultor/${n.companyId}${suffix}`;
      return `/colaborador/${n.companyId}${suffix}`;
    }
  }
}

// "há 5 min", "há 3 h", "ontem", ou a data curta (BRT) para itens antigos. O
// tooltip carrega o carimbo completo.
export function relativeTimeBRT(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMin = Math.round((Date.now() - then) / 60000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `há ${diffH} h`;
  if (diffH < 48) return "ontem";
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
  });
}

export function fullTimeBRT(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

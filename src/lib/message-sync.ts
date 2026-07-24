// Sincronização, na MESMA aba, entre a conversa e o badge de não lidas do
// AppShell (passo 32) — mesmo padrão do crm-timer-sync. Quem marca a conversa
// como lida emite o evento; o badge refaz a contagem sem esperar sinal
// externo. Abas diferentes se acertam pelo Realtime/visibilitychange.

export const MESSAGES_READ_EVENT = "crm-messages-read";

export function emitMessagesRead() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(MESSAGES_READ_EVENT));
}

// Validações de listagem lidas (passo 33) — mesmo padrão: quem marca "visto"
// avisa o badge (que soma mensagens + validações) a refazer a contagem.
export const VALIDATIONS_READ_EVENT = "crm-validations-read";

export function emitValidationsRead() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(VALIDATIONS_READ_EVENT));
}

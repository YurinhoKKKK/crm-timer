// Sincronização, na MESMA aba, entre a conversa e o badge de não lidas do
// AppShell (passo 32) — mesmo padrão do crm-timer-sync. Quem marca a conversa
// como lida emite o evento; o badge refaz a contagem sem esperar sinal
// externo. Abas diferentes se acertam pelo Realtime/visibilitychange.

export const MESSAGES_READ_EVENT = "crm-messages-read";

export function emitMessagesRead() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(MESSAGES_READ_EVENT));
}

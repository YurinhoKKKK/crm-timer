// Sincronização, na MESMA aba, entre a fila de validações e o badge de não
// vistas do AppShell (passo 33) — mesmo padrão do crm-timer-sync. Quem marca as
// validações como vistas emite o evento; o badge refaz a contagem sem esperar
// sinal externo. Abas diferentes se acertam pelo Realtime/visibilitychange.

// Validações de listagem vistas (passo 33): quem marca "visto" avisa o badge de
// validações a refazer a contagem.
export const VALIDATIONS_READ_EVENT = "crm-validations-read";

export function emitValidationsRead() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(VALIDATIONS_READ_EVENT));
}

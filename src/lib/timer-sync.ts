// Sincronização, na MESMA aba, entre o timer da tela da tarefa e o indicador
// global de timer ativo (AppShell). Quem muda o estado no banco (start/pause/
// finish) emite o evento; o outro lado atualiza a própria visão sem esperar o
// poll. Abas diferentes se sincronizam pelo poll do indicador.

export const TIMER_SYNC_EVENT = "crm-timer-sync";

export type TimerSyncDetail = {
  taskId: string;
  action: "start" | "pause" | "finish";
  // Total autoritativo devolvido pelo banco ao pausar/finalizar.
  totalSeconds?: number;
  // Quem originou a mudança, para o originador ignorar o próprio evento.
  source: "page" | "indicator";
};

export function emitTimerSync(detail: TimerSyncDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<TimerSyncDetail>(TIMER_SYNC_EVENT, { detail }));
}

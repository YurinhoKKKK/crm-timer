// Sincronização, na mesma aba, entre a coluna "Atendimento" do painel e o
// indicador global de atendimento (AppShell). Quem muda o estado emite; o outro
// lado se atualiza sem esperar o poll. Abas diferentes sincronizam pelo poll.

export const ATTENDANCE_SYNC_EVENT = "crm-attendance-sync";

export function emitAttendanceSync() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ATTENDANCE_SYNC_EVENT));
}

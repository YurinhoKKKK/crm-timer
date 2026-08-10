import "server-only";
import type { MeetingRoom } from "@/lib/meetings";

// =====================================================================
// Salas do escritório — endereços de agenda Google (Fatia A). SERVER-ONLY.
//
// Reservar a sala = convidar ESTE endereço como participante do evento na
// agenda primária de quem cria (ver pushToGoogle). Não é uma "resource calendar"
// do Workspace (@resource.calendar.google.com) e sim uma agenda compartilhada
// (@group.calendar.google.com): convidada como participante comum, ela aparece
// na própria agenda e responde (accepted por auto-aceite, ou declined se já
// estiver ocupada) — e essa resposta é a confirmação/negação real da reserva,
// lida de volta pelas Fatias B/C.
//
// O import "server-only" impede que estes endereços vazem para o bundle do
// cliente. Não são segredo, mas não há motivo para embarcá-los no navegador.
// =====================================================================
const ROOM_CALENDAR_ID: Record<MeetingRoom, string> = {
  grande:
    "c_9c71801d82af2e200a80168dd60f8f46680c9d995e8ed5291aea50c00ebafa72@group.calendar.google.com",
  pequena:
    "c_e417a06a40bdb9d9cd224a5501baf23b6c76416d2babbc17c411b6975d0adce0@group.calendar.google.com",
};

// Endereço de agenda da sala para convidar como participante, ou null (sem sala
// / valor inesperado). Aceita string crua vinda do banco para blindar a leitura.
export function roomCalendarEmail(room: string | null | undefined): string | null {
  if (room === "grande" || room === "pequena") return ROOM_CALENDAR_ID[room];
  return null;
}

// Reverso: dado o e-mail de um attendee do Google, qual sala ele é (ou null).
// Case-insensitive — o Google pode devolver o id em caixa diferente. Usado na
// leitura dirigida (Fatia B) para casar o attendee-sala com meetings.room.
const ROOM_BY_EMAIL = new Map<string, MeetingRoom>(
  (Object.entries(ROOM_CALENDAR_ID) as [MeetingRoom, string][]).map(
    ([room, email]) => [email.toLowerCase(), room]
  )
);

export function roomFromEmail(email: string | null | undefined): MeetingRoom | null {
  if (!email) return null;
  return ROOM_BY_EMAIL.get(email.toLowerCase()) ?? null;
}

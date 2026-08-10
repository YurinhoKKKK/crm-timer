-- =====================================================================
-- Reuniões — Fatia A: reservar SALA do escritório (Sala Grande / Sala Pequena).
--
-- A reserva no Google é feita CONVIDANDO a agenda da sala como participante do
-- evento na agenda primária de quem cria (ver src/lib/rooms.ts + pushToGoogle).
-- Um só evento-fonte; o accepted/declined da SALA (auto-aceite ou recusa por
-- choque de horário) volta pelo mesmo caminho de leitura das Fatias B/C.
--
-- Aqui só guardamos QUAL sala a reunião reservou. O endereço de agenda de cada
-- sala é config de servidor (rooms.ts), não vai para o banco nem para o cliente.
-- 'grande' | 'pequena' | null (sem sala). Só faz sentido em presencial no
-- escritório; a action garante isso (server é a fonte da verdade), então não
-- amarramos meeting_type no CHECK — trocar de tipo depois não deve quebrar a linha.
-- =====================================================================

alter table meetings
  add column room text
    check (room is null or room in ('grande', 'pequena'));

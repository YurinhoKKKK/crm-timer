-- =====================================================================
-- Reuniões — Fatia B: ESPELHO do responseStatus (accepted/declined/…).
--
-- Google é a verdade. Estas colunas são um ESPELHO SÓ-EXIBIÇÃO: guardam o último
-- status lido pela leitura dirigida (events.get por google_event_id, feita SÓ por
-- quem criou — só ele tem o token). Os demais internos LEEM o espelho, sem chamada
-- ao vivo; ninguém o trata como autoridade. `responses_synced_at` diz quão fresco
-- ele está ("status lido há X").
--
-- Por participante interno mora em meeting_participants.response (chaveado por
-- user_id — nunca por e-mail, mantendo a disciplina de não expor e-mail ao
-- navegador). O da SALA mora em meetings.room_response (só há uma sala por reunião).
--
-- RLS já cobre: mp_write/meetings_update (0048) exigem created_by = auth.uid(),
-- e é exatamente o criador quem escreve o espelho; mp_select/meetings_select
-- deixam todo interno ler. Sem policy nova.
--
-- Domínio dos valores = os do Google. NULL = ainda não lido / participante fora
-- do evento. Editar a reunião apaga+reinsere participantes (updateMeeting), então
-- o response some no editar — correto: mudou quem, o status velho não vale mais.
-- =====================================================================

alter table meeting_participants
  add column response text
    check (response is null
           or response in ('accepted', 'declined', 'tentative', 'needsAction'));

alter table meetings
  add column room_response text
    check (room_response is null
           or room_response in ('accepted', 'declined', 'tentative', 'needsAction')),
  add column responses_synced_at timestamptz;

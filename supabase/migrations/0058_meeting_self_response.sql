-- =====================================================================
-- Reuniões — Fatia D: PARTICIPANTE aceita/recusa DENTRO do sistema.
--
-- O write no Google é feito com o token DO PRÓPRIO participante (ele muda só o
-- seu responseStatus na cópia do evento na agenda dele — mesmo google_event_id).
-- Coerente com o modelo: cada um só age na própria agenda, sem service_role.
--
-- Aqui só o ESPELHO. A RLS de meeting_participants (mp_write, 0048) é criador-only
-- — de propósito, para o criador ser o dono da lista. Mas o participante precisa
-- espelhar a PRÓPRIA resposta. Esta função SECURITY DEFINER faz exatamente isso e
-- NADA mais: atualiza response SÓ da linha (meeting, auth.uid()). Não deixa mexer
-- em quem participa, nem na resposta de outro. Google continua a verdade; o
-- espelho é secundário (se isto falhar, a resposta no Google já valeu).
-- =====================================================================

create or replace function set_my_meeting_response(p_meeting uuid, p_response text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_response is null
     or p_response not in ('accepted', 'declined', 'tentative', 'needsAction') then
    raise exception 'Resposta inválida.' using errcode = '22023';
  end if;

  update meeting_participants
     set response = p_response
   where meeting_id = p_meeting
     and user_id = auth.uid();

  if not found then
    raise exception 'Você não é participante desta reunião.'
      using errcode = '42501';
  end if;
end;
$$;

revoke execute on function set_my_meeting_response(uuid, text) from public, anon;
grant  execute on function set_my_meeting_response(uuid, text) to authenticated;

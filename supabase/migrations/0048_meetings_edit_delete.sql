-- =====================================================================
-- REUNIÕES — FATIA 1.1 (EDITAR / EXCLUIR). Alinha o RLS à regra de produto.
--
-- REGRA: SÓ QUEM CRIOU edita/exclui a própria reunião (a action sincroniza a
-- mudança no Google com o token DELE). O admin NÃO edita nem exclui pelo fluxo
-- normal — ele não tem o token Google do outro, então mexer no banco deixaria o
-- evento real intocado: o desencontro silencioso entre o que o sistema mostra e
-- a agenda da pessoa, exatamente o que o produto quer evitar (mesma filosofia do
-- fix da 0047).
--
-- CASO ÓRFÃO (o criador saiu da empresa / a conta Google se foi): o admin ganha
-- UMA saída explícita e separada — admin_delete_meeting(), que remove SÓ do
-- sistema e assume não tocar no Google. Nunca há "editar como admin".
-- =====================================================================

-- 1. UPDATE: de (created_by OR is_admin) para SÓ o criador.
drop policy meetings_update on meetings;
create policy meetings_update on meetings for update
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- 2. DELETE: a 0044 revogou delete de authenticated e não criou policy (ninguém
-- apagava direto). Agora o CRIADOR pode excluir a própria reunião — a action
-- apaga o evento no Google antes. O admin segue SEM delete direto (usa a função).
grant delete on meetings to authenticated;
create policy meetings_delete on meetings for delete
  using (created_by = auth.uid());

-- 3. Participantes: escrita só do criador (era created_by OR is_admin). Coerente
-- com "só quem criou edita". O admin_delete_meeting apaga participantes por
-- CASCADE (meeting_participants.meeting_id ... on delete cascade), sem depender
-- desta policy — é SECURITY DEFINER.
drop policy mp_write on meeting_participants;
create policy mp_write on meeting_participants for all
  using (exists (select 1 from meetings m
                  where m.id = meeting_id and m.created_by = auth.uid()))
  with check (exists (select 1 from meetings m
                  where m.id = meeting_id and m.created_by = auth.uid()));

-- 4. Faxina do admin para reunião ÓRFÃ. Remove SÓ do sistema; NUNCA toca no
-- Google (o admin não tem o token do criador — por construção, ver
-- [[google-calendar-etapa1]]). SECURITY DEFINER para apagar apesar da policy
-- estrita de delete; checa is_admin() por dentro (42501 se não for). Não relê a
-- própria linha por PK, então nada da armadilha do RETURNING (ver ESPECIFICACAO).
create or replace function admin_delete_meeting(p_meeting uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Apenas administradores podem remover reuniões de outros.'
      using errcode = '42501';
  end if;
  delete from meetings where id = p_meeting;
end;
$$;

revoke execute on function admin_delete_meeting(uuid) from public, anon;
grant  execute on function admin_delete_meeting(uuid) to authenticated;

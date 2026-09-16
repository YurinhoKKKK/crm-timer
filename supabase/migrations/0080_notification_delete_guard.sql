-- =====================================================================
-- CORREÇÃO (continuação da 0079) — excluir empresa também quebrava por FK em
-- notifications.
-- =====================================================================
-- Mesmo padrão do bug de company_events: ao excluir a empresa, o cascade apaga
-- as `meetings` dela e o gatilho BEFORE DELETE `notify_meeting_cancel` dispara,
-- chamando push_notification() para avisar os participantes do cancelamento —
-- mas a empresa JÁ SUMIU nesse ponto, e a FK notifications_company_id_fkey recusa
-- a inserção, abortando a exclusão:
--
--   insert or update on table "notifications" violates foreign key constraint
--   "notifications_company_id_fkey"
--
-- Todas as notificações são inseridas por UM único ponto — push_notification() —
-- então a proteção fica AQUI, central e à prova de futuros gatilhos: se vier um
-- company_id que não existe mais (empresa em exclusão), não há a quem/por-qual
-- empresa notificar — sai sem gravar. A FK continua intacta.
--
-- Só pula quando company_id NÃO é nulo E a empresa sumiu. Notificação sem empresa
-- (ex.: cancelar reunião sem cliente, resposta de chamado) segue normal — o
-- p_company nulo passa pela FK e não é caso de exclusão de empresa.
-- =====================================================================

create or replace function push_notification(
  p_user uuid, p_type text, p_title text, p_body text,
  p_company uuid, p_source_type text, p_source_id uuid, p_actor uuid
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_user is null then return; end if;
  if p_actor is not null and p_user = p_actor then return; end if;
  -- GUARD: empresa em exclusão (cascade) → não há empresa a que amarrar a
  -- notificação. A FK recusaria de qualquer forma; aqui sai limpo.
  if p_company is not null and not company_exists(p_company) then return; end if;
  insert into notifications
    (user_id, type, title, body, company_id, source_type, source_id, actor_id)
  values
    (p_user, p_type, p_title, p_body, p_company, p_source_type, p_source_id, p_actor);
end;
$$;

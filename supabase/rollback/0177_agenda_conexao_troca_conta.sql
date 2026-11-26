-- =====================================================================
-- Reversão da 0177 — restaura o estado anterior (0176/0175/0155/0043).
-- =====================================================================
-- Ordem: remove os objetos novos e recria as funções/CHECKs nas versões
-- anteriores. As linhas de auditoria criadas pela 0177 ('reconciliado_auto',
-- 'conta_trocada', 'empresa_alterada') são APAGADAS antes de restaurar os CHECKs
-- antigos — senão a restrição recusaria os valores novos. Isso é intencional
-- numa reversão; são apenas trilhas de auditoria desta rodada.
-- =====================================================================

-- 4/3. Conexão/troca e liberação automática.
drop function if exists google_connect_account(text, text, text, timestamptz, text);
drop function if exists google_mark_reconciled_if_clean();
drop index if exists google_accounts_email_lower_uniq;

-- 3b. google_delete_account volta à versão 0043 (sem a limpeza de espelho/sync).
create or replace function google_delete_account(p_revoked boolean)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'google_delete_account: sem sessão (auth.uid() nulo)'
      using errcode = '28000';
  end if;
  delete from google_accounts where user_id = v_user;
  insert into google_calendar_audit(user_id, action)
  values (v_user, case when p_revoked then 'revogado' else 'desconectado' end);
end;
$$;
revoke execute on function google_delete_account(boolean) from public, anon;
grant  execute on function google_delete_account(boolean) to authenticated;

-- 1. CHECK de google_calendar_audit.action — remove as ações novas.
delete from google_calendar_audit where action in ('reconciliado_auto', 'conta_trocada');
alter table google_calendar_audit drop constraint google_calendar_audit_action_check;
alter table google_calendar_audit add constraint google_calendar_audit_action_check
  check (action in ('conectado', 'desconectado', 'revogado', 'erro_revogacao'));

-- 5. ITEM 4 — auditoria da troca de empresa do timer.
--    meetings_timer_sync volta à versão 0175 (sem auditoria).
create or replace function meetings_timer_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update meeting_timers
     set scheduled_start = new.starts_at,
         scheduled_end   = new.ends_at,
         company_id      = new.company_id
   where meeting_id = new.id;
  return new;
end; $$;

drop trigger if exists trg_meetings_timer_sync on meetings;
create trigger trg_meetings_timer_sync
  after update of starts_at, ends_at, company_id on meetings
  for each row execute function meetings_timer_sync();

-- meeting_timer_audit_list volta à versão 0155 (sem nomes de empresa).
drop function if exists meeting_timer_audit_list(uuid);
create function meeting_timer_audit_list(p_timer uuid)
returns table(
  event_type text, edited_at timestamptz, edited_by uuid, editor_name text,
  old_seconds bigint, new_seconds bigint, justification text
)
language plpgsql stable security definer set search_path = public as $$
declare v_company uuid; v_owner uuid;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '28000'; end if;

  select a.company_id, a.started_by into v_company, v_owner
    from meeting_timer_audit a where a.timer_id = p_timer limit 1;
  if not found then
    return;
  end if;

  if not ((select is_admin())
          or v_owner = (select auth.uid())
          or v_company in (select my_consultant_companies())) then
    raise exception 'Histórico de reunião restrito.' using errcode = '42501';
  end if;

  return query
    select a.event_type, a.edited_at, a.edited_by,
           case when a.edited_by is null then null
                else (select d.name from display_profiles(array[a.edited_by]::uuid[]) d) end,
           a.old_seconds, a.new_seconds, a.justification
      from meeting_timer_audit a
     where a.timer_id = p_timer
     order by a.edited_at desc;
end;
$$;
revoke execute on function meeting_timer_audit_list(uuid) from public, anon;
grant  execute on function meeting_timer_audit_list(uuid) to authenticated;

-- event_type CHECK volta ao da 0175 (sem 'empresa_alterada') e remove a coluna.
delete from meeting_timer_audit where event_type = 'empresa_alterada';
alter table meeting_timer_audit drop constraint meeting_timer_audit_event_type_check;
alter table meeting_timer_audit add constraint meeting_timer_audit_event_type_check
  check (event_type = any (array['edit'::text, 'auto_close'::text, 'company_delete'::text]));
alter table meeting_timer_audit drop column if exists from_company_id;

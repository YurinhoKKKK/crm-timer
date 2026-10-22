-- =====================================================================
-- ROLLBACK da 0147 — volta ao estado 0145/0146.
-- =====================================================================
-- Remove as novas ações/triggers/janela, restaura os corpos de função e desfaz
-- as mudanças de esquema. Reaplica o REVOKE da 0146 nas funções recriadas por
-- DROP. ATENÇÃO: dados criados pela 0147 (trechos add/delete, origin_deleted_at)
-- não são "desfeitos" — este rollback é de ESQUEMA/lógica.
-- =====================================================================

-- 1) Triggers + funções de trigger novas.
drop trigger if exists trg_meetings_timer_sync on meetings;
drop trigger if exists trg_meetings_timer_detach on meetings;
drop function if exists meetings_timer_sync();
drop function if exists meetings_timer_detach();

-- 2) Ações/janela novas.
drop function if exists meeting_timer_add_segment(uuid, timestamptz, timestamptz);
drop function if exists meeting_timer_delete_segment(uuid);
drop function if exists meeting_window_ok(timestamptz, timestamptz);

-- 3) Restaura corpos de função ao estado 0145 (sem janela/validações novas).
create or replace function meeting_timer_start(
  p_meeting_id uuid default null, p_google_event_id text default null,
  p_company_id uuid default null, p_people uuid[] default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_company uuid; v_title text; v_sstart timestamptz; v_send timestamptz;
  v_creator uuid; v_existing meeting_timers%rowtype; v_timer uuid; v_open_at timestamptz;
  v_started timestamptz; v_resumed boolean := false; v_pre jsonb; v_person uuid;
begin
  if v_user is null then raise exception 'não autenticado' using errcode = '28000'; end if;
  if num_nonnulls(p_meeting_id, p_google_event_id) <> 1 then
    raise exception 'Informe exatamente uma origem: reunião do CRM ou evento do Google.'; end if;
  if p_meeting_id is not null then
    select company_id, title, starts_at, ends_at, created_by into v_company, v_title, v_sstart, v_send, v_creator
      from meetings where id = p_meeting_id;
    if not found then raise exception 'Reunião não encontrada.'; end if;
    if v_creator is distinct from v_user then
      raise exception 'Só quem criou a reunião no CRM pode iniciar o timer.' using errcode = '42501'; end if;
  else
    if exists (select 1 from meetings m where m.google_event_id = p_google_event_id) then
      raise exception 'Esta reunião foi criada pelo CRM. Use o timer da reunião.' using errcode = '42501'; end if;
    select title, starts_at, ends_at into v_title, v_sstart, v_send from imported_google_events
     where user_id = v_user and google_event_id = p_google_event_id order by updated_at desc limit 1;
    if not found then raise exception 'Só quem tem o evento na própria agenda do Google pode iniciar o timer.' using errcode = '42501'; end if;
    if exists (select 1 from imported_google_events where user_id = v_user and google_event_id = p_google_event_id and is_private) then
      raise exception 'Eventos particulares não podem ser cronometrados.' using errcode = '42501'; end if;
  end if;
  if p_meeting_id is not null then select * into v_existing from meeting_timers where meeting_id = p_meeting_id;
  else select * into v_existing from meeting_timers where google_event_id = p_google_event_id; end if;
  if found then
    if v_existing.started_by is distinct from v_user then
      raise exception 'Esta reunião já tem um timer iniciado por outra pessoa.' using errcode = '42501'; end if;
    v_timer := v_existing.id;
    select started_at into v_open_at from meeting_timer_segments where timer_id = v_timer and ended_at is null order by started_at desc limit 1;
    if v_open_at is not null then
      return jsonb_build_object('timer_id', v_timer, 'started_at', v_open_at, 'already_running', true, 'resumed', false); end if;
    v_resumed := true;
  end if;
  if v_timer is null and p_google_event_id is not null then
    if p_company_id is null then raise exception 'Escolha a empresa da reunião.'; end if;
    if not ((select is_admin()) or p_company_id in (select my_consultant_companies())) then
      raise exception 'Empresa fora do seu alcance.' using errcode = '42501'; end if;
    v_company := p_company_id;
  end if;
  v_pre := meeting_timer_preempt();
  if v_timer is null then
    insert into meeting_timers (company_id, meeting_id, google_event_id, title, scheduled_start, scheduled_end, started_by)
    values (v_company, p_meeting_id, p_google_event_id, v_title, v_sstart, v_send, v_user) returning id into v_timer;
    if p_meeting_id is not null then
      insert into meeting_timer_people (timer_id, user_id)
      select v_timer, v_user union select v_timer, mp.user_id from meeting_participants mp where mp.meeting_id = p_meeting_id
      on conflict do nothing;
    else
      insert into meeting_timer_people (timer_id, user_id) values (v_timer, v_user) on conflict do nothing;
      if p_people is not null then
        foreach v_person in array p_people loop
          if v_person is not null and v_person <> v_user then
            if not is_internal_user(v_person) then raise exception 'Participante inválido (não é usuário interno ativo).' using errcode = '22023'; end if;
            insert into meeting_timer_people (timer_id, user_id) values (v_timer, v_person) on conflict do nothing;
          end if;
        end loop;
      end if;
    end if;
  end if;
  insert into meeting_timer_segments (timer_id, started_at) values (v_timer, now()) returning started_at into v_started;
  return jsonb_build_object('timer_id', v_timer, 'started_at', v_started, 'resumed', v_resumed,
    'paused_task_id', v_pre->'paused_task_id', 'paused_task_title', v_pre->'paused_task_title');
end; $$;

create or replace function meeting_timer_resume(p_timer uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_owner uuid; v_started timestamptz; v_pre jsonb;
begin
  if v_user is null then raise exception 'não autenticado'; end if;
  select started_by into v_owner from meeting_timers where id = p_timer;
  if v_owner is null then raise exception 'Timer não encontrado.'; end if;
  if v_owner is distinct from v_user then raise exception 'Só quem iniciou pode retomar o timer da reunião.' using errcode = '42501'; end if;
  select started_at into v_started from meeting_timer_segments where timer_id = p_timer and ended_at is null order by started_at desc limit 1;
  if v_started is not null then return jsonb_build_object('timer_id', p_timer, 'started_at', v_started, 'already_running', true); end if;
  v_pre := meeting_timer_preempt();
  insert into meeting_timer_segments (timer_id, started_at) values (p_timer, now()) returning started_at into v_started;
  return jsonb_build_object('timer_id', p_timer, 'started_at', v_started,
    'paused_task_id', v_pre->'paused_task_id', 'paused_task_title', v_pre->'paused_task_title');
end; $$;

create or replace function meeting_timer_set_segment(p_segment uuid, p_started_at timestamptz, p_ended_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare v_timer uuid; v_old_start timestamptz; v_old_end timestamptz;
begin
  select timer_id, started_at, ended_at into v_timer, v_old_start, v_old_end from meeting_timer_segments where id = p_segment;
  if v_timer is null then raise exception 'Trecho não encontrado.'; end if;
  if not meeting_timer_owned(v_timer) then raise exception 'Só admin ou quem iniciou pode corrigir a duração.' using errcode = '42501'; end if;
  if p_started_at is null then raise exception 'O início é obrigatório.'; end if;
  if p_started_at > now() then raise exception 'O início não pode ser no futuro.'; end if;
  if p_ended_at is not null then
    if p_ended_at <= p_started_at then raise exception 'O fim deve ser depois do início.'; end if;
    if p_ended_at > now() then raise exception 'O fim não pode ser no futuro.'; end if;
  end if;
  update meeting_timer_segments set started_at = p_started_at, ended_at = p_ended_at,
     end_reason = case when p_ended_at is null then null else 'manual' end where id = p_segment;
  insert into meeting_timer_audit (segment_id, edited_by, old_started_at, new_started_at, old_ended_at, new_ended_at)
  values (p_segment, auth.uid(), v_old_start, p_started_at, v_old_end, p_ended_at);
end; $$;

drop function if exists my_open_meeting_timer();
create or replace function my_open_meeting_timer()
returns table(timer_id uuid, title text, company_id uuid, started_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.title, t.company_id, s.started_at
    from meeting_timers t join meeting_timer_segments s on s.timer_id = t.id and s.ended_at is null
   where t.started_by = auth.uid() order by s.started_at desc limit 1;
$$;
revoke execute on function my_open_meeting_timer() from public, anon;
grant  execute on function my_open_meeting_timer() to authenticated;

drop function if exists company_meeting_sessions(uuid, date, date);
create or replace function company_meeting_sessions(p_company uuid, p_start date default null, p_end date default null)
returns table(timer_id uuid, title text, started_at timestamptz, seconds bigint, auto_closed boolean, started_by uuid, people jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not ((select is_admin()) or p_company in (select my_consultant_companies())) then
    raise exception 'company_meeting_sessions: acesso restrito.' using errcode = '42501'; end if;
  return query
  with seg as (select s.timer_id, sum(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)))::bigint as secs,
                      min(s.started_at) as first_start, bool_or(s.end_reason = 'auto') as auto_closed
                 from meeting_timer_segments s group by s.timer_id)
  select t.id, t.title, seg.first_start, seg.secs, seg.auto_closed, t.started_by,
         coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.full_name, 'avatar_path', pr.avatar_path) order by pr.full_name)
                     from meeting_timer_people mp join profiles pr on pr.id = mp.user_id where mp.timer_id = t.id), '[]'::jsonb)
    from meeting_timers t join seg on seg.timer_id = t.id
   where t.company_id = p_company
     and (p_start is null or seg.first_start >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
     and (p_end   is null or seg.first_start <  (p_end::timestamp   at time zone 'America/Sao_Paulo'))
   order by seg.first_start desc;
end; $$;
revoke execute on function company_meeting_sessions(uuid, date, date) from public, anon;
grant  execute on function company_meeting_sessions(uuid, date, date) to authenticated;

-- 4) Esquema: reverter meeting_timers.
alter table meeting_timers drop constraint meeting_timers_check;
alter table meeting_timers add constraint meeting_timers_check check (num_nonnulls(meeting_id, google_event_id) = 1);
alter table meeting_timers drop column origin_deleted_at;
alter table meeting_timers drop constraint meeting_timers_meeting_id_fkey;
alter table meeting_timers add constraint meeting_timers_meeting_id_fkey
  foreign key (meeting_id) references meetings(id) on delete cascade;

-- 5) Esquema: reverter auditoria.
alter table meeting_timer_audit drop constraint meeting_timer_audit_segment_id_fkey;
alter table meeting_timer_audit add constraint meeting_timer_audit_segment_id_fkey
  foreign key (segment_id) references meeting_timer_segments(id) on delete cascade;
alter table meeting_timer_audit alter column segment_id set not null;
alter table meeting_timer_audit drop column timer_id;
alter table meeting_timer_audit drop column action;

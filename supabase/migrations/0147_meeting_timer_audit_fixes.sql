-- =====================================================================
-- 0147 — Auditoria do timer de reunião (correções pós-0145/0146)
-- =====================================================================
-- Fecha 10 problemas achados na auditoria. Decisões (não reabrir) no prompt.
-- Resumo do que muda:
--  (1) Janela de operação: Iniciar/Retomar só de (início-30min) a (fim+3h);
--      evento sem fim → início+4h. Fora disso, recusa pedindo "Adicionar trecho".
--      Mata o trecho de 0 s do cron e o timer iniciado dias antes.
--  (2) Correção de trecho: só trecho FECHADO, fim obrigatório, sem sobreposição,
--      ≤ 6 h, início/fim no passado.
--  (3) Novas ações add/delete de trecho (mesmas validações + auditoria). Excluir
--      o último trecho remove o timer. Auditoria não perde registro: timer_id
--      guardado + FK de segment_id vira ON DELETE SET NULL; coluna action.
--  (4) Excluir a reunião do CRM não apaga as horas: meeting_id → ON DELETE SET
--      NULL + origin_deleted_at (trigger) + CHECK que aceita os dois nulos só aí.
--  (5) Remarcar reunião: trigger sincroniza scheduled_start/scheduled_end.
--  (6) my_open_meeting_timer devolve total (card e rodapé mostram o mesmo total);
--      company_meeting_sessions devolve origin_deleted (rótulo "reunião excluída").
--
-- (7) Toda função nova nasce com REVOKE ... FROM public, anon. As recriadas por
--     DROP (my_open_meeting_timer, company_meeting_sessions) reconcedem o default
--     PUBLIC → re-aplicamos o revoke. As de `create or replace` sem DROP mantêm
--     os privilégios da 0146.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Tabela de auditoria: action + timer_id + segment_id ON DELETE SET NULL.
-- ---------------------------------------------------------------------
alter table meeting_timer_audit add column action text not null default 'edit'
  check (action in ('edit', 'add', 'delete'));
alter table meeting_timer_audit add column timer_id uuid;

update meeting_timer_audit a
   set timer_id = s.timer_id
  from meeting_timer_segments s
 where s.id = a.segment_id and a.timer_id is null;

alter table meeting_timer_audit alter column segment_id drop not null;
alter table meeting_timer_audit drop constraint meeting_timer_audit_segment_id_fkey;
alter table meeting_timer_audit add constraint meeting_timer_audit_segment_id_fkey
  foreign key (segment_id) references meeting_timer_segments(id) on delete set null;

-- ---------------------------------------------------------------------
-- 2) meeting_timers: meeting_id ON DELETE SET NULL + origin_deleted_at + CHECK.
-- ---------------------------------------------------------------------
alter table meeting_timers drop constraint meeting_timers_meeting_id_fkey;
alter table meeting_timers add constraint meeting_timers_meeting_id_fkey
  foreign key (meeting_id) references meetings(id) on delete set null;

alter table meeting_timers add column origin_deleted_at timestamptz;

alter table meeting_timers drop constraint meeting_timers_check;
alter table meeting_timers add constraint meeting_timers_check
  check (origin_deleted_at is not null or num_nonnulls(meeting_id, google_event_id) = 1);

-- ---------------------------------------------------------------------
-- 3) Triggers em meetings: remarcar sincroniza; excluir marca origin_deleted_at.
-- ---------------------------------------------------------------------
create or replace function meetings_timer_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update meeting_timers
     set scheduled_start = new.starts_at, scheduled_end = new.ends_at
   where meeting_id = new.id;
  return new;
end;
$$;

drop trigger if exists trg_meetings_timer_sync on meetings;
create trigger trg_meetings_timer_sync
  after update of starts_at, ends_at on meetings
  for each row execute function meetings_timer_sync();

-- BEFORE DELETE: marca origin_deleted_at ANTES do FK SET NULL zerar meeting_id,
-- para o CHECK aceitar os dois nulos (título já está guardado em meeting_timers).
create or replace function meetings_timer_detach()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update meeting_timers set origin_deleted_at = now()
   where meeting_id = old.id and origin_deleted_at is null;
  return old;
end;
$$;

drop trigger if exists trg_meetings_timer_detach on meetings;
create trigger trg_meetings_timer_detach
  before delete on meetings
  for each row execute function meetings_timer_detach();

-- ---------------------------------------------------------------------
-- 4) Janela de operação (decisão 1). Helper usado por start/resume.
--    [início - 30min, fim + 3h]; sem fim → [início - 30min, início + 4h].
-- ---------------------------------------------------------------------
create or replace function meeting_window_ok(p_sstart timestamptz, p_send timestamptz)
returns boolean language sql stable set search_path = public as $$
  select case
    when p_sstart is null then true
    else now() >= (p_sstart - interval '30 minutes')
         and now() <= coalesce(p_send + interval '3 hours', p_sstart + interval '4 hours')
  end;
$$;
revoke execute on function meeting_window_ok(timestamptz, timestamptz) from public, anon;

-- ---------------------------------------------------------------------
-- 5) meeting_timer_start — + checagem de janela (decisão 1). Resto igual à 0145.
--    Para timer já existente (retomada), a janela usa o agendado GUARDADO.
-- ---------------------------------------------------------------------
create or replace function meeting_timer_start(
  p_meeting_id      uuid default null,
  p_google_event_id text default null,
  p_company_id      uuid default null,
  p_people          uuid[] default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user      uuid := auth.uid();
  v_company   uuid;
  v_title     text;
  v_sstart    timestamptz;
  v_send      timestamptz;
  v_creator   uuid;
  v_existing  meeting_timers%rowtype;
  v_timer     uuid;
  v_open_at   timestamptz;
  v_started   timestamptz;
  v_resumed   boolean := false;
  v_pre       jsonb;
  v_person    uuid;
begin
  if v_user is null then raise exception 'não autenticado' using errcode = '28000'; end if;
  if num_nonnulls(p_meeting_id, p_google_event_id) <> 1 then
    raise exception 'Informe exatamente uma origem: reunião do CRM ou evento do Google.';
  end if;

  if p_meeting_id is not null then
    select company_id, title, starts_at, ends_at, created_by
      into v_company, v_title, v_sstart, v_send, v_creator
      from meetings where id = p_meeting_id;
    if not found then raise exception 'Reunião não encontrada.'; end if;
    if v_creator is distinct from v_user then
      raise exception 'Só quem criou a reunião no CRM pode iniciar o timer.' using errcode = '42501';
    end if;
  else
    if exists (select 1 from meetings m where m.google_event_id = p_google_event_id) then
      raise exception 'Esta reunião foi criada pelo CRM. Use o timer da reunião.' using errcode = '42501';
    end if;
    select title, starts_at, ends_at
      into v_title, v_sstart, v_send
      from imported_google_events
     where user_id = v_user and google_event_id = p_google_event_id
     order by updated_at desc limit 1;
    if not found then
      raise exception 'Só quem tem o evento na própria agenda do Google pode iniciar o timer.' using errcode = '42501';
    end if;
    if exists (select 1 from imported_google_events
                where user_id = v_user and google_event_id = p_google_event_id and is_private) then
      raise exception 'Eventos particulares não podem ser cronometrados.' using errcode = '42501';
    end if;
  end if;

  if p_meeting_id is not null then
    select * into v_existing from meeting_timers where meeting_id = p_meeting_id;
  else
    select * into v_existing from meeting_timers where google_event_id = p_google_event_id;
  end if;

  if found then
    if v_existing.started_by is distinct from v_user then
      raise exception 'Esta reunião já tem um timer iniciado por outra pessoa.' using errcode = '42501';
    end if;
    v_timer := v_existing.id;
    -- Retomada: a janela usa o agendado GUARDADO no timer (fonte da verdade).
    v_sstart := v_existing.scheduled_start;
    v_send   := v_existing.scheduled_end;
    select started_at into v_open_at
      from meeting_timer_segments where timer_id = v_timer and ended_at is null
      order by started_at desc limit 1;
    if v_open_at is not null then
      return jsonb_build_object('timer_id', v_timer, 'started_at', v_open_at,
                                'already_running', true, 'resumed', false);
    end if;
    v_resumed := true;
  end if;

  if v_timer is null and p_google_event_id is not null then
    if p_company_id is null then raise exception 'Escolha a empresa da reunião.'; end if;
    if not ((select is_admin()) or p_company_id in (select my_consultant_companies())) then
      raise exception 'Empresa fora do seu alcance.' using errcode = '42501';
    end if;
    v_company := p_company_id;
  end if;

  -- Janela de operação (decisão 1) — antes de pré-emptar a tarefa.
  if not meeting_window_ok(v_sstart, v_send) then
    raise exception 'Fora do horário da reunião. Use ''Adicionar trecho'' para registrar o tempo.';
  end if;

  v_pre := meeting_timer_preempt();

  if v_timer is null then
    insert into meeting_timers
      (company_id, meeting_id, google_event_id, title, scheduled_start, scheduled_end, started_by)
    values
      (v_company, p_meeting_id, p_google_event_id, v_title, v_sstart, v_send, v_user)
    returning id into v_timer;

    if p_meeting_id is not null then
      insert into meeting_timer_people (timer_id, user_id)
      select v_timer, v_user
      union
      select v_timer, mp.user_id from meeting_participants mp where mp.meeting_id = p_meeting_id
      on conflict do nothing;
    else
      insert into meeting_timer_people (timer_id, user_id) values (v_timer, v_user)
      on conflict do nothing;
      if p_people is not null then
        foreach v_person in array p_people loop
          if v_person is not null and v_person <> v_user then
            if not is_internal_user(v_person) then
              raise exception 'Participante inválido (não é usuário interno ativo).' using errcode = '22023';
            end if;
            insert into meeting_timer_people (timer_id, user_id) values (v_timer, v_person)
            on conflict do nothing;
          end if;
        end loop;
      end if;
    end if;
  end if;

  insert into meeting_timer_segments (timer_id, started_at) values (v_timer, now())
  returning started_at into v_started;

  return jsonb_build_object(
    'timer_id', v_timer, 'started_at', v_started, 'resumed', v_resumed,
    'paused_task_id', v_pre->'paused_task_id', 'paused_task_title', v_pre->'paused_task_title'
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 6) meeting_timer_resume — + checagem de janela (decisão 1).
-- ---------------------------------------------------------------------
create or replace function meeting_timer_resume(p_timer uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_owner uuid; v_started timestamptz; v_pre jsonb;
  v_sstart timestamptz; v_send timestamptz; v_exists boolean;
begin
  if v_user is null then raise exception 'não autenticado'; end if;
  select true, started_by, scheduled_start, scheduled_end
    into v_exists, v_owner, v_sstart, v_send
    from meeting_timers where id = p_timer;
  if v_exists is null then
    raise exception 'Timer não encontrado.';
  end if;
  if v_owner is distinct from v_user then
    raise exception 'Só quem iniciou pode retomar o timer da reunião.' using errcode = '42501';
  end if;
  select started_at into v_started from meeting_timer_segments
   where timer_id = p_timer and ended_at is null order by started_at desc limit 1;
  if v_started is not null then
    return jsonb_build_object('timer_id', p_timer, 'started_at', v_started, 'already_running', true);
  end if;
  if not meeting_window_ok(v_sstart, v_send) then
    raise exception 'Fora do horário da reunião. Use ''Adicionar trecho'' para registrar o tempo.';
  end if;
  v_pre := meeting_timer_preempt();
  insert into meeting_timer_segments (timer_id, started_at) values (p_timer, now())
  returning started_at into v_started;
  return jsonb_build_object('timer_id', p_timer, 'started_at', v_started,
    'paused_task_id', v_pre->'paused_task_id', 'paused_task_title', v_pre->'paused_task_title');
end;
$$;

-- ---------------------------------------------------------------------
-- 7) meeting_timer_set_segment — só FECHADO, fim obrigatório, sem sobreposição,
--    ≤ 6 h, passado. Auditoria 'edit'. (decisão 2)
-- ---------------------------------------------------------------------
create or replace function meeting_timer_set_segment(
  p_segment uuid, p_started_at timestamptz, p_ended_at timestamptz
) returns void
language plpgsql security definer set search_path = public as $$
declare v_timer uuid; v_old_start timestamptz; v_old_end timestamptz;
begin
  select timer_id, started_at, ended_at into v_timer, v_old_start, v_old_end
    from meeting_timer_segments where id = p_segment;
  if v_timer is null then raise exception 'Trecho não encontrado.'; end if;
  if not meeting_timer_owned(v_timer) then
    raise exception 'Só admin ou quem iniciou pode corrigir a duração.' using errcode = '42501';
  end if;
  if v_old_end is null then
    raise exception 'Não é possível editar um trecho em andamento. Encerre-o primeiro.';
  end if;
  if p_started_at is null or p_ended_at is null then
    raise exception 'Início e fim são obrigatórios.';
  end if;
  if p_started_at > now() or p_ended_at > now() then
    raise exception 'Início e fim devem estar no passado.';
  end if;
  if p_ended_at <= p_started_at then raise exception 'O fim deve ser depois do início.'; end if;
  if p_ended_at - p_started_at > interval '6 hours' then
    raise exception 'Um trecho não pode passar de 6 horas.';
  end if;
  if exists (
    select 1 from meeting_timer_segments s2
     where s2.timer_id = v_timer and s2.id <> p_segment
       and tstzrange(s2.started_at, coalesce(s2.ended_at, 'infinity'), '[)')
        && tstzrange(p_started_at, p_ended_at, '[)')
  ) then
    raise exception 'O trecho se sobrepõe a outro já registrado.';
  end if;

  update meeting_timer_segments
     set started_at = p_started_at, ended_at = p_ended_at, end_reason = 'manual'
   where id = p_segment;

  insert into meeting_timer_audit
    (segment_id, timer_id, action, edited_by, old_started_at, new_started_at, old_ended_at, new_ended_at)
  values (p_segment, v_timer, 'edit', auth.uid(), v_old_start, p_started_at, v_old_end, p_ended_at);
end;
$$;

-- ---------------------------------------------------------------------
-- 8) meeting_timer_add_segment — quem esqueceu de iniciar (decisão 3).
-- ---------------------------------------------------------------------
create or replace function meeting_timer_add_segment(
  p_timer uuid, p_started_at timestamptz, p_ended_at timestamptz
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_seg uuid;
begin
  if not exists (select 1 from meeting_timers where id = p_timer) then
    raise exception 'Timer não encontrado.';
  end if;
  if not meeting_timer_owned(p_timer) then
    raise exception 'Só admin ou quem iniciou pode adicionar trechos.' using errcode = '42501';
  end if;
  if p_started_at is null or p_ended_at is null then
    raise exception 'Início e fim são obrigatórios.';
  end if;
  if p_started_at > now() or p_ended_at > now() then
    raise exception 'Início e fim devem estar no passado.';
  end if;
  if p_ended_at <= p_started_at then raise exception 'O fim deve ser depois do início.'; end if;
  if p_ended_at - p_started_at > interval '6 hours' then
    raise exception 'Um trecho não pode passar de 6 horas.';
  end if;
  if exists (
    select 1 from meeting_timer_segments s2
     where s2.timer_id = p_timer
       and tstzrange(s2.started_at, coalesce(s2.ended_at, 'infinity'), '[)')
        && tstzrange(p_started_at, p_ended_at, '[)')
  ) then
    raise exception 'O trecho se sobrepõe a outro já registrado.';
  end if;

  insert into meeting_timer_segments (timer_id, started_at, ended_at, end_reason)
  values (p_timer, p_started_at, p_ended_at, 'manual') returning id into v_seg;

  insert into meeting_timer_audit
    (segment_id, timer_id, action, edited_by, old_started_at, new_started_at, old_ended_at, new_ended_at)
  values (v_seg, p_timer, 'add', auth.uid(), null, p_started_at, null, p_ended_at);
  return v_seg;
end;
$$;

-- ---------------------------------------------------------------------
-- 9) meeting_timer_delete_segment — exclui 1 trecho; se era o último, some o
--    timer. A auditoria sobrevive (timer_id guardado; segment_id vira null).
-- ---------------------------------------------------------------------
create or replace function meeting_timer_delete_segment(p_segment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_timer uuid; v_old_start timestamptz; v_old_end timestamptz; v_remaining int;
begin
  select timer_id, started_at, ended_at into v_timer, v_old_start, v_old_end
    from meeting_timer_segments where id = p_segment;
  if v_timer is null then raise exception 'Trecho não encontrado.'; end if;
  if not meeting_timer_owned(v_timer) then
    raise exception 'Só admin ou quem iniciou pode excluir trechos.' using errcode = '42501';
  end if;

  -- Audita ANTES (o delete zera segment_id via ON DELETE SET NULL; timer_id fica).
  insert into meeting_timer_audit
    (segment_id, timer_id, action, edited_by, old_started_at, new_started_at, old_ended_at, new_ended_at)
  values (p_segment, v_timer, 'delete', auth.uid(), v_old_start, null, v_old_end, null);

  delete from meeting_timer_segments where id = p_segment;

  select count(*) into v_remaining from meeting_timer_segments where timer_id = v_timer;
  if v_remaining = 0 then
    delete from meeting_timers where id = v_timer;  -- cascade em people; audit (sem FK p/ timer) preservada
  end if;
end;
$$;

revoke execute on function meeting_timer_add_segment(uuid, timestamptz, timestamptz)    from public, anon;
revoke execute on function meeting_timer_delete_segment(uuid)                            from public, anon;
grant  execute on function meeting_timer_add_segment(uuid, timestamptz, timestamptz)    to authenticated;
grant  execute on function meeting_timer_delete_segment(uuid)                            to authenticated;

-- ---------------------------------------------------------------------
-- 10) Leituras: my_open_meeting_timer devolve o TOTAL; company_meeting_sessions
--     devolve origin_deleted. DROP+CREATE → reconcede PUBLIC → re-revogar.
-- ---------------------------------------------------------------------
drop function if exists my_open_meeting_timer();
create or replace function my_open_meeting_timer()
returns table(timer_id uuid, title text, company_id uuid, started_at timestamptz, total_seconds bigint)
language sql stable security definer set search_path = public as $$
  select t.id, t.title, t.company_id, s.started_at,
         coalesce((select sum(extract(epoch from (coalesce(x.ended_at, now()) - x.started_at)))::bigint
                     from meeting_timer_segments x where x.timer_id = t.id), 0)
    from meeting_timers t
    join meeting_timer_segments s on s.timer_id = t.id and s.ended_at is null
   where t.started_by = auth.uid()
   order by s.started_at desc limit 1;
$$;
revoke execute on function my_open_meeting_timer() from public, anon;
grant  execute on function my_open_meeting_timer() to authenticated;

drop function if exists company_meeting_sessions(uuid, date, date);
create or replace function company_meeting_sessions(
  p_company uuid, p_start date default null, p_end date default null
) returns table(
  timer_id uuid, title text, started_at timestamptz, seconds bigint, auto_closed boolean,
  started_by uuid, origin_deleted boolean, people jsonb
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not ((select is_admin()) or p_company in (select my_consultant_companies())) then
    raise exception 'company_meeting_sessions: acesso restrito.' using errcode = '42501';
  end if;
  return query
  with seg as (
    select s.timer_id,
           sum(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)))::bigint as secs,
           min(s.started_at) as first_start,
           bool_or(s.end_reason = 'auto') as auto_closed
      from meeting_timer_segments s group by s.timer_id
  )
  select t.id, t.title, seg.first_start, seg.secs, seg.auto_closed, t.started_by,
         (t.origin_deleted_at is not null),
         coalesce((
           select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.full_name, 'avatar_path', pr.avatar_path)
                            order by pr.full_name)
             from meeting_timer_people mp join profiles pr on pr.id = mp.user_id
            where mp.timer_id = t.id
         ), '[]'::jsonb)
    from meeting_timers t join seg on seg.timer_id = t.id
   where t.company_id = p_company
     and (p_start is null or seg.first_start >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
     and (p_end   is null or seg.first_start <  (p_end::timestamp   at time zone 'America/Sao_Paulo'))
   order by seg.first_start desc;
end;
$$;
revoke execute on function company_meeting_sessions(uuid, date, date) from public, anon;
grant  execute on function company_meeting_sessions(uuid, date, date) to authenticated;

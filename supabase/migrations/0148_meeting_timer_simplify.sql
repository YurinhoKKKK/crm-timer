-- =====================================================================
-- 0148 — Simplifica o timer de REUNIÃO: Play / Pause / Finalizar / Editar
-- =====================================================================
-- SUBSTITUI o editor de trechos (0147). A interação passa a ter 4 botões no card
-- (para quem opera — criador da reunião do CRM ou dono do evento importado):
--   · Play      — inicia ou retoma (internamente abre um trecho novo, como antes).
--   · Pause     — fecha o trecho aberto; permite Play de novo (meeting_timer_stop).
--   · Finalizar — fecha o trecho aberto (se houver) e marca finalized_at; sem Play
--                 depois de finalizado.
--   · Editar    — só pausado/finalizado. Grava manual_seconds (1 min a 6 h) que
--                 SUBSTITUI a soma dos trechos, com justificativa (≥ 10 car.) e
--                 auditoria (quem, quando, tempo antes/depois, justificativa).
--
-- DECISÕES (não reabrir) — resumo do que o banco garante:
--  (2) Tempo da reunião = manual_seconds se preenchido; senão a soma dos trechos
--      (trecho aberto conta até agora). MESMA regra no card, rodapé, total da
--      empresa, Capacidade e drill-down.
--  (4) Trechos são SÓ internos: removidos meeting_timer_set_segment/add_segment/
--      delete_segment/segments_list (sem tela, sem EXECUTE).
--  (5) Play só a partir de 30 min antes do início agendado (sem fim → mesma regra
--      pelo início). Fora disso, recusa (a UI desabilita e mostra "Disponível a
--      partir de HH:MM"). O limite superior é a finalização automática do cron.
--  (6) Cron: a (fim+3h) ou (início+4h) sem fim, finaliza automaticamente QUALQUER
--      timer não finalizado — inclusive o PAUSADO (sem criar trecho de 0 s) —,
--      marca 'auto' e avisa quem iniciou. O aviso de +15 min continua.
--  (3) Auditoria append-only que não perde registros: timer_id sem FK (sobrevive à
--      exclusão do timer) + snapshots de empresa/título/dono.
--
-- Convenção (decisão 12): REVOKE ... FROM public, anon em toda função nova ou
-- recriada; EXECUTE só para authenticated nas de uso; helpers/cron sem EXECUTE.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Colunas: finalização + tempo manual.
-- ---------------------------------------------------------------------
alter table meeting_timers
  add column finalized_at     timestamptz,
  add column finalized_reason text check (finalized_reason in ('manual', 'auto')),
  add column manual_seconds   integer
    check (manual_seconds is null or (manual_seconds >= 60 and manual_seconds <= 21600));

-- ---------------------------------------------------------------------
-- 2) Remove o editor de trechos (decisão 4): RPCs sem tela e sem EXECUTE.
-- ---------------------------------------------------------------------
drop function if exists meeting_timer_set_segment(uuid, timestamptz, timestamptz);
drop function if exists meeting_timer_add_segment(uuid, timestamptz, timestamptz);
drop function if exists meeting_timer_delete_segment(uuid);
drop function if exists meeting_timer_segments_list(uuid);

-- ---------------------------------------------------------------------
-- 3) Auditoria das EDIÇÕES de tempo (decisão 3). A tabela 0147 era de trechos
--    (feature removida; só dados de teste) → recria com o formato novo.
--    timer_id SEM FK: o log sobrevive à exclusão do timer. Snapshots de
--    empresa/título/dono deixam a leitura íntegra mesmo sem o timer.
-- ---------------------------------------------------------------------
drop table if exists meeting_timer_audit cascade;

create table meeting_timer_audit (
  id            uuid primary key default gen_random_uuid(),
  timer_id      uuid,
  company_id    uuid,
  title         text,
  started_by    uuid,
  edited_by     uuid not null references profiles(id),
  edited_at     timestamptz not null default now(),
  old_seconds   bigint,
  new_seconds   bigint not null,
  justification text not null
);
create index meeting_timer_audit_timer_idx on meeting_timer_audit(timer_id);
alter table meeting_timer_audit enable row level security;

-- Leitura: admin, o dono do timer (snapshot) ou quem fez a edição. Sem escrita por
-- policy — só o RPC de edição (DEFINER) insere.
create policy mta_select on meeting_timer_audit for select
  using (
    (select is_admin())
    or started_by = (select auth.uid())
    or edited_by  = (select auth.uid())
  );
grant select on meeting_timer_audit to authenticated;

-- ---------------------------------------------------------------------
-- 4) Tempo efetivo de um timer (decisão 2): manual_seconds, se houver; senão a
--    soma dos trechos (o aberto conta até agora). Helper interno (DEFINER, sem
--    EXECUTE para logados — só é chamado por dentro de outras funções DEFINER).
-- ---------------------------------------------------------------------
create or replace function meeting_timer_total_seconds(p_timer uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(
    (select t.manual_seconds::bigint from meeting_timers t where t.id = p_timer),
    coalesce((select sum(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)))::bigint
                from meeting_timer_segments s where s.timer_id = p_timer), 0)
  );
$$;
revoke execute on function meeting_timer_total_seconds(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5) Janela de Play (decisão 5): a partir de 30 min antes do início agendado.
--    Sem início agendado, sempre liberado. Sem limite superior (o cron finaliza).
-- ---------------------------------------------------------------------
create or replace function meeting_play_allowed(p_sstart timestamptz)
returns boolean language sql stable set search_path = public as $$
  select p_sstart is null or now() >= (p_sstart - interval '30 minutes');
$$;
revoke execute on function meeting_play_allowed(timestamptz) from public, anon;

-- ---------------------------------------------------------------------
-- 6) INICIAR / RETOMAR (Play). Recusa timer finalizado; janela só pelo início
--    (decisão 5). Ao RETOMAR, limpa manual_seconds — Play significa voltar a
--    contar ao vivo (o ajuste manual anterior fica no log de auditoria).
-- ---------------------------------------------------------------------
create or replace function meeting_timer_start(
  p_meeting_id      uuid default null,
  p_google_event_id text default null,
  p_company_id      uuid default null,
  p_people          uuid[] default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user     uuid := auth.uid();
  v_company  uuid;
  v_title    text;
  v_sstart   timestamptz;
  v_send     timestamptz;
  v_creator  uuid;
  v_existing meeting_timers%rowtype;
  v_timer    uuid;
  v_open_at  timestamptz;
  v_started  timestamptz;
  v_resumed  boolean := false;
  v_pre      jsonb;
  v_person   uuid;
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
    if v_existing.finalized_at is not null then
      raise exception 'Esta reunião foi finalizada. Não é possível retomar o timer.' using errcode = '42501';
    end if;
    v_timer  := v_existing.id;
    -- Retomada: a janela usa o agendado GUARDADO no timer (fonte da verdade).
    v_sstart := v_existing.scheduled_start;
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

  -- Janela de Play (decisão 5) — antes de pré-emptar a tarefa.
  if not meeting_play_allowed(v_sstart) then
    raise exception 'O timer só pode começar a partir de 30 min antes do início da reunião (%).',
      to_char((v_sstart - interval '30 minutes') at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI');
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
  else
    -- Retomada (Play) limpa o tempo manual: volta a valer a soma dos trechos ao vivo.
    update meeting_timers set manual_seconds = null where id = v_timer;
  end if;

  insert into meeting_timer_segments (timer_id, started_at) values (v_timer, now())
  returning started_at into v_started;

  return jsonb_build_object(
    'timer_id', v_timer, 'started_at', v_started, 'resumed', v_resumed,
    'paused_task_id', v_pre->'paused_task_id', 'paused_task_title', v_pre->'paused_task_title'
  );
end;
$$;

create or replace function meeting_timer_resume(p_timer uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_owner uuid; v_started timestamptz; v_pre jsonb;
  v_sstart timestamptz; v_fin timestamptz; v_found boolean;
begin
  if v_user is null then raise exception 'não autenticado'; end if;
  select true, started_by, scheduled_start, finalized_at
    into v_found, v_owner, v_sstart, v_fin
    from meeting_timers where id = p_timer;
  if v_found is null then raise exception 'Timer não encontrado.'; end if;
  if v_owner is distinct from v_user then
    raise exception 'Só quem iniciou pode retomar o timer da reunião.' using errcode = '42501';
  end if;
  if v_fin is not null then
    raise exception 'Esta reunião foi finalizada. Não é possível retomar o timer.' using errcode = '42501';
  end if;
  select started_at into v_started from meeting_timer_segments
   where timer_id = p_timer and ended_at is null order by started_at desc limit 1;
  if v_started is not null then
    return jsonb_build_object('timer_id', p_timer, 'started_at', v_started, 'already_running', true);
  end if;
  if not meeting_play_allowed(v_sstart) then
    raise exception 'O timer só pode começar a partir de 30 min antes do início da reunião (%).',
      to_char((v_sstart - interval '30 minutes') at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI');
  end if;
  update meeting_timers set manual_seconds = null where id = p_timer;
  v_pre := meeting_timer_preempt();
  insert into meeting_timer_segments (timer_id, started_at) values (p_timer, now())
  returning started_at into v_started;
  return jsonb_build_object('timer_id', p_timer, 'started_at', v_started,
    'paused_task_id', v_pre->'paused_task_id', 'paused_task_title', v_pre->'paused_task_title');
end;
$$;

-- ---------------------------------------------------------------------
-- 7) FINALIZAR (decisão 1): fecha o trecho aberto (se houver) e marca finalized_at.
--    Só quem iniciou. Idempotente (não re-finaliza). Sem Play depois (ver 6).
-- ---------------------------------------------------------------------
create or replace function meeting_timer_finalize(p_timer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_owner uuid; v_fin timestamptz;
begin
  if v_user is null then raise exception 'não autenticado'; end if;
  select started_by, finalized_at into v_owner, v_fin from meeting_timers where id = p_timer;
  if v_owner is null then raise exception 'Timer não encontrado.'; end if;
  if v_owner is distinct from v_user then
    raise exception 'Só quem iniciou pode finalizar o timer da reunião.' using errcode = '42501';
  end if;
  update meeting_timer_segments set ended_at = now(), end_reason = 'manual'
   where timer_id = p_timer and ended_at is null;
  if v_fin is null then
    update meeting_timers set finalized_at = now(), finalized_reason = 'manual' where id = p_timer;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 8) EDITAR o tempo (decisão 1/3): grava manual_seconds (1 min a 6 h) com
--    justificativa (≥ 10 car.) e auditoria. Só pausado/finalizado (sem trecho
--    aberto). Só quem iniciou.
-- ---------------------------------------------------------------------
create or replace function meeting_timer_edit(
  p_timer uuid, p_seconds integer, p_justification text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_owner uuid; v_company uuid; v_title text;
  v_open int; v_old bigint; v_just text := btrim(coalesce(p_justification, ''));
begin
  if v_user is null then raise exception 'não autenticado'; end if;
  select started_by, company_id, title into v_owner, v_company, v_title
    from meeting_timers where id = p_timer;
  if v_owner is null then raise exception 'Timer não encontrado.'; end if;
  if v_owner is distinct from v_user then
    raise exception 'Só quem iniciou pode editar o tempo da reunião.' using errcode = '42501';
  end if;

  select count(*) into v_open from meeting_timer_segments
   where timer_id = p_timer and ended_at is null;
  if v_open > 0 then
    raise exception 'Pause ou finalize o timer antes de editar o tempo.';
  end if;

  if p_seconds is null then raise exception 'Informe o tempo da reunião.'; end if;
  if p_seconds < 60    then raise exception 'O tempo mínimo é 1 minuto.'; end if;
  if p_seconds > 21600 then raise exception 'O tempo máximo é 6 horas.'; end if;
  if length(v_just) < 10 then
    raise exception 'A justificativa é obrigatória (mínimo 10 caracteres).';
  end if;

  v_old := meeting_timer_total_seconds(p_timer);

  update meeting_timers set manual_seconds = p_seconds where id = p_timer;

  insert into meeting_timer_audit
    (timer_id, company_id, title, started_by, edited_by, old_seconds, new_seconds, justification)
  values (p_timer, v_company, v_title, v_owner, v_user, v_old, p_seconds, v_just);
end;
$$;

revoke execute on function meeting_timer_start(uuid, text, uuid, uuid[]) from public, anon;
revoke execute on function meeting_timer_resume(uuid)                    from public, anon;
revoke execute on function meeting_timer_finalize(uuid)                  from public, anon;
revoke execute on function meeting_timer_edit(uuid, integer, text)       from public, anon;
grant  execute on function meeting_timer_start(uuid, text, uuid, uuid[]) to authenticated;
grant  execute on function meeting_timer_resume(uuid)                    to authenticated;
grant  execute on function meeting_timer_finalize(uuid)                  to authenticated;
grant  execute on function meeting_timer_edit(uuid, integer, text)       to authenticated;

-- ---------------------------------------------------------------------
-- 9) Leituras para a UI — tempo EFETIVO (decisão 2) + flag finalized.
--    readable_meeting_timers muda o RETORNO (ganha finalized) → DROP + CREATE.
-- ---------------------------------------------------------------------
drop function if exists readable_meeting_timers();
create function readable_meeting_timers()
returns table(
  timer_id uuid, meeting_id uuid, google_event_id text, company_id uuid,
  title text, started_by uuid, is_open boolean, open_started_at timestamptz,
  finalized boolean, total_seconds bigint
)
language sql stable security invoker set search_path = public as $$
  select t.id, t.meeting_id, t.google_event_id, t.company_id, t.title, t.started_by,
         exists (select 1 from meeting_timer_segments s where s.timer_id = t.id and s.ended_at is null),
         (select s.started_at from meeting_timer_segments s
            where s.timer_id = t.id and s.ended_at is null order by s.started_at desc limit 1),
         (t.finalized_at is not null),
         coalesce(t.manual_seconds::bigint,
           coalesce((select sum(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)))::bigint
                       from meeting_timer_segments s where s.timer_id = t.id), 0))
    from meeting_timers t;
$$;
revoke execute on function readable_meeting_timers() from public, anon;
grant  execute on function readable_meeting_timers() to authenticated;

-- my_open_meeting_timer: já devolve o total pela soma dos trechos; o timer ABERTO
-- nunca tem manual_seconds (não se edita rodando), então o total segue correto.
-- Mantido como está (0147). company_meeting_sessions/capacity_person_meetings e
-- company_meeting_hours passam a somar o tempo EFETIVO por timer.

create or replace function company_meeting_hours(
  p_company uuid, p_start date default null, p_end date default null
) returns table(user_id uuid, user_name text, avatar_path text, seconds bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not ((select is_admin()) or p_company in (select my_consultant_companies())) then
    raise exception 'company_meeting_hours: acesso restrito.' using errcode = '42501';
  end if;
  return query
  with eff as (
    select t.id as timer_id, t.company_id,
           coalesce(t.manual_seconds::bigint,
             coalesce((select sum(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)))::bigint
                         from meeting_timer_segments s where s.timer_id = t.id), 0)) as secs,
           (select min(s.started_at) from meeting_timer_segments s where s.timer_id = t.id) as first_start
      from meeting_timers t
  ),
  scoped as (
    select timer_id, secs from eff
     where company_id = p_company
       and (p_start is null or first_start >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
       and (p_end   is null or first_start <  (p_end::timestamp   at time zone 'America/Sao_Paulo'))
  )
  select mtp.user_id, pr.full_name, pr.avatar_path, sum(sc.secs)::bigint
    from scoped sc
    join meeting_timer_people mtp on mtp.timer_id = sc.timer_id
    join profiles pr on pr.id = mtp.user_id
   group by mtp.user_id, pr.full_name, pr.avatar_path
   order by pr.full_name;
end;
$$;

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
  with eff as (
    select t.id as timer_id,
           coalesce(t.manual_seconds::bigint,
             coalesce((select sum(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)))::bigint
                         from meeting_timer_segments s where s.timer_id = t.id), 0)) as secs,
           (select min(s.started_at) from meeting_timer_segments s where s.timer_id = t.id) as first_start
      from meeting_timers t
  )
  select t.id, t.title, eff.first_start, eff.secs, coalesce(t.finalized_reason = 'auto', false), t.started_by,
         (t.origin_deleted_at is not null),
         coalesce((
           select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.full_name, 'avatar_path', pr.avatar_path)
                            order by pr.full_name)
             from meeting_timer_people mp join profiles pr on pr.id = mp.user_id
            where mp.timer_id = t.id
         ), '[]'::jsonb)
    from meeting_timers t join eff on eff.timer_id = t.id
   where t.company_id = p_company
     and (p_start is null or eff.first_start >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
     and (p_end   is null or eff.first_start <  (p_end::timestamp   at time zone 'America/Sao_Paulo'))
   order by eff.first_start desc;
end;
$$;

create or replace function capacity_person_meetings(
  p_person uuid, p_start date default null, p_end date default null
) returns table(
  company_id uuid, company_name text, title text, started_at timestamptz, seconds bigint, auto_closed boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (select is_admin()) then
    raise exception 'capacity_person_meetings: acesso restrito a administradores.' using errcode = '42501';
  end if;
  return query
  with eff as (
    select t.id as timer_id, t.company_id, coalesce(t.finalized_reason = 'auto', false) as auto_closed,
           coalesce(t.manual_seconds::bigint,
             coalesce((select sum(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)))::bigint
                         from meeting_timer_segments s where s.timer_id = t.id), 0)) as secs,
           (select min(s.started_at) from meeting_timer_segments s where s.timer_id = t.id) as first_start,
           t.title
      from meeting_timers t
  )
  select eff.company_id, c.name, eff.title, eff.first_start, eff.secs, eff.auto_closed
    from eff
    join meeting_timer_people mtp on mtp.timer_id = eff.timer_id and mtp.user_id = p_person
    join companies c on c.id = eff.company_id
   where (p_start is null or eff.first_start >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
     and (p_end   is null or eff.first_start <  (p_end::timestamp   at time zone 'America/Sao_Paulo'))
   order by eff.first_start desc;
end;
$$;

revoke execute on function company_meeting_hours(uuid, date, date)    from public, anon;
revoke execute on function company_meeting_sessions(uuid, date, date) from public, anon;
revoke execute on function capacity_person_meetings(uuid, date, date) from public, anon;
grant  execute on function company_meeting_hours(uuid, date, date)    to authenticated;
grant  execute on function company_meeting_sessions(uuid, date, date) to authenticated;
grant  execute on function capacity_person_meetings(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 10) Capacidade: coluna "Horas em reunião" passa a somar o tempo EFETIVO por
--     timer (decisão 2). Mesmo RETORNO da 0145 → create or replace (sem DROP,
--     sem janela de caveat e sem re-grant). ÚNICA mudança: o CTE `meet`.
-- ---------------------------------------------------------------------
create or replace function team_capacity(p_start date default null, p_end date default null)
returns table(
  person_id uuid, person_name text, avatar_path text,
  carteira_active integer, carteira_by_group jsonb, carteira_exclusive integer,
  carteira_shared integer, carteira_alerta integer, carteira_stalled integer,
  meeting_seconds bigint, is_executor boolean, act_seconds bigint,
  act_seconds_pontual bigint, act_seconds_diaria bigint, act_pontual_done integer,
  act_overdue integer, act_companies integer, act_has_activity boolean,
  colab_active integer, colab_by_group jsonb, has_colab_carteira boolean,
  colab_out_of_portfolio integer
)
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_excluded text[] := capacity_excluded_groups();
  v_start_ts timestamptz := case when p_start is null then null
                                 else p_start::timestamp at time zone 'America/Sao_Paulo' end;
  v_end_ts   timestamptz := case when p_end is null then null
                                 else p_end::timestamp at time zone 'America/Sao_Paulo' end;
begin
  if not is_admin() then
    raise exception 'team_capacity: acesso restrito a administradores' using errcode = '42501';
  end if;

  return query
  with
  people as (
    select consultant_id as id from company_consultants
    union
    select collaborator_id from task_instances where collaborator_id is not null
    union
    select collaborator_id from company_collaborators
  ),
  executors as (
    select distinct collaborator_id as id from task_instances where collaborator_id is not null
  ),
  carteira as (
    select cc.consultant_id as person,
           cc.company_id,
           coalesce(g.name, 'Sem grupo') as gname,
           coalesce(g.position, 2147483647) as gpos,
           (c.group_id is null or g.name is null or not (g.name = any(v_excluded))) as is_active
      from company_consultants cc
      join companies c on c.id = cc.company_id
      left join company_groups g on g.id = c.group_id
  ),
  active_carteira as (
    select person, company_id from carteira where is_active
  ),
  company_consultant_count as (
    select company_id, count(*) as n from company_consultants group by company_id
  ),
  followup as (
    select company_id, days_since from client_followup(30, true)
  ),
  by_group as (
    select person,
           jsonb_agg(jsonb_build_object('name', gname, 'count', n) order by gpos, gname) as list
      from (
        select person, gname, gpos, count(*) as n from carteira group by person, gname, gpos
      ) q
     group by person
  ),
  cart as (
    select ac.person,
           count(*) as active,
           count(*) filter (where ccc.n = 1) as exclusive,
           count(*) filter (where ccc.n > 1) as shared,
           count(*) filter (where al.company_id is not null) as alerta,
           count(*) filter (where fu.days_since > 15)      as stalled
      from active_carteira ac
      join company_consultant_count ccc on ccc.company_id = ac.company_id
      left join followup fu on fu.company_id = ac.company_id
      left join lateral (
        select 1 as company_id
          from company_effective_labels cl
          join labels l on l.id = cl.label_id
         where cl.company_id = ac.company_id and lower(l.name) = 'alerta'
         limit 1
      ) al on true
     group by ac.person
  ),
  -- Tempo de reunião por pessoa no período: tempo EFETIVO por timer (manual, se
  -- houver; senão a soma dos trechos), somado nos timers em que a pessoa conta.
  -- Período pelo início do 1º trecho (BRT).
  meet as (
    select mtp.user_id as person, sum(eff.secs)::bigint as secs
      from meeting_timer_people mtp
      join (
        select t.id as timer_id,
               coalesce(t.manual_seconds::bigint,
                 coalesce((select sum(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)))::bigint
                             from meeting_timer_segments s where s.timer_id = t.id), 0)) as secs,
               (select min(s.started_at) from meeting_timer_segments s where s.timer_id = t.id) as first_start
          from meeting_timers t
      ) eff on eff.timer_id = mtp.timer_id
     where (v_start_ts is null or eff.first_start >= v_start_ts)
       and (v_end_ts   is null or eff.first_start <  v_end_ts)
     group by mtp.user_id
  ),
  colab_carteira as (
    select cc.collaborator_id as person,
           coalesce(g.name, 'Sem grupo') as gname,
           coalesce(g.position, 2147483647) as gpos,
           (c.group_id is null or g.name is null or not (g.name = any(v_excluded))) as is_active
      from company_collaborators cc
      join companies c on c.id = cc.company_id
      left join company_groups g on g.id = c.group_id
  ),
  colab_by_group as (
    select person,
           jsonb_agg(jsonb_build_object('name', gname, 'count', n) order by gpos, gname) as list
      from (
        select person, gname, gpos, count(*) as n from colab_carteira group by person, gname, gpos
      ) q
     group by person
  ),
  colab_active as (
    select person, count(*) filter (where is_active) as active from colab_carteira group by person
  ),
  colab_outside as (
    select ti.collaborator_id as person, count(distinct ti.company_id) as n
      from task_instances ti
     where ti.collaborator_id is not null and ti.company_id is not null
       and ti.status in ('a_fazer', 'iniciada')
       and not exists (
         select 1 from company_collaborators cc
          where cc.company_id = ti.company_id and cc.collaborator_id = ti.collaborator_id
       )
     group by ti.collaborator_id
  ),
  act_time as (
    select te.collaborator_id as person,
           sum(entry_seconds(te.seconds, te.started_at, te.ended_at))::bigint as secs,
           (sum(entry_seconds(te.seconds, te.started_at, te.ended_at))
             filter (where tt.kind = 'diaria'))::bigint as secs_diaria,
           (sum(entry_seconds(te.seconds, te.started_at, te.ended_at))
             filter (where tt.kind is distinct from 'diaria'))::bigint as secs_pontual
      from time_entries te
      join task_instances t on t.id = te.task_id
      left join task_templates tt on tt.id = t.template_id
     where (v_start_ts is null or te.started_at >= v_start_ts)
       and (v_end_ts   is null or te.started_at <  v_end_ts)
     group by te.collaborator_id
  ),
  act_done as (
    select ti.collaborator_id as person, count(*) as done
      from task_instances ti
      join task_templates tt on tt.id = ti.template_id
     where ti.status = 'finalizada' and tt.kind = 'unica' and ti.finished_at is not null
       and (v_start_ts is null or ti.finished_at >= v_start_ts)
       and (v_end_ts   is null or ti.finished_at <  v_end_ts)
     group by ti.collaborator_id
  ),
  act_company_pairs as (
    select te.collaborator_id as person, t.company_id
      from time_entries te
      join task_instances t on t.id = te.task_id
     where (v_start_ts is null or te.started_at >= v_start_ts)
       and (v_end_ts   is null or te.started_at <  v_end_ts)
    union
    select ti.collaborator_id, ti.company_id
      from task_instances ti
      join task_templates tt on tt.id = ti.template_id
     where ti.status = 'finalizada' and tt.kind = 'unica' and ti.finished_at is not null
       and (v_start_ts is null or ti.finished_at >= v_start_ts)
       and (v_end_ts   is null or ti.finished_at <  v_end_ts)
  ),
  act_companies as (
    select person, count(distinct company_id) as companies
      from act_company_pairs where company_id is not null group by person
  ),
  act_overdue as (
    select ti.collaborator_id as person, count(*) as n
      from task_instances ti
     where ti.status in ('a_fazer', 'iniciada') and ti.due_at < now()
       and (p_start is null or ti.task_date >= p_start)
       and (p_end   is null or ti.task_date <  p_end)
     group by ti.collaborator_id
  )
  select
    pe.id,
    dp.name,
    dp.avatar_path,
    coalesce(cart.active, 0)::integer,
    coalesce(bg.list, '[]'::jsonb),
    coalesce(cart.exclusive, 0)::integer,
    coalesce(cart.shared, 0)::integer,
    coalesce(cart.alerta, 0)::integer,
    coalesce(cart.stalled, 0)::integer,
    coalesce(ms.secs, 0)::bigint,
    (ex.id is not null) as is_executor,
    coalesce(at.secs, 0)::bigint,
    coalesce(at.secs_pontual, 0)::bigint,
    coalesce(at.secs_diaria, 0)::bigint,
    coalesce(ad.done, 0)::integer,
    coalesce(ao.n, 0)::integer,
    coalesce(acp.companies, 0)::integer,
    (at.person is not null or ad.person is not null or ao.person is not null) as act_has_activity,
    coalesce(ca.active, 0)::integer,
    coalesce(cbg.list, '[]'::jsonb),
    (cbg.person is not null) as has_colab_carteira,
    coalesce(oop.n, 0)::integer
  from people pe
  left join lateral (
    select d.name, d.avatar_path from display_profiles(array[pe.id]::uuid[]) d
  ) dp on true
  left join executors ex on ex.id = pe.id
  left join cart      on cart.person = pe.id
  left join meet      ms on ms.person = pe.id
  left join by_group  bg on bg.person = pe.id
  left join colab_active ca on ca.person = pe.id
  left join colab_by_group cbg on cbg.person = pe.id
  left join colab_outside oop on oop.person = pe.id
  left join act_time  at on at.person = pe.id
  left join act_done  ad on ad.person = pe.id
  left join act_companies acp on acp.person = pe.id
  left join act_overdue ao on ao.person = pe.id;
end;
$$;

revoke execute on function team_capacity(date, date) from public, anon;
grant  execute on function team_capacity(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 11) Cron (decisão 6): aviso de +15 min + FINALIZAÇÃO automática a (fim+3h) /
--     (início+4h sem fim) de QUALQUER timer não finalizado — inclusive o PAUSADO,
--     sem criar trecho de 0 s. Marca finalized_reason 'auto' e avisa quem iniciou.
--     create or replace (o agendamento */5 já aponta para esta função).
-- ---------------------------------------------------------------------
create or replace function meeting_timer_cron()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_count int := 0;
begin
  -- (A) Aviso de +15 min — reuniões rodando, COM fim agendado, não finalizadas.
  for r in
    select t.id as timer_id, s.id as seg_id, t.started_by, t.company_id, t.title
      from meeting_timer_segments s
      join meeting_timers t on t.id = s.timer_id
     where s.ended_at is null and s.notified_overrun = false
       and t.finalized_at is null
       and t.scheduled_end is not null
       and now() >= t.scheduled_end + interval '15 minutes'
  loop
    perform push_notification(r.started_by, 'reuniao_em_andamento',
      'Reunião ainda em andamento?', r.title, r.company_id, 'meeting_timer', r.timer_id, null);
    update meeting_timer_segments set notified_overrun = true where id = r.seg_id;
  end loop;

  -- (B) Finalização automática. Fecha o trecho aberto (se houver) no alvo e marca
  --     o timer como finalizado 'auto'. Timer pausado finaliza sem tocar trechos.
  for r in
    select t.id as timer_id, t.started_by, t.company_id, t.title,
           case when t.scheduled_end is not null
                then t.scheduled_end + interval '3 hours'
                else (select min(s.started_at) from meeting_timer_segments s where s.timer_id = t.id)
                     + interval '4 hours' end as close_target
      from meeting_timers t
     where t.finalized_at is null
  loop
    if r.close_target is not null and now() >= r.close_target then
      update meeting_timer_segments
         set ended_at = greatest(r.close_target, started_at), end_reason = 'auto'
       where timer_id = r.timer_id and ended_at is null;
      update meeting_timers set finalized_at = now(), finalized_reason = 'auto'
       where id = r.timer_id;
      perform push_notification(r.started_by, 'reuniao_encerrada_auto',
        'Reunião encerrada automaticamente', r.title, r.company_id, 'meeting_timer', r.timer_id, null);
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke execute on function meeting_timer_cron() from public, anon, authenticated;

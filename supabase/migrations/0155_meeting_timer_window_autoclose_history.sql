-- =====================================================================
-- 0155 — Timer de REUNIÃO: fim da trava de Play, auto-close +5h/+12h, histórico
-- =====================================================================
-- Ajustes sobre a versão simplificada (0148/0149). NÃO reabre as decisões já
-- travadas; só muda o que o prompt pediu:
--
--  (1) FIM da trava "Play só 30 min antes": o banco NÃO bloqueia mais por horário.
--      meeting_timer_start/resume removem a checagem meeting_play_allowed (a função
--      é descartada). A confirmação de "muito cedo" vira 100% da UI (decisão 2).
--
--  (3) Finalização automática pelo cron:
--      (a) fim agendado + 5h (antes +3h) — fecha o trecho aberto no instante alvo.
--      (b) limite de segurança: trecho ABERTO há > 12h é fechado em início+12h
--          (pega o "Play por engano" numa reunião de outro dia).
--      (c) vale o que ocorrer PRIMEIRO entre (a) e (b) — least() ignora null.
--      (d) evento SEM fim agendado: mantém a regra atual (início do 1º trecho + 4h).
--      (e) todo encerramento 'auto' avisa quem iniciou com o HH:MM do fecho.
--      (f) o aviso de +15 min segue igual.
--      (g) vale para reuniões do CRM e eventos importados (opera em meeting_timers).
--
--  (4) Histórico de edições + encerramento automático:
--      · meeting_timer_audit ganha event_type ('edit' | 'auto_close') e edited_by
--        passa a aceitar NULL (evento de sistema). O cron grava uma linha
--        'auto_close' a cada encerramento automático.
--      · meeting_timer_audit_list(timer): RPC DEFINER, do mais recente ao mais
--        antigo, com gate admin / quem iniciou / consultor da empresa (mesmo escopo
--        das horas em reunião). Colaborador e cliente são recusados.
--      · a policy mta_select passa a incluir o consultor da empresa (para o flag
--        `edited` do card, lido via readable_meeting_timers que é INVOKER).
--      · readable_meeting_timers ganha a coluna `edited` (há ≥1 linha de auditoria)
--        para o card mostrar "Editado · ver histórico".
--
-- Convenção (decisão 12): REVOKE ... FROM public, anon em toda função nova/recriada.
-- Rollback completo em supabase/rollback/0155_*.sql (volta trava de 30 min e +3h).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Fim da trava de horário (decisão 1). A função de janela sai de cena; os
--    RPCs de Play deixam de bloquear por horário. Tudo o mais fica igual à 0148.
-- ---------------------------------------------------------------------
drop function if exists meeting_play_allowed(timestamptz);

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
    v_timer := v_existing.id;
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

  -- Sem trava de horário (decisão 1): Play sempre disponível para quem pode operar.
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
  v_fin timestamptz; v_found boolean;
begin
  if v_user is null then raise exception 'não autenticado'; end if;
  select true, started_by, finalized_at
    into v_found, v_owner, v_fin
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
  -- Sem trava de horário (decisão 1).
  update meeting_timers set manual_seconds = null where id = p_timer;
  v_pre := meeting_timer_preempt();
  insert into meeting_timer_segments (timer_id, started_at) values (p_timer, now())
  returning started_at into v_started;
  return jsonb_build_object('timer_id', p_timer, 'started_at', v_started,
    'paused_task_id', v_pre->'paused_task_id', 'paused_task_title', v_pre->'paused_task_title');
end;
$$;

revoke execute on function meeting_timer_start(uuid, text, uuid, uuid[]) from public, anon;
revoke execute on function meeting_timer_resume(uuid)                    from public, anon;
grant  execute on function meeting_timer_start(uuid, text, uuid, uuid[]) to authenticated;
grant  execute on function meeting_timer_resume(uuid)                    to authenticated;

-- ---------------------------------------------------------------------
-- 2) Auditoria: event_type + evento de sistema (edited_by NULL) (decisão 4).
--    'edit' = ajuste manual (edited_by = quem editou); 'auto_close' = fecho pelo
--    cron (edited_by NULL, justificativa de sistema).
-- ---------------------------------------------------------------------
alter table meeting_timer_audit
  add column if not exists event_type text not null default 'edit'
    check (event_type in ('edit', 'auto_close'));
alter table meeting_timer_audit alter column edited_by drop not null;

-- Leitura: admin, quem iniciou (snapshot), quem editou, OU consultor da empresa
-- (mesmo escopo das horas em reunião). Colaborador/cliente ficam de fora.
drop policy if exists mta_select on meeting_timer_audit;
create policy mta_select on meeting_timer_audit for select
  using (
    (select is_admin())
    or started_by = (select auth.uid())
    or edited_by  = (select auth.uid())
    or company_id in (select my_consultant_companies())
  );

-- ---------------------------------------------------------------------
-- 3) Histórico para a UI (decisão 4) — RPC DEFINER com gate + ordenado.
--    Sem linhas de auditoria → retorna vazio (não vaza a existência do timer).
-- ---------------------------------------------------------------------
create or replace function meeting_timer_audit_list(p_timer uuid)
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
    return; -- sem histórico: nada a mostrar
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

-- ---------------------------------------------------------------------
-- 4) readable_meeting_timers — ganha `edited` (há ≥1 linha de auditoria visível).
--    INVOKER: o exists respeita a policy mta_select (consultor vê; colaborador
--    não). Muda o RETORNO → DROP + CREATE. Restante idêntico à 0149.
-- ---------------------------------------------------------------------
drop function if exists readable_meeting_timers();
create function readable_meeting_timers()
returns table(
  timer_id uuid, meeting_id uuid, google_event_id text, company_id uuid,
  title text, started_by uuid, is_open boolean, open_started_at timestamptz,
  finalized boolean, base_seconds bigint, server_now timestamptz, edited boolean
)
language sql stable security invoker set search_path = public as $$
  select t.id, t.meeting_id, t.google_event_id, t.company_id, t.title, t.started_by,
         exists (select 1 from meeting_timer_segments s where s.timer_id = t.id and s.ended_at is null),
         (select s.started_at from meeting_timer_segments s
            where s.timer_id = t.id and s.ended_at is null order by s.started_at desc limit 1),
         (t.finalized_at is not null),
         coalesce(t.manual_seconds::bigint,
           coalesce((select sum(extract(epoch from (s.ended_at - s.started_at)))::bigint
                       from meeting_timer_segments s
                      where s.timer_id = t.id and s.ended_at is not null), 0)),
         now(),
         exists (select 1 from meeting_timer_audit a where a.timer_id = t.id)
    from meeting_timers t;
$$;
revoke execute on function readable_meeting_timers() from public, anon;
grant  execute on function readable_meeting_timers() to authenticated;

-- ---------------------------------------------------------------------
-- 5) Cron (decisão 3): +15 min (igual) + auto-close com +5h / início+12h / +4h.
--    Para cada timer não finalizado:
--      alvo (a) = fim agendado + 5h   (sem fim → início do 1º trecho + 4h)
--      alvo (b) = início do trecho ABERTO + 12h   (null quando não há aberto)
--      fecho   = least(a, b)   -- o que ocorrer primeiro (least ignora null)
--    Ao fechar: encerra o trecho aberto (se houver) no instante do alvo, marca
--    finalized 'auto', grava evento de auditoria 'auto_close' e avisa quem iniciou.
-- ---------------------------------------------------------------------
create or replace function meeting_timer_cron()
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record; v_count int := 0;
  v_target_a timestamptz; v_target_b timestamptz; v_close timestamptz;
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

  -- (B) Finalização automática — QUALQUER timer não finalizado (inclusive pausado).
  for r in
    select t.id as timer_id, t.started_by, t.company_id, t.title, t.scheduled_end,
           (select min(s.started_at) from meeting_timer_segments s where s.timer_id = t.id) as first_start,
           (select s.started_at from meeting_timer_segments s
              where s.timer_id = t.id and s.ended_at is null
              order by s.started_at desc limit 1) as open_start
      from meeting_timers t
     where t.finalized_at is null
  loop
    v_target_a := case when r.scheduled_end is not null
                       then r.scheduled_end + interval '5 hours'
                       else r.first_start + interval '4 hours' end;
    v_target_b := case when r.open_start is not null
                       then r.open_start + interval '12 hours'
                       else null end;
    v_close := least(v_target_a, v_target_b);

    if v_close is not null and now() >= v_close then
      update meeting_timer_segments
         set ended_at = greatest(v_close, started_at), end_reason = 'auto'
       where timer_id = r.timer_id and ended_at is null;
      update meeting_timers set finalized_at = now(), finalized_reason = 'auto'
       where id = r.timer_id;

      -- Evento de sistema no histórico (decisão 4). edited_at = instante do fecho.
      insert into meeting_timer_audit
        (timer_id, company_id, title, started_by, edited_by, edited_at,
         old_seconds, new_seconds, justification, event_type)
      values
        (r.timer_id, r.company_id, r.title, r.started_by, null, v_close,
         null, meeting_timer_total_seconds(r.timer_id),
         'Encerrado automaticamente', 'auto_close');

      perform push_notification(r.started_by, 'reuniao_encerrada_auto',
        'Timer de reunião encerrado automaticamente',
        'Encerrado às ' || to_char(v_close at time zone 'America/Sao_Paulo', 'HH24:MI')
          || '. Se a reunião durou mais, ajuste em Editar.',
        r.company_id, 'meeting_timer', r.timer_id, null);
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;
revoke execute on function meeting_timer_cron() from public, anon, authenticated;

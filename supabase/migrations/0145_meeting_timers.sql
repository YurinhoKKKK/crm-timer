-- =====================================================================
-- 0145 — Timer manual de REUNIÃO (CRM + eventos Google importados)
-- =====================================================================
-- Mede o tempo real de reunião com cliente para alimentar a Capacidade.
-- Iniciar/Encerrar/Retomar (duração = soma dos trechos). Vale para reuniões do
-- CRM (meetings) e para eventos importados do Google (imported_google_events).
--
-- DECISÕES (não reabrir) — ver o prompt. Resumo do que o banco garante:
--  (2) Reunião do CRM: só o CRIADOR inicia/encerra/retoma; credita criador +
--      meeting_participants. (3) Importado: só o DONO do evento na própria agenda
--      inicia (admin: qualquer empresa; consultor: só my_consultant_companies());
--      credita quem iniciou + os consultores marcados (p_people); privado não
--      cronometra. (4) UM timer por reunião: unique(meeting_id)/unique(google_event_id);
--      o 1º a iniciar é o dono; os outros só veem "em andamento". (5) Exclusão
--      MÚTUA TOTAL entre os 3 cronômetros (tarefa, atendimento-calibração, reunião):
--      iniciar/retomar reunião pausa a tarefa (mesmo cálculo do timer_pause),
--      encerra o atendimento e qualquer outro timer de reunião aberto; e iniciar
--      tarefa/atendimento encerra o timer de reunião aberto. (6) Nunca encerra no
--      horário previsto; cron a 5 min faz o aviso de +15 e o encerramento de +3h
--      (evento sem fim → início + 4h). (7) Correção de trecho por admin ou quem
--      iniciou, com auditoria. (9) Horas de reunião: só admin + consultor da
--      empresa (NÃO colaborador). (11) Policies com (select is_admin())/(select
--      auth.uid()). Cliente nunca vê nada disto.
--
-- Reaproveita o padrão do módulo de atendimento-calibração (0126): pausa de
-- tarefa, cron e RPC DEFINER com checagem explícita.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Novos tipos de notificação (CHECK fixo de 0077 + acréscimos desta fatia).
--    Preserva a lista VIVA (inclui os tipos somados por 0095/0128).
-- ---------------------------------------------------------------------
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check check (type in (
  'mencionado', 'resposta_recebida', 'tarefa_atribuida',
  'tarefa_recorrente_atribuida', 'listagem_ajuste_solicitado',
  'reuniao_convite', 'reuniao_cancelada',
  'empresa_onboarding', 'empresa_renovacao',
  'digisac_sync_auth', 'digisac_sync_error', 'digisac_sync_stalled',
  'reuniao_em_andamento', 'reuniao_encerrada_auto'
));

-- ---------------------------------------------------------------------
-- 1) Tabelas
-- ---------------------------------------------------------------------
-- UM timer por reunião do CRM OU por evento do Google (exatamente um dos dois).
-- title/scheduled_* são CÓPIA no início (o evento importado some num re-sync).
create table meeting_timers (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  meeting_id      uuid references meetings(id) on delete cascade,
  google_event_id text,
  title           text,
  scheduled_start timestamptz,
  scheduled_end   timestamptz,
  started_by      uuid not null references profiles(id),
  created_at      timestamptz not null default now(),
  check (num_nonnulls(meeting_id, google_event_id) = 1)
);

-- Um timer por reunião / por evento (decisão 4). NULLs são distintos no Postgres,
-- então o lado não usado (sempre null) não colide.
create unique index meeting_timers_meeting_uk  on meeting_timers(meeting_id)      where meeting_id is not null;
create unique index meeting_timers_gevent_uk   on meeting_timers(google_event_id) where google_event_id is not null;
create index meeting_timers_company_idx on meeting_timers(company_id);

-- Trechos (segmentos) do timer. ended_at null = aberto. end_reason só quando
-- fechado. notified_overrun: aviso de +15 min já enviado (decisão 6).
create table meeting_timer_segments (
  id              uuid primary key default gen_random_uuid(),
  timer_id        uuid not null references meeting_timers(id) on delete cascade,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  end_reason      text check (end_reason in ('manual', 'auto')),
  notified_overrun boolean not null default false,
  -- auto-close degenerado (fim calculado < início) pode gerar trecho de 0s; por
  -- isso >= (a validação ESTRITA fim>início mora no RPC de correção manual).
  check (ended_at is null or ended_at >= started_at)
);

-- No máximo UM trecho aberto por timer.
create unique index meeting_timer_one_open_per_timer
  on meeting_timer_segments(timer_id) where ended_at is null;
create index meeting_timer_segments_timer_idx on meeting_timer_segments(timer_id);

-- Quem recebe o tempo (decisões 2 e 3).
create table meeting_timer_people (
  timer_id uuid not null references meeting_timers(id) on delete cascade,
  user_id  uuid not null references profiles(id) on delete cascade,
  primary key (timer_id, user_id)
);

-- Auditoria das correções de duração (decisão 7).
create table meeting_timer_audit (
  id             uuid primary key default gen_random_uuid(),
  segment_id     uuid not null references meeting_timer_segments(id) on delete cascade,
  edited_by      uuid not null references profiles(id),
  edited_at      timestamptz not null default now(),
  old_started_at timestamptz,
  new_started_at timestamptz,
  old_ended_at   timestamptz,
  new_ended_at   timestamptz
);

alter table meeting_timers          enable row level security;
alter table meeting_timer_segments  enable row level security;
alter table meeting_timer_people    enable row level security;
alter table meeting_timer_audit     enable row level security;

-- ---------------------------------------------------------------------
-- 2) Helpers de visibilidade (DEFINER → sem recursão de RLS nas policies).
--    readable = admin OR quem iniciou OR creditado. owned = admin OR quem iniciou.
-- ---------------------------------------------------------------------
create or replace function meeting_timer_readable(p_timer uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (select is_admin())
      or exists (select 1 from meeting_timers t where t.id = p_timer and t.started_by = auth.uid())
      or exists (select 1 from meeting_timer_people p where p.timer_id = p_timer and p.user_id = auth.uid());
$$;

create or replace function meeting_timer_owned(p_timer uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (select is_admin())
      or exists (select 1 from meeting_timers t where t.id = p_timer and t.started_by = auth.uid());
$$;

revoke execute on function meeting_timer_readable(uuid) from public, anon;
revoke execute on function meeting_timer_owned(uuid)    from public, anon;
grant  execute on function meeting_timer_readable(uuid) to authenticated;
grant  execute on function meeting_timer_owned(uuid)    to authenticated;

-- ---------------------------------------------------------------------
-- 3) RLS: leitura direta pelos creditados/dono/admin. Sem policy de escrita —
--    toda escrita passa pelos RPCs DEFINER abaixo. anon nunca.
-- ---------------------------------------------------------------------
create policy mt_select on meeting_timers for select
  using (meeting_timer_readable(id));

create policy mts_select on meeting_timer_segments for select
  using (meeting_timer_readable(timer_id));

create policy mtp_select on meeting_timer_people for select
  using (meeting_timer_readable(timer_id));

-- Auditoria: só admin OU quem iniciou (não os demais creditados).
create policy mta_select on meeting_timer_audit for select
  using (
    (select is_admin())
    or exists (
      select 1 from meeting_timer_segments s
       where s.id = segment_id and meeting_timer_owned(s.timer_id)
    )
  );

grant select on meeting_timers         to authenticated;
grant select on meeting_timer_segments to authenticated;
grant select on meeting_timer_people   to authenticated;
grant select on meeting_timer_audit    to authenticated;

-- ---------------------------------------------------------------------
-- 4) Exclusão mútua — fechar o timer de reunião aberto do usuário.
--    Chamado por timer_start (tarefa) e attendance_start (atendimento) para a
--    direção reversa da decisão 5. Idempotente; seguro (só mexe no próprio).
-- ---------------------------------------------------------------------
create or replace function meeting_timer_stop_self()
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then return; end if;
  update meeting_timer_segments s
     set ended_at = now(), end_reason = 'manual'
    from meeting_timers t
   where s.timer_id = t.id and t.started_by = v_user and s.ended_at is null;
end;
$$;

-- Pré-empção ao INICIAR/RETOMAR uma reunião: pausa a tarefa (mesmo cálculo do
-- timer_pause), encerra o atendimento-calibração e fecha qualquer outro timer de
-- reunião aberto do usuário. Devolve a tarefa pausada (para a UI informar).
create or replace function meeting_timer_preempt()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user        uuid := auth.uid();
  v_task_ids    uuid[];
  v_paused_task uuid;
  v_paused_title text;
begin
  if v_user is null then return '{}'::jsonb; end if;

  select task_id into v_paused_task from time_entries
    where collaborator_id = v_user and ended_at is null
    order by started_at desc limit 1;
  if v_paused_task is not null then
    select title into v_paused_title from task_instances where id = v_paused_task;
  end if;

  select array_agg(distinct task_id) into v_task_ids
    from time_entries where collaborator_id = v_user and ended_at is null;

  update time_entries
     set ended_at = now(),
         seconds = greatest(0, floor(extract(epoch from (now() - started_at)))::int)
   where collaborator_id = v_user and ended_at is null;

  if v_task_ids is not null then
    update task_instances ti set total_seconds = agg.total
      from (
        select task_id, coalesce(sum(seconds), 0)::int as total
          from time_entries
         where collaborator_id = v_user and task_id = any(v_task_ids) and seconds is not null
         group by task_id
      ) agg
     where ti.id = agg.task_id;
  end if;

  perform attendance_stop();
  perform meeting_timer_stop_self();

  return jsonb_build_object('paused_task_id', v_paused_task, 'paused_task_title', v_paused_title);
end;
$$;

revoke execute on function meeting_timer_stop_self() from public, anon;
grant  execute on function meeting_timer_stop_self() to authenticated;
revoke execute on function meeting_timer_preempt()   from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5) INICIAR — reunião do CRM (p_meeting_id) OU evento do Google (p_google_event_id)
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

  -- -------- autorização + metadados por tipo --------
  if p_meeting_id is not null then
    select company_id, title, starts_at, ends_at, created_by
      into v_company, v_title, v_sstart, v_send, v_creator
      from meetings where id = p_meeting_id;
    if not found then raise exception 'Reunião não encontrada.'; end if;
    if v_creator is distinct from v_user then
      raise exception 'Só quem criou a reunião no CRM pode iniciar o timer.' using errcode = '42501';
    end if;
  else
    -- Reunião do CRM que também chegou como evento importado → usar o timer da reunião.
    if exists (select 1 from meetings m where m.google_event_id = p_google_event_id) then
      raise exception 'Esta reunião foi criada pelo CRM. Use o timer da reunião.' using errcode = '42501';
    end if;
    -- Dono do evento na própria agenda (vale até para admin — interpretação 1).
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
    -- A empresa só é exigida quando VAMOS CRIAR o timer (abaixo, após confirmar
    -- que ninguém iniciou ainda). Assim um 2º dono vê "já iniciado por outra
    -- pessoa" em vez de "empresa fora do alcance".
  end if;

  -- -------- timer único por reunião/evento (decisão 4) --------
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
    select started_at into v_open_at
      from meeting_timer_segments where timer_id = v_timer and ended_at is null
      order by started_at desc limit 1;
    if v_open_at is not null then
      -- já rodando (idempotente)
      return jsonb_build_object('timer_id', v_timer, 'started_at', v_open_at,
                                'already_running', true, 'resumed', false);
    end if;
    v_resumed := true;  -- estava pausado; vamos reabrir
  end if;

  -- -------- empresa: exigida só ao CRIAR um timer novo de evento importado --------
  if v_timer is null and p_google_event_id is not null then
    if p_company_id is null then raise exception 'Escolha a empresa da reunião.'; end if;
    if not ((select is_admin()) or p_company_id in (select my_consultant_companies())) then
      raise exception 'Empresa fora do seu alcance.' using errcode = '42501';
    end if;
    v_company := p_company_id;
  end if;

  -- -------- exclusão mútua (decisão 5) --------
  v_pre := meeting_timer_preempt();

  -- -------- cria o timer (se novo) + credita as pessoas --------
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

  -- -------- abre o trecho --------
  insert into meeting_timer_segments (timer_id, started_at) values (v_timer, now())
  returning started_at into v_started;

  return jsonb_build_object(
    'timer_id', v_timer, 'started_at', v_started, 'resumed', v_resumed,
    'paused_task_id', v_pre->'paused_task_id', 'paused_task_title', v_pre->'paused_task_title'
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 6) ENCERRAR / RETOMAR — só quem iniciou (started_by). Admin corrige por 7.
-- ---------------------------------------------------------------------
create or replace function meeting_timer_stop(p_timer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_owner uuid;
begin
  if v_user is null then raise exception 'não autenticado'; end if;
  select started_by into v_owner from meeting_timers where id = p_timer;
  if v_owner is null then raise exception 'Timer não encontrado.'; end if;
  if v_owner is distinct from v_user then
    raise exception 'Só quem iniciou pode encerrar o timer da reunião.' using errcode = '42501';
  end if;
  update meeting_timer_segments set ended_at = now(), end_reason = 'manual'
   where timer_id = p_timer and ended_at is null;
end;
$$;

create or replace function meeting_timer_resume(p_timer uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_owner uuid; v_started timestamptz; v_pre jsonb;
begin
  if v_user is null then raise exception 'não autenticado'; end if;
  select started_by into v_owner from meeting_timers where id = p_timer;
  if v_owner is null then raise exception 'Timer não encontrado.'; end if;
  if v_owner is distinct from v_user then
    raise exception 'Só quem iniciou pode retomar o timer da reunião.' using errcode = '42501';
  end if;
  -- já aberto → idempotente
  select started_at into v_started from meeting_timer_segments
   where timer_id = p_timer and ended_at is null order by started_at desc limit 1;
  if v_started is not null then
    return jsonb_build_object('timer_id', p_timer, 'started_at', v_started, 'already_running', true);
  end if;
  v_pre := meeting_timer_preempt();
  insert into meeting_timer_segments (timer_id, started_at) values (p_timer, now())
  returning started_at into v_started;
  return jsonb_build_object('timer_id', p_timer, 'started_at', v_started,
    'paused_task_id', v_pre->'paused_task_id', 'paused_task_title', v_pre->'paused_task_title');
end;
$$;

-- ---------------------------------------------------------------------
-- 7) CORREÇÃO de um trecho (decisão 7) — admin OU quem iniciou. Audita.
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
  if p_started_at is null then raise exception 'O início é obrigatório.'; end if;
  if p_started_at > now() then raise exception 'O início não pode ser no futuro.'; end if;
  if p_ended_at is not null then
    if p_ended_at <= p_started_at then raise exception 'O fim deve ser depois do início.'; end if;
    if p_ended_at > now() then raise exception 'O fim não pode ser no futuro.'; end if;
  end if;

  update meeting_timer_segments
     set started_at = p_started_at,
         ended_at   = p_ended_at,
         end_reason = case when p_ended_at is null then null else 'manual' end
   where id = p_segment;

  insert into meeting_timer_audit
    (segment_id, edited_by, old_started_at, new_started_at, old_ended_at, new_ended_at)
  values (p_segment, auth.uid(), v_old_start, p_started_at, v_old_end, p_ended_at);
end;
$$;

-- ---------------------------------------------------------------------
-- 8) Leituras para a UI
-- ---------------------------------------------------------------------
-- O timer de reunião ABERTO do próprio usuário (para o indicador global e para a
-- confirmação antes de iniciar tarefa/atendimento). No máximo um.
create or replace function my_open_meeting_timer()
returns table(timer_id uuid, title text, company_id uuid, started_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.title, t.company_id, s.started_at
    from meeting_timers t
    join meeting_timer_segments s on s.timer_id = t.id and s.ended_at is null
   where t.started_by = auth.uid()
   order by s.started_at desc limit 1;
$$;

-- Timers que o usuário ENXERGA (RLS filtra) — para os cards da Agenda e da aba.
-- is_open + segundos agregados; o card casa por meeting_id / google_event_id.
create or replace function readable_meeting_timers()
returns table(
  timer_id uuid, meeting_id uuid, google_event_id text, company_id uuid,
  title text, started_by uuid, is_open boolean, open_started_at timestamptz, total_seconds bigint
)
language sql stable security invoker set search_path = public as $$
  select t.id, t.meeting_id, t.google_event_id, t.company_id, t.title, t.started_by,
         exists (select 1 from meeting_timer_segments s where s.timer_id = t.id and s.ended_at is null),
         (select s.started_at from meeting_timer_segments s
            where s.timer_id = t.id and s.ended_at is null order by s.started_at desc limit 1),
         coalesce((select sum(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)))::bigint
                     from meeting_timer_segments s where s.timer_id = t.id), 0)
    from meeting_timers t;
$$;

-- imported_events_range ganha google_event_id + is_crm_meeting: a Agenda precisa
-- do id para INICIAR o timer de um evento importado e do flag para ESCONDER o
-- botão quando o evento, na verdade, é uma reunião do CRM (ajuste 2). Aditivo:
-- as colunas existentes seguem iguais; o front antigo ignora as novas. DROP+CREATE
-- porque muda o retorno. Curadoria de título particular idêntica à 0050.
drop function if exists imported_events_range(timestamptz, timestamptz);
create or replace function imported_events_range(p_from timestamptz, p_to timestamptz)
returns table (
  id uuid, owner_id uuid, title text, starts_at timestamptz, ends_at timestamptz,
  is_private boolean, google_event_id text, is_crm_meeting boolean
)
language sql stable security definer set search_path = public as $$
  select e.id, e.user_id,
         case when e.is_private and e.user_id <> auth.uid() then null else e.title end,
         e.starts_at, e.ends_at, e.is_private,
         e.google_event_id,
         exists (select 1 from meetings m where m.google_event_id = e.google_event_id) as is_crm_meeting
  from imported_google_events e
  where auth.uid() is not null and e.starts_at < p_to and e.ends_at > p_from
  order by e.starts_at;
$$;
revoke execute on function imported_events_range(timestamptz, timestamptz) from public, anon;
grant  execute on function imported_events_range(timestamptz, timestamptz) to authenticated;

-- Trechos de um timer para o editor de duração (decisão 7). Só admin/quem iniciou.
create or replace function meeting_timer_segments_list(p_timer uuid)
returns table(segment_id uuid, started_at timestamptz, ended_at timestamptz, end_reason text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not meeting_timer_owned(p_timer) then
    raise exception 'Acesso restrito.' using errcode = '42501';
  end if;
  return query
    select s.id, s.started_at, s.ended_at, s.end_reason
      from meeting_timer_segments s where s.timer_id = p_timer order by s.started_at;
end;
$$;

-- ---------------------------------------------------------------------
-- 9) Horas de reunião por empresa (decisão 9) — admin OU consultor DA EMPRESA.
--    Colaborador recebe ERRO de permissão (não é user_reaches_company).
--    Período: início do 1º trecho em BRT dentro de [p_start, p_end) (interpretação 3).
-- ---------------------------------------------------------------------
create or replace function company_meeting_hours(
  p_company uuid, p_start date default null, p_end date default null
) returns table(user_id uuid, user_name text, avatar_path text, seconds bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not ((select is_admin()) or p_company in (select my_consultant_companies())) then
    raise exception 'company_meeting_hours: acesso restrito.' using errcode = '42501';
  end if;
  return query
  with seg as (
    select s.timer_id,
           sum(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)))::bigint as secs,
           min(s.started_at) as first_start
      from meeting_timer_segments s group by s.timer_id
  ),
  scoped as (
    select t.id as timer_id, seg.secs
      from meeting_timers t join seg on seg.timer_id = t.id
     where t.company_id = p_company
       and (p_start is null or seg.first_start >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
       and (p_end   is null or seg.first_start <  (p_end::timestamp   at time zone 'America/Sao_Paulo'))
  )
  select mtp.user_id, pr.full_name, pr.avatar_path, sum(sc.secs)::bigint
    from scoped sc
    join meeting_timer_people mtp on mtp.timer_id = sc.timer_id
    join profiles pr on pr.id = mtp.user_id
   group by mtp.user_id, pr.full_name, pr.avatar_path
   order by pr.full_name;
end;
$$;

-- Lista das reuniões cronometradas da empresa (itens 3c/3d). Mesmo gate.
create or replace function company_meeting_sessions(
  p_company uuid, p_start date default null, p_end date default null
) returns table(
  timer_id uuid, title text, started_at timestamptz, seconds bigint, auto_closed boolean,
  started_by uuid, people jsonb
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

-- Drill-down clicável da coluna da Capacidade: reuniões de UMA pessoa no período.
-- Admin-only (a Capacidade já é admin-only).
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
  with seg as (
    select s.timer_id,
           sum(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)))::bigint as secs,
           min(s.started_at) as first_start,
           bool_or(s.end_reason = 'auto') as auto_closed
      from meeting_timer_segments s group by s.timer_id
  )
  select t.company_id, c.name, t.title, seg.first_start, seg.secs, seg.auto_closed
    from meeting_timers t
    join meeting_timer_people mtp on mtp.timer_id = t.id and mtp.user_id = p_person
    join seg on seg.timer_id = t.id
    join companies c on c.id = t.company_id
   where (p_start is null or seg.first_start >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
     and (p_end   is null or seg.first_start <  (p_end::timestamp   at time zone 'America/Sao_Paulo'))
   order by seg.first_start desc;
end;
$$;

-- ---------------------------------------------------------------------
-- 10) Exclusão mútua — direção reversa (decisão 5): iniciar TAREFA ou ATENDIMENTO
--     encerra o timer de reunião aberto. (A confirmação no app é da UI; o banco
--     só encerra.) Reescreve as duas funções vivas (0126) + perform stop_self.
-- ---------------------------------------------------------------------
create or replace function timer_start(p_task uuid)
returns timestamptz
language plpgsql as $$
declare
  v_collab uuid := auth.uid();
  v_status task_status;
  v_started timestamptz;
begin
  select status into v_status from task_instances
    where id = p_task and collaborator_id = v_collab;
  if v_status is null then raise exception 'tarefa nao encontrada'; end if;
  if v_status in ('finalizada','cancelada') then raise exception 'tarefa ja encerrada'; end if;

  perform attendance_stop();
  perform meeting_timer_stop_self();

  select started_at into v_started from time_entries
    where task_id = p_task and collaborator_id = v_collab and ended_at is null
    order by started_at desc limit 1;
  if v_started is not null then return v_started; end if;

  insert into time_entries (task_id, collaborator_id, started_at)
    values (p_task, v_collab, now())
    returning started_at into v_started;

  update task_instances
    set status = 'iniciada', started_at = coalesce(started_at, now())
    where id = p_task and collaborator_id = v_collab;

  return v_started;
end;
$$;

create or replace function attendance_start(p_company_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user         uuid := auth.uid();
  v_task_ids     uuid[];
  v_paused_task  uuid;
  v_paused_title text;
  v_started      timestamptz;
begin
  if v_user is null then raise exception 'não autenticado'; end if;
  if not attendance_is_enabled(v_user) then
    raise exception 'cronômetro de atendimento não habilitado para este usuário';
  end if;
  if not user_reaches_company(v_user, p_company_id) then
    raise exception 'empresa fora do seu alcance';
  end if;

  select array_agg(distinct task_id) into v_task_ids
    from time_entries where collaborator_id = v_user and ended_at is null;

  select task_id into v_paused_task from time_entries
    where collaborator_id = v_user and ended_at is null order by started_at desc limit 1;

  update time_entries
     set ended_at = now(),
         seconds = greatest(0, floor(extract(epoch from (now() - started_at)))::int)
   where collaborator_id = v_user and ended_at is null;

  if v_task_ids is not null then
    update task_instances ti set total_seconds = agg.total
      from (
        select task_id, coalesce(sum(seconds), 0)::int as total
          from time_entries
         where collaborator_id = v_user and task_id = any(v_task_ids) and seconds is not null
         group by task_id
      ) agg
     where ti.id = agg.task_id;
  end if;

  if v_paused_task is not null then
    select title into v_paused_title from task_instances where id = v_paused_task;
  end if;

  -- Começar um atendimento também encerra o timer de reunião aberto (decisão 5).
  perform meeting_timer_stop_self();

  update attendance_entries set ended_at = now()
   where user_id = v_user and ended_at is null;

  insert into attendance_entries (user_id, company_id, started_at)
    values (v_user, p_company_id, now())
    returning started_at into v_started;

  return jsonb_build_object(
    'started_at', v_started, 'paused_task_id', v_paused_task, 'paused_task_title', v_paused_title
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 11) Capacidade — troca "Sem registro" por "Horas em reunião" (decisão 10).
--     Muda o RETORNO → DROP + CREATE (decisão f). Base: versão viva (0107).
--     ÚNICAS mudanças: sai carteira_no_record, entra meeting_seconds; novo CTE
--     `meet` (segundos de reunião por pessoa, início do 1º trecho em BRT dentro
--     do período). team_capacity_drilldown fica intacto (a UI deixa de chamar o
--     scope 'sem_registro'; o drill novo é capacity_person_meetings).
-- ---------------------------------------------------------------------
drop function if exists team_capacity(date, date);

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
  meet as (
    select mtp.user_id as person, sum(sg.secs)::bigint as secs
      from meeting_timer_people mtp
      join (
        select s.timer_id,
               sum(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)))::bigint as secs,
               min(s.started_at) as first_start
          from meeting_timer_segments s group by s.timer_id
      ) sg on sg.timer_id = mtp.timer_id
     where (v_start_ts is null or sg.first_start >= v_start_ts)
       and (v_end_ts   is null or sg.first_start <  v_end_ts)
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

-- ---------------------------------------------------------------------
-- 12) Cron a cada 5 min (decisão 6): aviso de +15 min e encerramento de +3h
--     (evento sem fim → início + 4h). Sem EXECUTE para logados.
-- ---------------------------------------------------------------------
create or replace function meeting_timer_cron()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_count int := 0;
begin
  -- (A) Aviso de +15 min — só reuniões COM fim agendado; uma única vez.
  for r in
    select t.id as timer_id, s.id as seg_id, t.started_by, t.company_id, t.title
      from meeting_timer_segments s
      join meeting_timers t on t.id = s.timer_id
     where s.ended_at is null and s.notified_overrun = false
       and t.scheduled_end is not null
       and now() >= t.scheduled_end + interval '15 minutes'
  loop
    perform push_notification(r.started_by, 'reuniao_em_andamento',
      'Reunião ainda em andamento?', r.title, r.company_id, 'meeting_timer', r.timer_id, null);
    update meeting_timer_segments set notified_overrun = true where id = r.seg_id;
  end loop;

  -- (B) Encerramento automático de +3h (sem fim → início + 4h), end_reason 'auto'.
  for r in
    select s.id as seg_id, s.started_at, t.id as timer_id, t.started_by, t.company_id, t.title,
           case when t.scheduled_end is not null
                then t.scheduled_end + interval '3 hours'
                else fs.first_start + interval '4 hours' end as close_target
      from meeting_timer_segments s
      join meeting_timers t on t.id = s.timer_id
      join (select timer_id, min(started_at) as first_start
              from meeting_timer_segments group by timer_id) fs on fs.timer_id = t.id
     where s.ended_at is null
  loop
    if now() >= r.close_target then
      update meeting_timer_segments
         set ended_at = greatest(r.close_target, r.started_at), end_reason = 'auto'
       where id = r.seg_id;
      perform push_notification(r.started_by, 'reuniao_encerrada_auto',
        'Reunião encerrada automaticamente', r.title, r.company_id, 'meeting_timer', r.timer_id, null);
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

select cron.unschedule('meeting-timer-cron')
 where exists (select 1 from cron.job where jobname = 'meeting-timer-cron');

select cron.schedule('meeting-timer-cron', '*/5 * * * *', $$ select public.meeting_timer_cron(); $$);

-- ---------------------------------------------------------------------
-- 13) Grants (EXECUTE p/ authenticated; a autorização real está por dentro).
--     O cron e os helpers internos ficam SEM EXECUTE para logados.
-- ---------------------------------------------------------------------
grant execute on function meeting_timer_start(uuid, text, uuid, uuid[]) to authenticated;
grant execute on function meeting_timer_stop(uuid)                      to authenticated;
grant execute on function meeting_timer_resume(uuid)                    to authenticated;
grant execute on function meeting_timer_set_segment(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function meeting_timer_segments_list(uuid)             to authenticated;
grant execute on function my_open_meeting_timer()                       to authenticated;
grant execute on function readable_meeting_timers()                     to authenticated;
grant execute on function company_meeting_hours(uuid, date, date)       to authenticated;
grant execute on function company_meeting_sessions(uuid, date, date)    to authenticated;
grant execute on function capacity_person_meetings(uuid, date, date)    to authenticated;
grant execute on function team_capacity(date, date)                     to authenticated;

revoke execute on function meeting_timer_cron() from public, anon, authenticated;

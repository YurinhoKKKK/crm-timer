-- =====================================================================
-- CRM/Timer - Monvatti :: Cronômetro de ATENDIMENTO (calibração)
-- =====================================================================
-- Mede, por pessoa e por empresa, o tempo real de atendimento (WhatsApp etc.)
-- de DOIS colaboradores do teste, para comparar com a estimativa automática do
-- diagnóstico Digisac. É um módulo SEPARADO do cronômetro de TAREFAS:
--   - NÃO entra em time_entries, dashboards, gráficos, Capacidade, faturamento
--     nem relatórios existentes.
--   - Nunca os dois cronômetros (tarefa x atendimento) rodam ao mesmo tempo.
--
-- Habilitação por flag em profiles (só admin liga); a coluna/indicador no app
-- só aparecem para quem tem a flag. Escrita só por RPCs (DEFINER com checagem
-- explícita); um comando por passo, sem laço.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Habilitação
-- ---------------------------------------------------------------------
alter table profiles
  add column if not exists attendance_timer_enabled boolean not null default false;

-- Liga para os DOIS colaboradores do teste (por ID).
update profiles set attendance_timer_enabled = true
 where id in (
   '8b1aea49-5783-4b72-b641-4129cb8b8fdd', -- Marco Antonio Bristot Gomes
   '27cdaabe-f117-4a58-8051-130c5c4e81ea'  -- Marco de Jesus
 );

-- ---------------------------------------------------------------------
-- 2) Dados
-- ---------------------------------------------------------------------
create table if not exists attendance_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  company_id  uuid not null references companies(id) on delete cascade,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  auto_closed boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists attendance_entries_user_started_idx
  on attendance_entries (user_id, started_at);
create index if not exists attendance_entries_company_idx
  on attendance_entries (company_id);

-- No máximo UM atendimento aberto por pessoa.
create unique index if not exists attendance_one_open_per_user
  on attendance_entries (user_id) where ended_at is null;

-- ---------------------------------------------------------------------
-- 3) Helper de habilitação (DEFINER: não depende da RLS de profiles).
-- ---------------------------------------------------------------------
create or replace function attendance_is_enabled(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select attendance_timer_enabled from profiles where id = p_user),
    false
  );
$$;

-- ---------------------------------------------------------------------
-- 4) RLS: a pessoa lê só as PRÓPRIAS linhas, e só se tiver a flag ligada e
--    ALCANÇAR a empresa; admin lê tudo. Nenhuma policy de escrita: todas as
--    escritas passam pelos RPCs DEFINER abaixo.
-- ---------------------------------------------------------------------
alter table attendance_entries enable row level security;

drop policy if exists ae_select on attendance_entries;
create policy ae_select on attendance_entries
  for select
  using (
    (select is_admin())
    or (
      user_id = auth.uid()
      and attendance_is_enabled(auth.uid())
      and user_reaches_company(auth.uid(), company_id)
    )
  );

-- ---------------------------------------------------------------------
-- 5) Encerrar o atendimento aberto do próprio usuário (idempotente).
--    DEFINER + auth.uid(): encerrar é sempre seguro (não exige flag). Também é
--    chamado pelo timer_start (dar play numa TAREFA encerra o atendimento).
-- ---------------------------------------------------------------------
create or replace function attendance_stop()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'não autenticado';
  end if;
  update attendance_entries
     set ended_at = now()
   where user_id = v_user and ended_at is null;
end;
$$;

-- ---------------------------------------------------------------------
-- 6) Iniciar atendimento numa empresa.
--    Checagem explícita: flag ligada + alcança a empresa. Encerra o atendimento
--    anterior (se houver) e PAUSA o cronômetro de TAREFA aberto pelo mesmo
--    mecanismo do app (fecha o time_entry e recalcula total_seconds). Devolve
--    qual tarefa foi pausada (para a ação "Retomar") e o started_at do novo.
-- ---------------------------------------------------------------------
create or replace function attendance_start(p_company_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user         uuid := auth.uid();
  v_task_ids     uuid[];
  v_paused_task  uuid;
  v_paused_title text;
  v_started      timestamptz;
begin
  if v_user is null then
    raise exception 'não autenticado';
  end if;
  if not attendance_is_enabled(v_user) then
    raise exception 'cronômetro de atendimento não habilitado para este usuário';
  end if;
  if not user_reaches_company(v_user, p_company_id) then
    raise exception 'empresa fora do seu alcance';
  end if;

  -- (a) tarefas com cronômetro aberto do usuário (p/ recalcular depois) e qual
  --     reportar como pausada (a mais recente).
  select array_agg(distinct task_id) into v_task_ids
    from time_entries
   where collaborator_id = v_user and ended_at is null;

  select task_id into v_paused_task
    from time_entries
   where collaborator_id = v_user and ended_at is null
   order by started_at desc
   limit 1;

  -- (b) fecha os intervalos de tarefa abertos (mesmo cálculo do timer_pause).
  update time_entries
     set ended_at = now(),
         seconds = greatest(0, floor(extract(epoch from (now() - started_at)))::int)
   where collaborator_id = v_user and ended_at is null;

  -- (c) recalcula total_seconds só das tarefas afetadas.
  if v_task_ids is not null then
    update task_instances ti
       set total_seconds = agg.total
      from (
        select task_id, coalesce(sum(seconds), 0)::int as total
          from time_entries
         where collaborator_id = v_user
           and task_id = any(v_task_ids)
           and seconds is not null
         group by task_id
      ) agg
     where ti.id = agg.task_id;
  end if;

  if v_paused_task is not null then
    select title into v_paused_title from task_instances where id = v_paused_task;
  end if;

  -- (d) encerra atendimento anterior e (e) abre o novo.
  update attendance_entries set ended_at = now()
   where user_id = v_user and ended_at is null;

  insert into attendance_entries (user_id, company_id, started_at)
    values (v_user, p_company_id, now())
    returning started_at into v_started;

  return jsonb_build_object(
    'started_at', v_started,
    'paused_task_id', v_paused_task,
    'paused_task_title', v_paused_title
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 7) timer_start: dar play numa TAREFA encerra o atendimento aberto.
--    Reescrito igual à 0005, com um único acréscimo: perform attendance_stop().
-- ---------------------------------------------------------------------
create or replace function timer_start(p_task uuid)
returns timestamptz
language plpgsql
as $$
declare
  v_collab uuid := auth.uid();
  v_status task_status;
  v_started timestamptz;
begin
  select status into v_status from task_instances
    where id = p_task and collaborator_id = v_collab;
  if v_status is null then
    raise exception 'tarefa nao encontrada';
  end if;
  if v_status in ('finalizada','cancelada') then
    raise exception 'tarefa ja encerrada';
  end if;

  -- Nunca os dois cronômetros juntos: começar uma tarefa encerra o atendimento.
  perform attendance_stop();

  select started_at into v_started from time_entries
    where task_id = p_task and collaborator_id = v_collab and ended_at is null
    order by started_at desc limit 1;
  if v_started is not null then
    return v_started; -- já está rodando
  end if;

  insert into time_entries (task_id, collaborator_id, started_at)
    values (p_task, v_collab, now())
    returning started_at into v_started;

  update task_instances
    set status = 'iniciada',
        started_at = coalesce(started_at, now())
    where id = p_task and collaborator_id = v_collab;

  return v_started;
end;
$$;

-- ---------------------------------------------------------------------
-- 8) Cron: atendimento aberto há mais de 2h é encerrado em started_at + 2h,
--    marcado auto_closed. A cada 15 min.
-- ---------------------------------------------------------------------
create or replace function attendance_auto_close()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_count int;
begin
  with upd as (
    update attendance_entries
       set ended_at = started_at + interval '2 hours',
           auto_closed = true
     where ended_at is null
       and started_at < now() - interval '2 hours'
     returning 1
  )
  select count(*) into v_count from upd;
  return v_count;
end;
$$;

select cron.unschedule('attendance-auto-close')
 where exists (select 1 from cron.job where jobname = 'attendance-auto-close');

select cron.schedule(
  'attendance-auto-close',
  '*/15 * * * *',
  $$ select public.attendance_auto_close(); $$
);

-- ---------------------------------------------------------------------
-- 9) Leitura do painel (do PRÓPRIO usuário): atendimento aberto + total de hoje
--    por empresa. Agregação NO BANCO (nada de somar no JS). Dia em BRT.
-- ---------------------------------------------------------------------
create or replace function attendance_current()
returns table(company_id uuid, company_name text, company_number text, started_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select ae.company_id, c.name,
         substring(c.name from '^\s*(\d+)') as company_number,
         ae.started_at
    from attendance_entries ae
    join companies c on c.id = ae.company_id
   where ae.user_id = auth.uid() and ae.ended_at is null
   order by ae.started_at desc
   limit 1;
$$;

create or replace function attendance_today_totals()
returns table(company_id uuid, seconds integer)
language sql stable security definer set search_path = public
as $$
  select ae.company_id,
         coalesce(sum(extract(epoch from (coalesce(ae.ended_at, now()) - ae.started_at)))::int, 0)
    from attendance_entries ae
   where ae.user_id = auth.uid()
     and (ae.started_at at time zone 'America/Sao_Paulo')::date
         = (now() at time zone 'America/Sao_Paulo')::date
   group by ae.company_id;
$$;

-- ---------------------------------------------------------------------
-- 10) Relatório admin (DIA/SEMANA/MÊS em BRT, por pessoa e empresa). Admin-only
--     (gate is_admin por dentro; DEFINER lê tudo). Uma linha por
--     (pessoa, empresa, balde, auto_closed). Semana = segunda a domingo.
-- ---------------------------------------------------------------------
create or replace function attendance_admin_report(p_start date, p_end date, p_bucket text)
returns table(
  user_id uuid, user_name text,
  company_id uuid, company_number text, company_name text,
  bucket date, minutes numeric, auto_closed boolean, entries int
)
language sql stable security definer set search_path = public
as $$
  select user_id, user_name, company_id, company_number, company_name,
         bucket, round(sum(mins)::numeric, 2) as minutes, auto_closed,
         count(*)::int as entries
  from (
    select
      ae.user_id,
      pr.full_name as user_name,
      ae.company_id,
      substring(c.name from '^\s*(\d+)') as company_number,
      c.name as company_name,
      case lower(coalesce(p_bucket, 'day'))
        when 'week'  then date_trunc('week',  d)::date
        when 'month' then date_trunc('month', d)::date
        else d
      end as bucket,
      extract(epoch from (coalesce(ae.ended_at, now()) - ae.started_at)) / 60.0 as mins,
      ae.auto_closed
    from attendance_entries ae
    join profiles pr on pr.id = ae.user_id
    join companies c on c.id = ae.company_id
    cross join lateral (
      select (ae.started_at at time zone 'America/Sao_Paulo')::date as d
    ) x
    where (select is_admin())
      and (p_start is null or x.d >= p_start)
      and (p_end   is null or x.d <= p_end)
  ) s
  group by user_id, user_name, company_id, company_number, company_name, bucket, auto_closed
  order by user_name, company_name, bucket;
$$;

-- ---------------------------------------------------------------------
-- 11) Grants (EXECUTE para usuários autenticados; a autorização real está por
--     dentro de cada função).
-- ---------------------------------------------------------------------
grant execute on function attendance_start(uuid)            to authenticated;
grant execute on function attendance_stop()                 to authenticated;
grant execute on function attendance_current()              to authenticated;
grant execute on function attendance_today_totals()         to authenticated;
grant execute on function attendance_admin_report(date, date, text) to authenticated;
grant execute on function attendance_is_enabled(uuid)       to authenticated;

-- Leitura direta da tabela (a RLS ae_select é quem filtra as linhas). Sem grants
-- de escrita: INSERT/UPDATE/DELETE ficam sem policy e, com a RLS ligada, são
-- negados — toda escrita passa pelos RPCs DEFINER acima.
grant select on attendance_entries to authenticated;

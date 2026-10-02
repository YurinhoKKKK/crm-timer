-- 0098 — Período com LIMITE SUPERIOR (p_end) + critério de tarefas por PRAZO.
--
-- Problema: as RPCs de contagem filtravam `task_date >= p_start` SEM limite
-- superior. No "Hoje" entravam tarefas com prazo futuro e as atrasadas de dias
-- anteriores ficavam de fora. As RPCs de tempo também só tinham p_start, o que
-- impedia "Ontem" e período personalizado.
--
-- Correção:
--   1) Critério de TAREFA mora em UM lugar: a função `task_in_period`, baseada no
--      PRAZO (due_at convertido para America/Sao_Paulo, comparado como DATA) —
--      nunca task_date. Usada por todas as RPCs de contagem e pela RPC de lista.
--   2) As 8 RPCs (contagem + tempo) e a `time_by_task` (usada pelo detalhamento
--      do gráfico) ganham `p_end date default null`. DROP explícito das
--      assinaturas antigas na mesma migration para o PostgREST não ficar ambíguo.
--   3) Nova RPC `tasks_in_period` serve a lista do drill-down com EXATAMENTE o
--      mesmo critério das contagens (nunca filtro montado no JS).
--
-- Todas seguem SECURITY INVOKER (escopo pela RLS, como hoje).
-- Tempo mantém a regra do Passo 32.3 (time_entries pelo dia do started_at em
-- BRT; sessão que cruza a meia-noite fica no dia do started_at; correções
-- negativas com sinal) — só ganha o limite final. Tempo NÃO usa a regra de
-- atrasadas.

-- =====================================================================
-- 1) Helper do critério de tarefa por período
-- =====================================================================
-- Uma tarefa entra no período [p_start, p_end] (DATAS puras BRT) se:
--   (a) a DATA do prazo (due_at em BRT) está entre início e fim, inclusive, em
--       qualquer status; OU
--   (b) status em ('a_fazer','iniciada') E a DATA do prazo < início (atrasada
--       carregada de antes do recorte).
-- Finalizada/cancelada com prazo antes do início NÃO entra.
-- p_start e p_end nulos = "Tudo" (toda tarefa entra, igual a hoje).
-- p_end nulo com p_start preenchido = aberto até o futuro (retrocompatível).
create or replace function task_in_period(
  p_due_at    timestamptz,
  p_status    task_status,
  p_start     date,
  p_end       date
) returns boolean
  language sql
  stable
  set search_path to 'public'
as $$
  select
    case
      when p_start is null and p_end is null then true
      else
        (
          (p_start is null or (p_due_at at time zone 'America/Sao_Paulo')::date >= p_start)
          and
          (p_end is null or (p_due_at at time zone 'America/Sao_Paulo')::date <= p_end)
        )
        or
        (
          p_start is not null
          and p_status in ('a_fazer', 'iniciada')
          and (p_due_at at time zone 'America/Sao_Paulo')::date < p_start
        )
    end
$$;

comment on function task_in_period(timestamptz, task_status, date, date) is
  'Critério ÚNICO de pertencimento de tarefa a um período, por PRAZO (due_at em BRT como data): prazo dentro de [start,end] em qualquer status, OU aberta com prazo antes do início (atrasada carregada). start/end nulos = tudo.';

-- =====================================================================
-- 2) RPCs de CONTAGEM — critério por task_in_period + p_end
-- =====================================================================
drop function if exists task_status_counts(date, uuid);
create or replace function task_status_counts(
  p_start date,
  p_collaborator uuid default null,
  p_end date default null
) returns table(
  total bigint, a_fazer bigint, iniciada bigint,
  finalizada bigint, cancelada bigint, overdue bigint
)
  language sql
  stable
  set search_path to 'public'
as $$
  select
    count(*),
    count(*) filter (where status = 'a_fazer'),
    count(*) filter (where status = 'iniciada'),
    count(*) filter (where status = 'finalizada'),
    count(*) filter (where status = 'cancelada'),
    count(*) filter (where status in ('a_fazer', 'iniciada') and due_at < now())
  from task_instances
  where task_in_period(due_at, status, p_start, p_end)
    and (p_collaborator is null or collaborator_id = p_collaborator);
$$;

drop function if exists collaborator_task_counts(date);
create or replace function collaborator_task_counts(
  p_start date,
  p_end date default null
) returns table(collaborator_id uuid, total bigint, done bigint)
  language sql
  stable
  set search_path to 'public'
as $$
  select collaborator_id,
         count(*),
         count(*) filter (where status = 'finalizada')
  from task_instances
  where task_in_period(due_at, status, p_start, p_end)
  group by collaborator_id;
$$;

drop function if exists company_task_counts(date, uuid);
create or replace function company_task_counts(
  p_start date,
  p_collaborator uuid default null,
  p_end date default null
) returns table(
  company_id uuid, company_name text, total bigint, done bigint,
  pending bigint, overdue bigint, due_soon bigint
)
  language sql
  stable
  set search_path to 'public'
as $$
  select ti.company_id,
         c.name,
         count(*),
         count(*) filter (where ti.status = 'finalizada'),
         count(*) filter (where ti.status not in ('finalizada', 'cancelada')),
         count(*) filter (
           where ti.status not in ('finalizada', 'cancelada') and ti.due_at < now()
         ),
         count(*) filter (
           where ti.status not in ('finalizada', 'cancelada')
             and ti.due_at >= now()
             and ti.due_at < now() + interval '24 hours'
         )
    from task_instances ti
    left join companies c on c.id = ti.company_id
   where task_in_period(ti.due_at, ti.status, p_start, p_end)
     and (p_collaborator is null or ti.collaborator_id = p_collaborator)
   group by ti.company_id, c.name;
$$;

-- =====================================================================
-- 3) RPCs de TEMPO — só ganham o limite superior (started_at BRT < end+1)
-- =====================================================================
drop function if exists time_by_company(date, uuid);
create or replace function time_by_company(
  p_start date,
  p_collaborator uuid default null,
  p_end date default null
) returns table(company_id uuid, seconds bigint)
  language sql
  stable
  set search_path to 'public'
as $$
  select t.company_id,
         coalesce(sum(entry_seconds(te.seconds, te.started_at, te.ended_at)), 0)::bigint
    from time_entries te
    join task_instances t on t.id = te.task_id
   where (p_start is null or te.started_at >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
     and (p_end is null or te.started_at < ((p_end + 1)::timestamp at time zone 'America/Sao_Paulo'))
     and (p_collaborator is null or te.collaborator_id = p_collaborator)
   group by t.company_id;
$$;

drop function if exists time_by_collaborator(date);
create or replace function time_by_collaborator(
  p_start date,
  p_end date default null
) returns table(collaborator_id uuid, seconds bigint)
  language sql
  stable
  set search_path to 'public'
as $$
  select te.collaborator_id,
         coalesce(sum(entry_seconds(te.seconds, te.started_at, te.ended_at)), 0)::bigint
    from time_entries te
   where (p_start is null or te.started_at >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
     and (p_end is null or te.started_at < ((p_end + 1)::timestamp at time zone 'America/Sao_Paulo'))
   group by te.collaborator_id;
$$;

drop function if exists time_by_company_category(date, uuid);
create or replace function time_by_company_category(
  p_start date,
  p_collaborator uuid default null,
  p_end date default null
) returns table(company_id uuid, category text, seconds bigint)
  language sql
  stable
  set search_path to 'public'
as $$
  select t.company_id,
         coalesce(tt.category::text, 'listagem') as category,
         coalesce(sum(entry_seconds(te.seconds, te.started_at, te.ended_at)), 0)::bigint
    from time_entries te
    join task_instances t  on t.id = te.task_id
    join task_templates tt on tt.id = t.template_id
   where (p_start is null or te.started_at >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
     and (p_end is null or te.started_at < ((p_end + 1)::timestamp at time zone 'America/Sao_Paulo'))
     and (p_collaborator is null or te.collaborator_id = p_collaborator)
     and (tt.category is not null or tt.template_type = 'listagem')
   group by t.company_id, coalesce(tt.category::text, 'listagem');
$$;

drop function if exists time_by_company_standard(date, uuid);
create or replace function time_by_company_standard(
  p_start date,
  p_collaborator uuid default null,
  p_end date default null
) returns table(company_id uuid, seconds bigint)
  language sql
  stable
  set search_path to 'public'
as $$
  select t.company_id,
         coalesce(sum(entry_seconds(te.seconds, te.started_at, te.ended_at)), 0)::bigint
    from time_entries te
    join task_instances t  on t.id = te.task_id
    join task_templates tt on tt.id = t.template_id
   where (p_start is null or te.started_at >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
     and (p_end is null or te.started_at < ((p_end + 1)::timestamp at time zone 'America/Sao_Paulo'))
     and (p_collaborator is null or te.collaborator_id = p_collaborator)
     and tt.kind = 'diaria'
     and tt.category is null
     and tt.template_type <> 'listagem'
   group by t.company_id;
$$;

drop function if exists time_by_task(uuid, date, uuid);
create or replace function time_by_task(
  p_company uuid,
  p_start date,
  p_collaborator uuid default null,
  p_end date default null
) returns table(task_id uuid, seconds bigint)
  language sql
  stable
  set search_path to 'public'
as $$
  select te.task_id,
         coalesce(sum(entry_seconds(te.seconds, te.started_at, te.ended_at)), 0)::bigint
    from time_entries te
    join task_instances t on t.id = te.task_id
   where t.company_id = p_company
     and (p_start is null or te.started_at >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
     and (p_end is null or te.started_at < ((p_end + 1)::timestamp at time zone 'America/Sao_Paulo'))
     and (p_collaborator is null or te.collaborator_id = p_collaborator)
   group by te.task_id;
$$;

drop function if exists time_by_task_category(uuid, text, date, uuid);
create or replace function time_by_task_category(
  p_company uuid,
  p_category text,
  p_start date,
  p_collaborator uuid default null,
  p_end date default null
) returns table(task_id uuid, seconds bigint)
  language sql
  stable
  set search_path to 'public'
as $$
  select te.task_id,
         coalesce(sum(entry_seconds(te.seconds, te.started_at, te.ended_at)), 0)::bigint
    from time_entries te
    join task_instances t  on t.id = te.task_id
    join task_templates tt on tt.id = t.template_id
   where t.company_id = p_company
     and (p_start is null or te.started_at >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
     and (p_end is null or te.started_at < ((p_end + 1)::timestamp at time zone 'America/Sao_Paulo'))
     and (p_collaborator is null or te.collaborator_id = p_collaborator)
     and (
       case when p_category = '__diaria__'
            then tt.kind = 'diaria' and tt.category is null and tt.template_type <> 'listagem'
            else coalesce(tt.category::text, 'listagem') = p_category
                 and (tt.category is not null or tt.template_type = 'listagem')
       end
     )
   group by te.task_id;
$$;

-- =====================================================================
-- 4) RPC de LISTA por status — MESMO critério das contagens (task_in_period)
-- =====================================================================
-- Serve o drill-down do dashboard (/admin/instancias) e as listas da tela do
-- colaborador. p_filter: 'a_fazer'|'iniciada'|'finalizada'|'cancelada'|
-- 'atrasadas' | null (todas). p_limit traz o teto explícito (o cliente pede
-- CAP+1 para detectar corte). Ordena por prazo (nulos por último).
create or replace function tasks_in_period(
  p_filter       text,
  p_start        date,
  p_end          date default null,
  p_collaborator uuid default null,
  p_company      uuid default null,
  p_limit        int  default 301
) returns table(
  id uuid,
  title text,
  status task_status,
  due_at timestamptz,
  task_date date,
  template_id uuid,
  total_seconds integer,
  company_id uuid,
  company_name text,
  collaborator_full_name text,
  collaborator_email text,
  collaborator_avatar_path text
)
  language sql
  stable
  set search_path to 'public'
as $$
  select ti.id, ti.title, ti.status, ti.due_at, ti.task_date, ti.template_id,
         ti.total_seconds, ti.company_id, c.name,
         p.full_name, p.email, p.avatar_path
    from task_instances ti
    left join companies c on c.id = ti.company_id
    left join profiles  p on p.id = ti.collaborator_id
   where task_in_period(ti.due_at, ti.status, p_start, p_end)
     and (p_collaborator is null or ti.collaborator_id = p_collaborator)
     and (p_company is null or ti.company_id = p_company)
     and (
       p_filter is null
       or (p_filter = 'atrasadas' and ti.status in ('a_fazer','iniciada') and ti.due_at < now())
       or (p_filter in ('a_fazer','iniciada','finalizada','cancelada') and ti.status::text = p_filter)
     )
   order by ti.due_at asc nulls last
   limit greatest(p_limit, 0);
$$;

comment on function tasks_in_period(text, date, date, uuid, uuid, int) is
  'Lista de task_instances pelo MESMO critério de task_in_period (drill-down do dashboard e listas do colaborador). SECURITY INVOKER: escopo pela RLS.';

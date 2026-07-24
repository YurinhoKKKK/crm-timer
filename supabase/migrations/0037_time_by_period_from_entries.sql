-- =====================================================================
-- Correção: tempo POR PERÍODO vem de time_entries (started_at real),
-- não de task_instances.total_seconds filtrado por task_date.
-- =====================================================================
-- BUG: task_date é o PRAZO/dia agendado da tarefa, não o dia em que o
-- trabalho ocorreu. Agregar total_seconds por task_date responde "tempo das
-- tarefas PREVISTAS para o período" e exibe isso como "tempo TRABALHADO no
-- período" — perguntas diferentes. A verdade está em time_entries, que tem
-- started_at/ended_at reais. Ex.: uma listagem com prazo hoje, trabalhada
-- ontem, inflava o "Hoje" e sumia do total de ontem.
--
-- Regras desta correção:
-- - Janela do período em America/Sao_Paulo (BRT). Uma sessão pertence ao dia
--   do started_at; sessões que cruzam a meia-noite ficam INTEIRAS no dia do
--   started_at (sem rateio).
-- - Timer em andamento (ended_at null) conta now() - started_at.
-- - Ajustes manuais de tempo (passo 16) são time_entries (started_at=ended_at,
--   seconds = delta) e entram na soma normalmente — não são filtrados fora.
-- - NÃO muda: tempo POR TAREFA (total_seconds), contagens por status (task_date)
--   e seconds_all (tempo total da empresa, sem período) = sum(total_seconds).
-- - Tudo SECURITY INVOKER: herda te_select/ti_select — escopo por cargo idêntico
--   (admin tudo; consultor suas empresas; colaborador o próprio tempo).
-- - Sem índice novo: 815 time_entries → seq scan ~1ms (EXPLAIN ANALYZE).
--   Revisitar quando o volume justificar (mesma política do passo 29). O filtro
--   usa o limite inferior em timestamptz (meia-noite BRT), que é sargável por um
--   índice em started_at no dia em que ele fizer falta.
-- =====================================================================

-- Segundos de um intervalo: usa o valor gravado; se aberto (seconds null),
-- deriva de (ended_at | now()) - started_at. Nunca negativo.
create or replace function entry_seconds(
  p_seconds int, p_started timestamptz, p_ended timestamptz
) returns int
language sql
stable
set search_path = public
as $$
  select greatest(0, coalesce(
    p_seconds,
    floor(extract(epoch from (coalesce(p_ended, now()) - p_started)))::int
  ));
$$;

-- Tempo por empresa no período (opcionalmente escopado a um responsável, para
-- o gráfico da tela do colaborador). started_at >= meia-noite BRT de p_start.
create or replace function time_by_company(
  p_start date, p_collaborator uuid default null
) returns table (company_id uuid, seconds bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select t.company_id,
         coalesce(sum(entry_seconds(te.seconds, te.started_at, te.ended_at)), 0)::bigint
    from time_entries te
    join task_instances t on t.id = te.task_id
   where (p_start is null or te.started_at >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
     and (p_collaborator is null or te.collaborator_id = p_collaborator)
   group by t.company_id;
$$;

-- Tempo por responsável no período (global; a RLS te_select escopa por cargo).
create or replace function time_by_collaborator(
  p_start date
) returns table (collaborator_id uuid, seconds bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select te.collaborator_id,
         coalesce(sum(entry_seconds(te.seconds, te.started_at, te.ended_at)), 0)::bigint
    from time_entries te
   where (p_start is null or te.started_at >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
   group by te.collaborator_id;
$$;

-- Tempo por TAREFA de uma empresa no período (drill-down do gráfico). O tempo
-- por tarefa aqui é o TRABALHADO no período (não o total_seconds da tarefa),
-- para a soma do detalhamento bater exatamente com a barra.
create or replace function time_by_task(
  p_company uuid, p_start date, p_collaborator uuid default null
) returns table (task_id uuid, seconds bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select te.task_id,
         coalesce(sum(entry_seconds(te.seconds, te.started_at, te.ended_at)), 0)::bigint
    from time_entries te
    join task_instances t on t.id = te.task_id
   where t.company_id = p_company
     and (p_start is null or te.started_at >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
     and (p_collaborator is null or te.collaborator_id = p_collaborator)
   group by te.task_id;
$$;

-- company_overview: contagens por status seguem por task_date (INTACTAS); o
-- TEMPO do período e do mês passam a vir de time_entries (started_at BRT).
-- seconds_all (tempo total, sem período) permanece = sum(total_seconds).
create or replace function company_overview(
  p_company_id uuid, p_start date, p_month_start date
) returns table (
  total bigint, a_fazer bigint, iniciada bigint, finalizada bigint,
  cancelada bigint, overdue bigint,
  seconds_period bigint, seconds_month bigint, seconds_all bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*) filter (where p_start is null or task_date >= p_start),
    count(*) filter (where status = 'a_fazer'    and (p_start is null or task_date >= p_start)),
    count(*) filter (where status = 'iniciada'   and (p_start is null or task_date >= p_start)),
    count(*) filter (where status = 'finalizada' and (p_start is null or task_date >= p_start)),
    count(*) filter (where status = 'cancelada'  and (p_start is null or task_date >= p_start)),
    count(*) filter (
      where status in ('a_fazer', 'iniciada')
        and due_at < now()
        and (p_start is null or task_date >= p_start)
    ),
    (select coalesce(sum(entry_seconds(te.seconds, te.started_at, te.ended_at)), 0)
       from time_entries te
       join task_instances t2 on t2.id = te.task_id
      where t2.company_id = p_company_id
        and (p_start is null or te.started_at >= (p_start::timestamp at time zone 'America/Sao_Paulo'))),
    (select coalesce(sum(entry_seconds(te.seconds, te.started_at, te.ended_at)), 0)
       from time_entries te
       join task_instances t2 on t2.id = te.task_id
      where t2.company_id = p_company_id
        and te.started_at >= (p_month_start::timestamp at time zone 'America/Sao_Paulo')),
    coalesce(sum(total_seconds), 0)
  from task_instances
  where company_id = p_company_id;
$$;

-- company_collaborator_summary: total/done por task_date (contagens); SECONDS
-- por time_entries (started_at BRT). Inclui quem TRABALHOU no período mesmo que
-- a tarefa esteja datada fora dele (união por colaborador).
create or replace function company_collaborator_summary(
  p_company_id uuid, p_start date
) returns table (
  collaborator_id uuid, full_name text, email text, avatar_path text,
  seconds bigint, total bigint, done bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with counts as (
    select ti.collaborator_id,
           count(*) as total,
           count(*) filter (where ti.status = 'finalizada') as done
      from task_instances ti
     where ti.company_id = p_company_id
       and (p_start is null or ti.task_date >= p_start)
     group by ti.collaborator_id
  ),
  times as (
    select te.collaborator_id,
           sum(entry_seconds(te.seconds, te.started_at, te.ended_at)) as seconds
      from time_entries te
      join task_instances t on t.id = te.task_id
     where t.company_id = p_company_id
       and (p_start is null or te.started_at >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
     group by te.collaborator_id
  ),
  ids as (
    select collaborator_id from counts
    union
    select collaborator_id from times
  )
  select ids.collaborator_id, p.full_name, p.email, p.avatar_path,
         coalesce(times.seconds, 0)::bigint,
         coalesce(counts.total, 0)::bigint,
         coalesce(counts.done, 0)::bigint
    from ids
    left join counts on counts.collaborator_id = ids.collaborator_id
    left join times  on times.collaborator_id  = ids.collaborator_id
    left join profiles p on p.id = ids.collaborator_id
   order by coalesce(times.seconds, 0) desc;
$$;

grant execute on function entry_seconds(int, timestamptz, timestamptz) to authenticated;
grant execute on function time_by_company(date, uuid) to authenticated;
grant execute on function time_by_collaborator(date) to authenticated;
grant execute on function time_by_task(uuid, date, uuid) to authenticated;
grant execute on function company_overview(uuid, date, date) to authenticated;
grant execute on function company_collaborator_summary(uuid, date) to authenticated;

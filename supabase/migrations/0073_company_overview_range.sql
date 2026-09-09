-- =====================================================================
-- Central da empresa: filtro de período com LIMITE SUPERIOR (p_end)
-- =====================================================================
-- Os atalhos (Hoje/7d/30d/Tudo) só precisavam do início: são janelas abertas
-- que vão até hoje. O novo filtro acrescenta MÊS específico e INTERVALO livre —
-- ambos têm fim. As RPCs agregadas ganham `p_end date default null`:
--   • p_end null  → comportamento IDÊNTICO ao de antes (janela aberta até hoje);
--                   por isso o app em produção que só passa o início segue igual.
--   • p_end data  → limite superior INCLUSIVO. Contagens comparam task_date
--                   (data BRT) direto: task_date <= p_end. Tempo vem de
--                   time_entries por started_at BRT: started_at < meia-noite BRT
--                   do DIA SEGUINTE a p_end (o dia inteiro de p_end conta).
--
-- Data pura o tempo todo; a conversão para timestamptz (meia-noite BRT) acontece
-- só aqui no banco, como na 0037. NÃO muda a fonte do tempo (segue time_entries,
-- nunca task_date) nem seconds_all (tempo total, sem período).
--
-- create or replace não troca a assinatura (nº de args), então DROP + CREATE.
-- Tudo SECURITY INVOKER: a RLS de task_instances/time_entries escopa por cargo.
-- =====================================================================

-- --- company_overview: contagens + tempo do período (agora com fim) ----------
drop function if exists company_overview(uuid, date, date);
create or replace function company_overview(
  p_company_id uuid, p_start date, p_month_start date, p_end date default null
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
    count(*) filter (
      where (p_start is null or task_date >= p_start)
        and (p_end is null or task_date <= p_end)),
    count(*) filter (where status = 'a_fazer'
      and (p_start is null or task_date >= p_start)
      and (p_end is null or task_date <= p_end)),
    count(*) filter (where status = 'iniciada'
      and (p_start is null or task_date >= p_start)
      and (p_end is null or task_date <= p_end)),
    count(*) filter (where status = 'finalizada'
      and (p_start is null or task_date >= p_start)
      and (p_end is null or task_date <= p_end)),
    count(*) filter (where status = 'cancelada'
      and (p_start is null or task_date >= p_start)
      and (p_end is null or task_date <= p_end)),
    count(*) filter (
      where status in ('a_fazer', 'iniciada')
        and due_at < now()
        and (p_start is null or task_date >= p_start)
        and (p_end is null or task_date <= p_end)
    ),
    (select coalesce(sum(entry_seconds(te.seconds, te.started_at, te.ended_at)), 0)
       from time_entries te
       join task_instances t2 on t2.id = te.task_id
      where t2.company_id = p_company_id
        and (p_start is null or te.started_at >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
        and (p_end is null or te.started_at < ((p_end + 1)::timestamp at time zone 'America/Sao_Paulo'))),
    (select coalesce(sum(entry_seconds(te.seconds, te.started_at, te.ended_at)), 0)
       from time_entries te
       join task_instances t2 on t2.id = te.task_id
      where t2.company_id = p_company_id
        and te.started_at >= (p_month_start::timestamp at time zone 'America/Sao_Paulo')),
    coalesce(sum(total_seconds), 0)
  from task_instances
  where company_id = p_company_id;
$$;

-- --- company_collaborator_summary: resumo por colaborador (com fim) -----------
drop function if exists company_collaborator_summary(uuid, date);
create or replace function company_collaborator_summary(
  p_company_id uuid, p_start date, p_end date default null
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
       and (p_end is null or ti.task_date <= p_end)
     group by ti.collaborator_id
  ),
  times as (
    select te.collaborator_id,
           sum(entry_seconds(te.seconds, te.started_at, te.ended_at)) as seconds
      from time_entries te
      join task_instances t on t.id = te.task_id
     where t.company_id = p_company_id
       and (p_start is null or te.started_at >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
       and (p_end is null or te.started_at < ((p_end + 1)::timestamp at time zone 'America/Sao_Paulo'))
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

-- --- task_group_stats: contagens por template da lista (com fim) --------------
-- Chamada em vários lugares com parâmetros nomeados (uns sem período). Recriada
-- com p_end default null → todas as chamadas atuais seguem válidas (p_end vira
-- null e a função não filtra o teto).
drop function if exists task_group_stats(uuid, uuid, date);
create or replace function task_group_stats(
  p_company_id uuid default null,
  p_collaborator_id uuid default null,
  p_start date default null,
  p_end date default null
)
returns table (
  template_id uuid,
  total bigint,
  finalizadas bigint,
  canceladas bigint,
  abertas bigint,
  atrasadas bigint,
  seconds bigint,
  first_date date,
  last_date date
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    ti.template_id,
    count(*)::bigint                                             as total,
    count(*) filter (where ti.status = 'finalizada')             as finalizadas,
    count(*) filter (where ti.status = 'cancelada')              as canceladas,
    count(*) filter (where ti.status in ('a_fazer', 'iniciada')) as abertas,
    count(*) filter (
      where ti.status in ('a_fazer', 'iniciada') and ti.due_at < now()
    )                                                            as atrasadas,
    coalesce(sum(ti.total_seconds), 0)::bigint                   as seconds,
    min(ti.task_date)                                            as first_date,
    max(ti.task_date)                                            as last_date
  from task_instances ti
  where ti.template_id is not null
    and (p_company_id is null or ti.company_id = p_company_id)
    and (p_collaborator_id is null or ti.collaborator_id = p_collaborator_id)
    and (p_start is null or ti.task_date >= p_start)
    and (p_end is null or ti.task_date <= p_end)
  group by ti.template_id
  having count(*) > 1;
$$;

grant execute on function company_overview(uuid, date, date, date) to authenticated;
grant execute on function company_collaborator_summary(uuid, date, date) to authenticated;
grant execute on function task_group_stats(uuid, uuid, date, date) to authenticated;

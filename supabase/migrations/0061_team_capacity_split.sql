-- =====================================================================
-- Capacidade da equipe — REFINO da 0060 (mesma RPC/cálculo, ajuste de forma).
--
-- Motivos (a tela vira DUAS tabelas: consultores × colaboradores):
--  1. "Recebidos 30/90" saía de company_consultants.assigned_at, que é a data em
--     que o VÍNCULO foi criado no banco (cargas em massa: 86 em 09/07, 61 em
--     04/08), não a chegada do cliente. Número sem lastro → REMOVIDO (received_30/
--     received_90). Sem um campo real de data de entrada, ele não existe.
--  2. is_executor: quem tem execução (task_instances.collaborator_id em QUALQUER
--     tempo) — período-independente. É o que decide se a pessoa entra na tabela de
--     COLABORADORES, para um colaborador sem trabalho NO PERÍODO ainda aparecer
--     (com "sem registro no período") em vez de sumir. A tabela de CONSULTORES é
--     decidida no front por ter carteira (carteira_by_group não-vazio).
--  3. act_has_activity vira o CRITÉRIO ÚNICO de vazio: houve QUALQUER registro no
--     período? = trabalhou horas OU concluiu pontual OU tem atrasada no período.
--     Sem nenhum → traço "sem registro"; com algum → números reais (0,0 h é zero
--     medido de verdade). Antes ignorava atrasadas.
--
-- Troca a assinatura (some received_*, entra is_executor), então dropa a versão
-- antiga para não deixar overload. Todo o resto do cálculo é idêntico à 0060.
-- Continua admin-only (is_admin() por dentro), SECURITY INVOKER.
-- =====================================================================
drop function if exists team_capacity(date, date);

create or replace function team_capacity(
  p_start date default null,
  p_end   date default null
)
returns table (
  person_id            uuid,
  person_name          text,
  avatar_path          text,
  -- CARTEIRA (situação atual — não muda com o período)
  carteira_active      integer,
  carteira_by_group    jsonb,
  carteira_exclusive   integer,
  carteira_shared      integer,
  carteira_alerta      integer,
  carteira_red         integer,
  -- Tem execução em qualquer tempo? (decide a tabela de colaboradores)
  is_executor          boolean,
  -- ATIVIDADE (no período)
  act_seconds          bigint,
  act_seconds_pontual  bigint,
  act_seconds_diaria   bigint,
  act_pontual_done     integer,
  act_overdue          integer,
  act_companies        integer,
  act_has_activity     boolean
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  -- >>> LISTA DE EXCLUSÃO — o único ponto a ajustar para redefinir "ativo". <<<
  v_excluded text[] := array['Cancelados', 'Pausados', 'Projetos Finalizados'];
  v_start_ts timestamptz := case when p_start is null then null
                                 else p_start::timestamp at time zone 'America/Sao_Paulo' end;
  v_end_ts   timestamptz := case when p_end is null then null
                                 else p_end::timestamp at time zone 'America/Sao_Paulo' end;
begin
  if not is_admin() then
    raise exception 'team_capacity: acesso restrito a administradores'
      using errcode = '42501';
  end if;

  return query
  with
  people as (
    select consultant_id as id from company_consultants
    union
    select collaborator_id from task_instances where collaborator_id is not null
  ),
  executors as (
    select distinct collaborator_id as id
      from task_instances
     where collaborator_id is not null
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
           jsonb_agg(
             jsonb_build_object('name', gname, 'count', n)
             order by gpos, gname
           ) as list
      from (
        select person, gname, gpos, count(*) as n
          from carteira
         group by person, gname, gpos
      ) q
     group by person
  ),
  cart as (
    select ac.person,
           count(*) as active,
           count(*) filter (where ccc.n = 1) as exclusive,
           count(*) filter (where ccc.n > 1) as shared,
           count(*) filter (where al.company_id is not null) as alerta,
           count(*) filter (where fu.days_since is null or fu.days_since > 15) as red
      from active_carteira ac
      join company_consultant_count ccc on ccc.company_id = ac.company_id
      left join followup fu on fu.company_id = ac.company_id
      left join lateral (
        select 1 as company_id
          from company_labels cl
          join labels l on l.id = cl.label_id
         where cl.company_id = ac.company_id
           and lower(l.name) = 'alerta'
         limit 1
      ) al on true
     group by ac.person
  ),
  act_time as (
    select te.collaborator_id as person,
           sum(entry_seconds(te.seconds, te.started_at, te.ended_at))::bigint as secs,
           (sum(entry_seconds(te.seconds, te.started_at, te.ended_at))
             filter (where tt.kind = 'diaria'))::bigint as secs_diaria,
           (sum(entry_seconds(te.seconds, te.started_at, te.ended_at))
             filter (where tt.kind is distinct from 'diaria'))::bigint as secs_pontual,
           count(distinct t.company_id) as companies
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
     where ti.status = 'finalizada'
       and tt.kind = 'unica'
       and ti.finished_at is not null
       and (v_start_ts is null or ti.finished_at >= v_start_ts)
       and (v_end_ts   is null or ti.finished_at <  v_end_ts)
     group by ti.collaborator_id
  ),
  act_overdue as (
    select ti.collaborator_id as person, count(*) as n
      from task_instances ti
     where ti.status in ('a_fazer', 'iniciada')
       and ti.due_at < now()
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
    coalesce(cart.red, 0)::integer,
    (ex.id is not null) as is_executor,
    coalesce(at.secs, 0)::bigint,
    coalesce(at.secs_pontual, 0)::bigint,
    coalesce(at.secs_diaria, 0)::bigint,
    coalesce(ad.done, 0)::integer,
    coalesce(ao.n, 0)::integer,
    coalesce(at.companies, 0)::integer,
    -- CRITÉRIO ÚNICO de vazio: qualquer registro no período (tempo, conclusão
    -- pontual OU atrasada). Sem nenhum → traço; com algum → números reais.
    (at.person is not null or ad.person is not null or ao.person is not null) as act_has_activity
  from people pe
  left join lateral (
    select d.name, d.avatar_path from display_profiles(array[pe.id]::uuid[]) d
  ) dp on true
  left join executors ex on ex.id = pe.id
  left join cart      on cart.person = pe.id
  left join by_group  bg on bg.person = pe.id
  left join act_time  at on at.person = pe.id
  left join act_done  ad on ad.person = pe.id
  left join act_overdue ao on ao.person = pe.id;
end;
$$;

revoke execute on function team_capacity(date, date) from public, anon;
grant  execute on function team_capacity(date, date) to authenticated;

-- =====================================================================
-- Capacidade — a tabela de COLABORADORES ganha "FORA DA CARTEIRA".
--
-- Com a âncora (0090), responsável é vínculo declarado (company_collaborators)
-- e a tela já mostra a CARTEIRA do colaborador (0091: colab_active/by_group).
-- Esta migração acrescenta o ponto central da tela: quantas empresas a pessoa
-- tem tarefa EM ABERTO mas NÃO é responsável — as exceções indevidas que
-- motivaram a mudança de âncora.
--
--   · colab_out_of_portfolio = empresas DISTINTAS com tarefa em aberto
--     (a_fazer/iniciada) do colaborador, cuja empresa NÃO está na carteira dele.
--
-- É FOTO DO AGORA (tarefa em aberto × vínculo atual) — NÃO usa o período; por
-- isso não recebe o intervalo. O drill-down ganha o escopo 'fora_da_carteira'
-- com a MESMA regra, para a lista nunca divergir do número.
--
-- Assinatura de team_capacity muda (coluna nova no fim) → drop + recreate.
-- Segue admin-only (is_admin() por dentro), SECURITY INVOKER, só leitura. Tudo
-- que a 0091 já entregava permanece igual.
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
  carteira_active      integer,
  carteira_by_group    jsonb,
  carteira_exclusive   integer,
  carteira_shared      integer,
  carteira_alerta      integer,
  carteira_stalled     integer,
  carteira_no_record   integer,
  is_executor          boolean,
  act_seconds          bigint,
  act_seconds_pontual  bigint,
  act_seconds_diaria   bigint,
  act_pontual_done     integer,
  act_overdue          integer,
  act_companies        integer,
  act_has_activity     boolean,
  colab_active         integer,
  colab_by_group       jsonb,
  has_colab_carteira   boolean,
  -- NOVO: empresas com tarefa em aberto onde o colaborador NÃO é responsável.
  colab_out_of_portfolio integer
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_excluded text[] := capacity_excluded_groups();
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
    union
    select collaborator_id from company_collaborators           -- vinculado mesmo sem execução
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
           count(*) filter (where fu.days_since > 15)      as stalled,
           count(*) filter (where fu.days_since is null)   as no_record
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
  -- CARTEIRA DO COLABORADOR (company_collaborators). Mesmo tratamento de grupo/
  -- ativo que a carteira do consultor, mas fonte e coluna próprias.
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
           jsonb_agg(
             jsonb_build_object('name', gname, 'count', n)
             order by gpos, gname
           ) as list
      from (
        select person, gname, gpos, count(*) as n
          from colab_carteira
         group by person, gname, gpos
      ) q
     group by person
  ),
  colab_active as (
    select person, count(*) filter (where is_active) as active
      from colab_carteira
     group by person
  ),
  -- FORA DA CARTEIRA (foto do agora): empresas com tarefa EM ABERTO do
  -- colaborador cuja empresa NÃO está na carteira declarada dele. Não usa o
  -- período — é sobre o que está aberto e a quem a empresa pertence hoje.
  colab_outside as (
    select ti.collaborator_id as person, count(distinct ti.company_id) as n
      from task_instances ti
     where ti.collaborator_id is not null
       and ti.company_id is not null
       and ti.status in ('a_fazer', 'iniciada')
       and not exists (
         select 1 from company_collaborators cc
          where cc.company_id = ti.company_id
            and cc.collaborator_id = ti.collaborator_id
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
     where ti.status = 'finalizada'
       and tt.kind = 'unica'
       and ti.finished_at is not null
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
     where ti.status = 'finalizada'
       and tt.kind = 'unica'
       and ti.finished_at is not null
       and (v_start_ts is null or ti.finished_at >= v_start_ts)
       and (v_end_ts   is null or ti.finished_at <  v_end_ts)
  ),
  act_companies as (
    select person, count(distinct company_id) as companies
      from act_company_pairs
     where company_id is not null
     group by person
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
    coalesce(cart.stalled, 0)::integer,
    coalesce(cart.no_record, 0)::integer,
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
-- DRILL-DOWN: novo escopo 'fora_da_carteira' — a lista de empresas com tarefa
-- em aberto onde o colaborador NÃO é responsável (mesma regra do número). Não
-- usa o período (foto do agora). Os escopos anteriores ficam intactos.
-- ---------------------------------------------------------------------
create or replace function team_capacity_drilldown(
  p_person uuid,
  p_scope  text,
  p_start  date default null,
  p_end    date default null
)
returns table (
  company_id   uuid,
  company_name text,
  group_name   text,
  labels       jsonb,
  shared_with  jsonb,
  days_since   integer
)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_excluded text[] := capacity_excluded_groups();
  v_start_ts timestamptz := case when p_start is null then null
                                 else p_start::timestamp at time zone 'America/Sao_Paulo' end;
  v_end_ts   timestamptz := case when p_end is null then null
                                 else p_end::timestamp at time zone 'America/Sao_Paulo' end;
begin
  if not is_admin() then
    raise exception 'team_capacity_drilldown: acesso restrito a administradores'
      using errcode = '42501';
  end if;

  return query
  with
  active_carteira as (
    select cc.company_id
      from company_consultants cc
      join companies c on c.id = cc.company_id
      left join company_groups g on g.id = c.group_id
     where cc.consultant_id = p_person
       and (c.group_id is null or g.name is null or not (g.name = any(v_excluded)))
  ),
  cnt as (
    select company_id, count(*) as n from company_consultants group by company_id
  ),
  fu as (
    select company_id, days_since from client_followup(30, true)
  ),
  carteira_scoped as (
    select ac.company_id,
           coalesce(cnt.n, 1) as ncons,
           fu.days_since as dsince
      from active_carteira ac
      left join cnt on cnt.company_id = ac.company_id
      left join fu on fu.company_id = ac.company_id
  ),
  scoped as (
    select cs.company_id, cs.dsince
      from carteira_scoped cs
     where p_scope in ('ativos','exclusivos','compartilhados','alerta','parados','sem_registro')
       and case p_scope
             when 'exclusivos'     then cs.ncons = 1
             when 'compartilhados' then cs.ncons > 1
             when 'alerta'         then exists (
               select 1 from company_labels cl
                 join labels l on l.id = cl.label_id
                where cl.company_id = cs.company_id
                  and lower(l.name) = 'alerta')
             when 'parados'        then (cs.dsince is not null and cs.dsince > 15)
             when 'sem_registro'   then cs.dsince is null
             else true  -- 'ativos'
           end
    union all
    -- 'empresas': união de tempo + conclusão (mesmo critério de act_companies).
    select e.company_id, null::integer
      from (
        select distinct t.company_id
          from time_entries te
          join task_instances t on t.id = te.task_id
         where p_scope = 'empresas'
           and te.collaborator_id = p_person
           and (v_start_ts is null or te.started_at >= v_start_ts)
           and (v_end_ts   is null or te.started_at <  v_end_ts)
        union
        select distinct ti.company_id
          from task_instances ti
          join task_templates tt on tt.id = ti.template_id
         where p_scope = 'empresas'
           and ti.collaborator_id = p_person
           and ti.status = 'finalizada'
           and tt.kind = 'unica'
           and ti.finished_at is not null
           and (v_start_ts is null or ti.finished_at >= v_start_ts)
           and (v_end_ts   is null or ti.finished_at <  v_end_ts)
      ) e
     where e.company_id is not null
    union all
    -- 'fora_da_carteira': empresas com tarefa em aberto onde NÃO é responsável
    -- (mesma regra de colab_out_of_portfolio; foto do agora, ignora o período).
    select distinct ti.company_id, null::integer
      from task_instances ti
     where p_scope = 'fora_da_carteira'
       and ti.collaborator_id = p_person
       and ti.company_id is not null
       and ti.status in ('a_fazer', 'iniciada')
       and not exists (
         select 1 from company_collaborators cc
          where cc.company_id = ti.company_id
            and cc.collaborator_id = p_person
       )
  )
  select
    s.company_id,
    c.name,
    coalesce(g.name, 'Sem grupo'),
    coalesce(lab.list, '[]'::jsonb),
    coalesce(sh.list, '[]'::jsonb),
    s.dsince
  from scoped s
  join companies c on c.id = s.company_id
  left join company_groups g on g.id = c.group_id
  left join lateral (
    select jsonb_agg(
             jsonb_build_object('name', l.name, 'bg_color', l.bg_color,
                                'text_color', l.text_color, 'highlight', l.highlight)
             order by l.highlight desc, l.name
           ) as list
      from company_labels cl
      join labels l on l.id = cl.label_id
     where cl.company_id = s.company_id
  ) lab on true
  left join lateral (
    select jsonb_agg(
             jsonb_build_object('id', d.id, 'name', d.name, 'avatar_path', d.avatar_path)
             order by d.name
           ) as list
      from company_consultants cc2
      cross join lateral display_profiles(array[cc2.consultant_id]::uuid[]) d
     where p_scope = 'compartilhados'
       and cc2.company_id = s.company_id
       and cc2.consultant_id <> p_person
  ) sh on true
  order by c.name;
end;
$$;

revoke execute on function team_capacity_drilldown(uuid, text, date, date) from public, anon;
grant  execute on function team_capacity_drilldown(uuid, text, date, date) to authenticated;

-- =====================================================================
-- 0100 — Acompanhamento só de clientes de grupo ATIVO.
--
-- A tela /acompanhamento (semáforo de contato) passa a mostrar SOMENTE empresas
-- cujo grupo tem kind='active' (hoje Ativos e Ema; qualquer grupo ativo futuro
-- entra sozinho). Contato com cliente parado, em renovação, sem resposta, em
-- onboarding ou sem grupo é do comercial / sucesso do cliente — não polui a
-- cobertura do consultor. Regra por KIND, nunca por nome.
--
-- client_followup tem OUTROS chamadores que NÃO podem perder dado:
--   · o badge de contato do painel do consultor (/consultor), que agora lista
--     também empresas paradas (ver seções de grupo);
--   · a família team_capacity (team_capacity, _split, _drilldown, _split_red,
--     0091/0092/0094), que reusa client_followup(30, true) para o critério
--     VERMELHO em TODO o escopo.
-- Por isso NÃO filtramos direto: ganha um parâmetro p_only_active boolean default
-- false. Só o /acompanhamento passa true; todos os demais chamadores (inclusive os
-- posicionais client_followup(30, true) dentro das RPCs) caem no default e
-- continuam idênticos. Dropamos a assinatura antiga de 2 args para o overload não
-- deixar o PostgREST ambíguo. Continua SECURITY INVOKER (o join com company_groups
-- passa pela RLS cg_select, já liberada a admin/consultor/colaborador na 0099).
-- =====================================================================
drop function if exists client_followup(integer, boolean);

create or replace function client_followup(
  p_period_days  integer default 30,
  p_desc         boolean default true,
  p_only_active  boolean default false
)
returns table (
  company_id       uuid,
  company_name     text,
  consultants      jsonb,
  last_contact_at  timestamptz,
  last_contact_kind text,
  days_since       integer,
  next_meeting_at  timestamptz,
  period_meetings  bigint,
  period_notes     bigint,
  period_listings  bigint,
  period_readjusts bigint,
  period_tasks     bigint
)
language sql stable security invoker set search_path = public
as $$
  with
  v_days as (select greatest(1, coalesce(p_period_days, 30)) as d),
  -- Escopo das empresas: a RLS companies_select já limita por cargo. Quando
  -- p_only_active, restringe AINDA MAIS ao grupo ativo (kind='active') — nenhum
  -- contador da tela conta empresa fora deste conjunto. O ramo `not p_only_active`
  -- faz curto-circuito e nem toca company_groups (comportamento idêntico ao de
  -- antes para os demais chamadores). O exists lê company_groups sob a RLS
  -- cg_select (invoker) — liberada aos três cargos operacionais na 0099.
  scoped as (
    select c.id, c.name, c.created_at
      from companies c
     where not p_only_active
        or exists (
          select 1 from company_groups g
           where g.id = c.group_id and g.kind = 'active'
        )
  ),
  past as (
    select m.company_id, m.starts_at as at, 'reuniao'::text as kind
      from meetings m
      join scoped s on s.id = m.company_id
     where m.starts_at <= now()
    union all
    select n.company_id, n.created_at, 'anotacao'
      from company_notes n
      join scoped s on s.id = n.company_id
     where n.visible_to_client
    union all
    select ti.company_id, lr.created_at, 'listagem'
      from listing_results lr
      join task_instances ti on ti.id = lr.task_id
      join scoped s on s.id = ti.company_id
     where lr.link is not null
    union all
    select lv.company_id, lv.created_at, 'reajuste'
      from listing_validations lv
      join scoped s on s.id = lv.company_id
     where lv.event_type = 'reajuste_feito'
    union all
    select ti.company_id, ti.finished_at, 'tarefa'
      from task_instances ti
      join task_templates tt on tt.id = ti.template_id
      join scoped s on s.id = ti.company_id
     where ti.status = 'finalizada'
       and ti.finished_at is not null
       and tt.kind = 'unica'
       and tt.template_type = 'padrao'
       and tt.standard_task_id is null
  ),
  last_contact as (
    select distinct on (company_id) company_id, at, kind
      from past
     order by company_id, at desc
  ),
  period_counts as (
    select company_id,
      count(*) filter (where kind = 'reuniao')  as c_meet,
      count(*) filter (where kind = 'anotacao') as c_note,
      count(*) filter (where kind = 'listagem') as c_list,
      count(*) filter (where kind = 'reajuste') as c_readj,
      count(*) filter (where kind = 'tarefa')   as c_task
      from past, v_days
     where past.at >= now() - make_interval(days => v_days.d)
     group by company_id
  ),
  future_meeting as (
    select distinct on (m.company_id) m.company_id, m.starts_at as next_at
      from meetings m
      join scoped s on s.id = m.company_id
     where m.starts_at > now()
     order by m.company_id, m.starts_at asc
  ),
  cons as (
    select cc.company_id,
           jsonb_agg(
             jsonb_build_object('id', cc.consultant_id, 'name', dp.name, 'avatar_path', dp.avatar_path)
             order by dp.name
           ) as list
      from company_consultants cc
      join scoped s on s.id = cc.company_id
      left join lateral (
        select name, avatar_path from display_profiles(array[cc.consultant_id]::uuid[])
      ) dp on true
     group by cc.company_id
  )
  select
    s.id,
    s.name,
    coalesce(cn.list, '[]'::jsonb),
    lc.at,
    lc.kind,
    case when lc.at is null then null
         else (now() at time zone 'America/Sao_Paulo')::date
              - (lc.at at time zone 'America/Sao_Paulo')::date
    end,
    fm.next_at,
    coalesce(pc.c_meet, 0),
    coalesce(pc.c_note, 0),
    coalesce(pc.c_list, 0),
    coalesce(pc.c_readj, 0),
    coalesce(pc.c_task, 0)
  from scoped s
  left join last_contact  lc on lc.company_id = s.id
  left join period_counts pc on pc.company_id = s.id
  left join future_meeting fm on fm.company_id = s.id
  left join cons          cn on cn.company_id = s.id
  -- MESMA fila de prioridade, em dois sentidos. O ramo inativo vira NULL
  -- constante (no-op), então só um sentido ordena de fato:
  --   p_desc=true  → críticos no topo (nulls-first, cadastro asc, lc.at asc);
  --   p_desc=false → o espelho exato: todas as chaves invertidas.
  order by
    case when p_desc then (lc.at is not null) end asc,
    case when p_desc then (case when lc.at is null then s.created_at end) end asc,
    case when p_desc then lc.at end asc,
    case when p_desc then s.name end asc,
    case when not p_desc then (lc.at is not null) end desc,
    case when not p_desc then (case when lc.at is null then s.created_at end) end desc,
    case when not p_desc then lc.at end desc,
    case when not p_desc then s.name end desc;
$$;

revoke execute on function client_followup(integer, boolean, boolean) from public, anon;
grant  execute on function client_followup(integer, boolean, boolean) to authenticated;

-- =====================================================================
-- ACOMPANHAMENTO DE CLIENTES — SENTIDO da fila (não o critério).
--
-- O critério continua FIXO e único: prioridade de atendimento
--   (nunca-contatados primeiro, desempatados por cadastro mais antigo;
--    depois os demais por mais tempo sem contato).
-- Só acrescentamos um SENTIDO, aplicado NO BANCO para valer sob paginação:
--   · p_desc = true  (padrão): mais críticos no topo — como hoje;
--   · p_desc = false (invertido): a MESMA fila de baixo para cima — os
--     atendidos mais recentemente no topo e os críticos no fim.
-- Não é troca de campo (nada de nome/consultor): é a mesma urgência, lida da
-- outra ponta. Por isso a inversão espelha TODAS as chaves da ordenação.
--
-- Troca a assinatura (ganha p_desc), então derruba a versão de 1 argumento
-- para não deixar overload ambíguo. Os sinais de contato seguem intactos.
-- =====================================================================
drop function if exists client_followup(integer);

create or replace function client_followup(
  p_period_days integer default 30,
  p_desc        boolean default true
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
  scoped as (
    select id, name, created_at from companies
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

revoke execute on function client_followup(integer, boolean) from public, anon;
grant  execute on function client_followup(integer, boolean) to authenticated;

-- =====================================================================
-- ACOMPANHAMENTO DE CLIENTES — "quais clientes estão esfriando?"
--
-- Uma linha por empresa ALCANÇÁVEL pelo usuário, com: há quanto tempo houve
-- CONTATO, qual foi o último, um resumo do período e a próxima reunião marcada.
-- O objetivo é monitorar atendimento constante — NÃO ranquear ninguém.
--
-- ESCOPO NO BANCO (não só na tela): SECURITY INVOKER, e TUDO pende de `companies`
-- (RLS companies_select) — admin vê todas; consultor só a carteira dele;
-- colaborador só as dele (a página bloqueia colaborador de qualquer forma). Como
-- cada sinal é ligado por company_id às empresas já escopadas, ninguém vê sinal
-- de empresa fora do escopo, mesmo que a RLS daquele sinal seja mais permissiva.
--
-- O QUE CONTA COMO CONTATO (só estes; nada de tempo cronometrado ou volume):
--   · reunião REALIZADA (starts_at <= now)                → 'reuniao'
--   · anotação VISÍVEL AO CLIENTE (company_notes)         → 'anotacao'
--   · listagem ENTREGUE (listing_results com link)        → 'listagem'
--   · reajuste concluído (listing_validations reajuste_feito) → 'reajuste'
--   · tarefa PONTUAL concluída: kind='unica' E template_type='padrao' E
--     standard_task_id IS NULL E status='finalizada'      → 'tarefa'
--     (diárias e as do catálogo padrão são EXCLUÍDAS de propósito: elas concluem
--      sozinhas todo dia e fariam todo cliente parecer sempre atendido.)
-- Reunião MARCADA para o futuro NÃO entra no "último contato" (senão daria dias
-- negativos); vem à parte em next_meeting_at, para a tela mostrar que há
-- engajamento planejado — distinta da realizada.
--
-- CUSTO: agrega no banco e devolve UMA linha por empresa (limitado ao nº de
-- empresas do escopo — dezenas/centenas, nunca linhas cruas de sinais). Sem risco
-- da truncagem silenciosa do dashboard (que buscava linhas cruas sem limite).
-- Datas em America/Sao_Paulo (o "dias desde" é diferença de dia CIVIL em BRT).
-- =====================================================================
create or replace function client_followup(p_period_days integer default 30)
returns table (
  company_id       uuid,
  company_name     text,
  consultants      jsonb,       -- [{id, name, avatar_path}] — responsáveis
  last_contact_at  timestamptz, -- último contato PASSADO (null = nunca)
  last_contact_kind text,       -- tipo do último contato
  days_since       integer,     -- dias civis (BRT) desde o último contato; null = nunca
  next_meeting_at  timestamptz, -- próxima reunião MARCADA (futuro); null se não há
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
    -- Porta de escopo: só as empresas que a RLS deixa o chamador ver.
    select id, name from companies
  ),
  past as (
    -- Reuniões realizadas (já começaram).
    select m.company_id, m.starts_at as at, 'reuniao'::text as kind
      from meetings m
      join scoped s on s.id = m.company_id
     where m.starts_at <= now()
    union all
    -- Anotações visíveis ao cliente.
    select n.company_id, n.created_at, 'anotacao'
      from company_notes n
      join scoped s on s.id = n.company_id
     where n.visible_to_client
    union all
    -- Listagens entregues (com link publicado).
    select ti.company_id, lr.created_at, 'listagem'
      from listing_results lr
      join task_instances ti on ti.id = lr.task_id
      join scoped s on s.id = ti.company_id
     where lr.link is not null
    union all
    -- Reajuste de listagem concluído (evento interno).
    select lv.company_id, lv.created_at, 'reajuste'
      from listing_validations lv
      join scoped s on s.id = lv.company_id
     where lv.event_type = 'reajuste_feito'
    union all
    -- Tarefa PONTUAL concluída (só as de verdade: única + padrão + fora do catálogo).
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
  -- Mais tempo sem contato primeiro; nunca-contatado no topo.
  order by lc.at asc nulls first, s.name;
$$;

revoke execute on function client_followup(integer) from public, anon;
grant  execute on function client_followup(integer) to authenticated;

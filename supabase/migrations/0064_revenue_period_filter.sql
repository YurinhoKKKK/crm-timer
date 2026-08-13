-- =====================================================================
-- Faturamento — filtro por período (mês de início / fim)
-- =====================================================================
-- overview e insights passam a receber o intervalo [p_start, p_end] (datas no
-- dia 1). NULL/NULL = "Tudo" (comportamento anterior). Toda agregação e toda
-- variação seguem no banco, em numeric — o cliente só formata.
--
-- ACESSO inalterado: SECURITY INVOKER partindo de company_revenues (RLS crev_rw
-- escopa admin/consultor). Colaborador e anon não passam.
--
-- ARMADILHA DA PRIMEIRA LINHA (o ponto central): a variação é sempre contra o
-- mês IMEDIATAMENTE anterior. Se a base buscasse só [p_start, p_end], o mês mais
-- antigo da janela mostraria "sem base" mesmo existindo mês anterior lançado.
-- Por isso o insights busca UM MÊS A MAIS para trás (p_start - 1 mês), usado
-- EXCLUSIVAMENTE como base da variação da primeira linha: esse mês extra NÃO
-- entra em months, nem no gráfico, nem em soma nenhuma.
--
-- Troca de assinatura (uuid) -> (uuid, date, date): dropamos as antigas para não
-- deixar overload ambíguo no PostgREST.
-- =====================================================================

drop function if exists company_revenue_overview(uuid);
drop function if exists company_revenue_insights(uuid);

-- ---------------------------------------------------------------------
-- OVERVIEW (canais, tabela, totais do período)
-- ---------------------------------------------------------------------
create or replace function company_revenue_overview(
  p_company uuid,
  p_start   date default null,
  p_end     date default null
)
returns jsonb
language sql stable security invoker set search_path = public
as $$
  with cur as (
    select date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date
             as this_month
  ),
  rng as (
    -- Faixa de EXIBIÇÃO. Com filtro => [p_start, p_end]; sem filtro (Tudo) =>
    -- do primeiro lançamento até o maior entre o corrente e o último lançado.
    select
      case when p_start is not null and p_end is not null
           then date_trunc('month', p_start)::date
           else coalesce(
                  (select min(reference_month) from company_revenues
                    where company_id = p_company),
                  (select this_month from cur))
      end as v_first,
      case when p_start is not null and p_end is not null
           then date_trunc('month', p_end)::date
           else greatest(
                  (select this_month from cur),
                  coalesce(
                    (select max(reference_month) from company_revenues
                      where company_id = p_company),
                    (select this_month from cur)))
      end as v_last
  ),
  months as (
    select gs::date as m
    from rng,
         generate_series(rng.v_first, rng.v_last, interval '1 month') gs
  ),
  per_month as (
    select mo.m,
      coalesce(
        jsonb_object_agg(r.channel, r.amount) filter (where r.channel is not null),
        '{}'::jsonb) as channels,
      coalesce(sum(r.amount), 0)::numeric(14,2) as total,
      count(r.*) as entry_count,
      (select n.note from company_revenue_notes n
        where n.company_id = p_company and n.reference_month = mo.m) as note
    from months mo
    left join company_revenues r
      on r.company_id = p_company and r.reference_month = mo.m
    group by mo.m
  )
  select jsonb_build_object(
    'currentMonth', to_char((select this_month from cur), 'YYYY-MM-DD'),
    'rangeStart', to_char((select v_first from rng), 'YYYY-MM-DD'),
    'rangeEnd', to_char((select v_last from rng), 'YYYY-MM-DD'),
    'filtered', (p_start is not null and p_end is not null),
    'channelConfig', coalesce(
      (select jsonb_object_agg(channel, active)
         from company_sales_channels where company_id = p_company),
      '{}'::jsonb),
    'activeChannels', coalesce(
      (select jsonb_agg(channel order by channel)
         from company_sales_channels
        where company_id = p_company and active),
      '[]'::jsonb),
    'channelTotals', coalesce(
      (select jsonb_object_agg(channel, total)
         from (
           select channel, sum(amount)::numeric(14,2) as total
             from company_revenues
            where company_id = p_company
              and reference_month between (select v_first from rng)
                                      and (select v_last from rng)
            group by channel
         ) ct),
      '{}'::jsonb),
    'grandTotal', coalesce(
      (select sum(amount)::numeric(14,2) from company_revenues
        where company_id = p_company
          and reference_month between (select v_first from rng)
                                  and (select v_last from rng)), 0),
    'months', coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'month', to_char(pm.m, 'YYYY-MM-DD'),
                  'channels', pm.channels,
                  'total', pm.total,
                  'hasRecord', pm.entry_count > 0,
                  'note', pm.note) order by pm.m desc)
         from per_month pm),
      '[]'::jsonb)
  );
$$;

grant execute on function company_revenue_overview(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- INSIGHTS (variação, acumulado, último mês fechado — do período)
-- ---------------------------------------------------------------------
create or replace function company_revenue_insights(
  p_company uuid,
  p_start   date default null,
  p_end     date default null
)
returns jsonb
language sql stable security invoker set search_path = public
as $$
  with cur as (
    select date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date
             as this_month
  ),
  rng as (
    select
      case when p_start is not null and p_end is not null
           then date_trunc('month', p_start)::date
           else coalesce(
                  (select min(reference_month) from company_revenues
                    where company_id = p_company),
                  (select this_month from cur))
      end as v_first,
      case when p_start is not null and p_end is not null
           then date_trunc('month', p_end)::date
           else greatest(
                  (select this_month from cur),
                  coalesce(
                    (select max(reference_month) from company_revenues
                      where company_id = p_company),
                    (select this_month from cur)))
      end as v_last
  ),
  -- Base para VARIAÇÃO: um mês a mais para trás do início (só como base da
  -- primeira linha; não aparece em months/totais).
  mt as (
    select reference_month as m, sum(amount)::numeric(14,2) as total
      from company_revenues
     where company_id = p_company
       and reference_month between ((select v_first from rng) - interval '1 month')::date
                               and (select v_last from rng)
     group by reference_month
  ),
  mc as (
    select reference_month as m, channel, amount
      from company_revenues
     where company_id = p_company
       and reference_month between ((select v_first from rng) - interval '1 month')::date
                               and (select v_last from rng)
  ),
  tvar as (
    select cur_m.m,
      case
        when cur_m.m = (select this_month from cur)
          then jsonb_build_object('kind', 'current')
        when prev.total is null then jsonb_build_object('kind', 'no_base')
        when prev.total = 0     then jsonb_build_object('kind', 'first_positive')
        else jsonb_build_object(
               'kind', 'ok',
               'percent', round((cur_m.total - prev.total) / prev.total * 100, 1))
      end as v
    from mt cur_m
    left join mt prev on prev.m = (cur_m.m - interval '1 month')::date
    where cur_m.m >= (select v_first from rng)   -- exclui o mês-base extra
  ),
  cvar as (
    select cur_c.m, cur_c.channel,
      case
        when cur_c.m = (select this_month from cur)
          then jsonb_build_object('kind', 'current')
        when prev.amount is null then jsonb_build_object('kind', 'no_base')
        when prev.amount = 0     then jsonb_build_object('kind', 'first_positive')
        else jsonb_build_object(
               'kind', 'ok',
               'percent', round((cur_c.amount - prev.amount) / prev.amount * 100, 1))
      end as v
    from mc cur_c
    left join mc prev
      on prev.m = (cur_c.m - interval '1 month')::date
     and prev.channel = cur_c.channel
    where cur_c.m >= (select v_first from rng)
  ),
  last_closed as (
    select m, total from mt
     where m < (select this_month from cur)
       and m >= (select v_first from rng)   -- do intervalo, não do mês-base
     order by m desc
     limit 1
  )
  select jsonb_build_object(
    'currentMonth', to_char((select this_month from cur), 'YYYY-MM-DD'),
    'rangeStart', to_char((select v_first from rng), 'YYYY-MM-DD'),
    'rangeEnd', to_char((select v_last from rng), 'YYYY-MM-DD'),
    'filtered', (p_start is not null and p_end is not null),
    'summary', jsonb_build_object(
      'lastClosed', (
        select case when lc.m is null then null
                    else jsonb_build_object(
                           'month', to_char(lc.m, 'YYYY-MM-DD'),
                           'total', lc.total)
               end
          from last_closed lc
      ),
      'variation', (
        select tv.v from tvar tv where tv.m = (select m from last_closed)
      ),
      'accumulated', jsonb_build_object(
        'total', coalesce(
          (select sum(amount)::numeric(14,2) from company_revenues
            where company_id = p_company
              and reference_month between (select v_first from rng)
                                      and (select v_last from rng)), 0),
        'monthsWithRecord', (select count(*) from mt where m >= (select v_first from rng))
      )
    ),
    'totalVariations', coalesce(
      (select jsonb_object_agg(to_char(m, 'YYYY-MM-DD'), v) from tvar),
      '{}'::jsonb),
    'channelVariations', coalesce(
      (select jsonb_object_agg(m_str, chans) from (
         select to_char(m, 'YYYY-MM-DD') as m_str,
                jsonb_object_agg(channel, v) as chans
           from cvar group by m
       ) x),
      '{}'::jsonb)
  );
$$;

grant execute on function company_revenue_insights(uuid, date, date) to authenticated;

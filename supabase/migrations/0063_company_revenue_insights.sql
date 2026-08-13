-- =====================================================================
-- Faturamento — Fatia 2: INSIGHTS (variação, acumulado, progressão)
-- =====================================================================
-- Todo cálculo de variação e agregação é feito AQUI, em numeric — nunca em JS
-- (truncamento silencioso do PostgREST + erro de ponto flutuante em dinheiro).
-- O cliente só formata o que este RPC devolveu.
--
-- ACESSO idêntico à Fatia 1: SECURITY INVOKER partindo de company_revenues, cuja
-- RLS (crev_rw) já escopa admin (todas) e consultor (a carteira dele). Colaborador
-- e anon não passam — a agregação parte de linhas que eles não enxergam, então
-- devolve vazio. Nenhum afrouxamento.
--
-- AS TRÊS REGRAS DA VARIAÇÃO (contra o mês IMEDIATAMENTE anterior, nunca pulando
-- um mês faltante):
--   1. mês anterior SEM REGISTRO  -> kind 'no_base'        ("sem base de comparação")
--   2. mês anterior com valor ZERO -> kind 'first_positive' ("primeiro mês com faturamento")
--   3. mês CORRENTE (parcial)      -> kind 'current'        ("mês em andamento") — não
--      entra em comparação nenhuma (nem analisado, nem como base do seguinte)
--   caso normal                    -> kind 'ok' + percent = round((atual-ant)/ant*100, 1)
-- As mesmas regras valem canal a canal (canal sem registro no mês anterior =
-- 'no_base', mesmo que outros canais tenham).
--
-- O mês anterior é sempre (mês - 1 mês) no CALENDÁRIO. Se esse mês é um buraco,
-- não existe linha para ele em `mt`/`mc` → cai em 'no_base'.
-- =====================================================================
create or replace function company_revenue_insights(p_company uuid)
returns jsonb
language sql stable security invoker set search_path = public
as $$
  with cur as (
    select date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date
             as this_month
  ),
  -- total por mês (só meses COM registro)
  mt as (
    select reference_month as m, sum(amount)::numeric(14,2) as total
      from company_revenues where company_id = p_company
     group by reference_month
  ),
  -- valor por mês e canal
  mc as (
    select reference_month as m, channel, amount
      from company_revenues where company_id = p_company
  ),
  -- variação do TOTAL, mês a mês (LEFT JOIN no mês anterior de calendário: se
  -- ele é um buraco, `prev` fica NULL → 'no_base'; nunca pulamos para um mês
  -- mais antigo).
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
  ),
  -- variação por CANAL, mês a mês (mesmo LEFT JOIN, casando canal a canal)
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
  ),
  -- último mês FECHADO com registro = mais recente ANTES do corrente (exclui o
  -- parcial e qualquer mês futuro lançado retroativamente).
  last_closed as (
    select m, total from mt
     where m < (select this_month from cur)
     order by m desc
     limit 1
  )
  select jsonb_build_object(
    'currentMonth', to_char((select this_month from cur), 'YYYY-MM-DD'),
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
        select tv.v from tvar tv
         where tv.m = (select m from last_closed)
      ),
      'accumulated', jsonb_build_object(
        'total', coalesce(
          (select sum(amount)::numeric(14,2) from company_revenues
            where company_id = p_company), 0),
        'monthsWithRecord', (select count(*) from mt)
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

grant execute on function company_revenue_insights(uuid) to authenticated;

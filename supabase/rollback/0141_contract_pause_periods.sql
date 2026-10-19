-- =====================================================================
-- Reversão de 0141_contract_pause_periods
-- =====================================================================
-- Restaura churn_rows/churn_board/move_expired ao estado anterior, remove os
-- objetos novos (funções, trigger, tabela, coluna). As linhas de cs_audit com
-- field='pausa_contrato' NÃO são apagadas (histórico legítimo já gravado).
-- =====================================================================

-- 1) Restaura churn_rows/churn_board (sem paused_days; months_stayed sem pausa).
drop function if exists public.churn_board(date, date);
drop function if exists public.churn_rows(date, date);

create function public.churn_rows(p_start date, p_end date)
returns table(
  id uuid, company_id uuid, company_name text, churn_type text, churned_on date,
  reason churn_reason, seller_name text, consultants jsonb, mrr numeric,
  months_contracted integer, months_stayed integer, lost numeric
)
language sql
stable
set search_path to 'public'
as $fn$
  with raw as (
    select
      cc.id, cc.company_id, c.name as company_name, cc.churn_type, cc.churned_on,
      cc.reason, cc.seller_name, cc.consultants, cc.mrr,
      cd.months_total as months_contracted, d.started_on
    from company_churns cc
    join companies c on c.id = cc.company_id
    left join company_details d on d.company_id = cc.company_id
    left join lateral contract_duration(d.started_on, d.ends_on) cd on true
    where cc.reverted_at is null
      and (
        (p_start is null and p_end is null)
        or (cc.churned_on is not null
            and (p_start is null or cc.churned_on >= p_start)
            and (p_end   is null or cc.churned_on <= p_end))
      )
  ),
  base as (
    select r.*,
      case
        when r.started_on is not null and r.churned_on is not null
        then greatest(
               (extract(year  from age(r.churned_on, r.started_on)) * 12
              + extract(month from age(r.churned_on, r.started_on)))::int, 0)
        else null
      end as months_stayed
    from raw r
  )
  select
    b.id, b.company_id, b.company_name, b.churn_type, b.churned_on, b.reason,
    b.seller_name, b.consultants, b.mrr, b.months_contracted, b.months_stayed,
    case
      when b.churn_type = 'cancelado'
       and b.mrr is not null
       and b.months_contracted is not null
       and b.months_stayed is not null
      then (greatest(b.months_contracted - b.months_stayed, 0) * b.mrr)::numeric(14,2)
      else null
    end as lost
  from base b;
$fn$;

create function public.churn_board(p_start date default null, p_end date default null)
returns table(
  id uuid, company_id uuid, company_name text, churn_type text, churned_on text,
  reason text, seller_name text, consultants jsonb, mrr text,
  months_contracted integer, months_stayed integer, lost_revenue text, cs_note_count integer
)
language plpgsql
set search_path to 'public'
as $fn$
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores acessam o Controle de Churn.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    r.id, r.company_id, r.company_name, r.churn_type,
    to_char(r.churned_on, 'YYYY-MM-DD'),
    r.reason::text, r.seller_name, r.consultants, r.mrr::text,
    r.months_contracted, r.months_stayed, r.lost::text, coalesce(n.cnt, 0)
  from churn_rows(p_start, p_end) r
  left join (
    select cs.company_id as cid, count(*)::int as cnt from cs_notes cs group by cs.company_id
  ) n on n.cid = r.company_id
  order by r.churned_on desc nulls last, r.company_name;
end;
$fn$;

grant execute on function public.churn_board(date, date) to authenticated;

-- 2) Restaura move_expired_active_to_renewal (compara com ends_on).
create or replace function public.move_expired_active_to_renewal()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_renewal uuid;
  v_today   date := (timezone('America/Sao_Paulo', now()))::date;
  v_count   int := 0;
  r         record;
begin
  select id into v_renewal from company_groups
   where lower(name) in ('aguardando renovação', 'aguardando renovacao')
   order by position limit 1;
  if v_renewal is null then
    return 0;
  end if;

  for r in
    select c.id, c.name
    from companies c
    join company_groups g on g.id = c.group_id
    join company_details d on d.company_id = c.id
    where g.kind = 'active'
      and d.ends_on is not null
      and d.ends_on < v_today
  loop
    update companies set group_id = v_renewal, updated_at = now() where id = r.id;
    perform notify_admins_company(
      r.id, 'empresa_renovacao',
      'Contrato vencido — movida para Aguardando Renovação'
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$fn$;

-- 3) Remove objetos novos.
drop trigger if exists trg_companies_pause_period on public.companies;
drop function if exists public.companies_pause_period_trg();
drop function if exists public.pause_period_add(uuid, date, date);
drop function if exists public.pause_period_set_dates(uuid, date, date);
drop function if exists public.pause_period_delete(uuid);
drop function if exists public.effective_contract_end(uuid);
drop function if exists public.paused_days(uuid, date);
drop trigger if exists trg_company_pause_no_overlap on public.company_pause_periods;
drop function if exists public.company_pause_no_overlap();
drop table if exists public.company_pause_periods;
alter table public.company_groups drop column if exists pauses_contract;

delete from supabase_migrations.schema_migrations
 where name = '0141_contract_pause_periods';

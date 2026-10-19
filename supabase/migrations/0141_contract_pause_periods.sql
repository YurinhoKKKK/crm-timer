-- =====================================================================
-- 0141_contract_pause_periods :: CRM/Timer - Monvatti
-- =====================================================================
-- Pausa de contrato: quando a empresa está no grupo "Pausados", o contrato para
-- (sem serviço, sem pagamento). Em vez de mexer na data de fim, registramos
-- PERÍODOS de pausa e calculamos o FIM EFETIVO = company_details.ends_on + dias
-- pausados. company_details.ends_on NUNCA é alterado por esta regra (decisão 2).
--
-- Só o grupo "Pausados" pausa (decisão 1): coluna company_groups.pauses_contract
-- (resiste a renomear o grupo); "Aguardando Renovação", "Cancelados" e os demais
-- NÃO pausam, mesmo tendo kind='paused'.
--
-- Rollback: supabase/rollback/0141_contract_pause_periods.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Marca de grupo que PAUSA o contrato (decisão 1). true só para Pausados.
-- ---------------------------------------------------------------------
alter table public.company_groups
  add column if not exists pauses_contract boolean not null default false;

update public.company_groups set pauses_contract = true where name = 'Pausados';

-- ---------------------------------------------------------------------
-- 2) Tabela dos períodos de pausa (PASSO 1a).
--    started_on nulo = "entrada pendente" (conta 0 dias até o admin preencher).
--    ended_on nulo = período aberto (conta até hoje).
-- ---------------------------------------------------------------------
create table if not exists public.company_pause_periods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  started_on date,
  ended_on date,
  source text not null check (source in ('auto', 'historico', 'pendente', 'manual')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint cpp_dates_chk
    check (started_on is null or ended_on is null or ended_on >= started_on)
);

create index if not exists cpp_company_idx on public.company_pause_periods (company_id);
-- No máximo UM período aberto (ended_on null) por empresa.
create unique index if not exists cpp_one_open_per_company
  on public.company_pause_periods (company_id) where ended_on is null;

-- ---------------------------------------------------------------------
-- 3) RLS (PASSO 1b). SELECT: admin ou quem alcança a empresa. Sem policy de
--    escrita — só os RPCs DEFINER abaixo escrevem.
-- ---------------------------------------------------------------------
alter table public.company_pause_periods enable row level security;

drop policy if exists cpp_select on public.company_pause_periods;
create policy cpp_select on public.company_pause_periods
  for select using (
    (select is_admin()) or user_reaches_company((select auth.uid()), company_id)
  );

-- ---------------------------------------------------------------------
-- 4) Sem sobreposição entre períodos da mesma empresa (PASSO 1a: validar no
--    trigger E no RPC). Intervalos meio-abertos [started, ended): dois períodos
--    que se encostam numa fronteira (um termina no dia em que o outro começa) NÃO
--    se sobrepõem. Períodos com started_on nulo (início desconhecido) ficam fora
--    da checagem — representam dado pendente, não ocupam intervalo.
-- ---------------------------------------------------------------------
create or replace function public.company_pause_no_overlap()
returns trigger
language plpgsql
set search_path to 'public'
as $fn$
begin
  if new.started_on is not null and exists (
    select 1 from company_pause_periods p
     where p.company_id = new.company_id
       and p.id <> new.id
       and p.started_on is not null
       and new.started_on < coalesce(p.ended_on, 'infinity'::date)
       and p.started_on < coalesce(new.ended_on, 'infinity'::date)
  ) then
    raise exception 'Os períodos de pausa não podem se sobrepor.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_company_pause_no_overlap on public.company_pause_periods;
create trigger trg_company_pause_no_overlap
  before insert or update on public.company_pause_periods
  for each row execute function public.company_pause_no_overlap();

-- ---------------------------------------------------------------------
-- 5) Funções de cálculo (PASSO 1c). SECURITY INVOKER: a RLS da tabela recorta
--    quem lê (admin vê tudo; consultor/colaborador, as empresas que alcançam).
--    Quando chamadas de dentro de uma função DEFINER (move_expired), rodam como
--    o dono e enxergam tudo.
-- ---------------------------------------------------------------------

-- Soma de dias pausados até p_until (corta cada período em p_until; ignora
-- started_on nulo). Contagem = ended_on - started_on (decisão 3).
create or replace function public.paused_days(p_company uuid, p_until date)
returns int
language sql
stable
set search_path to 'public'
as $fn$
  select coalesce(sum(
           greatest(least(coalesce(ended_on, p_until), p_until) - started_on, 0)
         ), 0)::int
    from company_pause_periods
   where company_id = p_company
     and started_on is not null
     and started_on <= p_until;
$fn$;

-- Fim efetivo = ends_on + dias pausados até HOJE (BRT). Null se ends_on for null.
create or replace function public.effective_contract_end(p_company uuid)
returns date
language sql
stable
set search_path to 'public'
as $fn$
  select case
           when d.ends_on is null then null
           else d.ends_on
                + public.paused_days(p_company, (now() at time zone 'America/Sao_Paulo')::date)
         end
    from company_details d
   where d.company_id = p_company;
$fn$;

revoke all on function public.paused_days(uuid, date) from public, anon;
revoke all on function public.effective_contract_end(uuid) from public, anon;
grant execute on function public.paused_days(uuid, date) to authenticated;
grant execute on function public.effective_contract_end(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6) Automático (PASSO 2). AFTER UPDATE OF group_id em companies:
--    entrou num grupo que pausa -> abre período (hoje BRT, 'auto');
--    saiu desse grupo -> fecha o período aberto (hoje BRT). Ao ir
--    Pausados -> Cancelados, ended_on = hoje = data do churn (coincidem), então
--    independe da ordem relativa ao trg_companies_churn_capture.
-- ---------------------------------------------------------------------
create or replace function public.companies_pause_period_trg()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_old_pauses boolean;
  v_new_pauses boolean;
begin
  if new.group_id is not distinct from old.group_id then
    return null;
  end if;

  select coalesce(pauses_contract, false) into v_old_pauses
    from company_groups where id = old.group_id;
  select coalesce(pauses_contract, false) into v_new_pauses
    from company_groups where id = new.group_id;
  v_old_pauses := coalesce(v_old_pauses, false);
  v_new_pauses := coalesce(v_new_pauses, false);

  if v_new_pauses and not v_old_pauses then
    -- Entrou: abre período (a não ser que já exista um aberto).
    if not exists (
      select 1 from company_pause_periods where company_id = new.id and ended_on is null
    ) then
      insert into company_pause_periods (company_id, started_on, source, created_by, updated_by)
      values (new.id, v_today, 'auto', auth.uid(), auth.uid());
    end if;
  elsif v_old_pauses and not v_new_pauses then
    -- Saiu: fecha o período aberto.
    update company_pause_periods
       set ended_on = v_today, updated_at = now(), updated_by = auth.uid()
     where company_id = new.id and ended_on is null;
  end if;

  return null;
end;
$fn$;

drop trigger if exists trg_companies_pause_period on public.companies;
create trigger trg_companies_pause_period
  after update of group_id on public.companies
  for each row execute function public.companies_pause_period_trg();

-- ---------------------------------------------------------------------
-- 7) Escrita manual (decisão 8): RPCs SECURITY DEFINER com gate is_admin(); toda
--    alteração vai para cs_audit (field 'pausa_contrato'). Sem EXECUTE p/ anon.
-- ---------------------------------------------------------------------
create or replace function public.pause_period_add(
  p_company uuid, p_started date, p_ended date
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_id uuid;
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores alteram períodos de pausa.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_started is not null and p_ended is not null and p_ended < p_started then
    raise exception 'A data de fim não pode ser antes da de início.'
      using errcode = 'check_violation';
  end if;
  if p_ended is null and exists (
    select 1 from company_pause_periods where company_id = p_company and ended_on is null
  ) then
    raise exception 'Já existe um período de pausa aberto para esta empresa.'
      using errcode = 'check_violation';
  end if;

  insert into company_pause_periods (company_id, started_on, ended_on, source, created_by, updated_by)
  values (p_company, p_started, p_ended, 'manual', auth.uid(), auth.uid())
  returning id into v_id;

  insert into cs_audit (company_id, field, old_value, new_value, changed_by)
  values (p_company, 'pausa_contrato', null,
    coalesce(to_char(p_started, 'YYYY-MM-DD'), '(pendente)') || ' → ' ||
    coalesce(to_char(p_ended, 'YYYY-MM-DD'), 'aberto'), auth.uid());
  return v_id;
end;
$fn$;

create or replace function public.pause_period_set_dates(
  p_id uuid, p_started date, p_ended date
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_company uuid;
  v_old text;
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores alteram períodos de pausa.'
      using errcode = 'insufficient_privilege';
  end if;
  select company_id,
         coalesce(to_char(started_on, 'YYYY-MM-DD'), '(pendente)') || ' → ' ||
         coalesce(to_char(ended_on, 'YYYY-MM-DD'), 'aberto')
    into v_company, v_old
    from company_pause_periods where id = p_id;
  if v_company is null then
    raise exception 'Período de pausa não encontrado.' using errcode = 'no_data_found';
  end if;
  if p_started is not null and p_ended is not null and p_ended < p_started then
    raise exception 'A data de fim não pode ser antes da de início.'
      using errcode = 'check_violation';
  end if;

  update company_pause_periods
     set started_on = p_started, ended_on = p_ended,
         updated_at = now(), updated_by = auth.uid()
   where id = p_id;

  insert into cs_audit (company_id, field, old_value, new_value, changed_by)
  values (v_company, 'pausa_contrato', v_old,
    coalesce(to_char(p_started, 'YYYY-MM-DD'), '(pendente)') || ' → ' ||
    coalesce(to_char(p_ended, 'YYYY-MM-DD'), 'aberto'), auth.uid());
end;
$fn$;

create or replace function public.pause_period_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_company uuid;
  v_source text;
  v_old text;
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores alteram períodos de pausa.'
      using errcode = 'insufficient_privilege';
  end if;
  select company_id, source,
         coalesce(to_char(started_on, 'YYYY-MM-DD'), '(pendente)') || ' → ' ||
         coalesce(to_char(ended_on, 'YYYY-MM-DD'), 'aberto')
    into v_company, v_source, v_old
    from company_pause_periods where id = p_id;
  if v_company is null then
    raise exception 'Período de pausa não encontrado.' using errcode = 'no_data_found';
  end if;
  if v_source <> 'manual' then
    raise exception 'Só períodos adicionados manualmente podem ser excluídos.'
      using errcode = 'check_violation';
  end if;

  delete from company_pause_periods where id = p_id;

  insert into cs_audit (company_id, field, old_value, new_value, changed_by)
  values (v_company, 'pausa_contrato', v_old, null, auth.uid());
end;
$fn$;

revoke all on function public.pause_period_add(uuid, date, date)       from public, anon;
revoke all on function public.pause_period_set_dates(uuid, date, date) from public, anon;
revoke all on function public.pause_period_delete(uuid)                from public, anon;
grant execute on function public.pause_period_add(uuid, date, date)       to authenticated;
grant execute on function public.pause_period_set_dates(uuid, date, date) to authenticated;
grant execute on function public.pause_period_delete(uuid)                to authenticated;

-- ---------------------------------------------------------------------
-- 8) Cron de renovação (decisão 7): compara com o FIM EFETIVO, não com ends_on.
-- ---------------------------------------------------------------------
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
      and public.effective_contract_end(c.id) < v_today
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

-- ---------------------------------------------------------------------
-- 9) Controle de Churn (decisão 5 / PASSO 4d). Permanência = meses entre
--    started_on e (churned_on - dias pausados até churned_on). Nova coluna
--    paused_days (p/ exibir "+N dias pausado"). Projeto (months_contracted) e MRR
--    não mudam; Receita Perdida = (Projeto - Permanência) × MRR, só cancelados.
--    Mudança de assinatura -> DROP + CREATE (churn_board depende por nome; é
--    plpgsql, resolve em runtime, mas recriamos as duas por clareza).
-- ---------------------------------------------------------------------
drop function if exists public.churn_board(date, date);
drop function if exists public.churn_rows(date, date);

create function public.churn_rows(p_start date, p_end date)
returns table(
  id uuid, company_id uuid, company_name text, churn_type text, churned_on date,
  reason churn_reason, seller_name text, consultants jsonb, mrr numeric,
  months_contracted integer, months_stayed integer, paused_days integer, lost numeric
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
  pd as (
    select r.*,
      case when r.churned_on is not null
           then public.paused_days(r.company_id, r.churned_on) else 0 end as pdays
    from raw r
  ),
  base as (
    select p.*,
      case
        when p.started_on is not null and p.churned_on is not null
        then greatest(
               (extract(year  from age((p.churned_on - p.pdays), p.started_on)) * 12
              + extract(month from age((p.churned_on - p.pdays), p.started_on)))::int, 0)
        else null
      end as months_stayed
    from pd p
  )
  select
    b.id, b.company_id, b.company_name, b.churn_type, b.churned_on, b.reason,
    b.seller_name, b.consultants, b.mrr, b.months_contracted, b.months_stayed, b.pdays,
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
  months_contracted integer, months_stayed integer, paused_days integer,
  lost_revenue text, cs_note_count integer
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
    r.months_contracted, r.months_stayed, r.paused_days,
    r.lost::text, coalesce(n.cnt, 0)
  from churn_rows(p_start, p_end) r
  left join (
    select cs.company_id as cid, count(*)::int as cnt from cs_notes cs group by cs.company_id
  ) n on n.cid = r.company_id
  order by r.churned_on desc nulls last, r.company_name;
end;
$fn$;

grant execute on function public.churn_board(date, date) to authenticated;

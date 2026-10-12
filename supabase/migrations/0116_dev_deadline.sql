-- =====================================================================
-- 0116 — Quadro "Desenvolvimento" (Etapa 2): coluna Prazo (15 dias úteis).
-- =====================================================================
-- Barra de 15 dias ÚTEIS (sem fins de semana e sem feriados NACIONAIS) que só
-- avança enquanto a empresa está em desenvolvimento ATIVO (grupo "Em
-- Desenvolvimento" E status 'em_desenvolvimento' E sem pausa manual), com pausa
-- automática por status e pausa manual com justificativa.
--
-- O "relógio" é materializado em dev_clock_periods (períodos em que o prazo
-- correu), mantido por gatilho em company_dev. A contagem de dias úteis é
-- derivada desses períodos. Páscoa calculada por algoritmo (Meeus/Jones/Butcher)
-- — nada de tabela de feriados.
--
-- Tudo passa por dev_can_manage() (a Etapa 4 amplia num ponto só).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Páscoa (Meeus/Jones/Butcher, aritmética inteira) e dia útil.
-- ---------------------------------------------------------------------
create or replace function dev_easter(p_year integer)
returns date
language plpgsql
immutable
set search_path = public
as $$
declare
  a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int; mo int; da int;
begin
  a := p_year % 19;
  b := p_year / 100;
  c := p_year % 100;
  d := b / 4;
  e := b % 4;
  f := (b + 8) / 25;
  g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30;
  i := c / 4;
  k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  mo := (h + l - 7 * m + 114) / 31;
  da := ((h + l - 7 * m + 114) % 31) + 1;
  return make_date(p_year, mo, da);
end;
$$;
grant execute on function dev_easter(integer) to authenticated;

-- Dia útil: falso em sáb/dom e feriados NACIONAIS fixos + Sexta-feira Santa
-- (Páscoa - 2). Carnaval e Corpus Christi NÃO entram (ponto facultativo);
-- feriados estaduais/municipais ficam para a pausa manual.
create or replace function dev_is_business_day(d date)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_year int := extract(year from d)::int;
  v_mmdd text := to_char(d, 'MM-DD');
begin
  if extract(isodow from d) in (6, 7) then
    return false;  -- sábado / domingo
  end if;
  if d = dev_easter(v_year) - 2 then
    return false;  -- Sexta-feira Santa
  end if;
  if v_mmdd in (
    '01-01',  -- Confraternização
    '04-21',  -- Tiradentes
    '05-01',  -- Dia do Trabalho
    '09-07',  -- Independência
    '10-12',  -- N. Sra. Aparecida
    '11-02',  -- Finados
    '11-15',  -- Proclamação da República
    '11-20',  -- Consciência Negra
    '12-25'   -- Natal
  ) then
    return false;
  end if;
  return true;
end;
$$;
grant execute on function dev_is_business_day(date) to authenticated;

-- Prazo total (dias úteis) — definido em UM lugar.
create or replace function dev_deadline_days()
returns integer
language sql
immutable
set search_path = public
as $$
  select 15;
$$;
grant execute on function dev_deadline_days() to authenticated;

-- Soma N dias úteis a uma data (NÃO conta a própria data). Usado na previsão de
-- entrega. Pequeno avanço de datas (≤ ~21 passos p/ 15 dias úteis), não é laço
-- por empresa.
create or replace function dev_add_business_days(p_from date, p_n integer)
returns date
language plpgsql
immutable
set search_path = public
as $$
declare
  v_d date := p_from;
  v_left int := p_n;
begin
  if p_n <= 0 then
    return p_from;
  end if;
  while v_left > 0 loop
    v_d := v_d + 1;
    if dev_is_business_day(v_d) then
      v_left := v_left - 1;
    end if;
  end loop;
  return v_d;
end;
$$;
grant execute on function dev_add_business_days(date, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 2) Pausa manual em company_dev.
-- ---------------------------------------------------------------------
alter table company_dev
  add column manual_paused boolean not null default false,
  add column pause_reason  text,
  add column paused_at     timestamptz,
  add column paused_by     uuid;  -- sem FK (como updated_by): nome resolvido ao vivo

-- Estado "corre": grupo Em Desenvolvimento E status em_desenvolvimento E sem
-- pausa manual. UM lugar — usado pelo gatilho do relógio.
create or replace function dev_row_running(p_group_id uuid, p_status dev_status, p_manual_paused boolean)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(p_manual_paused, false) = false
     and p_status = 'em_desenvolvimento'
     and exists (
       select 1 from dev_groups g where g.id = p_group_id and g.name = 'Em Desenvolvimento'
     );
$$;
grant execute on function dev_row_running(uuid, dev_status, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 3) Períodos em que o prazo correu. No máximo UM aberto por empresa.
--    RLS admin (via dev_can_manage); sem escrita direta — só gatilho/RPC.
-- ---------------------------------------------------------------------
create table dev_clock_periods (
  id         bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  started_at timestamptz not null,
  ended_at   timestamptz
);
create unique index dev_clock_periods_one_open
  on dev_clock_periods (company_id) where ended_at is null;
create index dev_clock_periods_company_idx
  on dev_clock_periods (company_id, started_at);

alter table dev_clock_periods enable row level security;
create policy dev_clock_periods_select on dev_clock_periods
  for select using (dev_can_manage());

-- ---------------------------------------------------------------------
-- 4) Gatilho do relógio (AFTER, DEFINER): abre/fecha período conforme o estado
--    "corre" muda. Um comando por transição, sem laço.
-- ---------------------------------------------------------------------
create or replace function dev_clock_maintain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old boolean;
  v_new boolean;
begin
  if tg_op = 'INSERT' then
    v_old := false;
  else
    v_old := dev_row_running(old.group_id, old.status, old.manual_paused);
  end if;
  v_new := dev_row_running(new.group_id, new.status, new.manual_paused);

  if v_new and not v_old then
    insert into dev_clock_periods (company_id, started_at)
    values (new.company_id, now());
  elsif v_old and not v_new then
    update dev_clock_periods
       set ended_at = now()
     where company_id = new.company_id and ended_at is null;
  end if;
  return null;
end;
$$;

create trigger dev_clock_maintain_trg
  after insert or update on company_dev
  for each row execute function dev_clock_maintain();

-- ---------------------------------------------------------------------
-- 5) Gatilho (BEFORE UPDATE): quando a empresa SAI de Em Desenvolvimento, desliga
--    a pausa manual sozinho. O gatilho de auditoria (abaixo) registra como Sistema
--    porque o novo grupo deixa de ser "Em Desenvolvimento".
-- ---------------------------------------------------------------------
create or replace function dev_autoclear_manual_pause()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.manual_paused and not exists (
    select 1 from dev_groups g where g.id = new.group_id and g.name = 'Em Desenvolvimento'
  ) then
    new.manual_paused := false;
    new.pause_reason := null;
    new.paused_at := null;
    new.paused_by := null;
  end if;
  return new;
end;
$$;

create trigger dev_autoclear_manual_pause_trg
  before update on company_dev
  for each row execute function dev_autoclear_manual_pause();

-- ---------------------------------------------------------------------
-- 6) Auditoria: acrescenta o field 'pausa_manual'. Mesmo gatilho append-only,
--    mesma proteção de cascata (company_exists). "Pausado: {motivo}" ao ligar;
--    "Retomado" ao desligar. changed_by = quem retomou SE continua em Em
--    Desenvolvimento (usuário); senão nulo = "Sistema" (saiu de Em
--    Desenvolvimento → desligada pelo gatilho acima).
-- ---------------------------------------------------------------------
create or replace function company_dev_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor          uuid := auth.uid();
  v_now            timestamptz := now();
  v_default_status dev_status := 'lista_espera';
  v_lista          uuid;
begin
  select dg.id into v_lista from dev_groups dg where dg.name = 'Lista de Espera';

  if tg_op = 'INSERT' then
    if new.status is distinct from v_default_status then
      insert into dev_audit (company_id, field, old_value, new_value, changed_by, changed_at)
      values (new.company_id, 'status', v_default_status::text, new.status::text, v_actor, v_now);
    end if;
    if new.group_id is distinct from v_lista then
      insert into dev_audit (company_id, field, old_value, new_value, changed_by, changed_at)
      values (new.company_id, 'grupo',
              (select name from dev_groups where id = v_lista),
              (select name from dev_groups where id = new.group_id),
              v_actor, v_now);
    end if;
    if new.manual_paused then
      insert into dev_audit (company_id, field, old_value, new_value, changed_by, changed_at)
      values (new.company_id, 'pausa_manual', null,
              'Pausado: ' || coalesce(new.pause_reason, ''), v_actor, v_now);
    end if;
    return null;

  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into dev_audit (company_id, field, old_value, new_value, changed_by, changed_at)
      values (new.company_id, 'status', old.status::text, new.status::text, v_actor, v_now);
    end if;
    if new.group_id is distinct from old.group_id then
      insert into dev_audit (company_id, field, old_value, new_value, changed_by, changed_at)
      values (new.company_id, 'grupo',
              (select name from dev_groups where id = old.group_id),
              (select name from dev_groups where id = new.group_id),
              v_actor, v_now);
    end if;
    if new.manual_paused is distinct from old.manual_paused then
      if new.manual_paused then
        -- Ligou (pausou): sempre por um usuário (via dev_pause_deadline).
        insert into dev_audit (company_id, field, old_value, new_value, changed_by, changed_at)
        values (new.company_id, 'pausa_manual', null,
                'Pausado: ' || coalesce(new.pause_reason, ''), v_actor, v_now);
      else
        -- Desligou (retomou): usuário se continua em Em Desenvolvimento; senão
        -- Sistema (desligada pelo gatilho ao sair de Em Desenvolvimento).
        insert into dev_audit (company_id, field, old_value, new_value, changed_by, changed_at)
        values (new.company_id, 'pausa_manual', null, 'Retomado',
                case when exists (
                       select 1 from dev_groups g
                        where g.id = new.group_id and g.name = 'Em Desenvolvimento'
                     ) then v_actor else null end,
                v_now);
      end if;
    end if;
    return null;

  else -- DELETE (na prática só via cascade da exclusão da empresa)
    if not company_exists(old.company_id) then
      return null;
    end if;
    if old.status is distinct from v_default_status then
      insert into dev_audit (company_id, field, old_value, new_value, changed_by, changed_at)
      values (old.company_id, 'status', old.status::text, v_default_status::text, v_actor, v_now);
    end if;
    if old.group_id is distinct from v_lista then
      insert into dev_audit (company_id, field, old_value, new_value, changed_by, changed_at)
      values (old.company_id, 'grupo',
              (select name from dev_groups where id = old.group_id),
              (select name from dev_groups where id = v_lista),
              v_actor, v_now);
    end if;
    return null;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 7) PREENCHIMENTO (uma vez): reconstrói os períodos a partir do dev_audit.
--    Estado inicial = padrão (Lista de Espera / lista_espera, não corre). Para
--    cada timestamp distinto, resolve o grupo/status vigente; corre = (Em
--    Desenvolvimento E em_desenvolvimento). Transições false->true abrem período;
--    true->false fecham. Período final sem fechamento fica aberto.
-- ---------------------------------------------------------------------
with ts as (
  select distinct company_id, changed_at from dev_audit where field in ('grupo', 'status')
),
state as (
  select t.company_id, t.changed_at,
    coalesce((select d.new_value from dev_audit d
      where d.company_id = t.company_id and d.field = 'grupo' and d.changed_at <= t.changed_at
      order by d.changed_at desc, d.id desc limit 1), 'Lista de Espera') as g,
    coalesce((select d.new_value from dev_audit d
      where d.company_id = t.company_id and d.field = 'status' and d.changed_at <= t.changed_at
      order by d.changed_at desc, d.id desc limit 1), 'lista_espera') as s
  from ts t
),
runpts as (
  select company_id, changed_at,
    (g = 'Em Desenvolvimento' and s = 'em_desenvolvimento') as run
  from state
),
withlag as (
  select company_id, changed_at, run,
    coalesce(lag(run) over (partition by company_id order by changed_at), false) as prev_run
  from runpts
),
transitions as (
  select company_id, changed_at, run from withlag where run <> prev_run
),
opens as (
  select company_id, changed_at as started_at,
    row_number() over (partition by company_id order by changed_at) as rn
  from transitions where run
),
closes as (
  select company_id, changed_at as ended_at,
    row_number() over (partition by company_id order by changed_at) as rn
  from transitions where not run
)
insert into dev_clock_periods (company_id, started_at, ended_at)
select o.company_id, o.started_at, c.ended_at
from opens o
left join closes c on c.company_id = o.company_id and c.rn = o.rn;

-- ---------------------------------------------------------------------
-- 8) Contagem de dias úteis usados. Um dia útil ANTERIOR a hoje (BRT) conta se o
--    prazo corria no fim dele (fronteira = início do dia seguinte em BRT); hoje
--    conta se for dia útil e houver período aberto agora. Set-based (sem laço por
--    empresa; generate_series limitado ao intervalo dos períodos).
-- ---------------------------------------------------------------------
create or replace function dev_elapsed_all()
returns table(company_id uuid, used integer)
language sql
stable
set search_path = public
as $$
  with bounds as (
    select min(started_at) as min_start from dev_clock_periods
  ),
  today_brt as (
    select (now() at time zone 'America/Sao_Paulo')::date as td
  ),
  days as (
    select g::date as d
    from bounds b, today_brt t,
         generate_series((b.min_start at time zone 'America/Sao_Paulo')::date, t.td, interval '1 day') g
    where b.min_start is not null
  )
  select p.company_id, count(distinct d.d)::int as used
  from dev_clock_periods p
  cross join days d
  cross join today_brt t
  where dev_is_business_day(d.d)
    and (
      (d.d < t.td
        and p.started_at < ((d.d + 1)::timestamp at time zone 'America/Sao_Paulo')
        and (p.ended_at is null or p.ended_at >= ((d.d + 1)::timestamp at time zone 'America/Sao_Paulo')))
      or
      (d.d = t.td and p.ended_at is null)
    )
  group by p.company_id;
$$;
grant execute on function dev_elapsed_all() to authenticated;

-- Versão por empresa (mesmo critério).
create or replace function dev_elapsed_business_days(p_company_id uuid)
returns integer
language sql
stable
set search_path = public
as $$
  with bounds as (
    select min(started_at) as min_start from dev_clock_periods where company_id = p_company_id
  ),
  today_brt as (
    select (now() at time zone 'America/Sao_Paulo')::date as td
  ),
  days as (
    select g::date as d
    from bounds b, today_brt t,
         generate_series((b.min_start at time zone 'America/Sao_Paulo')::date, t.td, interval '1 day') g
    where b.min_start is not null
  )
  select coalesce(count(distinct d.d), 0)::int
  from days d
  cross join today_brt t
  where dev_is_business_day(d.d)
    and (
      (d.d < t.td and exists (
        select 1 from dev_clock_periods p
        where p.company_id = p_company_id
          and p.started_at < ((d.d + 1)::timestamp at time zone 'America/Sao_Paulo')
          and (p.ended_at is null or p.ended_at >= ((d.d + 1)::timestamp at time zone 'America/Sao_Paulo'))
      ))
      or
      (d.d = t.td and exists (
        select 1 from dev_clock_periods p
        where p.company_id = p_company_id and p.ended_at is null
      ))
    );
$$;
grant execute on function dev_elapsed_business_days(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 9) RPCs de pausa manual (INVOKER; dev_can_manage + RLS admin). Pausar exige
--    motivo (1..500) e só em Em Desenvolvimento. Retomar limpa tudo.
-- ---------------------------------------------------------------------
create or replace function dev_pause_deadline(p_company_id uuid, p_reason text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not dev_can_manage() then
    raise exception 'Apenas administradores alteram o Desenvolvimento.' using errcode = 'insufficient_privilege';
  end if;
  if not dev_on_board(p_company_id) then
    raise exception 'Esta empresa não está no quadro de Desenvolvimento.' using errcode = 'check_violation';
  end if;
  if v_reason = '' then
    raise exception 'Informe o motivo da pausa.' using errcode = 'check_violation';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'Motivo muito longo (máx. 500 caracteres).' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from company_dev cd
      join dev_groups g on g.id = cd.group_id
     where cd.company_id = p_company_id and g.name = 'Em Desenvolvimento'
  ) then
    raise exception 'Só é possível pausar o prazo de uma empresa em Em Desenvolvimento.'
      using errcode = 'check_violation';
  end if;

  update company_dev
     set manual_paused = true, pause_reason = v_reason, paused_at = now(), paused_by = auth.uid(),
         updated_at = now(), updated_by = auth.uid()
   where company_id = p_company_id;
end;
$$;
grant execute on function dev_pause_deadline(uuid, text) to authenticated;

create or replace function dev_resume_deadline(p_company_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not dev_can_manage() then
    raise exception 'Apenas administradores alteram o Desenvolvimento.' using errcode = 'insufficient_privilege';
  end if;
  if not dev_on_board(p_company_id) then
    raise exception 'Esta empresa não está no quadro de Desenvolvimento.' using errcode = 'check_violation';
  end if;

  update company_dev
     set manual_paused = false, pause_reason = null, paused_at = null, paused_by = null,
         updated_at = now(), updated_by = auth.uid()
   where company_id = p_company_id and manual_paused = true;
end;
$$;
grant execute on function dev_resume_deadline(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 10) dev_board() — acrescenta Prazo: dias úteis usados, se corre agora, pausa
--     manual (bool/motivo/quando/por quem), se já começou, previsão de entrega
--     (hoje + restantes, só correndo e não estourado) e o total do prazo.
--     DROP + CREATE (retorno muda).
-- ---------------------------------------------------------------------
drop function if exists public.dev_board();

create function public.dev_board()
returns table (
  id               uuid,
  name             text,
  group_id         uuid,
  status           text,
  labels           jsonb,
  history_count    integer,
  used_days        integer,
  deadline_days    integer,
  running          boolean,
  started_ever     boolean,
  manual_paused    boolean,
  pause_reason     text,
  paused_at        timestamptz,
  paused_by_name   text,
  deadline_forecast text
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lista    uuid;
  v_today    date := (now() at time zone 'America/Sao_Paulo')::date;
  v_deadline integer := dev_deadline_days();
begin
  if not dev_can_manage() then
    raise exception 'Apenas administradores acessam o quadro de Desenvolvimento.'
      using errcode = 'insufficient_privilege';
  end if;
  select dg.id into v_lista from dev_groups dg where dg.name = 'Lista de Espera';
  return query
  with hist as (
    select da.company_id, count(*)::int as n from dev_audit da group by da.company_id
  ),
  lbl as (
    select cel.company_id,
      jsonb_agg(
        jsonb_build_object(
          'id', l.id, 'name', l.name, 'bg_color', l.bg_color,
          'text_color', l.text_color, 'highlight', l.highlight
        )
        order by l.highlight desc, l.name
      ) as items
    from company_effective_labels cel
    join labels l on l.id = cel.label_id
    group by cel.company_id
  ),
  used as (
    select e.company_id, e.used from dev_elapsed_all() e
  ),
  clock as (
    select p.company_id,
           bool_or(p.ended_at is null) as running,
           true as started_ever
    from dev_clock_periods p
    group by p.company_id
  )
  select
    c.id,
    c.name,
    coalesce(cd.group_id, v_lista),
    coalesce(cd.status, 'lista_espera'::dev_status)::text,
    coalesce(lbl.items, '[]'::jsonb),
    coalesce(h.n, 0),
    coalesce(u.used, 0),
    v_deadline,
    coalesce(ck.running, false),
    coalesce(ck.started_ever, false),
    coalesce(cd.manual_paused, false),
    cd.pause_reason,
    cd.paused_at,
    (case when cd.paused_by is not null
          then coalesce(nullif(pp.full_name, ''), pp.email) end),
    (case
       when coalesce(ck.running, false) and coalesce(u.used, 0) < v_deadline
       then to_char(dev_add_business_days(v_today, v_deadline - coalesce(u.used, 0)), 'YYYY-MM-DD')
       else null
     end)
  from companies c
  left join company_dev cd on cd.company_id = c.id
  left join profiles pp on pp.id = cd.paused_by
  left join hist h on h.company_id = c.id
  left join lbl on lbl.company_id = c.id
  left join used u on u.company_id = c.id
  left join clock ck on ck.company_id = c.id
  where exists (
    select 1 from company_contracted_channels cc
     where cc.company_id = c.id
       and cc.channel in ('gestao_site', 'desenvolvimento_site')
  )
  order by c.name;
end;
$$;
grant execute on function public.dev_board() to authenticated;

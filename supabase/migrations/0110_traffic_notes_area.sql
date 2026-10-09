-- =====================================================================
-- 0110 — Quadro "Tráfego" (Fatia 3): balão de Atualizações filtrado pela área
-- Tráfego.
-- =====================================================================
-- As Atualizações do Tráfego NÃO são tabelas novas: são as company_notes
-- normais da empresa (aparecem também na central, para todos que já leem as
-- Atualizações daquela empresa), filtradas pela área 'trafego'.
--
-- Esta fatia acrescenta só a MARCA DE ORIGEM (company_notes.origin) e as travas
-- de banco que mantêm a área Tráfego presa às notas criadas pelo quadro — a
-- garantia é do banco, não da tela. Nada de novo em company_events.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) origin: null (criada fora do quadro) ou 'traffic' (criada pelo Tráfego).
--    Imutável depois de criada (gatilho recusa a troca).
-- ---------------------------------------------------------------------
alter table company_notes
  add column origin text,
  add constraint company_notes_origin_check
    check (origin is null or origin = 'traffic');

-- Imutabilidade de origin (BEFORE UPDATE, dedicado — não mexe no gatilho de
-- auditoria existente). Uma edição normal manda new.origin = old.origin
-- (inalterado) e passa; só uma TROCA real é recusada.
create or replace function company_notes_freeze_origin()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.origin is distinct from old.origin then
    raise exception 'A origem da atualização é imutável.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_company_notes_freeze_origin
  before update on company_notes
  for each row execute function company_notes_freeze_origin();

-- ---------------------------------------------------------------------
-- 2) Nota criada pelo Tráfego (origin='traffic') ganha a área 'trafego'
--    automaticamente (AFTER INSERT, SECURITY DEFINER). on conflict do nothing.
-- ---------------------------------------------------------------------
create or replace function company_notes_traffic_area()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.origin = 'traffic' then
    insert into company_note_areas (note_id, area)
    values (new.id, 'trafego')
    on conflict (note_id, area) do nothing;
  end if;
  return null;
end;
$$;

create trigger trg_company_notes_traffic_area
  after insert on company_notes
  for each row execute function company_notes_traffic_area();

-- ---------------------------------------------------------------------
-- 3) A área 'trafego' NÃO pode ser removida de uma nota origin='traffic'
--    (BEFORE DELETE em company_note_areas). EXCEÇÃO de cascata: quando a própria
--    nota (ou a empresa) está sendo excluída, a nota já não existe mais e a
--    remoção passa — mesmo cuidado da proteção de cascata da 0104. SECURITY
--    DEFINER para que a checagem de origin não dependa da RLS de quem apaga.
-- ---------------------------------------------------------------------
create or replace function company_note_areas_guard_traffic()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origin text;
  v_found boolean;
begin
  if old.area <> 'trafego' then
    return old;
  end if;
  select origin into v_origin from company_notes where id = old.note_id;
  v_found := found;
  -- Nota já removida (cascata da exclusão da nota/empresa): nada a proteger.
  if not v_found then
    return old;
  end if;
  if v_origin = 'traffic' then
    raise exception 'Esta atualização foi criada no quadro de Tráfego e precisa manter a área Tráfego.'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

create trigger trg_company_note_areas_guard_traffic
  before delete on company_note_areas
  for each row execute function company_note_areas_guard_traffic();

-- ---------------------------------------------------------------------
-- 4) traffic_board() ganha traffic_note_count: nº de Atualizações da empresa COM
--    a área 'trafego' (mesma regra do balão de Empresas — contar a nota, só
--    filtrando pela área). Mudança de retorno exige DROP + CREATE (conferir em
--    pg_proc que sobra UMA).
-- ---------------------------------------------------------------------
drop function if exists public.traffic_board();

create function public.traffic_board()
returns table (
  id uuid,
  name text,
  group_id uuid,
  synced boolean,
  months_total integer,
  period_days integer,
  manual_group_id uuid,
  focus text,
  platform text,
  status text,
  budget text,
  history_count integer,
  traffic_note_count integer
)
language plpgsql
security invoker
set search_path to 'public'
as $$
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores acessam o quadro de Tráfego.' using errcode = 'insufficient_privilege';
  end if;
  return query
  with hist as (
    select company_id, count(*)::int as n from traffic_audit group by company_id
  ),
  tnotes as (
    select n.company_id, count(*)::int as n
    from company_notes n
    join company_note_areas a on a.note_id = n.id and a.area = 'trafego'
    group by n.company_id
  )
  select
    c.id,
    c.name,
    c.group_id,
    exists (
      select 1 from company_contracted_channels x
       where x.company_id = c.id
         and x.channel in ('mercado_livre', 'shopee', 'amazon')
    ) as synced,
    cd.months_total,
    cd.period_days,
    ct.manual_group_id,
    ct.focus::text,
    ct.platform::text,
    ct.status::text,
    ct.budget::text,
    coalesce(h.n, 0),
    coalesce(tn.n, 0)
  from companies c
  left join company_details d on d.company_id = c.id
  left join lateral contract_duration(d.started_on, d.ends_on) cd on true
  left join company_traffic ct on ct.company_id = c.id
  left join hist h on h.company_id = c.id
  left join tnotes tn on tn.company_id = c.id
  where exists (
    select 1 from company_contracted_channels cc
     where cc.company_id = c.id and cc.channel = 'trafego'
  )
  order by c.name;
end;
$$;

grant execute on function public.traffic_board() to authenticated;

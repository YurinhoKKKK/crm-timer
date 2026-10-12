-- =====================================================================
-- 0117 — Quadro "Desenvolvimento" (Etapa 3): Atualizações filtradas pela área
-- Site, GENERALIZANDO o mecanismo de origem das Atualizações do Tráfego (0110).
-- =====================================================================
-- Nada de um segundo conjunto de gatilhos: a marca de origem das Atualizações
-- (company_notes.origin) passa a aceitar também 'site', e os gatilhos do Tráfego
-- viram GENÉRICOS, dirigidos por UMA função de correspondência origin -> área:
--   'traffic' -> 'trafego'   |   'site' -> 'site'
-- O comportamento do Tráfego fica IDÊNTICO.
--
-- As Atualizações do Desenvolvimento são company_notes NORMAIS (aparecem também
-- na central da empresa, para todos que já leem as Atualizações dela), filtradas
-- pela área 'site'. Nada de novo em company_events.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) origin aceita null, 'traffic' ou 'site'. (Continua imutável — o gatilho
--    trg_company_notes_freeze_origin da 0110 segue valendo, já tem nome genérico.)
-- ---------------------------------------------------------------------
alter table company_notes drop constraint company_notes_origin_check;
alter table company_notes
  add constraint company_notes_origin_check
    check (origin is null or origin in ('traffic', 'site'));

-- ---------------------------------------------------------------------
-- 2) Correspondência origin -> área travada, em UM lugar (fonte única usada pelos
--    dois gatilhos). Origem desconhecida/null -> sem área travada.
-- ---------------------------------------------------------------------
create or replace function note_origin_area(p_origin text)
returns note_area
language sql
immutable
set search_path = public
as $$
  select case p_origin
    when 'traffic' then 'trafego'::note_area
    when 'site'    then 'site'::note_area
    else null::note_area
  end;
$$;
grant execute on function note_origin_area(text) to authenticated;

-- ---------------------------------------------------------------------
-- 3) Nota criada por um quadro (origin não nulo) ganha a área correspondente
--    automaticamente (AFTER INSERT, SECURITY DEFINER). Generaliza o antigo
--    company_notes_traffic_area usando a função de correspondência.
--    Renomeia o gatilho: trg_company_notes_traffic_area -> trg_company_notes_origin_area.
-- ---------------------------------------------------------------------
create or replace function company_notes_origin_area()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_area note_area := note_origin_area(new.origin);
begin
  if v_area is not null then
    insert into company_note_areas (note_id, area)
    values (new.id, v_area)
    on conflict (note_id, area) do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_company_notes_traffic_area on company_notes;
create trigger trg_company_notes_origin_area
  after insert on company_notes
  for each row execute function company_notes_origin_area();

drop function if exists company_notes_traffic_area();

-- ---------------------------------------------------------------------
-- 4) A área correspondente à origem NÃO pode ser removida de uma nota que tem
--    origem (BEFORE DELETE em company_note_areas). Generaliza o antigo
--    company_note_areas_guard_traffic. EXCEÇÃO de cascata mantida (nota/empresa
--    sendo excluída: a nota já não existe e a remoção passa). Mensagem genérica
--    por quadro/área. Renomeia o gatilho:
--    trg_company_note_areas_guard_traffic -> trg_company_note_areas_guard_origin.
-- ---------------------------------------------------------------------
create or replace function company_note_areas_guard_origin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origin text;
  v_found boolean;
  v_locked note_area;
  v_quadro text;
  v_area_label text;
begin
  select origin into v_origin from company_notes where id = old.note_id;
  v_found := found;
  -- Nota já removida (cascata da exclusão da nota/empresa): nada a proteger.
  if not v_found then
    return old;
  end if;
  v_locked := note_origin_area(v_origin);
  -- Só a área correspondente à origem é protegida; as demais saem livremente.
  -- Sem origem (v_locked null) nada é protegido.
  if v_locked is null or old.area <> v_locked then
    return old;
  end if;
  if v_origin = 'traffic' then
    v_quadro := 'Tráfego';
    v_area_label := 'Tráfego';
  else -- 'site' (único outro origin que mapeia para área travada)
    v_quadro := 'Desenvolvimento';
    v_area_label := 'Site';
  end if;
  raise exception 'Esta atualização foi criada no quadro de % e precisa manter a área %.',
    v_quadro, v_area_label using errcode = 'check_violation';
end;
$$;

drop trigger if exists trg_company_note_areas_guard_traffic on company_note_areas;
create trigger trg_company_note_areas_guard_origin
  before delete on company_note_areas
  for each row execute function company_note_areas_guard_origin();

drop function if exists company_note_areas_guard_traffic();

-- ---------------------------------------------------------------------
-- 5) dev_board() ganha site_note_count: nº de Atualizações da empresa COM a área
--    'site' (mesma regra do balão de Empresas — contar a nota, só filtrando pela
--    área). Mudança de retorno exige DROP + CREATE (conferir em pg_proc que sobra
--    UMA). Mantém TODO o restante da Etapa 2 (Prazo) intacto.
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
  deadline_forecast text,
  site_note_count  integer
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
  ),
  snotes as (
    select n.company_id, count(*)::int as n
    from company_notes n
    join company_note_areas a on a.note_id = n.id and a.area = 'site'
    group by n.company_id
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
     end),
    coalesce(sn.n, 0)
  from companies c
  left join company_dev cd on cd.company_id = c.id
  left join profiles pp on pp.id = cd.paused_by
  left join hist h on h.company_id = c.id
  left join lbl on lbl.company_id = c.id
  left join used u on u.company_id = c.id
  left join clock ck on ck.company_id = c.id
  left join snotes sn on sn.company_id = c.id
  where exists (
    select 1 from company_contracted_channels cc
     where cc.company_id = c.id
       and cc.channel in ('gestao_site', 'desenvolvimento_site')
  )
  order by c.name;
end;
$$;
grant execute on function public.dev_board() to authenticated;

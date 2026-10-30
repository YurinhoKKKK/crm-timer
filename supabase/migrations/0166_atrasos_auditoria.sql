-- =====================================================================
-- 0166 — Auditoria de ATRASOS (quadro do Dashboard + tela /admin/atrasos)
-- =====================================================================
-- O atraso real do operacional está nas tarefas CONCLUÍDAS fora do prazo (as
-- padrão diárias expiram em 24h e somem de "Tarefas"), então ganha um lugar no
-- DASHBOARD: um quadro "Atrasos" logo abaixo do "Resumo por responsável", com
-- três números e as pessoas que mais atrasam — por CRIADOR e por RESPONSÁVEL —,
-- e uma tela dedicada /admin/atrasos com resumo + lista paginada + export.
--
-- Definições (BRT, "por PRAZO" — a tarefa entra pela data do prazo, como todo o
-- Dashboard), sobre task_instances com due_at NÃO nulo:
--   · Concluída com atraso: status='finalizada' e finished_at > due_at.
--   · Atrasada em aberto:    status in (a_fazer,iniciada) e due_at < now().
--   · Expirada:              cancelada pela expiração automática (existe linha em
--                            task_auto_expirations para a instância).
--   · No prazo:              status='finalizada' e finished_at <= due_at.
--   · Prazo concedido:       due_at - created_at da ORIGEM — tarefa única usa o
--                            task_templates.created_at; recorrente (diária) usa o
--                            created_at da própria ocorrência (sem template → a
--                            ocorrência). Igual à regra do CreatorMeta.
--   · Criador = task_templates.created_by; Responsável = task_instances.collaborator_id.
--
-- Tarefas PADRÃO DIÁRIAS (tt.standard_task_id não nulo) ficam de FORA por padrão
-- (no quadro sempre; na tela há o toggle p_include_standard). Situações são
-- mutuamente exclusivas por prioridade: expirada > concluída com atraso >
-- atrasada em aberto. Mediana do atraso = mediana de (finished_at - due_at) das
-- concluídas com atraso.
--
-- Quatro RPCs SECURITY DEFINER (gate is_admin()):
--   1) atrasos_dashboard — 3 totais + pessoas (criador/responsável) com atrasos,
--      sem padrão diárias. Uma ida agregada (o quadro não carrega lista). jsonb.
--   2) atrasos_summary   — blocos "Por criador" e "Por responsável" da tela,
--      respeitando TODOS os filtros. jsonb.
--   3) atrasos_list      — lista paginada no banco (limit/offset + total_count)
--      do universo de atrasos, com filtros/busca/ordenação.
--   4) atrasos_facets    — empresas/criadores/responsáveis/tipos distintos do
--      universo de atrasos no período (para os filtros). jsonb.
--
-- Pessoas via profiles (só full_name + avatar_path, nunca e-mail — igual
-- display_profiles). Busca sem acento: extensions.unaccent (qualificada pelo
-- schema, search_path 'public').
--
-- Contas de TESTE (sem uso real) ficam de fora de TODA a tela e do quadro: a
-- lista fixa de IDs mora num único lugar — atrasos_excluded_ids() — e toda RPC
-- descarta a tarefa cujo responsável OU criador esteja nessa lista.
--
-- Convenção (funcao-nova-revoke-anon): REVOKE de public/anon + GRANT authenticated.
-- Aditiva: nada é alterado nas tabelas nem nas RPCs existentes.
--
-- ROLLBACK (completo — puramente aditiva): ver supabase/rollback/0166_*.sql
-- =====================================================================

-- =====================================================================
-- 0) atrasos_excluded_ids — contas de teste excluídas (fonte única)
-- =====================================================================
-- IDs confirmados pelo Yuri como contas de teste (sem uso real): Teste Yuri,
-- Yuri Teste 2 e Alex Analista. Fonte única usada por todas as RPCs de atrasos.
create or replace function public.atrasos_excluded_ids()
returns uuid[]
language sql
immutable
as $$
  select array[
    'dc27d309-c1b4-4ae6-a56d-e8fef99f54fa'::uuid, -- Teste Yuri
    'b039888d-7816-44c9-9991-135467cf1e05'::uuid, -- Yuri Teste 2
    'ed05b270-b774-4a2f-9a96-e73883021589'::uuid  -- Alex Analista
  ];
$$;

comment on function public.atrasos_excluded_ids() is
  'IDs de contas de teste (sem uso real) excluídas de toda a auditoria de atrasos — fonte única. Teste Yuri / Yuri Teste 2 / Alex Analista.';

revoke execute on function public.atrasos_excluded_ids() from public, anon;
grant  execute on function public.atrasos_excluded_ids() to authenticated;

-- =====================================================================
-- 1) atrasos_dashboard — 3 totais + top por criador/responsável (sem padrão)
-- =====================================================================
-- Devolve jsonb { totals:{completed_late,open_overdue,expired},
--                 creators:[{id,late,total,on_time_pct}...],
--                 responsibles:[...] } — ordenados por atrasos desc. O Dashboard
-- fatia o Top 5 de cada e resolve foto/nome por display_profiles.
create or replace function public.atrasos_dashboard(
  p_start date,
  p_end   date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_result jsonb;
begin
  if not (select is_admin()) then
    raise exception 'atrasos_dashboard: acesso restrito a administradores.'
      using errcode = '42501';
  end if;

  -- CTE única visível a todas as subconsultas do MESMO SELECT (totais + os dois
  -- rankings). Separar em vários SELECT INTO perderia a CTE a partir do 2º.
  with scope as (
    select
      ti.collaborator_id,
      tt.created_by,
      exists (select 1 from task_auto_expirations ae where ae.task_id = ti.id) as is_expired,
      (ti.status = 'finalizada' and ti.finished_at is not null and ti.finished_at > ti.due_at) as done_late_raw,
      (ti.status in ('a_fazer','iniciada') and ti.due_at < now()) as open_overdue_raw,
      (ti.status = 'finalizada' and ti.finished_at is not null and ti.finished_at <= ti.due_at) as on_time_raw
    from task_instances ti
    left join task_templates tt on tt.id = ti.template_id
    where ti.due_at is not null
      and tt.standard_task_id is null
      and ti.collaborator_id <> all(public.atrasos_excluded_ids())
      and (tt.created_by is null or tt.created_by <> all(public.atrasos_excluded_ids()))
      and (p_start is null or (ti.due_at at time zone 'America/Sao_Paulo')::date >= p_start)
      and (p_end   is null or (ti.due_at at time zone 'America/Sao_Paulo')::date <= p_end)
  ),
  flagged as (
    select
      collaborator_id,
      created_by,
      is_expired,
      (not is_expired and done_late_raw)    as completed_late,
      (not is_expired and open_overdue_raw) as open_overdue,
      (not is_expired and on_time_raw)      as on_time
    from scope
  )
  select jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'completed_late', coalesce(sum(case when completed_late then 1 else 0 end), 0),
        'open_overdue',   coalesce(sum(case when open_overdue   then 1 else 0 end), 0),
        'expired',        coalesce(sum(case when is_expired     then 1 else 0 end), 0)
      )
      from flagged
    ),
    -- Por responsável (collaborator_id nunca é nulo).
    'responsibles', coalesce((
      select jsonb_agg(row_to_json(t)::jsonb order by t.late desc, t.total desc)
      from (
        select
          collaborator_id as id,
          count(*) as total,
          count(*) filter (where is_expired or completed_late or open_overdue) as late,
          round(100.0 * count(*) filter (where on_time) / nullif(count(*), 0)) as on_time_pct
        from flagged
        group by collaborator_id
        having count(*) filter (where is_expired or completed_late or open_overdue) > 0
      ) t
    ), '[]'::jsonb),
    -- Por criador (ignora origem sem criador — sistema/legado sem template).
    'creators', coalesce((
      select jsonb_agg(row_to_json(t)::jsonb order by t.late desc, t.total desc)
      from (
        select
          created_by as id,
          count(*) as total,
          count(*) filter (where is_expired or completed_late or open_overdue) as late,
          round(100.0 * count(*) filter (where on_time) / nullif(count(*), 0)) as on_time_pct
        from flagged
        where created_by is not null
        group by created_by
        having count(*) filter (where is_expired or completed_late or open_overdue) > 0
      ) t
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

comment on function public.atrasos_dashboard(date, date) is
  'Quadro Atrasos do Dashboard: 3 totais (concluídas com atraso / atrasadas em aberto / expiradas) + pessoas com atrasos por criador e por responsável (sem tarefas padrão diárias), por PRAZO no período. DEFINER + gate is_admin().';

revoke execute on function public.atrasos_dashboard(date, date) from public, anon;
grant  execute on function public.atrasos_dashboard(date, date) to authenticated;

-- =====================================================================
-- 2) atrasos_summary — blocos "Por criador" e "Por responsável" da tela
-- =====================================================================
-- Respeita TODOS os filtros da tela (toggle padrão, situação, criador,
-- responsável, empresa, tipo, busca). Cada pessoa: total de tarefas, % no prazo,
-- concluídas com atraso, atrasadas em aberto, expiradas, atraso mediano (seg) e
-- — só no bloco de criador — quantas atrasadas tinham prazo concedido < 24h.
create or replace function public.atrasos_summary(
  p_start             date,
  p_end               date,
  p_include_standard  boolean default false,
  p_status            text default null,
  p_creator           uuid default null,
  p_responsible       uuid default null,
  p_company           uuid default null,
  p_type              text default null,
  p_search            text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_search text := lower(extensions.unaccent(coalesce(nullif(btrim(p_search), ''), '')));
  v_result jsonb;
begin
  if not (select is_admin()) then
    raise exception 'atrasos_summary: acesso restrito a administradores.'
      using errcode = '42501';
  end if;

  with base as (
    select
      ti.id,
      ti.collaborator_id,
      tt.created_by,
      ti.company_id,
      c.name as company_name,
      ti.title,
      ti.description,
      case
        when tt.category is not null then 'cat:' || tt.category::text
        when tt.template_type = 'listagem' then 'cat:listagem'
        else 'title:' || coalesce(nullif(btrim(tt.title), ''), ti.title)
      end as type_key,
      cp.full_name as creator_name,
      exists (select 1 from task_auto_expirations ae where ae.task_id = ti.id) as is_expired_raw,
      (ti.status = 'finalizada' and ti.finished_at is not null and ti.finished_at > ti.due_at) as done_late_raw,
      (ti.status in ('a_fazer','iniciada') and ti.due_at < now()) as open_overdue_raw,
      (ti.status = 'finalizada' and ti.finished_at is not null and ti.finished_at <= ti.due_at) as on_time_raw,
      extract(epoch from (ti.finished_at - ti.due_at)) as done_delay_seconds,
      extract(epoch from (ti.due_at -
        case when tt.kind = 'diaria' then ti.created_at
             else coalesce(tt.created_at, ti.created_at) end)) as granted_seconds
    from task_instances ti
    left join task_templates tt on tt.id = ti.template_id
    left join companies      c  on c.id = ti.company_id
    left join profiles       cp on cp.id = tt.created_by
    where ti.due_at is not null
      and (p_include_standard or tt.standard_task_id is null)
      and ti.collaborator_id <> all(public.atrasos_excluded_ids())
      and (tt.created_by is null or tt.created_by <> all(public.atrasos_excluded_ids()))
      and (p_start is null or (ti.due_at at time zone 'America/Sao_Paulo')::date >= p_start)
      and (p_end   is null or (ti.due_at at time zone 'America/Sao_Paulo')::date <= p_end)
  ),
  flagged as (
    select
      b.collaborator_id,
      b.created_by,
      b.is_expired_raw as is_expired,
      (not b.is_expired_raw and b.done_late_raw)    as completed_late,
      (not b.is_expired_raw and b.open_overdue_raw) as open_overdue,
      (not b.is_expired_raw and b.on_time_raw)      as on_time,
      b.done_delay_seconds,
      b.granted_seconds
    from base b
    where (p_company is null or b.company_id = p_company)
      and (p_type is null or b.type_key = p_type)
      and (p_creator is null or b.created_by = p_creator)
      and (p_responsible is null or b.collaborator_id = p_responsible)
      and (
        p_status is null or p_status = ''
        or (p_status = 'completed_late' and not b.is_expired_raw and b.done_late_raw)
        or (p_status = 'open_overdue'   and not b.is_expired_raw and b.open_overdue_raw)
        or (p_status = 'expired'        and b.is_expired_raw)
      )
      and (
        v_search = ''
        or lower(extensions.unaccent(coalesce(b.title, '')))        like '%' || v_search || '%'
        or lower(extensions.unaccent(coalesce(b.company_name, ''))) like '%' || v_search || '%'
        or lower(extensions.unaccent(coalesce(b.description, '')))  like '%' || v_search || '%'
        or lower(extensions.unaccent(coalesce(b.creator_name, '')))  like '%' || v_search || '%'
      )
  )
  select jsonb_build_object(
    'responsibles', coalesce((
      select jsonb_agg(row_to_json(t)::jsonb order by t.late desc, t.total desc)
      from (
        select
          collaborator_id as id,
          count(*) as total,
          count(*) filter (where is_expired or completed_late or open_overdue) as late,
          round(100.0 * count(*) filter (where on_time) / nullif(count(*), 0)) as on_time_pct,
          count(*) filter (where completed_late) as completed_late,
          count(*) filter (where open_overdue)   as open_overdue,
          count(*) filter (where is_expired)     as expired,
          coalesce(round(percentile_cont(0.5) within group (
            order by done_delay_seconds) filter (where completed_late)), 0) as median_delay_seconds
        from flagged
        group by collaborator_id
        having count(*) filter (where is_expired or completed_late or open_overdue) > 0
      ) t
    ), '[]'::jsonb),
    'creators', coalesce((
      select jsonb_agg(row_to_json(t)::jsonb order by t.late desc, t.total desc)
      from (
        select
          created_by as id,
          count(*) as total,
          count(*) filter (where is_expired or completed_late or open_overdue) as late,
          round(100.0 * count(*) filter (where on_time) / nullif(count(*), 0)) as on_time_pct,
          count(*) filter (where completed_late) as completed_late,
          count(*) filter (where open_overdue)   as open_overdue,
          count(*) filter (where is_expired)     as expired,
          coalesce(round(percentile_cont(0.5) within group (
            order by done_delay_seconds) filter (where completed_late)), 0) as median_delay_seconds,
          count(*) filter (where (is_expired or completed_late or open_overdue)
                             and granted_seconds is not null and granted_seconds < 86400) as under24_late
        from flagged
        where created_by is not null
        group by created_by
        having count(*) filter (where is_expired or completed_late or open_overdue) > 0
      ) t
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

comment on function public.atrasos_summary(date, date, boolean, text, uuid, uuid, uuid, text, text) is
  'Blocos de resumo da tela /admin/atrasos (Por criador / Por responsável), respeitando todos os filtros. DEFINER + gate is_admin().';

revoke execute on function public.atrasos_summary(date, date, boolean, text, uuid, uuid, uuid, text, text) from public, anon;
grant  execute on function public.atrasos_summary(date, date, boolean, text, uuid, uuid, uuid, text, text) to authenticated;

-- =====================================================================
-- 3) atrasos_list — lista paginada no banco (universo de atrasos)
-- =====================================================================
-- Só o universo de ATRASOS (expirada | concluída com atraso | atrasada em
-- aberto). p_order: 'atraso' (default, mais atrasadas primeiro), 'recentes'
-- (criada em desc), 'prazo' (prazo concedido asc). total_count em cada linha.
create or replace function public.atrasos_list(
  p_start             date,
  p_end               date,
  p_include_standard  boolean default false,
  p_status            text default null,
  p_creator           uuid default null,
  p_responsible       uuid default null,
  p_company           uuid default null,
  p_type              text default null,
  p_search            text default null,
  p_order             text default 'atraso',
  p_limit             int  default 50,
  p_offset            int  default 0
)
returns table(
  id uuid,
  title text,
  company_id uuid,
  company_name text,
  type_key text,
  type_label text,
  responsible_id uuid,
  responsible_name text,
  responsible_avatar_path text,
  creator_id uuid,
  creator_name text,
  creator_avatar_path text,
  created_at timestamptz,
  due_at timestamptz,
  granted_seconds double precision,
  finished_at timestamptz,
  delay_seconds double precision,
  situation text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_search text := lower(extensions.unaccent(coalesce(nullif(btrim(p_search), ''), '')));
begin
  if not (select is_admin()) then
    raise exception 'atrasos_list: acesso restrito a administradores.'
      using errcode = '42501';
  end if;

  return query
  with base as (
    select
      ti.id, ti.title, ti.company_id, c.name as company_name,
      ti.collaborator_id, rp.full_name as responsible_name, rp.avatar_path as responsible_avatar_path,
      tt.created_by, cp.full_name as creator_name, cp.avatar_path as creator_avatar_path,
      ti.created_at, ti.due_at, ti.finished_at, ti.description,
      case
        when tt.category is not null then 'cat:' || tt.category::text
        when tt.template_type = 'listagem' then 'cat:listagem'
        else 'title:' || coalesce(nullif(btrim(tt.title), ''), ti.title)
      end as type_key,
      case
        when tt.category is not null then tt.category::text
        when tt.template_type = 'listagem' then 'Listagem'
        else coalesce(nullif(btrim(tt.title), ''), ti.title)
      end as type_label,
      extract(epoch from (ti.due_at -
        case when tt.kind = 'diaria' then ti.created_at
             else coalesce(tt.created_at, ti.created_at) end))::double precision as granted_seconds,
      exists (select 1 from task_auto_expirations ae where ae.task_id = ti.id) as is_expired_raw,
      (ti.status = 'finalizada' and ti.finished_at is not null and ti.finished_at > ti.due_at) as done_late_raw,
      (ti.status in ('a_fazer','iniciada') and ti.due_at < now()) as open_overdue_raw,
      (select min(ae.expired_at) from task_auto_expirations ae where ae.task_id = ti.id) as expired_at
    from task_instances ti
    left join task_templates tt on tt.id = ti.template_id
    left join companies      c  on c.id = ti.company_id
    left join profiles       rp on rp.id = ti.collaborator_id
    left join profiles       cp on cp.id = tt.created_by
    where ti.due_at is not null
      and (p_include_standard or tt.standard_task_id is null)
      and ti.collaborator_id <> all(public.atrasos_excluded_ids())
      and (tt.created_by is null or tt.created_by <> all(public.atrasos_excluded_ids()))
      and (p_start is null or (ti.due_at at time zone 'America/Sao_Paulo')::date >= p_start)
      and (p_end   is null or (ti.due_at at time zone 'America/Sao_Paulo')::date <= p_end)
  ),
  universe as (
    select
      b.*,
      case
        when b.is_expired_raw then 'expired'
        when b.done_late_raw  then 'completed_late'
        when b.open_overdue_raw then 'open_overdue'
      end as situation,
      (case
        when b.is_expired_raw then extract(epoch from (coalesce(b.expired_at, now()) - b.due_at))
        when b.done_late_raw  then extract(epoch from (b.finished_at - b.due_at))
        when b.open_overdue_raw then extract(epoch from (now() - b.due_at))
      end)::double precision as delay_seconds
    from base b
    where b.is_expired_raw or b.done_late_raw or b.open_overdue_raw
  ),
  filtered as (
    select u.*
    from universe u
    where (p_company is null or u.company_id = p_company)
      and (p_type is null or u.type_key = p_type)
      and (p_creator is null or u.created_by = p_creator)
      and (p_responsible is null or u.collaborator_id = p_responsible)
      and (p_status is null or p_status = '' or u.situation = p_status)
      and (
        v_search = ''
        or lower(extensions.unaccent(coalesce(u.title, '')))        like '%' || v_search || '%'
        or lower(extensions.unaccent(coalesce(u.company_name, ''))) like '%' || v_search || '%'
        or lower(extensions.unaccent(coalesce(u.description, '')))  like '%' || v_search || '%'
        or lower(extensions.unaccent(coalesce(u.creator_name, '')))  like '%' || v_search || '%'
      )
  ),
  ordered as (
    select f.*, count(*) over() as total_count
    from filtered f
    order by
      case when p_order = 'recentes' then f.created_at end desc nulls last,
      case when p_order = 'prazo'    then f.granted_seconds end asc nulls last,
      case when p_order not in ('recentes','prazo') then f.delay_seconds end desc nulls last,
      f.id desc
    limit greatest(p_limit, 0) offset greatest(p_offset, 0)
  )
  select
    o.id, o.title, o.company_id, o.company_name, o.type_key, o.type_label,
    o.collaborator_id, o.responsible_name, o.responsible_avatar_path,
    o.created_by, o.creator_name, o.creator_avatar_path,
    o.created_at, o.due_at, o.granted_seconds, o.finished_at, o.delay_seconds,
    o.situation, o.total_count
  from ordered o
  order by
    case when p_order = 'recentes' then o.created_at end desc nulls last,
    case when p_order = 'prazo'    then o.granted_seconds end asc nulls last,
    case when p_order not in ('recentes','prazo') then o.delay_seconds end desc nulls last,
    o.id desc;
end;
$$;

comment on function public.atrasos_list(date, date, boolean, text, uuid, uuid, uuid, text, text, text, int, int) is
  'Lista paginada no banco do universo de atrasos (expirada | concluída com atraso | atrasada em aberto) por PRAZO no período, com filtros/busca/ordenação e total_count. DEFINER + gate is_admin().';

revoke execute on function public.atrasos_list(date, date, boolean, text, uuid, uuid, uuid, text, text, text, int, int) from public, anon;
grant  execute on function public.atrasos_list(date, date, boolean, text, uuid, uuid, uuid, text, text, text, int, int) to authenticated;

-- =====================================================================
-- 4) atrasos_facets — empresas/criadores/responsáveis/tipos (filtros)
-- =====================================================================
-- Distintos do universo de atrasos no período (respeita só o toggle padrão).
create or replace function public.atrasos_facets(
  p_start            date,
  p_end              date,
  p_include_standard boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_companies jsonb;
  v_types jsonb;
  v_creators jsonb;
  v_responsibles jsonb;
begin
  if not (select is_admin()) then
    raise exception 'atrasos_facets: acesso restrito a administradores.'
      using errcode = '42501';
  end if;

  with base as (
    select
      ti.company_id, c.name as company_name,
      ti.collaborator_id, rp.full_name as responsible_name, rp.avatar_path as responsible_avatar_path,
      tt.created_by, cp.full_name as creator_name, cp.avatar_path as creator_avatar_path,
      case
        when tt.category is not null then 'cat:' || tt.category::text
        when tt.template_type = 'listagem' then 'cat:listagem'
        else 'title:' || coalesce(nullif(btrim(tt.title), ''), ti.title)
      end as type_key,
      case
        when tt.category is not null then tt.category::text
        when tt.template_type = 'listagem' then 'Listagem'
        else coalesce(nullif(btrim(tt.title), ''), ti.title)
      end as type_label,
      exists (select 1 from task_auto_expirations ae where ae.task_id = ti.id) as is_expired_raw,
      (ti.status = 'finalizada' and ti.finished_at is not null and ti.finished_at > ti.due_at) as done_late_raw,
      (ti.status in ('a_fazer','iniciada') and ti.due_at < now()) as open_overdue_raw
    from task_instances ti
    left join task_templates tt on tt.id = ti.template_id
    left join companies      c  on c.id = ti.company_id
    left join profiles       rp on rp.id = ti.collaborator_id
    left join profiles       cp on cp.id = tt.created_by
    where ti.due_at is not null
      and (p_include_standard or tt.standard_task_id is null)
      and ti.collaborator_id <> all(public.atrasos_excluded_ids())
      and (tt.created_by is null or tt.created_by <> all(public.atrasos_excluded_ids()))
      and (p_start is null or (ti.due_at at time zone 'America/Sao_Paulo')::date >= p_start)
      and (p_end   is null or (ti.due_at at time zone 'America/Sao_Paulo')::date <= p_end)
  ),
  universe as (
    select * from base b
    where b.is_expired_raw or b.done_late_raw or b.open_overdue_raw
  )
  select
    coalesce((
      select jsonb_agg(jsonb_build_object('id', t.company_id, 'name', t.company_name)
                       order by t.company_name)
      from (select distinct company_id, company_name from universe where company_id is not null) t
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('key', t.type_key, 'label', t.type_label)
                       order by (t.type_key like 'title:%'), t.type_label)
      from (select distinct type_key, type_label from universe) t
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', t.created_by, 'name', t.creator_name, 'avatar_path', t.creator_avatar_path)
                       order by t.creator_name)
      from (select distinct created_by, creator_name, creator_avatar_path from universe
            where created_by is not null and creator_name is not null) t
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', t.collaborator_id, 'name', t.responsible_name, 'avatar_path', t.responsible_avatar_path)
                       order by t.responsible_name)
      from (select distinct collaborator_id, responsible_name, responsible_avatar_path from universe
            where collaborator_id is not null and responsible_name is not null) t
    ), '[]'::jsonb)
  into v_companies, v_types, v_creators, v_responsibles;

  return jsonb_build_object(
    'companies', v_companies,
    'types', v_types,
    'creators', v_creators,
    'responsibles', v_responsibles
  );
end;
$$;

comment on function public.atrasos_facets(date, date, boolean) is
  'Empresas/criadores/responsáveis/tipos distintos do universo de atrasos num período, para os filtros de /admin/atrasos. DEFINER + gate is_admin().';

revoke execute on function public.atrasos_facets(date, date, boolean) from public, anon;
grant  execute on function public.atrasos_facets(date, date, boolean) to authenticated;

-- =====================================================================
-- 5) atrasos_cell_tasks — drill-down de uma célula do resumo
-- =====================================================================
-- Tarefas EXATAS de uma célula clicada (ex.: "Mateus Borges · Concluídas com
-- atraso"): mesmo período/toggle/filtros da tela + a pessoa (p_dimension =
-- 'creator'|'responsible', p_person) + a métrica (p_metric =
-- 'total'|'completed_late'|'open_overdue'|'expired'|'under24'). A contagem
-- (total_count) bate com o número da célula. Paginada no banco; devolve os dois
-- lados (a UI mostra o OUTRO lado da relação). situation inclui 'on_time'/
-- 'pending' para a métrica 'total' (que tem não-atrasadas); delay_seconds nulo
-- nesses casos.
create or replace function public.atrasos_cell_tasks(
  p_start             date,
  p_end               date,
  p_dimension         text,
  p_person            uuid,
  p_metric            text,
  p_include_standard  boolean default false,
  p_status            text default null,
  p_creator           uuid default null,
  p_responsible       uuid default null,
  p_company           uuid default null,
  p_type              text default null,
  p_search            text default null,
  p_limit             int  default 50,
  p_offset            int  default 0
)
returns table(
  id uuid, title text, company_id uuid, company_name text,
  type_key text, type_label text,
  responsible_id uuid, responsible_name text, responsible_avatar_path text,
  creator_id uuid, creator_name text, creator_avatar_path text,
  created_at timestamptz, due_at timestamptz, granted_seconds double precision,
  finished_at timestamptz, delay_seconds double precision, situation text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_search text := lower(extensions.unaccent(coalesce(nullif(btrim(p_search), ''), '')));
begin
  if not (select is_admin()) then
    raise exception 'atrasos_cell_tasks: acesso restrito a administradores.'
      using errcode = '42501';
  end if;

  return query
  with base as (
    select
      ti.id, ti.title, ti.company_id, c.name as company_name,
      ti.collaborator_id, rp.full_name as responsible_name, rp.avatar_path as responsible_avatar_path,
      tt.created_by, cp.full_name as creator_name, cp.avatar_path as creator_avatar_path,
      ti.created_at, ti.due_at, ti.finished_at, ti.status, ti.description,
      case
        when tt.category is not null then 'cat:' || tt.category::text
        when tt.template_type = 'listagem' then 'cat:listagem'
        else 'title:' || coalesce(nullif(btrim(tt.title), ''), ti.title)
      end as type_key,
      case
        when tt.category is not null then tt.category::text
        when tt.template_type = 'listagem' then 'Listagem'
        else coalesce(nullif(btrim(tt.title), ''), ti.title)
      end as type_label,
      extract(epoch from (ti.due_at -
        case when tt.kind = 'diaria' then ti.created_at
             else coalesce(tt.created_at, ti.created_at) end))::double precision as granted_seconds,
      exists (select 1 from task_auto_expirations ae where ae.task_id = ti.id) as is_expired_raw,
      (ti.status = 'finalizada' and ti.finished_at is not null and ti.finished_at > ti.due_at) as done_late_raw,
      (ti.status in ('a_fazer','iniciada') and ti.due_at < now()) as open_overdue_raw,
      (ti.status = 'finalizada' and ti.finished_at is not null and ti.finished_at <= ti.due_at) as on_time_raw,
      (select min(ae.expired_at) from task_auto_expirations ae where ae.task_id = ti.id) as expired_at
    from task_instances ti
    left join task_templates tt on tt.id = ti.template_id
    left join companies      c  on c.id = ti.company_id
    left join profiles       rp on rp.id = ti.collaborator_id
    left join profiles       cp on cp.id = tt.created_by
    where ti.due_at is not null
      and (p_include_standard or tt.standard_task_id is null)
      and ti.collaborator_id <> all(public.atrasos_excluded_ids())
      and (tt.created_by is null or tt.created_by <> all(public.atrasos_excluded_ids()))
      and (p_start is null or (ti.due_at at time zone 'America/Sao_Paulo')::date >= p_start)
      and (p_end   is null or (ti.due_at at time zone 'America/Sao_Paulo')::date <= p_end)
      -- pessoa da célula (um dos dois lados)
      and (p_dimension <> 'creator'     or tt.created_by = p_person)
      and (p_dimension <> 'responsible' or ti.collaborator_id = p_person)
      -- filtros da tela
      and (p_company is null or ti.company_id = p_company)
      and (p_creator is null or tt.created_by = p_creator)
      and (p_responsible is null or ti.collaborator_id = p_responsible)
  ),
  typed as (
    select b.*,
      (p_type is null or b.type_key = p_type) as type_ok,
      (
        v_search = ''
        or lower(extensions.unaccent(coalesce(b.title, '')))        like '%' || v_search || '%'
        or lower(extensions.unaccent(coalesce(b.company_name, ''))) like '%' || v_search || '%'
        or lower(extensions.unaccent(coalesce(b.description, '')))  like '%' || v_search || '%'
        or lower(extensions.unaccent(coalesce(b.creator_name, '')))  like '%' || v_search || '%'
      ) as search_ok
    from base b
  ),
  flagged as (
    select t.*,
      t.is_expired_raw as is_expired,
      (not t.is_expired_raw and t.done_late_raw)    as completed_late,
      (not t.is_expired_raw and t.open_overdue_raw) as open_overdue,
      case
        when t.is_expired_raw then 'expired'
        when t.done_late_raw  then 'completed_late'
        when t.open_overdue_raw then 'open_overdue'
        when t.on_time_raw    then 'on_time'
        else 'pending'
      end as situation,
      (case
        when t.is_expired_raw then extract(epoch from (coalesce(t.expired_at, now()) - t.due_at))
        when t.done_late_raw  then extract(epoch from (t.finished_at - t.due_at))
        when t.open_overdue_raw then extract(epoch from (now() - t.due_at))
      end)::double precision as delay_seconds
    from typed t
    where t.type_ok and t.search_ok
      -- filtro de situação da tela (mesma semântica do resumo/lista)
      and (
        p_status is null or p_status = ''
        or (p_status = 'completed_late' and not t.is_expired_raw and t.done_late_raw)
        or (p_status = 'open_overdue'   and not t.is_expired_raw and t.open_overdue_raw)
        or (p_status = 'expired'        and t.is_expired_raw)
      )
  ),
  metric as (
    select f.*
    from flagged f
    where
      case p_metric
        when 'total'          then true
        when 'completed_late' then f.completed_late
        when 'open_overdue'   then f.open_overdue
        when 'expired'        then f.is_expired
        when 'under24'        then (f.is_expired or f.completed_late or f.open_overdue)
                                   and f.granted_seconds is not null and f.granted_seconds < 86400
        else true
      end
  ),
  ordered as (
    select m.*, count(*) over() as total_count
    from metric m
    order by m.delay_seconds desc nulls last, m.id desc
    limit greatest(p_limit, 0) offset greatest(p_offset, 0)
  )
  select
    o.id, o.title, o.company_id, o.company_name, o.type_key, o.type_label,
    o.collaborator_id, o.responsible_name, o.responsible_avatar_path,
    o.created_by, o.creator_name, o.creator_avatar_path,
    o.created_at, o.due_at, o.granted_seconds, o.finished_at, o.delay_seconds,
    o.situation, o.total_count
  from ordered o
  order by o.delay_seconds desc nulls last, o.id desc;
end;
$$;

comment on function public.atrasos_cell_tasks(date, date, text, uuid, text, boolean, text, uuid, uuid, uuid, text, text, int, int) is
  'Drill-down de uma célula do resumo de atrasos (pessoa × métrica), respeitando período/toggle/filtros da tela; paginada, total_count = número da célula. DEFINER + gate is_admin().';

revoke execute on function public.atrasos_cell_tasks(date, date, text, uuid, text, boolean, text, uuid, uuid, uuid, text, text, int, int) from public, anon;
grant  execute on function public.atrasos_cell_tasks(date, date, text, uuid, text, boolean, text, uuid, uuid, uuid, text, text, int, int) to authenticated;

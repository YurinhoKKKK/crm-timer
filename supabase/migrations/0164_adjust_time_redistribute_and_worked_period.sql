-- =====================================================================
-- 0164 — Ajuste de tempo sem entradas negativas + critério "trabalhada no período"
-- =====================================================================
-- Três frentes:
--
-- A) admin_adjust_time passa a redistribuir o tempo NO DIA DO TRABALHO, sem
--    criar entradas negativas nem instantâneas em now():
--      · recusa ajuste com timer rodando (trecho aberto) — erro claro; o
--        formulário já nem aparece na UI, mas a RPC é a última barreira;
--      · justificativa OBRIGATÓRIA (rejeita vazia);
--      · REDUÇÃO: encurta os trechos do MAIS RECENTE para o mais antigo
--        (ended_at e seconds), removendo os que zerarem, até bater o novo total;
--      · AUMENTO: cria UM trecho manual colado ao fim do trecho mais recente
--        (started_at = ended_at do último; ended_at = started_at + diferença);
--        sem trechos, ancora no PRAZO da tarefa (fim = due_at). Marca is_manual.
--    Mantém time_adjustments (old/new/reason/quem/quando) e total_seconds.
--    DEFINER, gate is_admin(), REVOKE public/anon.
--    Histórico antigo (entradas negativas) NÃO é tocado aqui.
--
-- B) time_entries.is_manual (default false) marca o trecho criado por ajuste.
--
-- C) collaborator_tasks_page / collaborator_task_facets passam a aceitar, além
--    de "prazo no período" e "atrasada em aberto", a tarefa TRABALHADA no período
--    (algum time_entry com started_at no período, BRT). A página devolve
--    only_by_work = true quando a tarefa entrou SÓ pelo trabalho (para o selo
--    "Trabalhada no período · prazo DD/MM").
--
-- ROLLBACK (completo — restaura o estado pós-0163): supabase/rollback/0164_*.sql
-- =====================================================================

-- =====================================================================
-- B) Coluna is_manual
-- =====================================================================
alter table time_entries
  add column if not exists is_manual boolean not null default false;

comment on column time_entries.is_manual is
  'Trecho criado por ajuste manual de tempo (admin_adjust_time, aumento) — não veio de um timer real.';

-- =====================================================================
-- A) admin_adjust_time — redistribuição sem negativas
-- =====================================================================
create or replace function admin_adjust_time(
  p_task uuid,
  p_new_seconds integer,
  p_reason text default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_admin  uuid := auth.uid();
  v_old    integer;
  v_collab uuid;
  v_due    timestamptz;
  v_reason text;
  v_sum    bigint;
  v_remove bigint;
  v_diff   bigint;
  v_anchor timestamptz;
  v_start  timestamptz;
  v_end    timestamptz;
  v_dur    bigint;
  r        record;
begin
  if not is_admin() then
    raise exception 'Ajuste de tempo: acesso restrito a administradores.'
      using errcode = '42501';
  end if;
  if p_new_seconds is null or p_new_seconds < 0 then
    raise exception 'Informe um tempo válido (>= 0).';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'A justificativa do ajuste é obrigatória.';
  end if;

  select total_seconds, collaborator_id, due_at
    into v_old, v_collab, v_due
    from task_instances where id = p_task;
  if not found then
    raise exception 'Tarefa não encontrada.';
  end if;

  -- Timer rodando: recusa (não fecha o trecho sozinha — peça para pausar antes).
  if exists (select 1 from time_entries where task_id = p_task and ended_at is null) then
    raise exception 'Há um timer em andamento nesta tarefa. Peça para pausar antes de ajustar o tempo.'
      using errcode = '55000';
  end if;

  -- Soma atual (com sinal; inclui eventuais reconciliações antigas).
  select coalesce(sum(entry_seconds(seconds, started_at, ended_at)), 0)
    into v_sum from time_entries where task_id = p_task;

  if p_new_seconds > v_sum then
    -- AUMENTO: um trecho manual colado ao fim do trecho mais recente.
    v_diff := p_new_seconds - v_sum;
    select ended_at into v_anchor
      from time_entries
     where task_id = p_task and ended_at is not null
     order by ended_at desc
     limit 1;
    if v_anchor is not null then
      v_start := v_anchor;
      v_end   := v_anchor + make_interval(secs => v_diff);
    else
      -- Sem trechos: ancora no prazo da tarefa (fim = due_at); sem prazo, now().
      v_end   := coalesce(v_due, now());
      v_start := v_end - make_interval(secs => v_diff);
    end if;
    insert into time_entries (task_id, collaborator_id, started_at, ended_at, seconds, is_manual)
      values (p_task, v_collab, v_start, v_end, v_diff, true);

  elsif p_new_seconds < v_sum then
    -- REDUÇÃO: encurta do mais recente para o mais antigo (sem negativas).
    v_remove := v_sum - p_new_seconds;
    for r in
      select id, started_at, ended_at, seconds
        from time_entries
       where task_id = p_task and ended_at is not null
       order by started_at desc
    loop
      exit when v_remove <= 0;
      v_dur := entry_seconds(r.seconds, r.started_at, r.ended_at);
      if v_dur <= 0 then
        continue;
      end if;
      if v_remove >= v_dur then
        delete from time_entries where id = r.id;
        v_remove := v_remove - v_dur;
      else
        update time_entries
           set seconds  = (v_dur - v_remove)::int,
               ended_at = r.started_at + make_interval(secs => (v_dur - v_remove))
         where id = r.id;
        v_remove := 0;
      end if;
    end loop;
  end if;

  update task_instances set total_seconds = p_new_seconds where id = p_task;

  insert into time_adjustments (task_id, adjusted_by, old_seconds, new_seconds, reason)
    values (p_task, v_admin, v_old, p_new_seconds, v_reason);

  return p_new_seconds;
end;
$$;

comment on function admin_adjust_time(uuid, integer, text) is
  'Ajuste de tempo pelo admin: redistribui no dia do trabalho (reduz encurtando trechos recentes; aumenta com um trecho is_manual colado ao último ou ancorado no prazo). Sem entradas negativas/instantâneas. Recusa timer aberto e justificativa vazia. DEFINER + gate is_admin().';

revoke execute on function admin_adjust_time(uuid, integer, text) from public, anon;
grant  execute on function admin_adjust_time(uuid, integer, text) to authenticated;

-- =====================================================================
-- C) Lista do colaborador — critério inclui "trabalhada no período"
-- =====================================================================
-- Recriada (drop+create) porque ganha a coluna only_by_work no retorno.
drop function if exists public.collaborator_tasks_page(uuid, date, date, text, uuid, text, text, text, int, int);
create function public.collaborator_tasks_page(
  p_collaborator uuid,
  p_start        date,
  p_end          date,
  p_status       text default null,
  p_company      uuid default null,
  p_type         text default null,
  p_search       text default null,
  p_order        text default 'recentes',
  p_limit        int  default 50,
  p_offset       int  default 0
)
returns table(
  id uuid,
  title text,
  status task_status,
  due_at timestamptz,
  task_date date,
  finished_at timestamptz,
  total_seconds integer,
  company_id uuid,
  company_name text,
  type_key text,
  type_label text,
  only_by_work boolean,
  adjustment_count int,
  adjustments jsonb,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_search text := lower(extensions.unaccent(coalesce(nullif(btrim(p_search), ''), '')));
  v_from timestamptz := case when p_start is null then null
                             else (p_start::timestamp at time zone 'America/Sao_Paulo') end;
  v_to   timestamptz := case when p_end is null then null
                             else ((p_end + 1)::timestamp at time zone 'America/Sao_Paulo') end;
begin
  if not (select is_admin()) then
    raise exception 'collaborator_tasks_page: acesso restrito a administradores.'
      using errcode = '42501';
  end if;

  return query
  with rows as (
    select
      ti.id,
      ti.title,
      ti.status,
      ti.due_at,
      ti.task_date,
      ti.finished_at,
      ti.total_seconds,
      ti.company_id,
      c.name as company_name,
      ti.description,
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
      not task_in_period(ti.due_at, ti.status, p_start, p_end) as only_by_work
    from task_instances ti
    left join companies      c  on c.id  = ti.company_id
    left join task_templates tt on tt.id = ti.template_id
    where ti.collaborator_id = p_collaborator
      and (
        task_in_period(ti.due_at, ti.status, p_start, p_end)
        or exists (
          select 1 from time_entries te
          where te.task_id = ti.id
            and (v_from is null or te.started_at >= v_from)
            and (v_to   is null or te.started_at <  v_to)
        )
      )
  ),
  filtered as (
    select r.*
    from rows r
    where (p_company is null or r.company_id = p_company)
      and (p_type is null or r.type_key = p_type)
      and (
        p_status is null or p_status = ''
        or (p_status in ('atrasada', 'atrasadas')
            and r.status in ('a_fazer', 'iniciada') and r.due_at < now())
        or (p_status in ('a_fazer', 'iniciada', 'finalizada', 'cancelada')
            and r.status::text = p_status)
      )
      and (
        v_search = ''
        or lower(extensions.unaccent(coalesce(r.title, '')))        like '%' || v_search || '%'
        or lower(extensions.unaccent(coalesce(r.company_name, ''))) like '%' || v_search || '%'
        or lower(extensions.unaccent(coalesce(r.description, '')))  like '%' || v_search || '%'
      )
  ),
  ordered as (
    select f.*, count(*) over() as total_count
    from filtered f
    order by
      case when p_order = 'antigas' then f.due_at end asc  nulls last,
      case when p_order = 'proximo'
           then abs(extract(epoch from (f.due_at - now()))) end asc nulls last,
      case when p_order not in ('antigas', 'proximo') then f.due_at end desc nulls last,
      f.id desc
    limit greatest(p_limit, 0) offset greatest(p_offset, 0)
  )
  select
    o.id, o.title, o.status, o.due_at, o.task_date, o.finished_at,
    o.total_seconds, o.company_id, o.company_name, o.type_key, o.type_label,
    o.only_by_work,
    coalesce(adj.cnt, 0) as adjustment_count,
    coalesce(adj.items, '[]'::jsonb) as adjustments,
    o.total_count
  from ordered o
  left join lateral (
    select
      count(*)::int as cnt,
      jsonb_agg(
        jsonb_build_object(
          'oldSeconds', ta.old_seconds,
          'newSeconds', ta.new_seconds,
          'reason',     ta.reason,
          'at',         ta.created_at,
          'by',         coalesce(pr.full_name, pr.email, 'admin')
        ) order by ta.created_at desc
      ) as items
    from time_adjustments ta
    left join profiles pr on pr.id = ta.adjusted_by
    where ta.task_id = o.id
  ) adj on true
  order by
    case when p_order = 'antigas' then o.due_at end asc  nulls last,
    case when p_order = 'proximo'
         then abs(extract(epoch from (o.due_at - now()))) end asc nulls last,
    case when p_order not in ('antigas', 'proximo') then o.due_at end desc nulls last,
    o.id desc;
end;
$$;

comment on function public.collaborator_tasks_page(uuid, date, date, text, uuid, text, text, text, int, int) is
  'Lista paginada no banco das tarefas de um colaborador num período: prazo no período OU trabalhada no período (time_entry started_at no período, BRT) OU atrasada em aberto. only_by_work = entrou só pelo trabalho. Busca sem acento, filtros, ordenação e ajustes de tempo da página. DEFINER + gate is_admin().';

revoke execute on function public.collaborator_tasks_page(uuid, date, date, text, uuid, text, text, text, int, int) from public, anon;
grant  execute on function public.collaborator_tasks_page(uuid, date, date, text, uuid, text, text, text, int, int) to authenticated;

-- Facets: mesmo critério ampliado (empresas/tipos das tarefas trabalhadas também).
create or replace function public.collaborator_task_facets(
  p_collaborator uuid,
  p_start        date,
  p_end          date
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
  v_from timestamptz := case when p_start is null then null
                             else (p_start::timestamp at time zone 'America/Sao_Paulo') end;
  v_to   timestamptz := case when p_end is null then null
                             else ((p_end + 1)::timestamp at time zone 'America/Sao_Paulo') end;
begin
  if not (select is_admin()) then
    raise exception 'collaborator_task_facets: acesso restrito a administradores.'
      using errcode = '42501';
  end if;

  with rows as (
    select
      ti.company_id,
      c.name as company_name,
      case
        when tt.category is not null then 'cat:' || tt.category::text
        when tt.template_type = 'listagem' then 'cat:listagem'
        else 'title:' || coalesce(nullif(btrim(tt.title), ''), ti.title)
      end as type_key,
      case
        when tt.category is not null then tt.category::text
        when tt.template_type = 'listagem' then 'Listagem'
        else coalesce(nullif(btrim(tt.title), ''), ti.title)
      end as type_label
    from task_instances ti
    left join companies      c  on c.id  = ti.company_id
    left join task_templates tt on tt.id = ti.template_id
    where ti.collaborator_id = p_collaborator
      and (
        task_in_period(ti.due_at, ti.status, p_start, p_end)
        or exists (
          select 1 from time_entries te
          where te.task_id = ti.id
            and (v_from is null or te.started_at >= v_from)
            and (v_to   is null or te.started_at <  v_to)
        )
      )
  )
  select
    coalesce((
      select jsonb_agg(jsonb_build_object('id', t.company_id, 'name', t.company_name)
                       order by t.company_name)
      from (select distinct company_id, company_name from rows) t
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('key', t.type_key, 'label', t.type_label)
                       order by (t.type_key like 'title:%'), t.type_label)
      from (select distinct type_key, type_label from rows) t
    ), '[]'::jsonb)
  into v_companies, v_types;

  return jsonb_build_object('companies', v_companies, 'types', v_types);
end;
$$;

revoke execute on function public.collaborator_task_facets(uuid, date, date) from public, anon;
grant  execute on function public.collaborator_task_facets(uuid, date, date) to authenticated;

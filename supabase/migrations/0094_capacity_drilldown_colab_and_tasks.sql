-- =====================================================================
-- Capacidade — drill-down para as colunas que ainda não abriam.
--
-- (1) COLUNA "Ativos" (colaborador): novo escopo de EMPRESA 'colab_ativos' no
--     team_capacity_drilldown = a carteira ATIVA do colaborador
--     (company_collaborators, mesma exclusão de grupos). Contagem == coluna.
--     De passagem, o drilldown vira SECURITY DEFINER (era o único que ainda era
--     INVOKER; mesmo motivo da 0093: gate is_admin() por dentro, RLS interna só
--     encarecia).
--
-- (2) COLUNAS DE ATIVIDADE (Horas, Pontuais ✓, Atrasadas): contam TAREFA/TEMPO,
--     não empresa. Abrir a lista de empresas faria o total do painel divergir da
--     célula. Então ganham um drilldown PRÓPRIO de TAREFAS —
--     team_capacity_task_drilldown — cujas linhas somam/contam EXATAMENTE o que a
--     célula mostra (mesmos filtros de team_capacity):
--       · pontuais  = unica finalizada no período (por finished_at)   → nº linhas
--       · atrasadas = a_fazer/iniciada vencida, task_date no período   → nº linhas
--       · horas     = tempo por tarefa no período (por started_at)     → Σ segundos
--     LEFT JOIN companies: tarefa sem empresa NÃO é descartada (senão o total
--     divergiria da célula, que conta por colaborador sem olhar a empresa).
--
-- Ambas admin-only (is_admin() na 1ª linha), SECURITY DEFINER, só leitura.
-- =====================================================================

-- ---------------------------------------------------------------------
-- (1) DRILL-DOWN DE EMPRESAS — + 'colab_ativos', agora SECURITY DEFINER.
-- ---------------------------------------------------------------------
create or replace function team_capacity_drilldown(
  p_person uuid,
  p_scope  text,
  p_start  date default null,
  p_end    date default null
)
returns table (
  company_id   uuid,
  company_name text,
  group_name   text,
  labels       jsonb,
  shared_with  jsonb,
  days_since   integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_excluded text[] := capacity_excluded_groups();
  v_start_ts timestamptz := case when p_start is null then null
                                 else p_start::timestamp at time zone 'America/Sao_Paulo' end;
  v_end_ts   timestamptz := case when p_end is null then null
                                 else p_end::timestamp at time zone 'America/Sao_Paulo' end;
begin
  if not is_admin() then
    raise exception 'team_capacity_drilldown: acesso restrito a administradores'
      using errcode = '42501';
  end if;

  return query
  with
  active_carteira as (
    select cc.company_id
      from company_consultants cc
      join companies c on c.id = cc.company_id
      left join company_groups g on g.id = c.group_id
     where cc.consultant_id = p_person
       and (c.group_id is null or g.name is null or not (g.name = any(v_excluded)))
  ),
  cnt as (
    select company_id, count(*) as n from company_consultants group by company_id
  ),
  fu as (
    select company_id, days_since from client_followup(30, true)
  ),
  carteira_scoped as (
    select ac.company_id,
           coalesce(cnt.n, 1) as ncons,
           fu.days_since as dsince
      from active_carteira ac
      left join cnt on cnt.company_id = ac.company_id
      left join fu on fu.company_id = ac.company_id
  ),
  scoped as (
    select cs.company_id, cs.dsince
      from carteira_scoped cs
     where p_scope in ('ativos','exclusivos','compartilhados','alerta','parados','sem_registro')
       and case p_scope
             when 'exclusivos'     then cs.ncons = 1
             when 'compartilhados' then cs.ncons > 1
             when 'alerta'         then exists (
               select 1 from company_labels cl
                 join labels l on l.id = cl.label_id
                where cl.company_id = cs.company_id
                  and lower(l.name) = 'alerta')
             when 'parados'        then (cs.dsince is not null and cs.dsince > 15)
             when 'sem_registro'   then cs.dsince is null
             else true
           end
    union all
    -- 'empresas': união de tempo + conclusão (mesmo critério de act_companies).
    select e.company_id, null::integer
      from (
        select distinct t.company_id
          from time_entries te
          join task_instances t on t.id = te.task_id
         where p_scope = 'empresas'
           and te.collaborator_id = p_person
           and (v_start_ts is null or te.started_at >= v_start_ts)
           and (v_end_ts   is null or te.started_at <  v_end_ts)
        union
        select distinct ti.company_id
          from task_instances ti
          join task_templates tt on tt.id = ti.template_id
         where p_scope = 'empresas'
           and ti.collaborator_id = p_person
           and ti.status = 'finalizada'
           and tt.kind = 'unica'
           and ti.finished_at is not null
           and (v_start_ts is null or ti.finished_at >= v_start_ts)
           and (v_end_ts   is null or ti.finished_at <  v_end_ts)
      ) e
     where e.company_id is not null
    union all
    -- 'fora_da_carteira': tarefa em aberto onde NÃO é responsável (foto do agora).
    select distinct ti.company_id, null::integer
      from task_instances ti
     where p_scope = 'fora_da_carteira'
       and ti.collaborator_id = p_person
       and ti.company_id is not null
       and ti.status in ('a_fazer', 'iniciada')
       and not exists (
         select 1 from company_collaborators cc
          where cc.company_id = ti.company_id
            and cc.collaborator_id = p_person
       )
    union all
    -- 'colab_ativos': carteira ATIVA do COLABORADOR (company_collaborators),
    -- mesma exclusão de grupos. Foto do agora — contagem == coluna "Ativos".
    select ccx.company_id, null::integer
      from company_collaborators ccx
      join companies c on c.id = ccx.company_id
      left join company_groups g on g.id = c.group_id
     where p_scope = 'colab_ativos'
       and ccx.collaborator_id = p_person
       and (c.group_id is null or g.name is null or not (g.name = any(v_excluded)))
  )
  select
    s.company_id,
    c.name,
    coalesce(g.name, 'Sem grupo'),
    coalesce(lab.list, '[]'::jsonb),
    coalesce(sh.list, '[]'::jsonb),
    s.dsince
  from scoped s
  join companies c on c.id = s.company_id
  left join company_groups g on g.id = c.group_id
  left join lateral (
    select jsonb_agg(
             jsonb_build_object('name', l.name, 'bg_color', l.bg_color,
                                'text_color', l.text_color, 'highlight', l.highlight)
             order by l.highlight desc, l.name
           ) as list
      from company_labels cl
      join labels l on l.id = cl.label_id
     where cl.company_id = s.company_id
  ) lab on true
  left join lateral (
    select jsonb_agg(
             jsonb_build_object('id', d.id, 'name', d.name, 'avatar_path', d.avatar_path)
             order by d.name
           ) as list
      from company_consultants cc2
      cross join lateral display_profiles(array[cc2.consultant_id]::uuid[]) d
     where p_scope = 'compartilhados'
       and cc2.company_id = s.company_id
       and cc2.consultant_id <> p_person
  ) sh on true
  order by c.name;
end;
$$;

revoke execute on function team_capacity_drilldown(uuid, text, date, date) from public, anon;
grant  execute on function team_capacity_drilldown(uuid, text, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- (2) DRILL-DOWN DE TAREFAS — Horas / Pontuais / Atrasadas.
--   Cada linha é uma TAREFA; o conjunto casa exatamente com a célula:
--     'pontuais'  → 1 linha por unica finalizada no período  (nº linhas)
--     'atrasadas' → 1 linha por aberta vencida no período     (nº linhas)
--     'horas'     → 1 linha por tarefa com tempo no período   (Σ seconds)
--   Mesmos filtros de team_capacity (act_done / act_overdue / act_time).
-- ---------------------------------------------------------------------
create or replace function team_capacity_task_drilldown(
  p_person uuid,
  p_scope  text,
  p_start  date default null,
  p_end    date default null
)
returns table (
  task_id      uuid,
  title        text,
  company_name text,
  status       task_status,
  ref_at       timestamptz,
  seconds      bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start_ts timestamptz := case when p_start is null then null
                                 else p_start::timestamp at time zone 'America/Sao_Paulo' end;
  v_end_ts   timestamptz := case when p_end is null then null
                                 else p_end::timestamp at time zone 'America/Sao_Paulo' end;
begin
  if not is_admin() then
    raise exception 'team_capacity_task_drilldown: acesso restrito a administradores'
      using errcode = '42501';
  end if;

  return query
  -- PONTUAIS: unica finalizada no período (por finished_at) — como act_done.
  select ti.id,
         coalesce(ti.title, tt.title, '(sem título)'),
         coalesce(c.name, '(sem empresa)'),
         ti.status,
         ti.finished_at,
         null::bigint
    from task_instances ti
    join task_templates tt on tt.id = ti.template_id
    left join companies c on c.id = ti.company_id
   where p_scope = 'pontuais'
     and ti.collaborator_id = p_person
     and ti.status = 'finalizada'
     and tt.kind = 'unica'
     and ti.finished_at is not null
     and (v_start_ts is null or ti.finished_at >= v_start_ts)
     and (v_end_ts   is null or ti.finished_at <  v_end_ts)

  union all
  -- ATRASADAS: aberta e vencida, task_date no período — como act_overdue
  -- (não filtra por kind; template pode faltar → left join só p/ título).
  select ti.id,
         coalesce(ti.title, tt.title, '(sem título)'),
         coalesce(c.name, '(sem empresa)'),
         ti.status,
         ti.due_at,
         null::bigint
    from task_instances ti
    left join task_templates tt on tt.id = ti.template_id
    left join companies c on c.id = ti.company_id
   where p_scope = 'atrasadas'
     and ti.collaborator_id = p_person
     and ti.status in ('a_fazer', 'iniciada')
     and ti.due_at < now()
     and (p_start is null or ti.task_date >= p_start)
     and (p_end   is null or ti.task_date <  p_end)

  union all
  -- HORAS: tempo por tarefa no período (por started_at) — como act_time.
  -- Σ seconds das linhas == a célula de horas (mesma expressão entry_seconds).
  select ti.id,
         coalesce(ti.title, tt.title, '(sem título)'),
         coalesce(c.name, '(sem empresa)'),
         ti.status,
         max(te.started_at),
         sum(entry_seconds(te.seconds, te.started_at, te.ended_at))::bigint
    from time_entries te
    join task_instances ti on ti.id = te.task_id
    left join task_templates tt on tt.id = ti.template_id
    left join companies c on c.id = ti.company_id
   where p_scope = 'horas'
     and te.collaborator_id = p_person
     and (v_start_ts is null or te.started_at >= v_start_ts)
     and (v_end_ts   is null or te.started_at <  v_end_ts)
   group by ti.id, ti.title, tt.title, c.name, ti.status

  order by 6 desc nulls last, 5 desc nulls last, 2;
end;
$$;

revoke execute on function team_capacity_task_drilldown(uuid, text, date, date) from public, anon;
grant  execute on function team_capacity_task_drilldown(uuid, text, date, date) to authenticated;

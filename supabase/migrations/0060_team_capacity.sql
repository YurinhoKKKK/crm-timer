-- =====================================================================
-- VISÃO DE CAPACIDADE DA EQUIPE — "como distribuir novos clientes" e
-- "quem está sobrecarregado". É ferramenta de DISTRIBUIÇÃO DE CARGA, não
-- ranking de produtividade nem avaliação de desempenho.
--
-- ADMIN-ONLY, reforçado NO BANCO: a função levanta exceção se o chamador não
-- for admin (não basta esconder a rota na interface). SECURITY INVOKER + guarda
-- is_admin() — com admin, todas as tabelas ficam visíveis; qualquer outro cargo
-- nem chega a agregar.
--
-- DECISÕES DE MODELAGEM (ver docs/ESPECIFICACAO e o prompt da fatia):
--  1. QUEM APARECE: união de quem tem CARTEIRA (company_consultants) com quem
--     tem EXECUÇÃO (task_instances.collaborator_id) — independente do cargo
--     (vários admins têm carteira grande e precisam aparecer).
--  2. CLIENTE ATIVO É POR EXCLUSÃO: ativo = empresa que NÃO está nos grupos
--     Cancelados / Pausados / Projetos Finalizados. SEM grupo conta como ativa.
--     A lista de exclusão fica em UM ponto só (v_excluded, abaixo) — ajustável
--     em uma linha. NÃO usar "está no grupo Ativos" (deixaria dezenas de fora).
--  3. CARTEIRA NÃO SOMA: uma empresa pode ter 2–3 consultores. Aqui cada linha
--     conta a carteira DA PESSOA; nenhum total de agência sai de somar carteiras
--     (se um dia precisar, é count(distinct company)).
--  4. HORA É A MEDIDA DE CARGA; contagem de tarefa é secundária. Diária e pontual
--     são SEMPRE separadas (86% do volume de tarefas é 23% do tempo). Pontual =
--     kind='unica' (inclui listagens); diária = kind='diaria'.
--
-- FILTRO DE PERÍODO afeta SÓ a atividade (time_entries por started_at BRT — dia
-- real do trabalho, nunca task_date; regra do passo 32.3). A CARTEIRA é foto do
-- AGORA e ignora o período (recebe p_start/p_end e não os usa nos blocos de
-- carteira). p_start/p_end são datas BRT; p_end é EXCLUSIVO; ambos null = "Tudo".
--
-- CLIENTES VERMELHOS: reaproveita a MESMA lógica da tela de Acompanhamento —
-- chama client_followup() e usa days_since (nunca contatado OU > 15 dias). Não
-- reimplementa o semáforo.
--
-- CUSTO: uma linha por pessoa (≤ dezenas). Sem risco da truncagem silenciosa do
-- PostgREST (agrega tudo no banco; nada de varrer instâncias no cliente).
-- =====================================================================
create or replace function team_capacity(
  p_start date default null,
  p_end   date default null   -- exclusivo; null = sem limite superior
)
returns table (
  person_id            uuid,
  person_name          text,
  avatar_path          text,
  -- CARTEIRA (foto do agora — não muda com o período)
  carteira_active      integer,       -- clientes ATIVOS na carteira
  carteira_by_group    jsonb,         -- [{name, count}] toda a carteira por grupo
  carteira_exclusive   integer,       -- ativos exclusivos (só esta pessoa)
  carteira_shared      integer,       -- ativos com outro consultor junto
  carteira_alerta      integer,       -- ativos com a etiqueta ALERTA
  carteira_red         integer,       -- ativos vermelhos no semáforo (> 15 dias)
  received_30          integer,       -- clientes recebidos nos últimos 30 dias
  received_90          integer,       -- ... e nos últimos 90 dias
  -- ATIVIDADE (muda com o período)
  act_seconds          bigint,        -- horas trabalhadas (todas)
  act_seconds_pontual  bigint,        -- ... só pontuais
  act_seconds_diaria   bigint,        -- ... só diárias
  act_pontual_done     integer,       -- tarefas pontuais concluídas
  act_overdue          integer,       -- tarefas atrasadas
  act_companies        integer,       -- empresas distintas atendidas
  act_has_activity     boolean        -- houve QUALQUER registro no período?
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  -- >>> LISTA DE EXCLUSÃO — o único ponto a ajustar para redefinir "ativo". <<<
  v_excluded text[] := array['Cancelados', 'Pausados', 'Projetos Finalizados'];
  v_start_ts timestamptz := case when p_start is null then null
                                 else p_start::timestamp at time zone 'America/Sao_Paulo' end;
  v_end_ts   timestamptz := case when p_end is null then null
                                 else p_end::timestamp at time zone 'America/Sao_Paulo' end;
begin
  -- Barreira no banco: sem admin, ninguém agrega nada.
  if not is_admin() then
    raise exception 'team_capacity: acesso restrito a administradores'
      using errcode = '42501';
  end if;

  return query
  with
  -- Pessoas que aparecem: carteira OU execução (qualquer cargo).
  people as (
    select consultant_id as id from company_consultants
    union
    select collaborator_id from task_instances where collaborator_id is not null
  ),
  -- Toda a carteira (ativa e inativa) com o grupo resolvido.
  carteira as (
    select cc.consultant_id as person,
           cc.company_id,
           cc.assigned_at,
           coalesce(g.name, 'Sem grupo') as gname,
           coalesce(g.position, 2147483647) as gpos,
           (c.group_id is null or g.name is null or not (g.name = any(v_excluded))) as is_active
      from company_consultants cc
      join companies c on c.id = cc.company_id
      left join company_groups g on g.id = c.group_id
  ),
  active_carteira as (
    select person, company_id, assigned_at from carteira where is_active
  ),
  -- Quantos consultores cada empresa tem (para exclusivo × compartilhado).
  company_consultant_count as (
    select company_id, count(*) as n from company_consultants group by company_id
  ),
  -- Semáforo de acompanhamento — MESMA RPC da tela de Acompanhamento.
  followup as (
    select company_id, days_since from client_followup(30, true)
  ),
  -- Quebra por grupo de TODA a carteira (grupo novo aparece sozinho).
  by_group as (
    select person,
           jsonb_agg(
             jsonb_build_object('name', gname, 'count', n)
             order by gpos, gname
           ) as list
      from (
        select person, gname, gpos, count(*) as n
          from carteira
         group by person, gname, gpos
      ) q
     group by person
  ),
  -- Blocos de carteira ATIVA por pessoa.
  cart as (
    select ac.person,
           count(*) as active,
           count(*) filter (where ccc.n = 1) as exclusive,
           count(*) filter (where ccc.n > 1) as shared,
           count(*) filter (where al.company_id is not null) as alerta,
           count(*) filter (where fu.days_since is null or fu.days_since > 15) as red,
           count(*) filter (where ac.assigned_at >= now() - interval '30 days') as r30,
           count(*) filter (where ac.assigned_at >= now() - interval '90 days') as r90
      from active_carteira ac
      join company_consultant_count ccc on ccc.company_id = ac.company_id
      left join followup fu on fu.company_id = ac.company_id
      left join lateral (
        select 1 as company_id
          from company_labels cl
          join labels l on l.id = cl.label_id
         where cl.company_id = ac.company_id
           and lower(l.name) = 'alerta'
         limit 1
      ) al on true
     group by ac.person
  ),
  -- ATIVIDADE — tempo por período (started_at BRT, passo 32.3), pontual × diária.
  act_time as (
    select te.collaborator_id as person,
           sum(entry_seconds(te.seconds, te.started_at, te.ended_at))::bigint as secs,
           (sum(entry_seconds(te.seconds, te.started_at, te.ended_at))
             filter (where tt.kind = 'diaria'))::bigint as secs_diaria,
           (sum(entry_seconds(te.seconds, te.started_at, te.ended_at))
             filter (where tt.kind is distinct from 'diaria'))::bigint as secs_pontual,
           count(distinct t.company_id) as companies
      from time_entries te
      join task_instances t on t.id = te.task_id
      left join task_templates tt on tt.id = t.template_id
     where (v_start_ts is null or te.started_at >= v_start_ts)
       and (v_end_ts   is null or te.started_at <  v_end_ts)
     group by te.collaborator_id
  ),
  -- Tarefas pontuais concluídas no período (pelo dia da conclusão).
  act_done as (
    select ti.collaborator_id as person, count(*) as done
      from task_instances ti
      join task_templates tt on tt.id = ti.template_id
     where ti.status = 'finalizada'
       and tt.kind = 'unica'
       and ti.finished_at is not null
       and (v_start_ts is null or ti.finished_at >= v_start_ts)
       and (v_end_ts   is null or ti.finished_at <  v_end_ts)
     group by ti.collaborator_id
  ),
  -- Atrasadas: em aberto e vencidas, dentro da janela do período (por task_date,
  -- no mesmo espírito de company_overview).
  act_overdue as (
    select ti.collaborator_id as person, count(*) as n
      from task_instances ti
     where ti.status in ('a_fazer', 'iniciada')
       and ti.due_at < now()
       and (p_start is null or ti.task_date >= p_start)
       and (p_end   is null or ti.task_date <  p_end)
     group by ti.collaborator_id
  )
  select
    pe.id,
    dp.name,
    dp.avatar_path,
    coalesce(cart.active, 0)::integer,
    coalesce(bg.list, '[]'::jsonb),
    coalesce(cart.exclusive, 0)::integer,
    coalesce(cart.shared, 0)::integer,
    coalesce(cart.alerta, 0)::integer,
    coalesce(cart.red, 0)::integer,
    coalesce(cart.r30, 0)::integer,
    coalesce(cart.r90, 0)::integer,
    coalesce(at.secs, 0)::bigint,
    coalesce(at.secs_pontual, 0)::bigint,
    coalesce(at.secs_diaria, 0)::bigint,
    coalesce(ad.done, 0)::integer,
    coalesce(ao.n, 0)::integer,
    coalesce(at.companies, 0)::integer,
    (at.person is not null or ad.person is not null) as act_has_activity
  from people pe
  left join lateral (
    select d.name, d.avatar_path from display_profiles(array[pe.id]::uuid[]) d
  ) dp on true
  left join cart      on cart.person = pe.id
  left join by_group  bg on bg.person = pe.id
  left join act_time  at on at.person = pe.id
  left join act_done  ad on ad.person = pe.id
  left join act_overdue ao on ao.person = pe.id;
end;
$$;

revoke execute on function team_capacity(date, date) from public, anon;
grant  execute on function team_capacity(date, date) to authenticated;

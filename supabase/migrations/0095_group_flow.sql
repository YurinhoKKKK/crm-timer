-- =====================================================================
-- FLUXO AUTOMÁTICO ENTRE GRUPOS
-- =====================================================================
-- Grupo deixa de ser só um rótulo visual e passa a DIRIGIR a operação. Como o
-- grupo é DADO (company_groups, criado pela admin), a semântica não pode ficar
-- amarrada ao nome no código: ganha uma coluna `kind` (active/paused/onboarding/
-- neutral), com backfill pelos nomes atuais e EDITÁVEL. Todo o fluxo lê `kind`,
-- nunca o nome.
--
-- REGRA CENTRAL — active vs paused_by_group:
--   · active           = decisão HUMANA (ligar/desligar a tarefa à mão).
--   · paused_by_group  = decisão do GRUPO (parar/retomar a geração em bloco).
-- A geração diária exige AS DUAS: active=true AND paused_by_group=false. Assim,
-- ao voltar de um grupo PARADO para um ATIVO, retomam EXATAMENTE as tarefas que
-- estavam ativas antes — e as desativadas à mão continuam desativadas. NUNCA
-- mexemos em active nas transições de grupo. NUNCA apagamos instância/tempo.
--
-- O "nó" do bloqueio de entrada em ATIVO (3.2): "tarefa ativa" é active=true
-- INDEPENDENTE de paused_by_group. Se exigisse paused_by_group=false, uma empresa
-- que saiu de Ativos (o que pausa tudo) nunca conseguiria voltar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Classificação do grupo (kind) — a semântica que dirige o fluxo.
-- ---------------------------------------------------------------------
alter table company_groups
  add column kind text not null default 'neutral'
    check (kind in ('active', 'paused', 'onboarding', 'neutral'));

comment on column company_groups.kind is
  'Semântica do grupo para o fluxo automático: active (Ativos/Ema) retoma a '
  'geração de tarefas; paused (Aguardando Renovação, Pausados, Sem Resposta|BO, '
  'Projetos Finalizados, Cancelados) pausa a geração e some dos painéis; '
  'onboarding (On Boarding) notifica os admins; neutral não dispara nada. É DADO '
  'editável (não enum fixo no código) — todo o fluxo lê kind, nunca o nome.';

-- Backfill pelos nomes atuais (a admin pode reclassificar depois pela coluna).
update company_groups set kind = 'active'
  where lower(name) in ('ativos', 'ema');
update company_groups set kind = 'onboarding'
  where lower(name) = 'on boarding';
update company_groups set kind = 'paused'
  where lower(name) in (
    'aguardando renovação', 'aguardando renovacao', 'pausados',
    'sem resposta | bo | aguardando comercial', 'projetos finalizados',
    'cancelados'
  );

-- ---------------------------------------------------------------------
-- 2. paused_by_group — a decisão do GRUPO (distinta de active).
-- ---------------------------------------------------------------------
alter table task_templates
  add column paused_by_group boolean not null default false;

comment on column task_templates.paused_by_group is
  'Pausa DITADA PELO GRUPO (grupo PARADO). A geração diária exige active=true AND '
  'paused_by_group=false. Nunca alterar active nas transições de grupo: active é a '
  'decisão humana, paused_by_group é a do grupo.';

-- Backfill: empresas HOJE em grupo PARADO já nascem com a geração pausada — alinha
-- a realidade ao modelo (projeto finalizado/cancelado não deve gerar diária).
-- NÃO apaga instância nem mexe em active.
update task_templates t set paused_by_group = true
  from companies c join company_groups g on g.id = c.group_id
 where t.company_id = c.id and g.kind = 'paused';

-- ---------------------------------------------------------------------
-- 3. GERAÇÃO — passa a exigir paused_by_group = false nos TRÊS caminhos.
-- ---------------------------------------------------------------------

-- 3a. Cron diário (00:05 BRT).
create or replace function public.generate_daily_tasks(target_date date default current_date)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  tmpl record;
  created_count integer := 0;
  dow smallint := extract(dow from target_date);
  due timestamptz;
begin
  for tmpl in
    select * from task_templates
    where active = true
      and paused_by_group = false          -- grupo PARADO não gera
      and kind = 'diaria'
      and start_date <= target_date
      and (end_date is null or end_date >= target_date)
      and dow = any(weekdays)
  loop
    due := (
      (target_date::text || ' ' || coalesce(tmpl.due_time, '23:59')::text)::timestamp
        at time zone 'America/Sao_Paulo'
    );

    insert into task_instances (
      template_id, company_id, collaborator_id, title, description,
      instructions, due_at, task_date
    )
    values (
      tmpl.id, tmpl.company_id, tmpl.collaborator_id, tmpl.title,
      tmpl.description, tmpl.instructions, due, target_date
    )
    on conflict (template_id, task_date) do nothing;

    if found then
      created_count := created_count + 1;
    end if;
  end loop;

  return created_count;
end;
$function$;

-- 3b. Geração da ocorrência de HOJE na ATRIBUIÇÃO/criação (trigger AFTER INSERT).
create or replace function public.generate_template_today(p_template uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  tmpl        record;
  brt_now     timestamp := timezone('America/Sao_Paulo', now());
  today       date       := (timezone('America/Sao_Paulo', now()))::date;
  dow         smallint   := extract(dow from (timezone('America/Sao_Paulo', now()))::date);
  due         timestamptz;
  inserted    integer := 0;
begin
  select * into tmpl
    from task_templates
   where id = p_template
     and active = true
     and paused_by_group = false           -- grupo PARADO não gera
     and kind = 'diaria';
  if not found then
    return false;
  end if;

  if not (dow = any(tmpl.weekdays)) then
    return false;
  end if;

  if tmpl.start_date > today
     or (tmpl.end_date is not null and tmpl.end_date < today) then
    return false;
  end if;

  if brt_now::time > coalesce(tmpl.due_time, time '23:59:59') then
    return false;
  end if;

  due := (
    (today::text || ' ' || coalesce(tmpl.due_time, '23:59')::text)::timestamp
      at time zone 'America/Sao_Paulo'
  );

  insert into task_instances (
    template_id, company_id, collaborator_id, title, description,
    instructions, due_at, task_date
  )
  values (
    tmpl.id, tmpl.company_id, tmpl.collaborator_id, tmpl.title,
    tmpl.description, tmpl.instructions, due, today
  )
  on conflict (template_id, task_date) do nothing;

  get diagnostics inserted = row_count;
  return inserted > 0;
end;
$function$;

-- 3c. Geração da ocorrência de HOJE na EDIÇÃO (ignora due_time). Novo status
--     'pausada_grupo' quando o grupo está PARADO.
create or replace function public.generate_template_today_edit(p_template uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  tmpl     record;
  today    date     := (timezone('America/Sao_Paulo', now()))::date;
  dow      smallint := extract(dow from (timezone('America/Sao_Paulo', now()))::date);
  due      timestamptz;
  inserted integer := 0;
begin
  select * into tmpl
    from task_templates
   where id = p_template
     and kind = 'diaria';
  if not found then
    return 'nao_aplica';
  end if;

  if not tmpl.active then
    return 'inativa';
  end if;

  if tmpl.paused_by_group then
    return 'pausada_grupo';
  end if;

  if not (dow = any(tmpl.weekdays)) then
    return 'nao_e_dia';
  end if;

  if tmpl.start_date > today
     or (tmpl.end_date is not null and tmpl.end_date < today) then
    return 'fora_do_periodo';
  end if;

  due := (today::text || ' ' || coalesce(tmpl.due_time, '23:59')::text)::timestamptz;

  insert into task_instances (
    template_id, company_id, collaborator_id, title, description,
    instructions, due_at, task_date
  )
  values (
    tmpl.id, tmpl.company_id, tmpl.collaborator_id, tmpl.title,
    tmpl.description, tmpl.instructions, due, today
  )
  on conflict (template_id, task_date) do nothing;

  get diagnostics inserted = row_count;
  return case when inserted > 0 then 'gerada' else 'ja_existia' end;
end;
$function$;

-- 3d. Molde criado numa empresa JÁ em grupo PARADO nasce pausado (fecha a brecha
--     de adicionar tarefa a uma empresa parada e ela voltar a gerar). BEFORE
--     INSERT: roda antes do trg_diaria_template_today (AFTER), então o WHEN
--     abaixo já enxerga paused_by_group corrigido.
create or replace function set_template_pause_from_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.paused_by_group
     and exists (
       select 1 from companies c
       join company_groups g on g.id = c.group_id
       where c.id = new.company_id and g.kind = 'paused'
     ) then
    new.paused_by_group := true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_template_pause_from_group on task_templates;
create trigger trg_template_pause_from_group
  before insert on task_templates
  for each row execute function set_template_pause_from_group();

-- A geração de HOJE no INSERT só ocorre se a tarefa não estiver pausada pelo grupo.
drop trigger if exists trg_diaria_template_today on task_templates;
create trigger trg_diaria_template_today
  after insert on task_templates
  for each row
  when (new.kind = 'diaria' and new.active = true and new.paused_by_group = false)
  execute function handle_diaria_template_today();

-- ---------------------------------------------------------------------
-- 4. Notificação para todos os admins sobre uma empresa. Ator = auth.uid()
--    (quem moveu). push_notification já NÃO notifica o próprio autor; em ação do
--    sistema (cron/CRM) auth.uid() é null e TODOS os admins recebem.
-- ---------------------------------------------------------------------
create or replace function notify_admins_company(
  p_company uuid, p_type text, p_title text
)
returns void
language plpgsql security definer set search_path = public
as $$
declare r record;
begin
  for r in select id from profiles where role = 'admin' loop
    perform push_notification(
      r.id, p_type, p_title, null, p_company, 'company', p_company, auth.uid()
    );
  end loop;
end;
$$;

-- Amplia o CHECK de tipos de notificação (empresa em On Boarding / em Renovação).
alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check check (type in (
  'mencionado', 'resposta_recebida', 'tarefa_atribuida',
  'tarefa_recorrente_atribuida', 'listagem_ajuste_solicitado',
  'reuniao_convite', 'reuniao_cancelada',
  'empresa_onboarding', 'empresa_renovacao'
));

-- ---------------------------------------------------------------------
-- 5. GATILHO do fluxo por grupo (companies, INSERT e UPDATE OF group_id).
--    Pausa/retoma a geração e notifica On Boarding. O evento 'grupo_alterado'
--    (a mudança em si) continua no gatilho da 0072; aqui cuidamos do efeito nas
--    tarefas e do aviso. SEM mexer em active. Idempotente por transição.
-- ---------------------------------------------------------------------
create or replace function companies_group_flow_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_kind text;
  v_old_kind text := 'neutral';
begin
  if tg_op = 'UPDATE' then
    if new.group_id is not distinct from old.group_id then
      return new;  -- outro campo mudou; grupo não
    end if;
    select coalesce(kind, 'neutral') into v_old_kind
      from company_groups where id = old.group_id;
    v_old_kind := coalesce(v_old_kind, 'neutral');
  end if;

  select coalesce(kind, 'neutral') into v_new_kind
    from company_groups where id = new.group_id;
  v_new_kind := coalesce(v_new_kind, 'neutral');

  -- Entrou em PARADO: pausa a geração (nunca mexe em active).
  if v_new_kind = 'paused' and (tg_op = 'INSERT' or v_old_kind <> 'paused') then
    update task_templates set paused_by_group = true
      where company_id = new.id and paused_by_group = false;
    if found then
      insert into company_events (company_id, event_type, summary, details, actor_id)
      values (new.id, 'tarefas_pausadas_grupo',
              'Geração de tarefas pausada (grupo parado)',
              jsonb_build_object('auto', auth.uid() is null), auth.uid());
    end if;
  end if;

  -- Entrou em ATIVO: retoma (só desliga a pausa do grupo; active fica como estava).
  if v_new_kind = 'active' and (tg_op = 'INSERT' or v_old_kind <> 'active') then
    update task_templates set paused_by_group = false
      where company_id = new.id and paused_by_group = true;
    if found then
      insert into company_events (company_id, event_type, summary, details, actor_id)
      values (new.id, 'tarefas_retomadas_grupo',
              'Geração de tarefas retomada (grupo ativo)',
              jsonb_build_object('auto', auth.uid() is null), auth.uid());
    end if;
  end if;

  -- Entrou em ON BOARDING: notifica todos os admins (vale para mudança manual e
  -- para a criação pela integração do CRM comercial, que insere já no grupo).
  if v_new_kind = 'onboarding' and (tg_op = 'INSERT' or v_old_kind <> 'onboarding') then
    perform notify_admins_company(new.id, 'empresa_onboarding',
                                  'Empresa entrou em On Boarding');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_companies_group_flow on companies;
create trigger trg_companies_group_flow
  after insert or update of group_id on companies
  for each row execute function companies_group_flow_trg();

-- Rótulos dos eventos novos para o filtro/badge do histórico.
create or replace function activity_type_label(p_type text)
returns text
language sql immutable
set search_path = public
as $$
  select case p_type
    when 'atividade'                      then 'Atividade'
    when 'tarefa_criada'                  then 'Tarefa criada'
    when 'tarefa_concluida'               then 'Tarefa concluída'
    when 'tarefa_excluida'                then 'Tarefa excluída'
    when 'tarefa_recorrente_criada'       then 'Tarefa recorrente criada'
    when 'tarefa_recorrente_editada'      then 'Tarefa recorrente editada'
    when 'tarefa_recorrente_desativada'   then 'Tarefa recorrente desativada'
    when 'tarefas_pausadas_grupo'         then 'Tarefas pausadas (grupo)'
    when 'tarefas_retomadas_grupo'        then 'Tarefas retomadas (grupo)'
    when 'consultor_adicionado'           then 'Consultor adicionado'
    when 'consultor_removido'             then 'Consultor removido'
    when 'grupo_alterado'                 then 'Grupo alterado'
    when 'etiqueta_alterada'              then 'Etiqueta alterada'
    when 'faturamento_lancado'            then 'Faturamento lançado'
    when 'faturamento_corrigido'          then 'Faturamento corrigido'
    when 'informacoes_alteradas'          then 'Informações alteradas'
    when 'acesso_cliente_criado'          then 'Acesso do cliente criado'
    when 'acesso_cliente_senha_redefinida' then 'Senha do cliente redefinida'
    when 'acesso_cliente_revogado'        then 'Acesso do cliente revogado'
    when 'listagem_validada'              then 'Listagem validada'
    when 'reuniao_criada'                 then 'Reunião criada'
    when 'reuniao_cancelada'              then 'Reunião cancelada'
    else p_type
  end;
$$;

-- ---------------------------------------------------------------------
-- 6. BLOQUEIO DE ENTRADA EM ATIVO (3.2) — validado no SERVIDOR, dentro do
--    set_companies_group (o único caminho de escrita de group_id pela UI). A
--    recusa é uma exceção com a lista EXATA do que falta, por empresa; a tela do
--    admin reverte o cartão e mostra a mensagem.
-- ---------------------------------------------------------------------

-- Requisitos de entrada em ATIVO. Devolve null se a empresa pode entrar, senão a
-- lista do que falta. "tarefa ativa" = active=true INDEPENDENTE de paused_by_group.
create or replace function active_group_requirements_missing(p_company uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  parts text[] := '{}';
begin
  if not exists (select 1 from company_consultants where company_id = p_company) then
    parts := array_append(parts, 'consultor responsável');
  end if;
  if not exists (select 1 from company_collaborators where company_id = p_company) then
    parts := array_append(parts, 'colaborador responsável');
  end if;
  if not exists (select 1 from task_templates where company_id = p_company and active = true) then
    parts := array_append(parts, 'tarefa ativa');
  end if;
  if array_length(parts, 1) is null then
    return null;
  end if;
  -- "falta X, Y e Z"
  if array_length(parts, 1) = 1 then
    return 'falta ' || parts[1];
  end if;
  return 'falta ' || array_to_string(parts[1:array_length(parts,1)-1], ', ')
         || ' e ' || parts[array_length(parts,1)];
end;
$$;

create or replace function set_companies_group(
  p_company_ids uuid[],
  p_group_id    uuid
)
returns integer
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_count   integer;
  v_kind    text;
  v_gname   text;
  v_missing text;
  v_msgs    text[] := '{}';
  r         record;
begin
  if p_group_id is not null then
    select kind, name into v_kind, v_gname from company_groups where id = p_group_id;
  end if;

  -- Entrada em grupo ATIVO exige consultor + colaborador + tarefa ativa em CADA
  -- empresa. Se qualquer uma falhar, nada é movido (a transação inteira falha).
  if v_kind = 'active' then
    for r in
      select id, name from companies where id = any (p_company_ids) order by name
    loop
      v_missing := active_group_requirements_missing(r.id);
      if v_missing is not null then
        v_msgs := array_append(v_msgs, r.name || ': ' || v_missing);
      end if;
    end loop;
    if array_length(v_msgs, 1) is not null then
      raise exception 'Para entrar em "%": %', v_gname, array_to_string(v_msgs, '; ')
        using errcode = 'P0001';
    end if;
  end if;

  update companies
     set group_id   = p_group_id,
         updated_at = now()
   where id = any (p_company_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. ROTINA DIÁRIA (3.3) — move para "Aguardando Renovação" as empresas de grupo
--    ATIVO cujo company_details.ends_on já venceu. Idempotente (depois de movida
--    ela sai do grupo ativo). Empresa sem ends_on nunca é movida. O UPDATE de
--    group_id dispara o evento 'grupo_alterado' (ator null = sistema) e a pausa
--    das tarefas; aqui só notificamos os admins.
-- ---------------------------------------------------------------------
create or replace function move_expired_active_to_renewal()
returns integer
language plpgsql
security definer
set search_path = public
as $$
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
$$;

select cron.unschedule('move-expired-to-renewal')
where exists (select 1 from cron.job where jobname = 'move-expired-to-renewal');

-- 03:15 UTC == 00:15 BRT (UTC-3 fixo), logo após a geração diária das 00:05.
select cron.schedule(
  'move-expired-to-renewal',
  '15 3 * * *',
  $$ select public.move_expired_active_to_renewal(); $$
);

-- ---------------------------------------------------------------------
-- 8. OCULTAR NOS PAINÉIS (3.5) — empresas de grupo PARADO somem do painel do
--    consultor/colaborador, MENOS enquanto o próprio usuário tiver tarefa EM
--    ABERTO ali. SECURITY DEFINER porque consultor/colaborador não leem
--    company_groups (admin-only); só expõe id + booleano, e a tela cruza com a
--    lista que a pessoa já alcança. A empresa continua alcançável por busca/lista.
-- ---------------------------------------------------------------------
create or replace function my_company_pause_state()
returns table (company_id uuid, has_open boolean)
language sql stable security definer set search_path = public
as $$
  select c.id,
         exists (
           select 1 from task_instances ti
           where ti.company_id = c.id
             and ti.collaborator_id = auth.uid()
             and ti.status in ('a_fazer', 'iniciada')
         )
  from companies c
  join company_groups g on g.id = c.group_id
  where g.kind = 'paused';
$$;

grant execute on function my_company_pause_state() to authenticated;
grant execute on function active_group_requirements_missing(uuid) to authenticated;

-- A rotina de renovação é SÓ do cron (owner/service_role). Nenhum usuário logado
-- deve poder disparar um movimento em massa de grupo.
revoke execute on function move_expired_active_to_renewal() from authenticated, anon, public;

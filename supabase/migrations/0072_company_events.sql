-- =====================================================================
-- FATIA 2 do histórico de atividades — EVENTOS NOVOS
-- =====================================================================
-- A Fatia 1 unificou a APRESENTAÇÃO (paginação/filtros/total no banco) com uma
-- única fonte (activity_log). Esta fatia ENRIQUECE a fonte: uma tabela de eventos
-- APPEND-ONLY (company_events) alimentada por GATILHOS — nunca pelo código da
-- aplicação, para pegar QUALQUER caminho de escrita (inclusive correção direta no
-- banco), do mesmo jeito que a auditoria de faturamento (0067). A RPC da Fatia 1
-- passa a UNIR company_events + activity_log + client_portal_audit numa linha do
-- tempo só, ordenada/filtrada/paginada no banco. NÃO migramos histórico antigo:
-- unimos na leitura (menos arriscado, sem duplicar).
--
-- VOLUME (decisão de produto): o pg_cron cria instâncias diárias para quase toda
-- empresa todo dia. Se cada uma virasse evento, o histórico afogaria. Por isso
-- NÃO há gatilho de criação em task_instances. A vida da tarefa é registrada no
-- MOLDE (task_templates): criar/editar/desativar/excluir. Assim uma tarefa
-- pontual (molde 'unica') vira UM "tarefa_criada"; uma recorrente (molde
-- 'diaria') vira "tarefa_recorrente_*", e as instâncias diárias do cron somem do
-- histórico. A CONCLUSÃO é o único evento no nível da instância (é ação humana,
-- não geração automática).
--
-- google_calendar_audit foi DELIBERADAMENTE deixada de fora da união: ela é
-- account-level (conectar/revogar a conta Google do usuário, sem company_id) e
-- não dá para atribuir a uma empresa. A atividade de calendário POR EMPRESA vem
-- de company_events (reuniao_criada/reuniao_cancelada), a partir de `meetings`.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tabela de eventos (append-only, imutável)
-- ---------------------------------------------------------------------
create table company_events (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  event_type  text not null,             -- ver activity_type_label() p/ o catálogo
  summary     text not null,             -- frase curta, pronta para exibir
  details     jsonb,                     -- antes/depois, só o necessário
  actor_id    uuid references profiles(id),  -- null = sistema (cron/migration/DB)
  created_at  timestamptz not null default now()
);

create index idx_company_events_company_created
  on company_events (company_id, created_at desc);
create index idx_company_events_company_type
  on company_events (company_id, event_type);

-- RLS: LEITURA para quem já ALCANÇA a empresa (admin todas, consultor a carteira,
-- colaborador as empresas em que tem tarefa) — o MESMO critério do faturamento
-- (0071). Por isso os eventos de faturamento aparecem para todos que alcançam a
-- empresa, sem filtro por cargo na RPC: a fronteira é esta política. NENHUMA
-- policy de insert/update/delete: só o gatilho escreve (SECURITY DEFINER). Se um
-- evento novo carregar dado mais restrito, a checagem entra AQUI, nunca só na UI.
alter table company_events enable row level security;

create policy ce_select on company_events for select
  using (
    is_admin()
    or company_id in (select my_consultant_companies())
    or company_id in (select my_collaborator_companies())
  );

-- ---------------------------------------------------------------------
-- 2. Catálogo de rótulos (no banco, para o filtro/badge não ter lista fixa no
--    código — a Fatia 1 tinha um mapa no front; agora o rótulo vem daqui).
-- ---------------------------------------------------------------------
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

-- Rótulo do canal de venda (para o resumo de faturamento).
create or replace function sales_channel_label(p_channel sales_channel)
returns text
language sql immutable
set search_path = public
as $$
  select case p_channel::text
    when 'amazon'        then 'Amazon'
    when 'mercado_livre' then 'Mercado Livre'
    when 'shopee'        then 'Shopee'
    when 'site_proprio'  then 'Site próprio'
    else p_channel::text
  end;
$$;

-- Nome exibível de um perfil (nome, senão e-mail), para montar resumos.
create or replace function display_name(p_id uuid)
returns text
language sql stable
set search_path = public
as $$
  select coalesce(full_name, email) from profiles where id = p_id;
$$;

-- ---------------------------------------------------------------------
-- 3. Gatilhos — TAREFAS
--
-- Toda a VIDA da tarefa (criar/editar/desativar/excluir) é registrada no MOLDE.
-- Excluir uma tarefa é sempre excluir o molde (a app só faz isso; a FK cascateia
-- as instâncias), então o evento sai UMA vez aqui — sem o dilúvio de N
-- "tarefa_excluida" que sairia se o gatilho fosse na instância em cascata.
-- ---------------------------------------------------------------------
create or replace function task_templates_event_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changes jsonb := '{}'::jsonb;
  v_parts   text[] := '{}';
  v_resp    text;
  v_inst    int;
  v_secs    bigint;
  v_hours   bigint;
  v_min     bigint;
  v_time    text;
  v_lost    text;
begin
  if tg_op = 'INSERT' then
    if new.kind = 'unica' then
      insert into company_events (company_id, event_type, summary, details, actor_id)
      values (new.company_id, 'tarefa_criada',
              'Tarefa “' || coalesce(new.title, '(sem título)') || '” criada',
              jsonb_build_object('templateId', new.id, 'kind', new.kind,
                                 'collaboratorId', new.collaborator_id),
              auth.uid());
    else -- diaria
      insert into company_events (company_id, event_type, summary, details, actor_id)
      values (new.company_id, 'tarefa_recorrente_criada',
              'Tarefa recorrente “' || coalesce(new.title, '(sem título)') || '” criada',
              jsonb_build_object('templateId', new.id, 'kind', new.kind,
                                 'collaboratorId', new.collaborator_id),
              auth.uid());
    end if;
    return null;
  end if;

  if tg_op = 'DELETE' then
    -- BEFORE DELETE: as instâncias AINDA existem (o cascade da FK só roda DEPOIS,
    -- na fase AFTER — verificado: em AFTER DELETE a contagem já dá 0). Contamos
    -- aqui QUANTAS ocorrências e QUANTAS horas de trabalho a exclusão do MOLDE vai
    -- levar junto, para o histórico dizer o que foi perdido. Foi essa informação
    -- que faltou quando alguém apagou tarefas e ninguém soube o tamanho do estrago.
    v_resp := display_name(old.collaborator_id);
    select count(*), coalesce(sum(total_seconds), 0)
      into v_inst, v_secs
    from task_instances
    where template_id = old.id;

    v_hours := v_secs / 3600;
    v_min   := (v_secs % 3600) / 60;
    v_time  := case
                 when v_secs <= 0     then null
                 when v_hours = 0     then v_min || 'min'
                 when v_min = 0       then v_hours || 'h'
                 else v_hours || 'h ' || v_min || 'min'
               end;

    v_lost := case
                when v_inst = 0 then ' [nenhuma ocorrência gerada]'
                else ' [' || v_inst
                       || case when v_inst = 1 then ' ocorrência' else ' ocorrências' end
                       || case when v_time is not null
                               then ' · ' || v_time || ' de trabalho' else '' end
                       || ']'
              end;

    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (old.company_id, 'tarefa_excluida',
            case when old.kind = 'diaria' then 'Tarefa recorrente “' else 'Tarefa “' end
              || coalesce(old.title, '(sem título)') || '” excluída'
              || case when v_resp is not null then ' (responsável: ' || v_resp || ')' else '' end
              || v_lost,
            jsonb_build_object('templateId', old.id, 'kind', old.kind,
                               'title', old.title, 'collaboratorId', old.collaborator_id,
                               'instanceCount', v_inst, 'secondsRemoved', v_secs),
            auth.uid());
    return old;  -- BEFORE trigger: RETURN OLD para NÃO cancelar a exclusão.
  end if;

  -- UPDATE: só interessa a tarefa RECORRENTE (a pontual não registra edição).
  if old.kind <> 'diaria' and new.kind <> 'diaria' then
    return null;
  end if;

  -- Desativar uma recorrente (parar de gerar) é tão consequente quanto criar.
  if old.active and not new.active then
    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (new.company_id, 'tarefa_recorrente_desativada',
            'Tarefa recorrente “' || coalesce(new.title, '(sem título)') || '” desativada',
            jsonb_build_object('templateId', new.id, 'collaboratorId', new.collaborator_id),
            auth.uid());
    return null;
  end if;

  -- Edição: registra O QUE mudou (título, responsável, dia, hora-limite,
  -- reativação). Só gera evento se algo relevante mudou de fato.
  if new.title is distinct from old.title then
    v_changes := v_changes || jsonb_build_object('titulo',
                   jsonb_build_object('de', old.title, 'para', new.title));
    v_parts := array_append(v_parts, 'título');
  end if;
  if new.collaborator_id is distinct from old.collaborator_id then
    v_changes := v_changes || jsonb_build_object('responsavel',
                   jsonb_build_object('de', display_name(old.collaborator_id),
                                      'para', display_name(new.collaborator_id)));
    v_parts := array_append(v_parts, 'responsável');
  end if;
  if new.weekdays is distinct from old.weekdays then
    v_changes := v_changes || jsonb_build_object('dias',
                   jsonb_build_object('de', old.weekdays, 'para', new.weekdays));
    v_parts := array_append(v_parts, 'dias');
  end if;
  if new.due_time is distinct from old.due_time then
    v_changes := v_changes || jsonb_build_object('horaLimite',
                   jsonb_build_object('de', to_char(old.due_time, 'HH24:MI'),
                                      'para', to_char(new.due_time, 'HH24:MI')));
    v_parts := array_append(v_parts, 'hora-limite');
  end if;
  if not old.active and new.active then
    v_changes := v_changes || jsonb_build_object('reativada', true);
    v_parts := array_append(v_parts, 'reativada');
  end if;

  if v_changes = '{}'::jsonb then
    return null;  -- nada relevante mudou
  end if;

  insert into company_events (company_id, event_type, summary, details, actor_id)
  values (new.company_id, 'tarefa_recorrente_editada',
          'Tarefa recorrente “' || coalesce(new.title, '(sem título)') || '” editada: '
            || array_to_string(v_parts, ', '),
          jsonb_build_object('templateId', new.id, 'changes', v_changes),
          auth.uid());
  return null;
end;
$$;

-- INSERT/UPDATE em AFTER (a linha já está persistida). O DELETE fica num gatilho
-- BEFORE separado (mesma função), para contar as instâncias ANTES do cascade da FK.
create trigger trg_task_templates_event
  after insert or update on task_templates
  for each row execute function task_templates_event_trg();

create trigger trg_task_templates_del_event
  before delete on task_templates
  for each row execute function task_templates_event_trg();

-- Conclusão — único evento no nível da INSTÂNCIA (ação humana, não geração do
-- cron). Vale para pontual e para cada ocorrência de recorrente concluída.
--
-- EVITANDO DUPLICATA: a conclusão é o evento MAIS frequente do sistema (≈42/dia).
-- Ela já entra no feed pela FONTE 1 (activity_log), que é MAIS rica — traz a nota
-- de conclusão e os minutos gastos. Gerar 'tarefa_concluida' para TODA conclusão
-- faria a mesma linha aparecer DUAS vezes. Por isso só emitimos o evento quando a
-- conclusão NÃO deixou rastro em activity_log — e isso é exatamente o caso da
-- conclusão SEM resumo: timer_finish (tarefa comum) exige a nota, então SEMPRE
-- grava activity_log; timer_finish_listing (listagem) torna a nota opcional e só
-- grava activity_log se houver nota. Ou seja: `completion_note is null` prevê com
-- precisão a ausência de activity_log (verificado no banco: 1293 conclusões em
-- 30 dias, 1 sem activity_log, e essa 1 tem completion_note null). Assim o feed
-- mostra cada conclusão UMA vez, sem nunca perder a conclusão "silenciosa".
create or replace function task_instances_event_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'finalizada' and old.status is distinct from new.status
     and new.completion_note is null then
    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (new.company_id, 'tarefa_concluida',
            'Tarefa “' || coalesce(new.title, '(sem título)') || '” concluída (sem resumo)',
            jsonb_build_object('taskId', new.id, 'seconds', new.total_seconds),
            auth.uid());
  end if;
  return null;
end;
$$;

create trigger trg_task_instances_event
  after update on task_instances
  for each row execute function task_instances_event_trg();

-- ---------------------------------------------------------------------
-- 4. Gatilhos — CONSULTORES e ETIQUETAS (conjuntos por linha)
--
-- As telas passam a gravar DIFERENÇA (só o que entrou/saiu), então cada linha
-- inserida/removida é uma mudança real — nada de "removeu e recolocou tudo".
-- ---------------------------------------------------------------------
create or replace function company_consultants_event_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if tg_op = 'INSERT' then
    v_name := display_name(new.consultant_id);
    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (new.company_id, 'consultor_adicionado',
            'Consultor ' || coalesce(v_name, '(desconhecido)') || ' adicionado',
            jsonb_build_object('consultantId', new.consultant_id), auth.uid());
  else
    v_name := display_name(old.consultant_id);
    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (old.company_id, 'consultor_removido',
            'Consultor ' || coalesce(v_name, '(desconhecido)') || ' removido',
            jsonb_build_object('consultantId', old.consultant_id), auth.uid());
  end if;
  return null;
end;
$$;

create trigger trg_company_consultants_event
  after insert or delete on company_consultants
  for each row execute function company_consultants_event_trg();

create or replace function company_labels_event_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if tg_op = 'INSERT' then
    select name into v_name from labels where id = new.label_id;
    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (new.company_id, 'etiqueta_alterada',
            'Etiqueta “' || coalesce(v_name, '?') || '” adicionada',
            jsonb_build_object('action', 'added', 'labelId', new.label_id,
                               'labelName', v_name), auth.uid());
  else
    -- Na exclusão da etiqueta (cascade), a linha em labels pode já ter sumido.
    select name into v_name from labels where id = old.label_id;
    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (old.company_id, 'etiqueta_alterada',
            'Etiqueta ' || coalesce('“' || v_name || '” ', '') || 'removida',
            jsonb_build_object('action', 'removed', 'labelId', old.label_id,
                               'labelName', v_name), auth.uid());
  end if;
  return null;
end;
$$;

create trigger trg_company_labels_event
  after insert or delete on company_labels
  for each row execute function company_labels_event_trg();

-- ---------------------------------------------------------------------
-- 5. Gatilho — GRUPO da empresa (companies.group_id). Só quando muda de fato.
-- ---------------------------------------------------------------------
create or replace function companies_group_event_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
  v_new text;
begin
  if new.group_id is not distinct from old.group_id then
    return null;  -- outro campo mudou; grupo não
  end if;
  select name into v_old from company_groups where id = old.group_id;
  select name into v_new from company_groups where id = new.group_id;
  insert into company_events (company_id, event_type, summary, details, actor_id)
  values (new.id, 'grupo_alterado',
          case
            when new.group_id is null then 'Empresa removida do grupo “' || coalesce(v_old, '?') || '”'
            when old.group_id is null then 'Empresa movida para o grupo “' || coalesce(v_new, '?') || '”'
            else 'Empresa movida de “' || coalesce(v_old, '?') || '” para “' || coalesce(v_new, '?') || '”'
          end,
          jsonb_build_object('fromId', old.group_id, 'toId', new.group_id,
                             'from', v_old, 'to', v_new),
          auth.uid());
  return null;
end;
$$;

create trigger trg_companies_group_event
  after update of group_id on companies
  for each row execute function companies_group_event_trg();

-- ---------------------------------------------------------------------
-- 6. Gatilho — INFORMAÇÕES DO CLIENTE (company_details). Diferença dos campos
--    de conteúdo; ignora updated_at/updated_by. Só registra se algo mudou.
-- ---------------------------------------------------------------------
create or replace function company_details_event_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changes jsonb := '{}'::jsonb;
begin
  if tg_op = 'UPDATE' then
    if new.project_model is distinct from old.project_model then
      v_changes := v_changes || jsonb_build_object('modelo', jsonb_build_object('de', old.project_model, 'para', new.project_model)); end if;
    if new.started_on is distinct from old.started_on then
      v_changes := v_changes || jsonb_build_object('inicio', jsonb_build_object('de', old.started_on, 'para', new.started_on)); end if;
    if new.ends_on is distinct from old.ends_on then
      v_changes := v_changes || jsonb_build_object('fim', jsonb_build_object('de', old.ends_on, 'para', new.ends_on)); end if;
    if new.cadence is distinct from old.cadence then
      v_changes := v_changes || jsonb_build_object('cadencia', jsonb_build_object('de', old.cadence, 'para', new.cadence)); end if;
    if new.system_used is distinct from old.system_used then
      v_changes := v_changes || jsonb_build_object('sistema', jsonb_build_object('de', old.system_used, 'para', new.system_used)); end if;
    if new.main_pain is distinct from old.main_pain then
      v_changes := v_changes || jsonb_build_object('dor', true); end if;
    if new.about is distinct from old.about then
      v_changes := v_changes || jsonb_build_object('sobre', true); end if;
    if v_changes = '{}'::jsonb then
      return null;
    end if;
  end if;

  insert into company_events (company_id, event_type, summary, details, actor_id)
  values (coalesce(new.company_id, old.company_id), 'informacoes_alteradas',
          'Informações do cliente atualizadas',
          case when tg_op = 'UPDATE' then jsonb_build_object('changes', v_changes) else '{}'::jsonb end,
          auth.uid());
  return null;
end;
$$;

create trigger trg_company_details_event
  after insert or update on company_details
  for each row execute function company_details_event_trg();

-- ---------------------------------------------------------------------
-- 7. Gatilho — FATURAMENTO (company_revenues). Espelha a lógica da auditoria
--    (0067): não registra UPDATE que não muda o valor. INSERT = lançado;
--    UPDATE/DELETE = corrigido. Resumo com canal, mês e de quanto para quanto.
--    SEM filtro por cargo: quem alcança a empresa lê o evento (RLS de
--    company_events), coerente com o acesso de faturamento (0071).
-- ---------------------------------------------------------------------
create or replace function company_revenues_event_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old    numeric(14,2);
  v_new    numeric(14,2);
  v_reason text;
  v_chan   sales_channel;
  v_month  date;
  v_type   text;
  v_amt    text;
begin
  if tg_op = 'INSERT' then
    v_old := null; v_new := new.amount; v_type := 'faturamento_lancado';
  elsif tg_op = 'UPDATE' then
    if new.amount is not distinct from old.amount then
      return null;
    end if;
    v_old := old.amount; v_new := new.amount; v_type := 'faturamento_corrigido';
  else
    v_old := old.amount; v_new := null; v_type := 'faturamento_corrigido';
  end if;

  v_chan  := coalesce(new.channel, old.channel);
  v_month := coalesce(new.reference_month, old.reference_month);
  v_reason := nullif(btrim(coalesce(current_setting('app.revenue_reason', true), '')), '');

  v_amt := case
    when v_old is null then 'lançado R$ ' || trim(to_char(v_new, 'FM999999990.00'))
    when v_new is null then 'removido (era R$ ' || trim(to_char(v_old, 'FM999999990.00')) || ')'
    else 'de R$ ' || trim(to_char(v_old, 'FM999999990.00'))
           || ' para R$ ' || trim(to_char(v_new, 'FM999999990.00'))
  end;

  insert into company_events (company_id, event_type, summary, details, actor_id)
  values (coalesce(new.company_id, old.company_id), v_type,
          'Faturamento ' || sales_channel_label(v_chan) || ' ' || to_char(v_month, 'MM/YYYY')
            || ': ' || v_amt,
          jsonb_build_object('channel', v_chan, 'month', v_month,
                             'oldAmount', v_old, 'newAmount', v_new, 'reason', v_reason),
          auth.uid());
  return null;
end;
$$;

create trigger trg_company_revenues_event
  after insert or update or delete on company_revenues
  for each row execute function company_revenues_event_trg();

-- ---------------------------------------------------------------------
-- 8. Gatilho — ACESSO DO CLIENTE (client_portal_access). A CRIAÇÃO e a
--    REDEFINIÇÃO DE SENHA já ficam registradas em client_portal_audit (com
--    histórico) e entram no feed por lá; aqui cobrimos o que falta: a REVOGAÇÃO
--    (active true→false) e a reativação (false→true), que a auditoria não grava.
-- ---------------------------------------------------------------------
create or replace function client_portal_access_event_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.active and not new.active then
    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (new.company_id, 'acesso_cliente_revogado', 'Acesso do cliente revogado',
            '{}'::jsonb, auth.uid());
  elsif not old.active and new.active then
    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (new.company_id, 'acesso_cliente_criado', 'Acesso do cliente reativado',
            jsonb_build_object('reactivated', true), auth.uid());
  end if;
  return null;
end;
$$;

create trigger trg_client_portal_access_event
  after update of active on client_portal_access
  for each row execute function client_portal_access_event_trg();

-- ---------------------------------------------------------------------
-- 9. Gatilho — LISTAGEM VALIDADA pelo CLIENTE (listing_validations, author
--    'cliente'). O ator é o cliente (não é um profile): actor_id fica null e o
--    resumo diz "Cliente ..." — a UI mostra "Sistema" no autor só quando não há
--    ninguém; aqui o resumo carrega quem foi. reajuste_feito é ação interna, não
--    validação do cliente — fica de fora.
-- ---------------------------------------------------------------------
create or replace function listing_validations_event_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_brand  text;
  v_market text;
  v_label  text;
  v_verb   text;
begin
  if new.author_type <> 'cliente' then
    return null;
  end if;
  if new.event_type not in ('aprovado', 'ajuste_solicitado', 'contestado') then
    return null;
  end if;

  select b.name, r.marketplace::text
    into v_brand, v_market
  from listing_results r
  left join listing_brands b on b.id = r.brand_id
  where r.id = new.listing_result_id;

  v_label := trim(both ' ·' from coalesce(v_brand, '') || ' · ' || coalesce(v_market, ''));
  v_verb := case new.event_type
    when 'aprovado'         then 'aprovou'
    when 'ajuste_solicitado' then 'pediu ajuste em'
    when 'contestado'       then 'contestou'
  end;

  insert into company_events (company_id, event_type, summary, details, actor_id)
  values (new.company_id, 'listagem_validada',
          'Cliente ' || v_verb || ' a listagem'
            || case when v_label <> '' then ' (' || v_label || ')' else '' end,
          jsonb_build_object('event', new.event_type, 'listingResultId', new.listing_result_id,
                             'brand', v_brand, 'marketplace', v_market, 'comment', new.comment),
          null);
  return null;
end;
$$;

create trigger trg_listing_validations_event
  after insert on listing_validations
  for each row execute function listing_validations_event_trg();

-- ---------------------------------------------------------------------
-- 10. Gatilho — REUNIÕES (meetings). Criar/cancelar, só quando há empresa
--     (reserva de sala sem empresa não é evento de nenhuma empresa).
-- ---------------------------------------------------------------------
create or replace function meetings_event_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_when text;
begin
  if tg_op = 'INSERT' then
    if new.company_id is null then return null; end if;
    v_when := to_char(new.starts_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (new.company_id, 'reuniao_criada',
            'Reunião “' || coalesce(new.title, '(sem título)') || '” criada para ' || v_when,
            jsonb_build_object('meetingId', new.id, 'startsAt', new.starts_at,
                               'meetingType', new.meeting_type, 'room', new.room),
            auth.uid());
  else -- DELETE
    if old.company_id is null then return null; end if;
    v_when := to_char(old.starts_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (old.company_id, 'reuniao_cancelada',
            'Reunião “' || coalesce(old.title, '(sem título)') || '” (' || v_when || ') cancelada',
            jsonb_build_object('meetingId', old.id, 'startsAt', old.starts_at,
                               'meetingType', old.meeting_type, 'room', old.room),
            auth.uid());
  end if;
  return null;
end;
$$;

create trigger trg_meetings_event
  after insert or delete on meetings
  for each row execute function meetings_event_trg();

-- =====================================================================
-- 11. RPC do histórico — agora UNE várias fontes numa linha do tempo só.
--     Continua SECURITY INVOKER: a RLS de cada fonte é a fronteira (por isso
--     colaborador vê faturamento — company_events tem RLS por alcance — mas pode
--     não ver o que a RLS da fonte não permitir). Paginação/total/filtros no
--     banco. O `content` dos eventos é o próprio resumo (não têm corpo longo).
-- =====================================================================
create or replace function company_activity_feed(
  p_company uuid,
  p_limit   int  default 20,
  p_offset  int  default 0,
  p_search  text default null,
  p_types   text[] default null,
  p_author  uuid default null,
  p_from    date default null,
  p_to      date default null
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public', 'extensions'
as $function$
  with feed as (
    -- FONTE 1: activity_log (notas de trabalho / tempo) — Fatia 1.
    select
      al.id,
      'atividade'::text                                   as type,
      al.created_at                                       as at,
      al.collaborator_id                                  as author_id,
      left(btrim(split_part(al.message, E'\n', 1)), 140)  as summary,
      al.message                                          as content,
      jsonb_build_object(
        'seconds',      al.seconds_spent,
        'sentWhatsapp', al.sent_whatsapp,
        'taskId',       al.task_id
      )                                                   as meta
    from public.activity_log al
    where al.company_id = p_company

    union all

    -- FONTE 2: company_events (eventos novos desta fatia).
    select
      ce.id,
      ce.event_type                                       as type,
      ce.created_at                                       as at,
      ce.actor_id                                         as author_id,
      left(ce.summary, 140)                               as summary,
      ce.summary                                          as content,
      coalesce(ce.details, '{}'::jsonb)                   as meta
    from public.company_events ce
    where ce.company_id = p_company

    union all

    -- FONTE 3: client_portal_audit (acesso do cliente criado / senha redefinida).
    -- A REVOGAÇÃO vem por company_events (a auditoria não a grava).
    select
      cpa.id,
      case cpa.action
        when 'criado'          then 'acesso_cliente_criado'
        when 'senha_redefinida' then 'acesso_cliente_senha_redefinida'
        else 'acesso_cliente_' || cpa.action
      end                                                 as type,
      cpa.created_at                                      as at,
      cpa.actor_id                                        as author_id,
      case cpa.action
        when 'criado'          then 'Acesso do cliente criado'
        when 'senha_redefinida' then 'Senha do cliente redefinida'
        else 'Acesso do cliente: ' || cpa.action
      end                                                 as summary,
      case cpa.action
        when 'criado'          then 'Acesso do cliente criado'
        when 'senha_redefinida' then 'Senha do cliente redefinida'
        else 'Acesso do cliente: ' || cpa.action
      end                                                 as content,
      jsonb_build_object('action', cpa.action)            as meta
    from public.client_portal_audit cpa
    where cpa.company_id = p_company
  ),
  filtered as (
    select f.*,
           public.activity_type_label(f.type) as type_label,
           coalesce(p.full_name, p.email)      as author_name,
           p.avatar_path
    from feed f
    left join public.profiles p on p.id = f.author_id
    where (p_types is null or array_length(p_types, 1) is null or f.type = any(p_types))
      and (p_author is null or f.author_id = p_author)
      and (p_from is null or (f.at at time zone 'America/Sao_Paulo')::date >= p_from)
      and (p_to   is null or (f.at at time zone 'America/Sao_Paulo')::date <= p_to)
      and (
        p_search is null or btrim(p_search) = ''
        or f.content ilike '%' || p_search || '%'
      )
  ),
  page as (
    select *
    from filtered
    order by at desc, id desc
    limit  greatest(0, least(coalesce(p_limit, 20), 100))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'items', coalesce(
      (select jsonb_agg(jsonb_build_object(
         'id',           page.id,
         'type',         page.type,
         'typeLabel',    page.type_label,
         'at',           page.at,
         'authorId',     page.author_id,
         'authorName',   page.author_name,
         'authorAvatar', page.avatar_path,
         'summary',      page.summary,
         'content',      page.content,
         'meta',         page.meta
       ) order by page.at desc, page.id desc)
       from page),
      '[]'::jsonb
    )
  );
$function$;

-- Autores distintos com evento nesta empresa (todas as fontes) — filtro por
-- PESSOA. Independe de paginação/demais filtros. Null (cliente/sistema) fica fora.
create or replace function company_activity_authors(p_company uuid)
returns jsonb
language sql
stable
security invoker
set search_path to 'public', 'extensions'
as $function$
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id',     a.author_id,
      'name',   coalesce(p.full_name, p.email),
      'avatar', p.avatar_path
    ) order by coalesce(p.full_name, p.email)),
    '[]'::jsonb
  )
  from (
    select distinct author_id from (
      select collaborator_id as author_id from public.activity_log where company_id = p_company
      union
      select actor_id from public.company_events where company_id = p_company
      union
      select actor_id from public.client_portal_audit where company_id = p_company
    ) s
    where author_id is not null
  ) a
  left join public.profiles p on p.id = a.author_id;
$function$;

-- Tipos de evento REALMENTE presentes nesta empresa (sem lista fixa no código) —
-- alimenta o filtro por TIPO com {value,label} vindos do banco.
create or replace function company_activity_types(p_company uuid)
returns jsonb
language sql
stable
security invoker
set search_path to 'public', 'extensions'
as $function$
  select coalesce(
    jsonb_agg(jsonb_build_object('value', t.type, 'label', public.activity_type_label(t.type))
              order by public.activity_type_label(t.type)),
    '[]'::jsonb
  )
  from (
    select distinct type from (
      (select 'atividade' as type from public.activity_log where company_id = p_company limit 1)
      union
      (select distinct event_type from public.company_events where company_id = p_company)
      union
      (select distinct case cpa.action
                         when 'criado' then 'acesso_cliente_criado'
                         when 'senha_redefinida' then 'acesso_cliente_senha_redefinida'
                         else 'acesso_cliente_' || cpa.action
                       end
       from public.client_portal_audit cpa where cpa.company_id = p_company)
    ) s
  ) t;
$function$;

grant execute on function company_activity_feed(uuid, int, int, text, text[], uuid, date, date) to authenticated;
grant execute on function company_activity_authors(uuid) to authenticated;
grant execute on function company_activity_types(uuid) to authenticated;
grant execute on function activity_type_label(text) to authenticated, anon;

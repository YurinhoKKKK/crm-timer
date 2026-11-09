-- =====================================================================
-- 0168_activity_history_expansion :: CRM/Timer - Monvatti
-- =====================================================================
-- Tudo que muda numa empresa passa a aparecer no histórico (company_events),
-- com quem, quando e de -> para. Esta migration é ADITIVA e go-forward:
--   · acrescenta colunas source/source_id (idempotência do futuro backfill);
--   · recria o catálogo de rótulos (corrige a regressão da 0167 + ~25 tipos);
--   · acrescenta CATEGORIA (filtro) e VISIBILIDADE POR TIPO (RLS);
--   · centraliza a escrita num helper log_company_event();
--   · acrescenta os triggers daqui-para-frente (tarefas, contato, contrato, CS,
--     tráfego, dev, tempo, anotações, reuniões, pausas, churn, canais);
--   · passa consultor/colaborador por RPC que emite UM evento *_trocado;
--   · cria company_responsible_periods (linha do tempo de responsáveis) e a
--     mantém a partir dos vínculos (go-forward);
--   · a RPC do feed ganha filtro por categoria + enriquece a conclusão com o
--     tempo total.
--
-- O BACKFILL das auditorias e a RECONSTRUÇÃO dos períodos de responsável NÃO
-- entram aqui — vão numa migration separada, depois das contagens/prévia.
--
-- Visibilidade por tipo (activity_event_visibility):
--   'admin'    -> só admin (valor de contrato, CS/NPS, churn);
--   'trafego'  -> admin + gestor_trafego∩my_traffic_companies;
--   'dev'      -> admin + desenvolvedor∩my_dev_companies;
--   'anotacao' -> mesma visibilidade da anotação (alcance + cargo-de-quadro c/ área);
--   'reach'    -> alcance (admin/consultor/colaborador) — padrão, = ce_select de hoje.
--
-- Rollback: supabase/rollback/0168_activity_history_expansion.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. company_events: origem rastreável (idempotência do backfill/mirror).
--    source = tabela de origem; source_id = PK (texto, pois há uuid e bigint).
--    Índice único PARCIAL: duas inserções com o mesmo (source, source_id) não
--    duplicam — nem backfill rodado 2x, nem backfill + trigger go-forward.
-- ---------------------------------------------------------------------
alter table public.company_events
  add column if not exists source    text,
  add column if not exists source_id text;

create unique index if not exists uq_company_events_source
  on public.company_events (source, source_id)
  where source is not null;

-- ---------------------------------------------------------------------
-- 2. Helper de escrita. SECURITY DEFINER (chamado de dentro dos triggers, que
--    também são DEFINER). Idempotente por (source, source_id). company null =
--    no-op (guarda de cascade). details nulo vira {}.
-- ---------------------------------------------------------------------
create or replace function public.log_company_event(
  p_company   uuid,
  p_type      text,
  p_summary   text,
  p_details   jsonb default '{}'::jsonb,
  p_actor     uuid  default null,
  p_source    text  default null,
  p_source_id text  default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_company is null then
    return;
  end if;
  insert into company_events
    (company_id, event_type, summary, details, actor_id, source, source_id)
  values
    (p_company, p_type, p_summary, coalesce(p_details, '{}'::jsonb), p_actor, p_source, p_source_id)
  on conflict (source, source_id) where source is not null do nothing;
end;
$$;

revoke all on function public.log_company_event(uuid, text, text, jsonb, uuid, text, text) from public, anon;

-- ---------------------------------------------------------------------
-- 3. Catálogo de RÓTULOS — recria com TODOS os tipos (corrige a regressão da
--    0167, que derrubou 7 rótulos) + os ~25 novos.
-- ---------------------------------------------------------------------
create or replace function activity_type_label(p_type text)
returns text
language sql immutable
set search_path = public
as $$
  select case p_type
    -- Atividade / Tarefas
    when 'atividade'                      then 'Atividade'
    when 'tarefa_criada'                  then 'Tarefa criada'
    when 'tarefa_editada'                 then 'Tarefa editada'
    when 'tarefa_concluida'               then 'Tarefa concluída'
    when 'tarefa_excluida'                then 'Tarefa excluída'
    when 'tarefa_cancelada'               then 'Tarefa cancelada'
    when 'tarefa_reaberta'                then 'Tarefa reaberta'
    when 'tarefa_expirada'                then 'Tarefa expirada'
    when 'ocorrencia_prazo_alterado'      then 'Prazo da ocorrência alterado'
    when 'ocorrencia_excluida'            then 'Ocorrência excluída'
    when 'tarefa_recorrente_criada'       then 'Tarefa recorrente criada'
    when 'tarefa_recorrente_editada'      then 'Tarefa recorrente editada'
    when 'tarefa_recorrente_desativada'   then 'Tarefa recorrente desativada'
    when 'tarefa_desativada_catalogo'     then 'Tarefa desativada pelo catálogo'
    when 'tarefa_reativada_catalogo'      then 'Tarefa reativada pelo catálogo'
    when 'tarefas_pausadas_grupo'         then 'Tarefas pausadas (grupo)'
    when 'tarefas_retomadas_grupo'        then 'Tarefas retomadas (grupo)'
    -- Responsáveis
    when 'tarefa_responsavel_alterada'    then 'Responsável alterado'
    when 'tarefas_repassadas'             then 'Tarefas repassadas'
    when 'consultor_adicionado'           then 'Consultor adicionado'
    when 'consultor_removido'             then 'Consultor removido'
    when 'consultor_trocado'              then 'Consultor trocado'
    when 'colaborador_adicionado'         then 'Colaborador adicionado'
    when 'colaborador_removido'           then 'Colaborador removido'
    when 'colaborador_trocado'            then 'Colaborador trocado'
    -- Tempo
    when 'tempo_ajustado'                 then 'Tempo ajustado'
    -- Contrato / Faturamento
    when 'informacoes_alteradas'          then 'Informações alteradas'
    when 'faturamento_lancado'            then 'Faturamento lançado'
    when 'faturamento_corrigido'          then 'Faturamento corrigido'
    when 'valor_contrato_alterado'        then 'Valor do contrato alterado'
    when 'canais_alterados'               then 'Canais alterados'
    when 'pausa_iniciada'                 then 'Pausa iniciada'
    when 'pausa_encerrada'                then 'Pausa encerrada'
    -- Sucesso do Cliente
    when 'cs_alterado'                    then 'Sucesso do Cliente alterado'
    when 'churn_registrado'               then 'Churn registrado'
    when 'churn_editado'                  then 'Churn editado'
    -- Contato
    when 'empresa_renomeada'              then 'Empresa renomeada'
    when 'contato_digisac_alterado'       then 'Contato do Digisac alterado'
    when 'grupo_whatsapp_alterado'        then 'Grupo de WhatsApp alterado'
    -- Empresa / Cadastro
    when 'grupo_alterado'                 then 'Grupo alterado'
    when 'etiqueta_alterada'              then 'Etiqueta alterada'
    when 'empresa_criada_crm'             then 'Empresa criada (CRM)'
    -- Tráfego / Desenvolvimento
    when 'trafego_alterado'               then 'Tráfego alterado'
    when 'dev_alterado'                   then 'Desenvolvimento alterado'
    -- Reuniões
    when 'reuniao_criada'                 then 'Reunião criada'
    when 'reuniao_cancelada'              then 'Reunião cancelada'
    when 'timer_reuniao_editado'          then 'Timer de reunião editado'
    -- Portal
    when 'acesso_cliente_criado'          then 'Acesso do cliente criado'
    when 'acesso_cliente_senha_redefinida' then 'Senha do cliente redefinida'
    when 'acesso_cliente_link_girado'     then 'Link do cliente girado'
    when 'acesso_cliente_revogado'        then 'Acesso do cliente revogado'
    -- Anotações
    when 'anotacao_editada'               then 'Anotação editada'
    when 'anotacao_excluida'              then 'Anotação excluída'
    -- Listagens
    when 'listagem_validada'              then 'Listagem validada'
    else p_type
  end;
$$;

grant execute on function activity_type_label(text) to authenticated, anon;

-- ---------------------------------------------------------------------
-- 4. CATEGORIA de cada tipo (chave) e rótulo pt-BR da categoria.
-- ---------------------------------------------------------------------
create or replace function activity_type_category(p_type text)
returns text
language sql immutable
set search_path = public
as $$
  select case p_type
    when 'atividade'                      then 'tempo'
    when 'tempo_ajustado'                 then 'tempo'
    when 'tarefa_criada'                  then 'tarefas'
    when 'tarefa_editada'                 then 'tarefas'
    when 'tarefa_concluida'               then 'tarefas'
    when 'tarefa_excluida'                then 'tarefas'
    when 'tarefa_cancelada'               then 'tarefas'
    when 'tarefa_reaberta'                then 'tarefas'
    when 'tarefa_expirada'                then 'tarefas'
    when 'ocorrencia_prazo_alterado'      then 'tarefas'
    when 'ocorrencia_excluida'            then 'tarefas'
    when 'tarefa_recorrente_criada'       then 'tarefas'
    when 'tarefa_recorrente_editada'      then 'tarefas'
    when 'tarefa_recorrente_desativada'   then 'tarefas'
    when 'tarefa_desativada_catalogo'     then 'tarefas'
    when 'tarefa_reativada_catalogo'      then 'tarefas'
    when 'tarefas_pausadas_grupo'         then 'tarefas'
    when 'tarefas_retomadas_grupo'        then 'tarefas'
    when 'tarefa_responsavel_alterada'    then 'responsaveis'
    when 'tarefas_repassadas'             then 'responsaveis'
    when 'consultor_adicionado'           then 'responsaveis'
    when 'consultor_removido'             then 'responsaveis'
    when 'consultor_trocado'              then 'responsaveis'
    when 'colaborador_adicionado'         then 'responsaveis'
    when 'colaborador_removido'           then 'responsaveis'
    when 'colaborador_trocado'            then 'responsaveis'
    when 'informacoes_alteradas'          then 'contrato'
    when 'faturamento_lancado'            then 'contrato'
    when 'faturamento_corrigido'          then 'contrato'
    when 'valor_contrato_alterado'        then 'contrato'
    when 'canais_alterados'               then 'contrato'
    when 'pausa_iniciada'                 then 'contrato'
    when 'pausa_encerrada'                then 'contrato'
    when 'cs_alterado'                    then 'cs'
    when 'churn_registrado'               then 'cs'
    when 'churn_editado'                  then 'cs'
    when 'empresa_renomeada'              then 'contato'
    when 'contato_digisac_alterado'       then 'contato'
    when 'grupo_whatsapp_alterado'        then 'contato'
    when 'grupo_alterado'                 then 'empresa'
    when 'etiqueta_alterada'              then 'empresa'
    when 'empresa_criada_crm'             then 'empresa'
    when 'trafego_alterado'               then 'trafego'
    when 'dev_alterado'                   then 'desenvolvimento'
    when 'reuniao_criada'                 then 'reunioes'
    when 'reuniao_cancelada'              then 'reunioes'
    when 'timer_reuniao_editado'          then 'reunioes'
    when 'acesso_cliente_criado'          then 'portal'
    when 'acesso_cliente_senha_redefinida' then 'portal'
    when 'acesso_cliente_link_girado'     then 'portal'
    when 'acesso_cliente_revogado'        then 'portal'
    when 'anotacao_editada'               then 'anotacoes'
    when 'anotacao_excluida'              then 'anotacoes'
    when 'listagem_validada'              then 'tarefas'
    else 'empresa'
  end;
$$;

grant execute on function activity_type_category(text) to authenticated, anon;

create or replace function activity_category_label(p_key text)
returns text
language sql immutable
set search_path = public
as $$
  select case p_key
    when 'tarefas'         then 'Tarefas'
    when 'responsaveis'    then 'Responsáveis'
    when 'tempo'           then 'Tempo'
    when 'contrato'        then 'Contrato'
    when 'cs'              then 'Sucesso do Cliente'
    when 'contato'         then 'Contato'
    when 'empresa'         then 'Empresa'
    when 'trafego'         then 'Tráfego'
    when 'desenvolvimento' then 'Desenvolvimento'
    when 'reunioes'        then 'Reuniões'
    when 'portal'          then 'Portal'
    when 'anotacoes'       then 'Anotações'
    else p_key
  end;
$$;

grant execute on function activity_category_label(text) to authenticated, anon;

-- ---------------------------------------------------------------------
-- 5. VISIBILIDADE por tipo. Imutável; usada na RLS de company_events.
-- ---------------------------------------------------------------------
create or replace function activity_event_visibility(p_type text)
returns text
language sql immutable
set search_path = public
as $$
  select case p_type
    when 'valor_contrato_alterado' then 'admin'
    when 'cs_alterado'             then 'admin'
    when 'churn_registrado'        then 'admin'
    when 'churn_editado'           then 'admin'
    when 'trafego_alterado'        then 'trafego'
    when 'dev_alterado'            then 'dev'
    when 'anotacao_editada'        then 'anotacao'
    when 'anotacao_excluida'       then 'anotacao'
    else 'reach'
  end;
$$;

grant execute on function activity_event_visibility(text) to authenticated, anon;

-- ---------------------------------------------------------------------
-- 6. RLS — recria ce_select com a trava por tipo. O 'reach' é IDÊNTICO ao de
--    hoje (admin/consultor/colaborador). Os tipos restritos exigem o cargo/área.
--    O feed e o PDF usam a RPC SECURITY INVOKER, então esta policy vale nos dois
--    e os tipos restritos nem aparecem como opção de filtro para quem não os vê.
-- ---------------------------------------------------------------------
drop policy if exists ce_select on public.company_events;
create policy ce_select on public.company_events for select
  using (
    (select is_admin())
    or (
      case activity_event_visibility(event_type)
        when 'admin' then false
        when 'trafego' then
          company_id in (select my_traffic_companies())
        when 'dev' then
          company_id in (select my_dev_companies())
        when 'anotacao' then
          company_id in (select my_consultant_companies())
          or company_id in (select my_collaborator_companies())
          or (board_area_for_role((select auth_role())) is not null
              and (company_id in (select my_traffic_companies())
                   or company_id in (select my_dev_companies()))
              and coalesce(details->'areas', '[]'::jsonb) ? board_area_for_role((select auth_role()))::text)
        else -- 'reach'
          company_id in (select my_consultant_companies())
          or company_id in (select my_collaborator_companies())
      end
    )
  );

-- =====================================================================
-- 7. TAREFAS — recria os gatilhos de molde e de instância (base 0167) com os
--    eventos novos. Tudo que já existia é preservado.
-- =====================================================================

-- 7a. sync_template_instances: além de app.suppress_resp_event, agora também
--     app.suppress_prazo_event (a propagação do modelo NÃO é "alteração de prazo
--     da ocorrência"). Resto idêntico à 0167.
create or replace function sync_template_instances(p_template uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  tmpl record;
  updated_count integer := 0;
begin
  select * into tmpl from task_templates where id = p_template;
  if not found then
    return 0;
  end if;

  if not (is_admin() or tmpl.company_id in (select my_consultant_companies())) then
    raise exception 'not authorized';
  end if;

  perform set_config('app.suppress_resp_event', 'on', true);
  perform set_config('app.suppress_prazo_event', 'on', true);

  update task_instances ti
  set collaborator_id = tmpl.collaborator_id,
      company_id      = tmpl.company_id,
      title           = tmpl.title,
      description     = tmpl.description,
      instructions    = tmpl.instructions,
      task_date       = case when tmpl.kind = 'unica' then tmpl.start_date else ti.task_date end,
      due_at          = (
        ((case when tmpl.kind = 'unica' then tmpl.start_date else ti.task_date end)::text
          || ' ' || coalesce(tmpl.due_time, '23:59')::text)::timestamp
          at time zone 'America/Sao_Paulo'
      )
  where ti.template_id = p_template
    and ti.status in ('a_fazer', 'iniciada');

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

-- 7b. Gatilho do MODELO (task_templates). Base 0167 + bloco 'tarefa_editada'
--     para a tarefa ÚNICA (título, prazo, descrição, instruções, categoria/tipo).
create or replace function task_templates_event_trg()
returns trigger
language plpgsql security definer set search_path = public
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
      perform log_company_event(new.company_id, 'tarefa_criada',
        'Tarefa “' || coalesce(new.title, '(sem título)') || '” criada',
        jsonb_build_object('templateId', new.id, 'kind', new.kind, 'collaboratorId', new.collaborator_id),
        auth.uid());
    else
      perform log_company_event(new.company_id, 'tarefa_recorrente_criada',
        'Tarefa recorrente “' || coalesce(new.title, '(sem título)') || '” criada',
        jsonb_build_object('templateId', new.id, 'kind', new.kind, 'collaboratorId', new.collaborator_id),
        auth.uid());
    end if;
    return null;
  end if;

  if tg_op = 'DELETE' then
    v_resp := display_name(old.collaborator_id);
    select count(*), coalesce(sum(total_seconds), 0) into v_inst, v_secs
    from task_instances where template_id = old.id;

    v_hours := v_secs / 3600;
    v_min   := (v_secs % 3600) / 60;
    v_time  := case
                 when v_secs <= 0 then null
                 when v_hours = 0 then v_min || 'min'
                 when v_min = 0   then v_hours || 'h'
                 else v_hours || 'h ' || v_min || 'min'
               end;
    v_lost := case
                when v_inst = 0 then ' [nenhuma ocorrência gerada]'
                else ' [' || v_inst
                       || case when v_inst = 1 then ' ocorrência' else ' ocorrências' end
                       || case when v_time is not null then ' · ' || v_time || ' de trabalho' else '' end
                       || ']'
              end;

    perform log_company_event(old.company_id, 'tarefa_excluida',
      case when old.kind = 'diaria' then 'Tarefa recorrente “' else 'Tarefa “' end
        || coalesce(old.title, '(sem título)') || '” excluída'
        || case when v_resp is not null then ' (responsável: ' || v_resp || ')' else '' end
        || v_lost,
      jsonb_build_object('templateId', old.id, 'kind', old.kind, 'title', old.title,
                         'collaboratorId', old.collaborator_id, 'instanceCount', v_inst,
                         'secondsRemoved', v_secs),
      auth.uid());
    return old;
  end if;

  -- ===== UPDATE =====

  -- Troca de RESPONSÁVEL — vale para ÚNICA e RECORRENTE (evento dedicado).
  if new.collaborator_id is distinct from old.collaborator_id
     and coalesce(current_setting('app.suppress_resp_event', true), '') <> 'on' then
    perform log_company_event(new.company_id, 'tarefa_responsavel_alterada',
      'Responsável da tarefa “' || coalesce(new.title, '(sem título)')
        || '” alterado de ' || coalesce(display_name(old.collaborator_id), '(sem responsável)')
        || ' para ' || coalesce(display_name(new.collaborator_id), '(sem responsável)'),
      jsonb_build_object('templateId', new.id, 'kind', new.kind,
                         'from', old.collaborator_id, 'to', new.collaborator_id,
                         'fromName', display_name(old.collaborator_id),
                         'toName', display_name(new.collaborator_id)),
      auth.uid());
  end if;

  -- Edição da tarefa ÚNICA (novo) — espelha 'tarefa_recorrente_editada'.
  if old.kind = 'unica' and new.kind = 'unica' then
    if new.title is distinct from old.title then
      v_changes := v_changes || jsonb_build_object('titulo', jsonb_build_object('de', old.title, 'para', new.title));
      v_parts := array_append(v_parts, 'título');
    end if;
    if new.start_date is distinct from old.start_date then
      v_changes := v_changes || jsonb_build_object('prazo', jsonb_build_object('de', old.start_date, 'para', new.start_date));
      v_parts := array_append(v_parts, 'prazo');
    end if;
    if new.due_time is distinct from old.due_time then
      v_changes := v_changes || jsonb_build_object('horaLimite',
                     jsonb_build_object('de', to_char(old.due_time, 'HH24:MI'), 'para', to_char(new.due_time, 'HH24:MI')));
      v_parts := array_append(v_parts, 'hora-limite');
    end if;
    if new.description is distinct from old.description then
      v_changes := v_changes || jsonb_build_object('descricao', true);
      v_parts := array_append(v_parts, 'descrição');
    end if;
    if new.instructions is distinct from old.instructions then
      v_changes := v_changes || jsonb_build_object('instrucoes', true);
      v_parts := array_append(v_parts, 'instruções');
    end if;
    if new.category is distinct from old.category then
      v_changes := v_changes || jsonb_build_object('categoria',
                     jsonb_build_object('de', old.category, 'para', new.category));
      v_parts := array_append(v_parts, 'categoria');
    end if;
    if new.template_type is distinct from old.template_type then
      v_changes := v_changes || jsonb_build_object('tipo',
                     jsonb_build_object('de', old.template_type, 'para', new.template_type));
      v_parts := array_append(v_parts, 'tipo');
    end if;

    if v_changes <> '{}'::jsonb then
      perform log_company_event(new.company_id, 'tarefa_editada',
        'Tarefa “' || coalesce(new.title, '(sem título)') || '” editada: ' || array_to_string(v_parts, ', '),
        jsonb_build_object('templateId', new.id, 'changes', v_changes),
        auth.uid());
    end if;
    return null;
  end if;

  -- Daqui, só a tarefa RECORRENTE registra.
  if old.kind <> 'diaria' and new.kind <> 'diaria' then
    return null;
  end if;

  if old.active and not new.active then
    perform log_company_event(new.company_id, 'tarefa_recorrente_desativada',
      'Tarefa recorrente “' || coalesce(new.title, '(sem título)') || '” desativada',
      jsonb_build_object('templateId', new.id, 'collaboratorId', new.collaborator_id),
      auth.uid());
    return null;
  end if;

  if new.title is distinct from old.title then
    v_changes := v_changes || jsonb_build_object('titulo', jsonb_build_object('de', old.title, 'para', new.title));
    v_parts := array_append(v_parts, 'título');
  end if;
  if new.weekdays is distinct from old.weekdays then
    v_changes := v_changes || jsonb_build_object('dias', jsonb_build_object('de', old.weekdays, 'para', new.weekdays));
    v_parts := array_append(v_parts, 'dias');
  end if;
  if new.due_time is distinct from old.due_time then
    v_changes := v_changes || jsonb_build_object('horaLimite',
                   jsonb_build_object('de', to_char(old.due_time, 'HH24:MI'), 'para', to_char(new.due_time, 'HH24:MI')));
    v_parts := array_append(v_parts, 'hora-limite');
  end if;
  if not old.active and new.active then
    v_changes := v_changes || jsonb_build_object('reativada', true);
    v_parts := array_append(v_parts, 'reativada');
  end if;

  if v_changes = '{}'::jsonb then
    return null;
  end if;

  perform log_company_event(new.company_id, 'tarefa_recorrente_editada',
    'Tarefa recorrente “' || coalesce(new.title, '(sem título)') || '” editada: ' || array_to_string(v_parts, ', '),
    jsonb_build_object('templateId', new.id, 'changes', v_changes),
    auth.uid());
  return null;
end;
$$;

-- 7c. Gatilho da INSTÂNCIA (task_instances). Base 0167 + prazo/cancelada/reaberta.
create or replace function task_instances_event_trg()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Troca de responsável direta na ocorrência (editor de ocorrência).
  if new.collaborator_id is distinct from old.collaborator_id
     and coalesce(current_setting('app.suppress_resp_event', true), '') <> 'on' then
    perform log_company_event(new.company_id, 'tarefa_responsavel_alterada',
      'Responsável da tarefa “' || coalesce(new.title, '(sem título)')
        || '” alterado de ' || coalesce(display_name(old.collaborator_id), '(sem responsável)')
        || ' para ' || coalesce(display_name(new.collaborator_id), '(sem responsável)'),
      jsonb_build_object('taskId', new.id, 'from', old.collaborator_id, 'to', new.collaborator_id,
                         'fromName', display_name(old.collaborator_id), 'toName', display_name(new.collaborator_id)),
      auth.uid());
  end if;

  -- Prazo da ocorrência alterado FORA do sync do modelo.
  if new.due_at is distinct from old.due_at
     and coalesce(current_setting('app.suppress_prazo_event', true), '') <> 'on' then
    perform log_company_event(new.company_id, 'ocorrencia_prazo_alterado',
      'Prazo da tarefa “' || coalesce(new.title, '(sem título)') || '” alterado de '
        || coalesce(to_char(old.due_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'), '(sem prazo)')
        || ' para '
        || coalesce(to_char(new.due_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'), '(sem prazo)'),
      jsonb_build_object('taskId', new.id, 'de', old.due_at, 'para', new.due_at),
      auth.uid());
  end if;

  -- Cancelamento MANUAL (a expiração automática seta app.suppress_cancel_event).
  if new.status = 'cancelada' and old.status is distinct from new.status
     and coalesce(current_setting('app.suppress_cancel_event', true), '') <> 'on' then
    perform log_company_event(new.company_id, 'tarefa_cancelada',
      'Tarefa “' || coalesce(new.title, '(sem título)') || '” cancelada',
      jsonb_build_object('taskId', new.id, 'de', old.status),
      auth.uid());
  end if;

  -- Reabertura (finalizada/cancelada -> a_fazer/iniciada).
  if old.status in ('finalizada', 'cancelada') and new.status in ('a_fazer', 'iniciada')
     and old.status is distinct from new.status then
    perform log_company_event(new.company_id, 'tarefa_reaberta',
      'Tarefa “' || coalesce(new.title, '(sem título)') || '” reaberta',
      jsonb_build_object('taskId', new.id, 'de', old.status, 'para', new.status),
      auth.uid());
  end if;

  -- Conclusão silenciosa (sem resumo) — igual à 0167 (a conclusão com resumo já
  -- entra via activity_log; o tempo total é enriquecido na RPC do feed).
  if new.status = 'finalizada' and old.status is distinct from new.status
     and new.completion_note is null then
    perform log_company_event(new.company_id, 'tarefa_concluida',
      'Tarefa “' || coalesce(new.title, '(sem título)') || '” concluída (sem resumo)',
      jsonb_build_object('taskId', new.id, 'seconds', new.total_seconds),
      auth.uid());
  end if;
  return null;
end;
$$;

-- 7d. Exclusão de OCORRÊNCIA avulsa (delete direto, não cascade do molde/empresa).
--     BEFORE DELETE. Emite só quando a empresa NÃO está sendo apagada e o molde
--     ainda existe (ou é null): no cascade do molde o template já sumiu -> pula
--     (o 'tarefa_excluida' já cobre), e no cascade da empresa company_exists é false.
create or replace function task_instances_delete_event_trg()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if company_exists(old.company_id)
     and (old.template_id is null
          or exists (select 1 from task_templates where id = old.template_id)) then
    perform log_company_event(old.company_id, 'ocorrencia_excluida',
      'Ocorrência “' || coalesce(old.title, '(sem título)') || '” ('
        || coalesce(to_char(old.task_date, 'DD/MM/YYYY'), 's/data') || ') excluída',
      jsonb_build_object('taskId', old.id, 'templateId', old.template_id,
                         'taskDate', old.task_date, 'status', old.status),
      auth.uid());
  end if;
  return old;
end;
$$;

create trigger trg_task_instances_del_event
  before delete on task_instances
  for each row execute function task_instances_delete_event_trg();

-- 7e. Expiração automática -> 'tarefa_expirada' (com o nome do responsável), a
--     partir de task_auto_expirations (ator = sistema). source p/ idempotência.
create or replace function task_auto_expirations_event_trg()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_company uuid;
  v_title   text;
  v_resp    text;
begin
  select ti.company_id, ti.title, display_name(ti.collaborator_id)
    into v_company, v_title, v_resp
  from task_instances ti where ti.id = new.task_id;

  perform log_company_event(v_company, 'tarefa_expirada',
    'Tarefa “' || coalesce(v_title, '(sem título)') || '” expirou automaticamente'
      || case when v_resp is not null then ' (responsável: ' || v_resp || ')' else '' end,
    jsonb_build_object('taskId', new.task_id, 'previousStatus', new.previous_status,
                       'respName', v_resp, 'runId', new.run_id),
    null, 'task_auto_expirations', new.id::text);
  return null;
end;
$$;

create trigger trg_task_auto_expirations_event
  after insert on task_auto_expirations
  for each row execute function task_auto_expirations_event_trg();

-- 7f. Recria expire_overdue_standard_tasks (versão 0137) setando
--     app.suppress_cancel_event antes do UPDATE: o 'tarefa_cancelada' por linha
--     NÃO dispara; quem registra é o 'tarefa_expirada' acima.
create or replace function public.expire_overdue_standard_tasks()
returns table(run_id uuid, cancelled integer, skipped_open_timer integer)
language plpgsql security definer set search_path = public
as $fn$
declare
  v_run_id uuid := gen_random_uuid();
  v_today  date := (now() at time zone 'America/Sao_Paulo')::date;
  v_cancelled integer := 0;
  v_skipped integer := 0;
begin
  if not dev_is_business_day(v_today) then
    run_id := v_run_id; cancelled := 0; skipped_open_timer := 0;
    return next; return;
  end if;

  select count(*) into v_skipped
    from task_instances ti
    join task_templates tt on tt.id = ti.template_id
   where tt.from_standard = true and tt.kind = 'diaria'
     and ti.status in ('a_fazer', 'iniciada')
     and next_business_day(ti.task_date) <= v_today
     and exists (select 1 from time_entries te where te.task_id = ti.id and te.ended_at is null);

  if v_skipped > 0 then
    raise notice 'expire_overdue_standard_tasks run %: % tarefa(s) puladas por timer aberto: %',
      v_run_id, v_skipped,
      (select array_agg(ti.id)
         from task_instances ti
         join task_templates tt on tt.id = ti.template_id
        where tt.from_standard = true and tt.kind = 'diaria'
          and ti.status in ('a_fazer', 'iniciada')
          and next_business_day(ti.task_date) <= v_today
          and exists (select 1 from time_entries te where te.task_id = ti.id and te.ended_at is null));
  end if;

  insert into task_auto_expirations (task_id, previous_status, run_id)
  select ti.id, ti.status, v_run_id
    from task_instances ti
    join task_templates tt on tt.id = ti.template_id
   where tt.from_standard = true and tt.kind = 'diaria'
     and ti.status in ('a_fazer', 'iniciada')
     and next_business_day(ti.task_date) <= v_today
     and not exists (select 1 from time_entries te where te.task_id = ti.id and te.ended_at is null);

  -- Não deixa o gatilho da instância emitir 'tarefa_cancelada' (é expiração).
  perform set_config('app.suppress_cancel_event', 'on', true);

  update task_instances
     set status = 'cancelada'
   where id in (select ae.task_id from task_auto_expirations ae where ae.run_id = v_run_id);
  get diagnostics v_cancelled = row_count;

  run_id := v_run_id; cancelled := v_cancelled; skipped_open_timer := v_skipped;
  return next;
end;
$fn$;

revoke all on function public.expire_overdue_standard_tasks() from public, anon, authenticated;

-- =====================================================================
-- 8. CONTATO / CADASTRO — companies (nome, contato Digisac, grupo de WhatsApp).
--    Gatilho separado do de grupo (0072). Só quando o campo muda de fato.
-- =====================================================================
create or replace function companies_contact_event_trg()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.name is distinct from old.name then
    perform log_company_event(new.id, 'empresa_renomeada',
      'Empresa renomeada de “' || coalesce(old.name, '?') || '” para “' || coalesce(new.name, '?') || '”',
      jsonb_build_object('de', old.name, 'para', new.name), auth.uid());
  end if;

  if new.whatsapp_contact_id is distinct from old.whatsapp_contact_id then
    perform log_company_event(new.id, 'contato_digisac_alterado',
      case
        when old.whatsapp_contact_id is null then 'Contato do Digisac vinculado'
        when new.whatsapp_contact_id is null then 'Contato do Digisac removido'
        else 'Contato do Digisac trocado'
      end,
      jsonb_build_object('de', old.whatsapp_contact_id, 'para', new.whatsapp_contact_id), auth.uid());
  end if;

  if new.whatsapp_group_name is distinct from old.whatsapp_group_name then
    perform log_company_event(new.id, 'grupo_whatsapp_alterado',
      'Grupo de WhatsApp alterado de “' || coalesce(old.whatsapp_group_name, '(vazio)')
        || '” para “' || coalesce(new.whatsapp_group_name, '(vazio)') || '”',
      jsonb_build_object('de', old.whatsapp_group_name, 'para', new.whatsapp_group_name), auth.uid());
  end if;
  return null;
end;
$$;

create trigger trg_companies_contact_event
  after update of name, whatsapp_contact_id, whatsapp_group_name on companies
  for each row execute function companies_contact_event_trg();

-- =====================================================================
-- 9. CONTRATO — valor do contrato (ADMIN), canais, pausa.
-- =====================================================================

-- 9a. valor_contrato_alterado (company_contract_values). Admin-only (visibilidade).
create or replace function company_contract_values_event_trg()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_old_pv numeric(14,2);
  v_new_pv numeric(14,2);
  v_old_in integer;
  v_new_in integer;
begin
  if tg_op = 'UPDATE' then
    if new.project_value is not distinct from old.project_value
       and new.installments is not distinct from old.installments then
      return null;
    end if;
    v_old_pv := old.project_value; v_old_in := old.installments;
  end if;
  v_new_pv := new.project_value; v_new_in := new.installments;

  perform log_company_event(new.company_id, 'valor_contrato_alterado',
    'Valor do contrato atualizado',
    jsonb_build_object(
      'projeto', jsonb_build_object('de', v_old_pv, 'para', v_new_pv),
      'parcelas', jsonb_build_object('de', v_old_in, 'para', v_new_in)),
    auth.uid());
  return null;
end;
$$;

create trigger trg_company_contract_values_event
  after insert or update on company_contract_values
  for each row execute function company_contract_values_event_trg();

-- 9b. canais_alterados (company_contracted_channels e company_sales_channels).
--     company_details_save faz DIFF real -> um evento por canal realmente
--     adicionado/removido.
create or replace function company_channels_event_trg()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_company uuid;
  v_channel text;
  v_action  text;
  v_kind    text;
begin
  if tg_op = 'INSERT' then
    v_company := new.company_id; v_channel := new.channel::text; v_action := 'added';
  else
    v_company := old.company_id; v_channel := old.channel::text; v_action := 'removed';
    if not company_exists(v_company) then
      return null;  -- cascade da empresa: não registra.
    end if;
  end if;
  v_kind := case tg_table_name when 'company_sales_channels' then 'venda' else 'contratado' end;

  perform log_company_event(v_company, 'canais_alterados',
    'Canal ' || v_channel || case when v_action = 'added' then ' adicionado' else ' removido' end
      || ' (' || v_kind || ')',
    jsonb_build_object('action', v_action, 'channel', v_channel, 'kind', v_kind),
    auth.uid());
  return null;
end;
$$;

create trigger trg_company_contracted_channels_event
  after insert or delete on company_contracted_channels
  for each row execute function company_channels_event_trg();

create trigger trg_company_sales_channels_event
  after insert or delete on company_sales_channels
  for each row execute function company_channels_event_trg();

-- 9c. pausa_iniciada / pausa_encerrada (company_pause_periods). Alcance.
create or replace function company_pause_periods_event_trg()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.started_on is not null then
      perform log_company_event(new.company_id, 'pausa_iniciada',
        'Pausa de contrato iniciada em ' || to_char(new.started_on, 'DD/MM/YYYY'),
        jsonb_build_object('pauseId', new.id, 'de', null, 'para', new.started_on, 'source', new.source),
        auth.uid());
    end if;
    return null;
  end if;

  -- UPDATE: início preenchido (pendente -> iniciada) ou fim preenchido (encerrada).
  if new.started_on is not null and old.started_on is null then
    perform log_company_event(new.company_id, 'pausa_iniciada',
      'Pausa de contrato iniciada em ' || to_char(new.started_on, 'DD/MM/YYYY'),
      jsonb_build_object('pauseId', new.id, 'de', null, 'para', new.started_on, 'source', new.source),
      auth.uid());
  end if;
  if new.ended_on is not null and old.ended_on is null then
    perform log_company_event(new.company_id, 'pausa_encerrada',
      'Pausa de contrato encerrada em ' || to_char(new.ended_on, 'DD/MM/YYYY'),
      jsonb_build_object('pauseId', new.id, 'de', old.ended_on, 'para', new.ended_on, 'source', new.source),
      auth.uid());
  end if;
  return null;
end;
$$;

create trigger trg_company_pause_periods_event
  after insert or update on company_pause_periods
  for each row execute function company_pause_periods_event_trg();

-- =====================================================================
-- 10. SUCESSO DO CLIENTE — churn (admin). O MOTIVO (churn_reason) NUNCA entra
--     no evento (invariante 0120); churn_editado marca 'motivoAlterado' sem valor.
-- =====================================================================
create or replace function company_churns_event_trg()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_changes jsonb := '{}'::jsonb;
begin
  if not company_exists(coalesce(new.company_id, old.company_id)) then
    return null;
  end if;

  if tg_op = 'INSERT' then
    perform log_company_event(new.company_id, 'churn_registrado',
      'Churn registrado: ' || case new.churn_type when 'finalizado' then 'finalizado' else 'cancelado' end
        || case when new.churned_on is not null then ' em ' || to_char(new.churned_on, 'DD/MM/YYYY') else '' end,
      jsonb_build_object('churnId', new.id, 'churnType', new.churn_type,
                         'churnedOn', new.churned_on, 'mrr', new.mrr),
      auth.uid());
    return null;
  end if;

  -- UPDATE: reversão ou edição de data/vendedor/MRR/motivo (sem o valor do motivo).
  if old.reverted_at is null and new.reverted_at is not null then
    perform log_company_event(new.company_id, 'churn_editado',
      'Churn revertido',
      jsonb_build_object('churnId', new.id, 'revertido', true),
      auth.uid());
    return null;
  end if;

  if new.churned_on is distinct from old.churned_on then
    v_changes := v_changes || jsonb_build_object('data', jsonb_build_object('de', old.churned_on, 'para', new.churned_on));
  end if;
  if new.seller_name is distinct from old.seller_name then
    v_changes := v_changes || jsonb_build_object('vendedor', jsonb_build_object('de', old.seller_name, 'para', new.seller_name));
  end if;
  if new.mrr is distinct from old.mrr then
    v_changes := v_changes || jsonb_build_object('mrr', jsonb_build_object('de', old.mrr, 'para', new.mrr));
  end if;
  if new.reason is distinct from old.reason then
    v_changes := v_changes || jsonb_build_object('motivoAlterado', true);
  end if;

  if v_changes <> '{}'::jsonb then
    perform log_company_event(new.company_id, 'churn_editado',
      'Churn editado',
      jsonb_build_object('churnId', new.id, 'changes', v_changes),
      auth.uid());
  end if;
  return null;
end;
$$;

create trigger trg_company_churns_event
  after insert or update on company_churns
  for each row execute function company_churns_event_trg();

-- =====================================================================
-- 11. ANOTAÇÕES — anotacao_editada / anotacao_excluida (company_notes). NUNCA o
--     texto; guarda só as ÁREAS (p/ a visibilidade do cargo-de-quadro na RLS).
-- =====================================================================
create or replace function company_notes_event_trg()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_areas jsonb;
begin
  if tg_op = 'UPDATE' then
    -- Toggle de caixa de checklist na LEITURA (0101) grava content_html com a GUC
    -- app.task_checkbox='1' e NÃO é edição — não vira evento.
    if coalesce(current_setting('app.task_checkbox', true), '') = '1' then
      return null;
    end if;
    if new.content_html is not distinct from old.content_html
       and new.visible_to_client is not distinct from old.visible_to_client then
      return null;  -- só carimbo de updated_*; nada relevante.
    end if;
    select coalesce(jsonb_agg(area::text), '[]'::jsonb) into v_areas
      from company_note_areas where note_id = new.id;
    perform log_company_event(new.company_id, 'anotacao_editada',
      'Anotação editada',
      jsonb_build_object('noteId', new.id, 'areas', coalesce(v_areas, '[]'::jsonb)),
      auth.uid());
    return null;
  end if;

  -- DELETE (BEFORE): as áreas ainda existem; pula cascade da empresa.
  if not company_exists(old.company_id) then
    return old;
  end if;
  select coalesce(jsonb_agg(area::text), '[]'::jsonb) into v_areas
    from company_note_areas where note_id = old.id;
  perform log_company_event(old.company_id, 'anotacao_excluida',
    'Anotação excluída',
    jsonb_build_object('noteId', old.id, 'areas', coalesce(v_areas, '[]'::jsonb)),
    auth.uid());
  return old;
end;
$$;

create trigger trg_company_notes_update_event
  after update on company_notes
  for each row execute function company_notes_event_trg();

create trigger trg_company_notes_delete_event
  before delete on company_notes
  for each row execute function company_notes_event_trg();

-- =====================================================================
-- 12. ESPELHOS DE AUDITORIA (go-forward). source/source_id p/ idempotência com
--     o backfill. Faturamento NÃO entra aqui (company_revenues já emite evento);
--     portal NÃO entra (já é sintetizado no feed a partir de client_portal_audit).
-- =====================================================================

-- 12a. tempo_ajustado (time_adjustments -> via task_instances). Alcance.
create or replace function time_adjustments_event_trg()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_company uuid;
  v_title   text;
begin
  select ti.company_id, ti.title into v_company, v_title
    from task_instances ti where ti.id = new.task_id;

  perform log_company_event(v_company, 'tempo_ajustado',
    'Tempo da tarefa “' || coalesce(v_title, '(sem título)') || '” ajustado de '
      || coalesce(new.old_seconds, 0) || 's para ' || coalesce(new.new_seconds, 0) || 's'
      || case when nullif(btrim(coalesce(new.reason, '')), '') is not null
              then ' — ' || new.reason else '' end,
    jsonb_build_object('taskId', new.task_id,
                       'de', new.old_seconds, 'para', new.new_seconds, 'motivo', new.reason),
    new.adjusted_by, 'time_adjustments', new.id::text);
  return null;
end;
$$;

create trigger trg_time_adjustments_event
  after insert on time_adjustments
  for each row execute function time_adjustments_event_trg();

-- 12b. cs_alterado (cs_audit) — SÓ os campos de CS puro (NPS/datas). Os campos
--      pausa_contrato/churn/valor_projeto/parcelas têm eventos dedicados -> fora.
--      Admin-only (visibilidade).
create or replace function cs_audit_event_trg()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_label text;
begin
  if new.field not in ('nps_geral', 'nps_pessoa', 'data_reuniao', 'data_entrada', 'data_fim') then
    return null;  -- pausa/churn/valor têm evento próprio.
  end if;
  if not company_exists(new.company_id) then
    return null;
  end if;

  v_label := case new.field
    when 'nps_geral'    then 'NPS geral'
    when 'nps_pessoa'   then 'NPS por pessoa'
    when 'data_reuniao' then 'Data da reunião'
    when 'data_entrada' then 'Data de entrada'
    when 'data_fim'     then 'Data de fim'
    else new.field end;

  perform log_company_event(new.company_id, 'cs_alterado',
    'Sucesso do Cliente — ' || v_label || ': '
      || coalesce(new.old_value, '(vazio)') || ' → ' || coalesce(new.new_value, '(vazio)'),
    jsonb_build_object('field', new.field, 'de', new.old_value, 'para', new.new_value,
                       'subjectUserId', new.subject_user_id),
    new.changed_by, 'cs_audit', new.id::text);
  return null;
end;
$$;

create trigger trg_cs_audit_event
  after insert on cs_audit
  for each row execute function cs_audit_event_trg();

-- 12c. trafego_alterado (traffic_audit). Visibilidade 'trafego'.
create or replace function traffic_audit_event_trg()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_label text;
begin
  if not company_exists(new.company_id) then
    return null;
  end if;
  v_label := case new.field
    when 'grupo_manual' then 'grupo'
    when 'foco'         then 'foco'
    when 'plataforma'   then 'plataforma'
    when 'status'       then 'status'
    when 'orcamento'    then 'orçamento'
    else new.field end;

  perform log_company_event(new.company_id, 'trafego_alterado',
    'Tráfego — ' || v_label || ': '
      || coalesce(new.old_value, '(vazio)') || ' → ' || coalesce(new.new_value, '(vazio)'),
    jsonb_build_object('field', new.field, 'de', new.old_value, 'para', new.new_value),
    new.changed_by, 'traffic_audit', new.id::text);
  return null;
end;
$$;

create trigger trg_traffic_audit_event
  after insert on traffic_audit
  for each row execute function traffic_audit_event_trg();

-- 12d. dev_alterado (dev_audit). Visibilidade 'dev'.
create or replace function dev_audit_event_trg()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_label text;
begin
  if not company_exists(new.company_id) then
    return null;
  end if;
  v_label := case new.field
    when 'grupo'        then 'grupo'
    when 'status'       then 'status'
    when 'prazo'        then 'prazo'
    when 'pausa_manual' then 'pausa'
    else new.field end;

  perform log_company_event(new.company_id, 'dev_alterado',
    'Desenvolvimento — ' || v_label || ': '
      || coalesce(new.old_value, '(vazio)') || ' → ' || coalesce(new.new_value, '(vazio)'),
    jsonb_build_object('field', new.field, 'de', new.old_value, 'para', new.new_value),
    new.changed_by, 'dev_audit', new.id::text);
  return null;
end;
$$;

create trigger trg_dev_audit_event
  after insert on dev_audit
  for each row execute function dev_audit_event_trg();

-- 12e. timer_reuniao_editado (meeting_timer_audit -> via meeting_timers). Alcance.
-- meeting_timer_audit (0155): company_id DIRETO; event_type 'edit'|'auto_close';
-- old_seconds/new_seconds (duração do trecho); justification; edited_by/edited_at.
create or replace function meeting_timer_audit_event_trg()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_verb text;
begin
  if not company_exists(new.company_id) then
    return null;
  end if;
  v_verb := case new.event_type
    when 'auto_close' then 'Timer de reunião fechado automaticamente'
    else 'Timer de reunião editado' end;

  perform log_company_event(new.company_id, 'timer_reuniao_editado',
    v_verb || ': de ' || coalesce(new.old_seconds, 0) || 's para ' || coalesce(new.new_seconds, 0) || 's'
      || case when nullif(btrim(coalesce(new.justification, '')), '') is not null then ' — ' || new.justification else '' end,
    jsonb_build_object('timerId', new.timer_id, 'eventType', new.event_type,
                       'de', new.old_seconds, 'para', new.new_seconds, 'justificativa', new.justification),
    new.edited_by, 'meeting_timer_audit', new.id::text);
  return null;
end;
$$;

create trigger trg_meeting_timer_audit_event
  after insert on meeting_timer_audit
  for each row execute function meeting_timer_audit_event_trg();

-- =====================================================================
-- 13. RESPONSÁVEIS — consultor/colaborador: evento único *_trocado na troca.
--     Recria os gatilhos por linha (0079/0162) com supressão app.suppress_resp_link_event.
-- =====================================================================
create or replace function company_consultants_event_trg()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_name text;
begin
  if coalesce(current_setting('app.suppress_resp_link_event', true), '') = 'on' then
    return null;
  end if;
  if tg_op = 'INSERT' then
    v_name := display_name(new.consultant_id);
    perform log_company_event(new.company_id, 'consultor_adicionado',
      'Consultor ' || coalesce(v_name, '(desconhecido)') || ' adicionado',
      jsonb_build_object('consultantId', new.consultant_id), auth.uid());
  else
    if not company_exists(old.company_id) then
      return null;
    end if;
    v_name := display_name(old.consultant_id);
    perform log_company_event(old.company_id, 'consultor_removido',
      'Consultor ' || coalesce(v_name, '(desconhecido)') || ' removido',
      jsonb_build_object('consultantId', old.consultant_id), auth.uid());
  end if;
  return null;
end;
$$;

create or replace function company_collaborators_event_trg()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_name text;
begin
  if coalesce(current_setting('app.suppress_resp_link_event', true), '') = 'on' then
    return null;
  end if;
  if tg_op = 'INSERT' then
    v_name := display_name(new.collaborator_id);
    perform log_company_event(new.company_id, 'colaborador_adicionado',
      'Colaborador ' || coalesce(v_name, '(desconhecido)') || ' adicionado',
      jsonb_build_object('collaboratorId', new.collaborator_id), auth.uid());
  else
    if not company_exists(old.company_id) then
      return null;
    end if;
    v_name := display_name(old.collaborator_id);
    perform log_company_event(old.company_id, 'colaborador_removido',
      'Colaborador ' || coalesce(v_name, '(desconhecido)') || ' removido',
      jsonb_build_object('collaboratorId', old.collaborator_id), auth.uid());
  end if;
  return null;
end;
$$;

-- 13a. reassign_company_collaborator_tasks — mesmo corpo da 0167, mas o
--      evento-resumo passa a ter o TIPO 'tarefas_repassadas' (categoria Responsáveis).
create or replace function reassign_company_collaborator_tasks(
  p_company uuid, p_from uuid, p_to uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_blocker text;
  v_tmpl    integer := 0;
  v_inst    integer := 0;
begin
  if not is_admin() then
    raise exception 'not authorized';
  end if;
  if p_from is null or p_to is null or p_from = p_to then
    raise exception 'destino inválido';
  end if;
  if not exists (select 1 from profiles where id = p_to) then
    raise exception 'destino inválido';
  end if;

  select coalesce(pr.full_name, pr.email) into v_blocker
  from time_entries te
  join task_instances ti on ti.id = te.task_id
  join profiles pr on pr.id = te.collaborator_id
  where ti.company_id = p_company and ti.collaborator_id = p_from
    and ti.status in ('a_fazer', 'iniciada') and te.ended_at is null
  limit 1;
  if v_blocker is not null then
    raise exception 'TIMER_RODANDO:%', v_blocker;
  end if;

  perform set_config('app.suppress_resp_event', 'on', true);

  update task_templates set collaborator_id = p_to
   where company_id = p_company and collaborator_id = p_from;
  get diagnostics v_tmpl = row_count;

  update task_instances set collaborator_id = p_to
   where company_id = p_company and collaborator_id = p_from
     and status in ('a_fazer', 'iniciada');
  get diagnostics v_inst = row_count;

  perform log_company_event(p_company, 'tarefas_repassadas',
    v_inst || ' tarefa' || case when v_inst = 1 then '' else 's' end || ' em aberto repassada'
      || case when v_inst = 1 then '' else 's' end || ' de '
      || coalesce(display_name(p_from), '(desconhecido)') || ' para '
      || coalesce(display_name(p_to), '(desconhecido)'),
    jsonb_build_object('de', p_from, 'para', p_to,
                       'deName', display_name(p_from), 'paraName', display_name(p_to),
                       'modelos', v_tmpl, 'ocorrencias', v_inst, 'reason', 'saida_responsavel'),
    auth.uid());

  return jsonb_build_object('templates', v_tmpl, 'instances', v_inst);
end;
$$;

-- 13b. RPCs de set — diff no banco; swap (sai um/entra outro) vira UM *_trocado.
create or replace function set_company_consultants(p_company uuid, p_ids uuid[])
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_remove uuid[];
  v_add    uuid[];
  v_desired uuid[] := coalesce(p_ids, '{}'::uuid[]);
begin
  if not is_admin() then
    raise exception 'not authorized';
  end if;

  select coalesce(array_agg(consultant_id), '{}'::uuid[]) into v_remove
    from company_consultants
   where company_id = p_company and consultant_id <> all (v_desired);

  select coalesce(array_agg(x), '{}'::uuid[]) into v_add
    from unnest(v_desired) x
   where x not in (select consultant_id from company_consultants where company_id = p_company);

  if array_length(v_remove, 1) is null and array_length(v_add, 1) is null then
    return;
  end if;

  -- Troca na mesma ação (saiu e entrou) -> um evento; senão, gatilho por linha.
  if array_length(v_remove, 1) is not null and array_length(v_add, 1) is not null then
    perform set_config('app.suppress_resp_link_event', 'on', true);
  end if;

  delete from company_consultants where company_id = p_company and consultant_id = any (v_remove);
  insert into company_consultants (company_id, consultant_id)
    select p_company, x from unnest(v_add) x
    on conflict do nothing;

  if array_length(v_remove, 1) is not null and array_length(v_add, 1) is not null then
    perform log_company_event(p_company, 'consultor_trocado',
      'Consultor trocado: ' || array_to_string(array(select coalesce(display_name(x), '(desconhecido)') from unnest(v_remove) x), ', ')
        || ' → ' || array_to_string(array(select coalesce(display_name(x), '(desconhecido)') from unnest(v_add) x), ', '),
      jsonb_build_object(
        'de', array(select coalesce(display_name(x), '(desconhecido)') from unnest(v_remove) x),
        'para', array(select coalesce(display_name(x), '(desconhecido)') from unnest(v_add) x),
        'deIds', v_remove, 'paraIds', v_add),
      auth.uid());
  end if;
end;
$$;

create or replace function set_company_collaborators_apply(
  p_company uuid, p_remove uuid[], p_add uuid[]
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_remove uuid[] := coalesce(p_remove, '{}'::uuid[]);
  v_add    uuid[] := coalesce(p_add, '{}'::uuid[]);
begin
  if not is_admin() then
    raise exception 'not authorized';
  end if;
  if array_length(v_remove, 1) is null and array_length(v_add, 1) is null then
    return;
  end if;

  if array_length(v_remove, 1) is not null and array_length(v_add, 1) is not null then
    perform set_config('app.suppress_resp_link_event', 'on', true);
  end if;

  delete from company_collaborators where company_id = p_company and collaborator_id = any (v_remove);
  insert into company_collaborators (company_id, collaborator_id)
    select p_company, x from unnest(v_add) x
    on conflict do nothing;

  if array_length(v_remove, 1) is not null and array_length(v_add, 1) is not null then
    perform log_company_event(p_company, 'colaborador_trocado',
      'Colaborador trocado: ' || array_to_string(array(select coalesce(display_name(x), '(desconhecido)') from unnest(v_remove) x), ', ')
        || ' → ' || array_to_string(array(select coalesce(display_name(x), '(desconhecido)') from unnest(v_add) x), ', '),
      jsonb_build_object(
        'de', array(select coalesce(display_name(x), '(desconhecido)') from unnest(v_remove) x),
        'para', array(select coalesce(display_name(x), '(desconhecido)') from unnest(v_add) x),
        'deIds', v_remove, 'paraIds', v_add),
      auth.uid());
  end if;
end;
$$;

revoke all on function set_company_consultants(uuid, uuid[]) from public, anon;
grant  execute on function set_company_consultants(uuid, uuid[]) to authenticated;
revoke all on function set_company_collaborators_apply(uuid, uuid[], uuid[]) from public, anon;
grant  execute on function set_company_collaborators_apply(uuid, uuid[], uuid[]) to authenticated;

-- =====================================================================
-- 14. LINHA DO TEMPO DE RESPONSÁVEIS — tabela própria, mantida pelos vínculos.
-- =====================================================================
create table if not exists public.company_responsible_periods (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id  uuid not null,              -- sem FK: histórico não some com o perfil
  role       text not null check (role in ('consultor', 'colaborador')),
  start_date date not null,
  end_date   date,                       -- null = período atual
  source     text not null check (source in ('registrado', 'reconstruido')),
  created_at timestamptz not null default now()
);

create index if not exists crp_company_idx on public.company_responsible_periods (company_id, role, start_date);
-- No máximo UM período aberto por (empresa, pessoa, papel).
create unique index if not exists crp_one_open
  on public.company_responsible_periods (company_id, person_id, role)
  where end_date is null;

alter table public.company_responsible_periods enable row level security;

-- Leitura: quem já alcança a empresa (mesmo critério do histórico). Escrita só
-- por trigger/RPC (SECURITY DEFINER); sem policy de insert/update/delete.
drop policy if exists crp_select on public.company_responsible_periods;
create policy crp_select on public.company_responsible_periods for select
  using (
    (select is_admin())
    or company_id in (select my_consultant_companies())
    or company_id in (select my_collaborator_companies())
  );

revoke all on public.company_responsible_periods from anon;

-- Manutenção go-forward: INSERT de vínculo abre período (start = assigned_at::date,
-- 'registrado'); DELETE fecha o aberto (end = hoje BRT). NÃO é suprimido pelo GUC
-- de eventos — a linha do tempo precisa seguir sempre.
create or replace function company_responsible_period_trg()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_role    text;
  v_company uuid;
  v_person  uuid;
  v_start   date;
begin
  if tg_table_name = 'company_consultants' then
    v_role := 'consultor';
    if tg_op = 'INSERT' then v_company := new.company_id; v_person := new.consultant_id; v_start := coalesce(new.assigned_at, now())::date;
    else                     v_company := old.company_id; v_person := old.consultant_id; end if;
  else
    v_role := 'colaborador';
    if tg_op = 'INSERT' then v_company := new.company_id; v_person := new.collaborator_id; v_start := coalesce(new.assigned_at, now())::date;
    else                     v_company := old.company_id; v_person := old.collaborator_id; end if;
  end if;

  if tg_op = 'INSERT' then
    insert into company_responsible_periods (company_id, person_id, role, start_date, source)
    values (v_company, v_person, v_role, v_start, 'registrado')
    on conflict (company_id, person_id, role) where end_date is null do nothing;
  else
    if company_exists(v_company) then
      update company_responsible_periods
         set end_date = (now() at time zone 'America/Sao_Paulo')::date
       where company_id = v_company and person_id = v_person and role = v_role and end_date is null;
    end if;
  end if;
  return null;
end;
$$;

create trigger trg_company_consultants_period
  after insert or delete on company_consultants
  for each row execute function company_responsible_period_trg();

create trigger trg_company_collaborators_period
  after insert or delete on company_collaborators
  for each row execute function company_responsible_period_trg();

-- RPC de leitura da linha do tempo (empresa). SECURITY INVOKER: a RLS acima
-- recorta. Nomes/avatars via display_profiles. Ordena por papel e início desc.
create or replace function company_responsible_timeline(p_company uuid)
returns jsonb
language sql stable security invoker
set search_path to 'public', 'extensions'
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', rp.id, 'personId', rp.person_id, 'role', rp.role,
      'name', coalesce(dp.name, '(desconhecido)'), 'avatar', dp.avatar_path,
      'startDate', rp.start_date, 'endDate', rp.end_date, 'source', rp.source
    ) order by rp.role, rp.start_date desc, rp.end_date desc nulls first),
    '[]'::jsonb)
  from company_responsible_periods rp
  left join lateral (select name, avatar_path from display_profiles(array[rp.person_id])) dp on true
  where rp.company_id = p_company;
$$;

grant execute on function company_responsible_timeline(uuid) to authenticated;

-- =====================================================================
-- 15. RPC do FEED — acrescenta filtro por CATEGORIA (p_categories), devolve a
--     'category' de cada item e ENRIQUECE a conclusão com o tempo total da tarefa
--     (sem segundo evento). Demais fontes/paginação/total idênticos à 0072.
-- =====================================================================
-- A 0072 criou company_activity_feed com 8 args; esta cria com 9 (p_categories).
-- São assinaturas diferentes -> o de 8 args ficaria pendurado como overload (o app
-- resolveria para ele e não veria a categoria). Derruba o antigo antes de criar.
drop function if exists company_activity_feed(uuid, int, int, text, text[], uuid, date, date);

create or replace function company_activity_feed(
  p_company    uuid,
  p_limit      int  default 20,
  p_offset     int  default 0,
  p_search     text default null,
  p_types      text[] default null,
  p_author     uuid default null,
  p_from       date default null,
  p_to         date default null,
  p_categories text[] default null
)
returns jsonb
language sql stable security invoker
set search_path to 'public', 'extensions'
as $function$
  with feed as (
    select
      al.id,
      'atividade'::text as type,
      al.created_at     as at,
      al.collaborator_id as author_id,
      left(btrim(split_part(al.message, E'\n', 1)), 140) as summary,
      al.message        as content,
      jsonb_build_object(
        'seconds',      al.seconds_spent,
        'sentWhatsapp', al.sent_whatsapp,
        'taskId',       al.task_id,
        'taskTotalSeconds', tti.total_seconds
      ) as meta
    from public.activity_log al
    left join public.task_instances tti on tti.id = al.task_id
    where al.company_id = p_company

    union all

    select
      ce.id, ce.event_type, ce.created_at, ce.actor_id,
      left(ce.summary, 140), ce.summary,
      coalesce(ce.details, '{}'::jsonb)
    from public.company_events ce
    where ce.company_id = p_company

    union all

    select
      cpa.id,
      case cpa.action
        when 'criado'           then 'acesso_cliente_criado'
        when 'senha_redefinida' then 'acesso_cliente_senha_redefinida'
        else 'acesso_cliente_' || cpa.action
      end,
      cpa.created_at, cpa.actor_id,
      case cpa.action
        when 'criado'           then 'Acesso do cliente criado'
        when 'senha_redefinida' then 'Senha do cliente redefinida'
        when 'link_girado'      then 'Link do cliente girado'
        else 'Acesso do cliente: ' || cpa.action
      end,
      case cpa.action
        when 'criado'           then 'Acesso do cliente criado'
        when 'senha_redefinida' then 'Senha do cliente redefinida'
        when 'link_girado'      then 'Link do cliente girado'
        else 'Acesso do cliente: ' || cpa.action
      end,
      jsonb_build_object('action', cpa.action)
    from public.client_portal_audit cpa
    where cpa.company_id = p_company
  ),
  filtered as (
    select f.*,
           public.activity_type_label(f.type)      as type_label,
           public.activity_type_category(f.type)   as category,
           public.activity_category_label(public.activity_type_category(f.type)) as category_label,
           coalesce(p.full_name, p.email)          as author_name,
           p.avatar_path
    from feed f
    left join public.profiles p on p.id = f.author_id
    where (p_types is null or array_length(p_types, 1) is null or f.type = any(p_types))
      and (p_categories is null or array_length(p_categories, 1) is null
           or public.activity_type_category(f.type) = any(p_categories))
      and (p_author is null or f.author_id = p_author)
      and (p_from is null or (f.at at time zone 'America/Sao_Paulo')::date >= p_from)
      and (p_to   is null or (f.at at time zone 'America/Sao_Paulo')::date <= p_to)
      and (p_search is null or btrim(p_search) = '' or f.content ilike '%' || p_search || '%')
  ),
  page as (
    select * from filtered
    order by at desc, id desc
    limit  greatest(0, least(coalesce(p_limit, 20), 100))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'items', coalesce(
      (select jsonb_agg(jsonb_build_object(
         'id', page.id, 'type', page.type, 'typeLabel', page.type_label,
         'category', page.category, 'categoryLabel', page.category_label,
         'at', page.at, 'authorId', page.author_id, 'authorName', page.author_name,
         'authorAvatar', page.avatar_path, 'summary', page.summary,
         'content', page.content, 'meta', page.meta
       ) order by page.at desc, page.id desc)
       from page),
      '[]'::jsonb)
  );
$function$;

grant execute on function company_activity_feed(uuid, int, int, text, text[], uuid, date, date, text[]) to authenticated;

-- Tipos presentes — agora com a categoria junto (para agrupar no filtro).
create or replace function company_activity_types(p_company uuid)
returns jsonb
language sql stable security invoker
set search_path to 'public', 'extensions'
as $function$
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'value', t.type,
      'label', public.activity_type_label(t.type),
      'category', public.activity_type_category(t.type),
      'categoryLabel', public.activity_category_label(public.activity_type_category(t.type))
    ) order by public.activity_category_label(public.activity_type_category(t.type)), public.activity_type_label(t.type)),
    '[]'::jsonb)
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

grant execute on function company_activity_types(uuid) to authenticated;

-- Categorias presentes nesta empresa (para o filtro por categoria).
create or replace function company_activity_categories(p_company uuid)
returns jsonb
language sql stable security invoker
set search_path to 'public', 'extensions'
as $function$
  select coalesce(
    jsonb_agg(jsonb_build_object('value', c.cat, 'label', public.activity_category_label(c.cat))
              order by public.activity_category_label(c.cat)),
    '[]'::jsonb)
  from (
    select distinct public.activity_type_category(type) as cat from (
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
  ) c;
$function$;

grant execute on function company_activity_categories(uuid) to authenticated;

-- =====================================================================
-- ROLLBACK da 0167 — volta ao estado pós-0154 (comportamento de 0004/0019/0072).
--   · sync_template_instances volta a propagar SÓ para 'a_fazer';
--   · gatilhos de task_templates / task_instances voltam à 0072 (sem o evento
--     dedicado 'tarefa_responsavel_alterada'; o responsável volta embutido no
--     'tarefa_recorrente_editada');
--   · activity_type_label volta sem a linha nova;
--   · remove as RPCs novas (timer-block e reatribuição em massa).
--
-- OBS.: a CORREÇÃO DE DADO (decisão 6) NÃO é desfeita — reverter reintroduziria
-- o bug (instância aberta com responsável divergente do modelo). É uma correção
-- de uma via.
-- =====================================================================

-- 1) sync_template_instances — versão 0019 (só 'a_fazer').
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
    and ti.status = 'a_fazer';

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

grant execute on function sync_template_instances(uuid) to authenticated;

-- 2) activity_type_label — versão 0072 (sem 'tarefa_responsavel_alterada').
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

grant execute on function activity_type_label(text) to authenticated, anon;

-- 3) task_templates_event_trg — versão 0072 (responsável embutido no editada).
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
    else
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
    return old;
  end if;

  if old.kind <> 'diaria' and new.kind <> 'diaria' then
    return null;
  end if;

  if old.active and not new.active then
    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (new.company_id, 'tarefa_recorrente_desativada',
            'Tarefa recorrente “' || coalesce(new.title, '(sem título)') || '” desativada',
            jsonb_build_object('templateId', new.id, 'collaboratorId', new.collaborator_id),
            auth.uid());
    return null;
  end if;

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
    return null;
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

-- 4) task_instances_event_trg — versão 0072 (só conclusão silenciosa).
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

-- 5) remove as RPCs novas.
drop function if exists reassign_company_collaborator_tasks(uuid, uuid, uuid);
drop function if exists template_timer_block(uuid);
drop function if exists instance_timer_block(uuid);

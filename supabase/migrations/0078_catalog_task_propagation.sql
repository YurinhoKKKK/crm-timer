-- ---------------------------------------------------------------------------
-- 0078 — Propagação do catálogo: desativar um molde pode PARAR as tarefas nas
--        empresas (e uma reativação SEPARADA e explícita pode retomá-las).
--
-- Contexto: um `standard_task` (molde do catálogo) gera N `task_templates` nas
-- empresas. Até aqui, desativar o molde só o tirava dos seletores — os templates
-- seguiam independentes e o cron continuava gerando as diárias. Passamos a oferecer
-- (na tela) uma segunda ação: propagar a desativação para as tarefas das empresas.
-- A propagação é sempre feita POR CRITÉRIO (standard_task_id), num único UPDATE;
-- o navegador nunca envia lista de ids.
--
-- Regras:
--  1. Desativar: para a geração futura (active=false). NADA é apagado — instâncias,
--     horas e relatos já existentes ficam intactos.
--  2. Reativar: nunca é automático. Entre os templates inativos há os desativados
--     INDIVIDUALMENTE (decisão daquela empresa) e os desativados pela PROPAGAÇÃO do
--     catálogo. Para distinguir, a coluna `active_source` registra a ORIGEM da
--     última mudança de `active`. A reativação em massa pode então reativar SOMENTE
--     os que a propagação desativou, preservando as decisões individuais.
--  3. Toda propagação (alto impacto) gera um evento no histórico de CADA empresa
--     afetada (company_events), dizendo desativada/reativada pelo catálogo e por quem.
-- ---------------------------------------------------------------------------

-- 1. ORIGEM da última mudança de active. Default 'individual': as tarefas que já
--    existem (inclusive as 23 desativadas manualmente) são tratadas como decisão
--    individual — a propagação nunca as reativa sem escolha explícita.
alter table task_templates
  add column active_source text not null default 'individual'
    check (active_source in ('individual', 'catalog'));

-- 2. Rótulos dos novos tipos de evento (o filtro/badge lê o rótulo do banco).
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
    when 'tarefa_desativada_catalogo'     then 'Tarefa desativada pelo catálogo'
    when 'tarefa_reativada_catalogo'      then 'Tarefa reativada pelo catálogo'
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

-- 3. Gatilho da vida da tarefa — agora com o ramo da PROPAGAÇÃO DO CATÁLOGO.
--    Quando `active` muda E a origem é 'catalog', o evento é próprio
--    (tarefa_desativada_catalogo / tarefa_reativada_catalogo), vale para pontual E
--    recorrente, e substitui os eventos genéricos de ação individual — assim o
--    histórico deixa claro que a origem foi o catálogo (e por quem, via auth.uid()).
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
  v_mold    text;
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

  -- PROPAGAÇÃO DO CATÁLOGO — antes do recorte "só recorrente" abaixo, porque a
  -- propagação vale para pontual E recorrente. Dispara só quando `active` muda de
  -- fato e a origem registrada é o catálogo.
  if (old.active is distinct from new.active) and new.active_source = 'catalog' then
    select title into v_mold from standard_tasks where id = new.standard_task_id;
    if new.active then
      insert into company_events (company_id, event_type, summary, details, actor_id)
      values (new.company_id, 'tarefa_reativada_catalogo',
              'Tarefa “' || coalesce(new.title, '(sem título)')
                || '” reativada pela propagação do catálogo'
                || case when v_mold is not null then ' (molde “' || v_mold || '”)' else '' end,
              jsonb_build_object('templateId', new.id, 'kind', new.kind,
                                 'standardTaskId', new.standard_task_id,
                                 'collaboratorId', new.collaborator_id),
              auth.uid());
    else
      insert into company_events (company_id, event_type, summary, details, actor_id)
      values (new.company_id, 'tarefa_desativada_catalogo',
              'Tarefa “' || coalesce(new.title, '(sem título)')
                || '” desativada pela propagação do catálogo'
                || case when v_mold is not null then ' (molde “' || v_mold || '”)' else '' end,
              jsonb_build_object('templateId', new.id, 'kind', new.kind,
                                 'standardTaskId', new.standard_task_id,
                                 'collaboratorId', new.collaborator_id),
              auth.uid());
    end if;
    return null;
  end if;

  -- UPDATE: daqui p/ baixo só interessa a tarefa RECORRENTE (a pontual não
  -- registra edição nem desativação individual).
  if old.kind <> 'diaria' and new.kind <> 'diaria' then
    return null;
  end if;

  -- Desativar uma recorrente (parar de gerar) individualmente é tão consequente
  -- quanto criar.
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

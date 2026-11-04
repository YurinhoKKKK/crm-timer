-- =====================================================================
-- CRM/Timer - Monvatti :: Troca de responsável de tarefa — propagação,
-- trava de timer, histórico e reatribuição em massa na saída do colaborador
-- =====================================================================
-- Problema de origem (caso 306 MERCADO GISELI): ao trocar o responsável de um
-- MODELO (task_templates), sync_template_instances só propagava para instâncias
-- 'a_fazer'. Uma instância 'iniciada' (que já tinha tempo trabalhado) ficava com
-- o responsável ANTIGO — o modelo dizia Nathália, a ocorrência seguia com o Marco.
--
-- DECISÕES (travadas) implementadas aqui:
--  1. sync_template_instances passa a propagar para 'a_fazer' E 'iniciada'
--     (mesmos campos). Finalizadas/canceladas nunca mudam.
--  2. TIMER RODANDO: se alguma instância afetada tiver trecho aberto
--     (time_entries.ended_at is null), a edição é RECUSADA. A validação é feita
--     no banco por RPC (template_timer_block / instance_timer_block) e a mensagem
--     aparece no editor. (O guard de recusa fica na server action; estas RPCs só
--     informam QUEM está com o timer aberto.)
--  3. O tempo já trabalhado continua com quem trabalhou: NÃO se altera
--     time_entries.collaborator_id em nenhum caminho abaixo.
--  4. Saída de colaborador da EMPRESA: reassign_company_collaborator_tasks()
--     reatribui modelos e instâncias ABERTAS (a_fazer/iniciada) daquela pessoa
--     naquela empresa, com a MESMA regra do timer rodando (raise).
--  5. HISTÓRICO: toda troca de responsável vira evento 'tarefa_responsavel_alterada'
--     em company_events (de -> para, quem fez, a tarefa). Antes a tarefa ÚNICA
--     não registrava nada; agora registra, igual à recorrente.
--  6. Correção de dado: as instâncias abertas cujo collaborator_id difere do
--     modelo passam a seguir o modelo (hoje só a 04c1a824… da 306), sem timer
--     aberto e sem tocar em time_entries.
--
-- GUC app.suppress_resp_event: os caminhos que EMITEM o próprio evento (sync,
-- reatribuição em massa, correção de dado) setam este flag LOCAL para que os
-- gatilhos de responsável NÃO disparem um evento por linha (evita enxurrada e
-- duplicidade). Edições diretas pelos editores NÃO setam o flag — aí o gatilho
-- registra o evento único.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Catálogo de rótulos — acrescenta 'tarefa_responsavel_alterada'.
--    (recriação idêntica à 0072 + a nova linha)
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
    when 'tarefa_responsavel_alterada'    then 'Responsável alterado'
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

-- ---------------------------------------------------------------------
-- 2. sync_template_instances — propaga para 'a_fazer' E 'iniciada'.
--    Suprime o evento de responsável por instância (o evento sai UMA vez,
--    no gatilho do MODELO, que é quem a edição realmente mexe).
-- ---------------------------------------------------------------------
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

  -- Mesma autorização da policy tt_manage: admin ou consultor da empresa.
  if not (is_admin() or tmpl.company_id in (select my_consultant_companies())) then
    raise exception 'not authorized';
  end if;

  -- Propagação não emite evento de responsável por instância.
  perform set_config('app.suppress_resp_event', 'on', true);

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

-- ---------------------------------------------------------------------
-- 3. Gatilho do MODELO (task_templates) — recria a função da 0072 com:
--    · evento DEDICADO 'tarefa_responsavel_alterada' na troca de responsável,
--      agora também para a tarefa ÚNICA (antes só a recorrente registrava, e
--      de forma embutida no 'tarefa_recorrente_editada');
--    · o 'tarefa_recorrente_editada' deixa de carregar 'responsavel' (foi para
--      o evento dedicado), evitando dois eventos para a mesma troca.
--    Resto idêntico à 0072 (INSERT/DELETE/desativação/demais campos).
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

  -- ===== UPDATE =====

  -- Troca de RESPONSÁVEL — vale para ÚNICA e RECORRENTE. Evento dedicado,
  -- de -> para, exceto quando um caminho em massa já emite o próprio evento.
  if new.collaborator_id is distinct from old.collaborator_id
     and coalesce(current_setting('app.suppress_resp_event', true), '') <> 'on' then
    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (new.company_id, 'tarefa_responsavel_alterada',
            'Responsável da tarefa “' || coalesce(new.title, '(sem título)')
              || '” alterado de ' || coalesce(display_name(old.collaborator_id), '(sem responsável)')
              || ' para ' || coalesce(display_name(new.collaborator_id), '(sem responsável)'),
            jsonb_build_object('templateId', new.id, 'kind', new.kind,
                               'from', old.collaborator_id, 'to', new.collaborator_id,
                               'fromName', display_name(old.collaborator_id),
                               'toName', display_name(new.collaborator_id)),
            auth.uid());
  end if;

  -- A partir daqui, só a tarefa RECORRENTE registra (a pontual já saiu acima).
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

  -- Edição recorrente: título, dia, hora-limite, reativação. O RESPONSÁVEL
  -- saiu deste evento (agora é o 'tarefa_responsavel_alterada' acima).
  if new.title is distinct from old.title then
    v_changes := v_changes || jsonb_build_object('titulo',
                   jsonb_build_object('de', old.title, 'para', new.title));
    v_parts := array_append(v_parts, 'título');
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
    return null;  -- nada relevante mudou (ou só o responsável, já registrado)
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

-- ---------------------------------------------------------------------
-- 4. Gatilho da INSTÂNCIA (task_instances) — recria a função da 0072 com um
--    bloco extra: troca de responsável DIRETA na instância (editor de tarefa
--    do consultor) também vira evento. Caminhos em massa (sync/reatribuição/
--    correção) setam o GUC e NÃO disparam aqui. Conclusão: igual à 0072.
-- ---------------------------------------------------------------------
create or replace function task_instances_event_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Troca de responsável feita direto na instância (editor de ocorrência).
  if new.collaborator_id is distinct from old.collaborator_id
     and coalesce(current_setting('app.suppress_resp_event', true), '') <> 'on' then
    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (new.company_id, 'tarefa_responsavel_alterada',
            'Responsável da tarefa “' || coalesce(new.title, '(sem título)')
              || '” alterado de ' || coalesce(display_name(old.collaborator_id), '(sem responsável)')
              || ' para ' || coalesce(display_name(new.collaborator_id), '(sem responsável)'),
            jsonb_build_object('taskId', new.id,
                               'from', old.collaborator_id, 'to', new.collaborator_id,
                               'fromName', display_name(old.collaborator_id),
                               'toName', display_name(new.collaborator_id)),
            auth.uid());
  end if;

  -- Conclusão silenciosa (sem resumo) — único evento de conclusão no nível da
  -- instância, igual à 0072 (a conclusão com resumo já entra via activity_log).
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

-- ---------------------------------------------------------------------
-- 5. RPCs de leitura do TIMER — devolvem o NOME de quem está com trecho aberto
--    (time_entries.ended_at is null) entre as instâncias afetadas; null = livre.
--    Usadas pelas server actions para RECUSAR a edição (decisão 2).
-- ---------------------------------------------------------------------
-- Pelo MODELO: considera as instâncias abertas do template (só 'iniciada' pode
-- ter trecho aberto, mas a_fazer entra na lista afetada por completude).
create or replace function template_timer_block(p_template uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(pr.full_name, pr.email)
  from time_entries te
  join task_instances ti on ti.id = te.task_id
  join profiles pr on pr.id = te.collaborator_id
  where ti.template_id = p_template
    and ti.status in ('a_fazer', 'iniciada')
    and te.ended_at is null
  limit 1;
$$;

-- Por uma INSTÂNCIA específica (editor de ocorrência).
create or replace function instance_timer_block(p_task uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(pr.full_name, pr.email)
  from time_entries te
  join profiles pr on pr.id = te.collaborator_id
  where te.task_id = p_task
    and te.ended_at is null
  limit 1;
$$;

-- ---------------------------------------------------------------------
-- 6. Reatribuição em massa na SAÍDA do colaborador da empresa (decisão 4).
--    Admin-only. Recusa se houver timer rodando em alguma tarefa aberta da
--    pessoa na empresa (raise 'TIMER_RODANDO:<nome>'). Reatribui MODELOS e
--    INSTÂNCIAS abertas (a_fazer/iniciada) de p_from -> p_to nessa empresa;
--    NÃO toca em time_entries. Emite UM evento-resumo.
-- ---------------------------------------------------------------------
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

  -- Timer rodando em tarefa ABERTA da pessoa nesta empresa?
  select coalesce(pr.full_name, pr.email) into v_blocker
  from time_entries te
  join task_instances ti on ti.id = te.task_id
  join profiles pr on pr.id = te.collaborator_id
  where ti.company_id = p_company
    and ti.collaborator_id = p_from
    and ti.status in ('a_fazer', 'iniciada')
    and te.ended_at is null
  limit 1;
  if v_blocker is not null then
    raise exception 'TIMER_RODANDO:%', v_blocker;
  end if;

  -- O evento-resumo sai UMA vez aqui; os gatilhos por linha ficam calados.
  perform set_config('app.suppress_resp_event', 'on', true);

  update task_templates
     set collaborator_id = p_to
   where company_id = p_company
     and collaborator_id = p_from;
  get diagnostics v_tmpl = row_count;

  update task_instances
     set collaborator_id = p_to
   where company_id = p_company
     and collaborator_id = p_from
     and status in ('a_fazer', 'iniciada');
  get diagnostics v_inst = row_count;

  insert into company_events (company_id, event_type, summary, details, actor_id)
  values (p_company, 'tarefa_responsavel_alterada',
          'Responsável alterado: ' || v_inst || ' tarefa'
            || case when v_inst = 1 then '' else 's' end || ' em aberto de '
            || coalesce(display_name(p_from), '(desconhecido)') || ' para '
            || coalesce(display_name(p_to), '(desconhecido)') || ' (saída de responsável)',
          jsonb_build_object('from', p_from, 'to', p_to,
                             'fromName', display_name(p_from), 'toName', display_name(p_to),
                             'templates', v_tmpl, 'instances', v_inst,
                             'reason', 'saida_responsavel'),
          auth.uid());

  return jsonb_build_object('templates', v_tmpl, 'instances', v_inst);
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Permissões — funções NOVAS/recriadas chamáveis: tira de public/anon e
--    concede a authenticated (convenção da 0146). As funções de GATILHO não
--    são chamáveis diretamente; o grant não se aplica a elas.
-- ---------------------------------------------------------------------
revoke execute on function sync_template_instances(uuid) from public, anon;
grant  execute on function sync_template_instances(uuid) to authenticated;

revoke execute on function template_timer_block(uuid) from public, anon;
grant  execute on function template_timer_block(uuid) to authenticated;

revoke execute on function instance_timer_block(uuid) from public, anon;
grant  execute on function instance_timer_block(uuid) to authenticated;

revoke execute on function reassign_company_collaborator_tasks(uuid, uuid, uuid) from public, anon;
grant  execute on function reassign_company_collaborator_tasks(uuid, uuid, uuid) to authenticated;

-- activity_type_label mantém o grant da 0072 (authenticated, anon).
grant execute on function activity_type_label(text) to authenticated, anon;

-- ---------------------------------------------------------------------
-- 8. CORREÇÃO DE DADO (decisão 6) — instâncias ABERTAS cujo responsável difere
--    do modelo passam a seguir o modelo. Guardas: só a_fazer/iniciada, só quando
--    difere, e só se NÃO houver trecho de timer aberto na instância (não mexe em
--    quem está cronometrando). NÃO toca time_entries. Correção silenciosa
--    (suprime o evento por linha). Conferido antes: hoje só a 04c1a824… da 306.
-- ---------------------------------------------------------------------
do $$
begin
  perform set_config('app.suppress_resp_event', 'on', true);

  update task_instances ti
     set collaborator_id = tt.collaborator_id
    from task_templates tt
   where ti.template_id = tt.id
     and ti.status in ('a_fazer', 'iniciada')
     and ti.collaborator_id is distinct from tt.collaborator_id
     and not exists (
       select 1 from time_entries te
        where te.task_id = ti.id and te.ended_at is null
     );
end $$;

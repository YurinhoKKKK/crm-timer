-- =====================================================================
-- CORREÇÃO — excluir empresa quebrava por FK em company_events
-- =====================================================================
-- Ao excluir uma empresa, o ON DELETE CASCADE remove as linhas filhas
-- (task_templates, company_consultants, company_labels, company_revenues,
-- meetings, ...). Esse cascade roda na fase AFTER da exclusão da empresa, ou
-- seja, a linha em `companies` JÁ SUMIU quando os gatilhos de auditoria dos
-- filhos disparam. Esses gatilhos tentam INSERIR em company_events apontando
-- para a empresa recém-removida, e a FK company_events_company_id_fkey recusa —
-- abortando a exclusão inteira:
--
--   insert or update on table "company_events" violates foreign key constraint
--   "company_events_company_id_fkey"
--
-- CORREÇÃO: nos ramos de DELETE que gravam evento, checar se a empresa AINDA
-- existe antes de inserir. Quando ela não existe (é a própria empresa sendo
-- excluída em cascata), sai sem gravar — não há empresa a que o evento pertença,
-- e o CASCADE já leva os eventos dela junto.
--
-- Isto NÃO enfraquece a FK (nada de SET NULL, nada de remover restrição) e NÃO
-- afeta o dia a dia: quando se exclui só uma tarefa / consultor / lançamento /
-- reunião de uma empresa VIVA, a empresa existe e o evento é gravado normalmente.
-- A checagem só muda de comportamento no cascade da exclusão da própria empresa.
-- =====================================================================

-- Helper: a empresa ainda existe? SECURITY DEFINER porque roda dentro de
-- gatilhos que já são definer; STABLE (uma leitura por statement basta).
create or replace function company_exists(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select exists (select 1 from companies where id = p_company) $$;

-- ---------------------------------------------------------------------
-- 1. TAREFAS (task_templates) — base: migration 0078. Só o ramo de DELETE
--    ganhou o guard; o resto é idêntico.
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
    -- GUARD: se a empresa já sumiu (exclusão da própria empresa em cascata), não
    -- há evento a gravar. RETURN OLD para NÃO cancelar o cascade da exclusão.
    if not company_exists(old.company_id) then
      return old;
    end if;

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

-- ---------------------------------------------------------------------
-- 2. CONSULTORES (company_consultants) — guard no ramo de DELETE.
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
    -- GUARD: empresa em exclusão (cascade) → não grava evento.
    if not company_exists(old.company_id) then
      return null;
    end if;
    v_name := display_name(old.consultant_id);
    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (old.company_id, 'consultor_removido',
            'Consultor ' || coalesce(v_name, '(desconhecido)') || ' removido',
            jsonb_build_object('consultantId', old.consultant_id), auth.uid());
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. ETIQUETAS (company_labels) — guard no ramo de DELETE.
-- ---------------------------------------------------------------------
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
    -- GUARD: empresa em exclusão (cascade) → não grava evento.
    if not company_exists(old.company_id) then
      return null;
    end if;
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

-- ---------------------------------------------------------------------
-- 4. FATURAMENTO (company_revenues) — guard no ramo de DELETE.
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
    -- GUARD: empresa em exclusão (cascade) → não grava evento.
    if not company_exists(old.company_id) then
      return null;
    end if;
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

-- ---------------------------------------------------------------------
-- 5. REUNIÕES (meetings) — guard no ramo de DELETE.
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
    -- GUARD: empresa em exclusão (cascade) → não grava evento.
    if not company_exists(old.company_id) then return null; end if;
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

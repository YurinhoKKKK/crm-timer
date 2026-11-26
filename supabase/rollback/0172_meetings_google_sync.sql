-- =====================================================================
-- ROLLBACK da 0172 — volta ao estado pós-0171 (sem o caminho Google→CRM).
--   · remove as RPCs novas (apply/enqueue/list/apply/dismiss/finalize + núcleo);
--   · gatilho de reuniões volta à 0072 (só INSERT/DELETE, sem origem/editada);
--   · activity_type_label/category voltam à 0168 (sem 'reuniao_editada');
--   · dropa a fila de revisão e as colunas novas.
--
-- OBS.: dados já APLICADOS (meetings que o Google atualizou/cancelou via a fila)
-- NÃO são revertidos — reverter reintroduziria a cópia velha. É uma correção de
-- uma via; a reversão só desliga o mecanismo.
-- =====================================================================

drop function if exists meeting_reconcile_finalize(uuid);
drop function if exists meeting_reconcile_dismiss(uuid);
drop function if exists meeting_reconcile_apply(uuid);
drop function if exists meeting_reconcile_list();
drop function if exists meeting_reconcile_enqueue(jsonb);
drop function if exists meetings_apply_google_sync(jsonb);
drop function if exists _apply_meeting_google_change(uuid, text, timestamptz, timestamptz, text, boolean);

-- Gatilho de reuniões — versão 0072 (só criar/cancelar).
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

drop trigger if exists trg_meetings_event on meetings;
create trigger trg_meetings_event
  after insert or delete on meetings
  for each row execute function meetings_event_trg();

-- Catálogos — versão 0168 (sem 'reuniao_editada').
create or replace function activity_type_label(p_type text)
returns text language sql immutable set search_path = public as $$
  select case p_type
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
    when 'tarefa_responsavel_alterada'    then 'Responsável alterado'
    when 'tarefas_repassadas'             then 'Tarefas repassadas'
    when 'consultor_adicionado'           then 'Consultor adicionado'
    when 'consultor_removido'             then 'Consultor removido'
    when 'consultor_trocado'              then 'Consultor trocado'
    when 'colaborador_adicionado'         then 'Colaborador adicionado'
    when 'colaborador_removido'           then 'Colaborador removido'
    when 'colaborador_trocado'            then 'Colaborador trocado'
    when 'tempo_ajustado'                 then 'Tempo ajustado'
    when 'informacoes_alteradas'          then 'Informações alteradas'
    when 'faturamento_lancado'            then 'Faturamento lançado'
    when 'faturamento_corrigido'          then 'Faturamento corrigido'
    when 'valor_contrato_alterado'        then 'Valor do contrato alterado'
    when 'canais_alterados'               then 'Canais alterados'
    when 'pausa_iniciada'                 then 'Pausa iniciada'
    when 'pausa_encerrada'                then 'Pausa encerrada'
    when 'cs_alterado'                    then 'Sucesso do Cliente alterado'
    when 'churn_registrado'               then 'Churn registrado'
    when 'churn_editado'                  then 'Churn editado'
    when 'empresa_renomeada'              then 'Empresa renomeada'
    when 'contato_digisac_alterado'       then 'Contato do Digisac alterado'
    when 'grupo_whatsapp_alterado'        then 'Grupo de WhatsApp alterado'
    when 'grupo_alterado'                 then 'Grupo alterado'
    when 'etiqueta_alterada'              then 'Etiqueta alterada'
    when 'empresa_criada_crm'             then 'Empresa criada (CRM)'
    when 'trafego_alterado'               then 'Tráfego alterado'
    when 'dev_alterado'                   then 'Desenvolvimento alterado'
    when 'reuniao_criada'                 then 'Reunião criada'
    when 'reuniao_cancelada'              then 'Reunião cancelada'
    when 'timer_reuniao_editado'          then 'Timer de reunião editado'
    when 'acesso_cliente_criado'          then 'Acesso do cliente criado'
    when 'acesso_cliente_senha_redefinida' then 'Senha do cliente redefinida'
    when 'acesso_cliente_link_girado'     then 'Link do cliente girado'
    when 'acesso_cliente_revogado'        then 'Acesso do cliente revogado'
    when 'anotacao_editada'               then 'Anotação editada'
    when 'anotacao_excluida'              then 'Anotação excluída'
    when 'listagem_validada'              then 'Listagem validada'
    else p_type
  end;
$$;
grant execute on function activity_type_label(text) to authenticated, anon;

create or replace function activity_type_category(p_type text)
returns text language sql immutable set search_path = public as $$
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

drop table if exists meeting_google_reconciliation;

alter table google_calendar_import_state
  drop column if exists auto_apply_from,
  drop column if exists last_reconcile_scan_at;

alter table meetings drop column if exists google_removed_at;

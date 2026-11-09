-- =====================================================================
-- ROLLBACK 0168_activity_history_expansion
-- =====================================================================
-- Desfaz a 0168: derruba os gatilhos/funções/tabela NOVOS, restaura as funções
-- RECRIADAS aos corpos anteriores (0167/0137/0072/0079/0162), devolve ce_select
-- ao critério por alcance, e remove as colunas/índice de origem. Opcional ao fim:
-- apaga os eventos gerados pela 0168 (por source do espelho de auditoria e pelos
-- tipos novos). Executar como dono (postgres).
-- =====================================================================

-- 1) Gatilhos NOVOS -----------------------------------------------------
drop trigger if exists trg_task_instances_del_event on task_instances;
drop trigger if exists trg_task_auto_expirations_event on task_auto_expirations;
drop trigger if exists trg_companies_contact_event on companies;
drop trigger if exists trg_company_contract_values_event on company_contract_values;
drop trigger if exists trg_company_contracted_channels_event on company_contracted_channels;
drop trigger if exists trg_company_sales_channels_event on company_sales_channels;
drop trigger if exists trg_company_pause_periods_event on company_pause_periods;
drop trigger if exists trg_company_churns_event on company_churns;
drop trigger if exists trg_company_notes_update_event on company_notes;
drop trigger if exists trg_company_notes_delete_event on company_notes;
drop trigger if exists trg_time_adjustments_event on time_adjustments;
drop trigger if exists trg_cs_audit_event on cs_audit;
drop trigger if exists trg_traffic_audit_event on traffic_audit;
drop trigger if exists trg_dev_audit_event on dev_audit;
drop trigger if exists trg_meeting_timer_audit_event on meeting_timer_audit;
drop trigger if exists trg_company_consultants_period on company_consultants;
drop trigger if exists trg_company_collaborators_period on company_collaborators;

-- 2) Funções NOVAS ------------------------------------------------------
drop function if exists task_instances_delete_event_trg();
drop function if exists task_auto_expirations_event_trg();
drop function if exists companies_contact_event_trg();
drop function if exists company_contract_values_event_trg();
drop function if exists company_channels_event_trg();
drop function if exists company_pause_periods_event_trg();
drop function if exists company_churns_event_trg();
drop function if exists company_notes_event_trg();
drop function if exists time_adjustments_event_trg();
drop function if exists cs_audit_event_trg();
drop function if exists traffic_audit_event_trg();
drop function if exists dev_audit_event_trg();
drop function if exists meeting_timer_audit_event_trg();
drop function if exists company_responsible_period_trg();
drop function if exists company_responsible_timeline(uuid);
drop function if exists company_activity_categories(uuid);
drop function if exists set_company_consultants(uuid, uuid[]);
drop function if exists set_company_collaborators_apply(uuid, uuid[], uuid[]);
drop function if exists activity_type_category(text);
drop function if exists activity_category_label(text);
drop function if exists activity_event_visibility(text);

-- 3) Tabela NOVA + RLS --------------------------------------------------
drop table if exists public.company_responsible_periods;

-- 4) ce_select -> critério por ALCANCE (0072/0134) ----------------------
drop policy if exists ce_select on public.company_events;
create policy ce_select on public.company_events for select using (
  (select is_admin())
  or company_id in (select my_consultant_companies())
  or company_id in (select my_collaborator_companies())
);

-- 5) company_activity_feed -> versão 8-arg (0072); remove a 9-arg -------
drop function if exists public.company_activity_feed(uuid, int, int, text, text[], uuid, date, date, text[]);
create or replace function company_activity_feed(
  p_company uuid, p_limit int default 20, p_offset int default 0, p_search text default null,
  p_types text[] default null, p_author uuid default null, p_from date default null, p_to date default null
) returns jsonb language sql stable security invoker set search_path to 'public', 'extensions' as $function$
  with feed as (
    select al.id, 'atividade'::text as type, al.created_at as at, al.collaborator_id as author_id,
      left(btrim(split_part(al.message, E'\n', 1)), 140) as summary, al.message as content,
      jsonb_build_object('seconds', al.seconds_spent, 'sentWhatsapp', al.sent_whatsapp, 'taskId', al.task_id) as meta
    from public.activity_log al where al.company_id = p_company
    union all
    select ce.id, ce.event_type, ce.created_at, ce.actor_id, left(ce.summary, 140), ce.summary, coalesce(ce.details, '{}'::jsonb)
    from public.company_events ce where ce.company_id = p_company
    union all
    select cpa.id,
      case cpa.action when 'criado' then 'acesso_cliente_criado' when 'senha_redefinida' then 'acesso_cliente_senha_redefinida' else 'acesso_cliente_' || cpa.action end,
      cpa.created_at, cpa.actor_id,
      case cpa.action when 'criado' then 'Acesso do cliente criado' when 'senha_redefinida' then 'Senha do cliente redefinida' else 'Acesso do cliente: ' || cpa.action end,
      case cpa.action when 'criado' then 'Acesso do cliente criado' when 'senha_redefinida' then 'Senha do cliente redefinida' else 'Acesso do cliente: ' || cpa.action end,
      jsonb_build_object('action', cpa.action)
    from public.client_portal_audit cpa where cpa.company_id = p_company
  ),
  filtered as (
    select f.*, public.activity_type_label(f.type) as type_label, coalesce(p.full_name, p.email) as author_name, p.avatar_path
    from feed f left join public.profiles p on p.id = f.author_id
    where (p_types is null or array_length(p_types, 1) is null or f.type = any(p_types))
      and (p_author is null or f.author_id = p_author)
      and (p_from is null or (f.at at time zone 'America/Sao_Paulo')::date >= p_from)
      and (p_to is null or (f.at at time zone 'America/Sao_Paulo')::date <= p_to)
      and (p_search is null or btrim(p_search) = '' or f.content ilike '%' || p_search || '%')
  ),
  page as (select * from filtered order by at desc, id desc limit greatest(0, least(coalesce(p_limit, 20), 100)) offset greatest(0, coalesce(p_offset, 0)))
  select jsonb_build_object('total', (select count(*) from filtered),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
       'id', page.id, 'type', page.type, 'typeLabel', page.type_label, 'at', page.at, 'authorId', page.author_id,
       'authorName', page.author_name, 'authorAvatar', page.avatar_path, 'summary', page.summary, 'content', page.content, 'meta', page.meta)
       order by page.at desc, page.id desc) from page), '[]'::jsonb));
$function$;
grant execute on function company_activity_feed(uuid, int, int, text, text[], uuid, date, date) to authenticated;

-- company_activity_types -> 0072 (sem categoria)
create or replace function company_activity_types(p_company uuid) returns jsonb
language sql stable security invoker set search_path to 'public', 'extensions' as $function$
  select coalesce(jsonb_agg(jsonb_build_object('value', t.type, 'label', public.activity_type_label(t.type)) order by public.activity_type_label(t.type)), '[]'::jsonb)
  from (select distinct type from (
      (select 'atividade' as type from public.activity_log where company_id = p_company limit 1)
      union (select distinct event_type from public.company_events where company_id = p_company)
      union (select distinct case cpa.action when 'criado' then 'acesso_cliente_criado' when 'senha_redefinida' then 'acesso_cliente_senha_redefinida' else 'acesso_cliente_' || cpa.action end
             from public.client_portal_audit cpa where cpa.company_id = p_company)) s) t;
$function$;
grant execute on function company_activity_types(uuid) to authenticated;

-- 6) activity_type_label -> 0167 (21 tipos) -----------------------------
create or replace function activity_type_label(p_type text) returns text language sql immutable set search_path = public as $$
  select case p_type
    when 'atividade' then 'Atividade' when 'tarefa_criada' then 'Tarefa criada' when 'tarefa_concluida' then 'Tarefa concluída'
    when 'tarefa_excluida' then 'Tarefa excluída' when 'tarefa_responsavel_alterada' then 'Responsável alterado'
    when 'tarefa_recorrente_criada' then 'Tarefa recorrente criada' when 'tarefa_recorrente_editada' then 'Tarefa recorrente editada'
    when 'tarefa_recorrente_desativada' then 'Tarefa recorrente desativada' when 'consultor_adicionado' then 'Consultor adicionado'
    when 'consultor_removido' then 'Consultor removido' when 'grupo_alterado' then 'Grupo alterado' when 'etiqueta_alterada' then 'Etiqueta alterada'
    when 'faturamento_lancado' then 'Faturamento lançado' when 'faturamento_corrigido' then 'Faturamento corrigido'
    when 'informacoes_alteradas' then 'Informações alteradas' when 'acesso_cliente_criado' then 'Acesso do cliente criado'
    when 'acesso_cliente_senha_redefinida' then 'Senha do cliente redefinida' when 'acesso_cliente_revogado' then 'Acesso do cliente revogado'
    when 'listagem_validada' then 'Listagem validada' when 'reuniao_criada' then 'Reunião criada' when 'reuniao_cancelada' then 'Reunião cancelada'
    else p_type end;
$$;
grant execute on function activity_type_label(text) to authenticated, anon;

-- 7) Funções RECRIADAS -> corpos anteriores (sem as GUCs/eventos novos).
--    Recria via o padrão da 0072/0167: o 'tarefa_responsavel_alterada' por linha
--    volta a usar insert inline; o resto idêntico ao estado pré-0168. (As funções
--    abaixo reaplicam as definições de 0167/0137/0079/0162 inline.)
-- NOTA: para um rollback fiel, reaplique as migrations 0167, 0137, 0079 e 0162 na
--    ordem após este arquivo — elas restauram task_templates_event_trg,
--    task_instances_event_trg, sync_template_instances,
--    reassign_company_collaborator_tasks, expire_overdue_standard_tasks,
--    company_consultants_event_trg e company_collaborators_event_trg aos corpos
--    originais (que não dependem de log_company_event).

-- 8) Colunas/índice de origem ------------------------------------------
drop index if exists public.uq_company_events_source;
alter table public.company_events drop column if exists source;
alter table public.company_events drop column if exists source_id;

-- 9) Helper -------------------------------------------------------------
-- NÃO dropar log_company_event aqui: enquanto as funções recriadas (gatilhos de
-- tarefa/consultor/colaborador) não forem reapontadas aos corpos de 0167/0137/
-- 0079/0162, elas ainda a chamam. Reaplique essas migrations ANTES e só então:
--   drop function if exists public.log_company_event(uuid, text, text, jsonb, uuid, text, text);

-- 10) (OPCIONAL) limpar os eventos gerados pela 0168 --------------------
-- delete from public.company_events where source in
--   ('time_adjustments','cs_audit','traffic_audit','dev_audit','meeting_timer_audit');
-- delete from public.company_events where event_type in
--   ('tarefa_editada','tarefa_cancelada','tarefa_reaberta','tarefa_expirada',
--    'ocorrencia_prazo_alterado','ocorrencia_excluida','consultor_trocado',
--    'colaborador_trocado','tarefas_repassadas','tempo_ajustado','valor_contrato_alterado',
--    'canais_alterados','pausa_iniciada','pausa_encerrada','cs_alterado','churn_registrado',
--    'churn_editado','empresa_renomeada','contato_digisac_alterado','grupo_whatsapp_alterado',
--    'trafego_alterado','dev_alterado','timer_reuniao_editado','anotacao_editada','anotacao_excluida');

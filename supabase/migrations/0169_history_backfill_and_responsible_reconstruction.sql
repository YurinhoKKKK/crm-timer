-- =====================================================================
-- 0169_history_backfill_and_responsible_reconstruction :: CRM/Timer - Monvatti
-- =====================================================================
-- Fecha o histórico (0168) com o PASSADO:
--  A) BACKFILL das auditorias -> company_events, com created_at = data REAL da
--     auditoria (não now()), idempotente por (source, source_id). Ator inexistente
--     em profiles vira NULL ("Sistema"). Faturamento já é coberto pelos eventos
--     go-forward (0072) — o insert aqui é idempotente e dedup por created_at, então
--     na prática insere 0; fica para o caso de linhas antigas sem evento.
--     Cobre: tempo_ajustado, cs_alterado (NPS/datas), trafego/dev_alterado,
--     timer_reuniao_editado, faturamento_*, valor_contrato_alterado (cs_audit
--     valor_projeto/parcelas), churn_registrado/editado (cs_audit churn*; NUNCA o
--     texto do motivo — invariante 0120), e pausa_iniciada/encerrada
--     (company_pause_periods). cs_audit field='etiqueta' fica FORA (já coberto por
--     etiqueta_alterada).
--  B) RECONSTRUÇÃO de company_responsible_periods (source='reconstruido'):
--     · COLABORADORES: responsável das INSTÂNCIAS diárias de "Controle de Conta"
--       por dia -> períodos (método validado na 293).
--     · CONSULTORES: intervalos por eventos consultor_adicionado/removido +
--       vínculo atual. Atuais sem evento de adição ficam com start_date NULL
--       (decisão 1: gravar mesmo assim; a UI mostra "desde antes de <1º evento
--       consultor_* do sistema> (início não registrado)").
--     Idempotente: apaga os 'reconstruido' e reinsere. Períodos ABERTOS usam
--     on conflict (crp_one_open) do nothing — assim um período 'registrado' aberto
--     criado pelos triggers entre a 0168 e a 0169 PREVALECE sobre o reconstruído.
--
-- Empresas sem Controle de Conta diária (decisão 2): sem reconstrução de
-- colaborador. Período atual reconstruído = 'reconstruido' (decisão 3); o trigger
-- go-forward fecha o aberto (qualquer fonte) e abre o novo 'registrado'.
--
-- Rollback: supabase/rollback/0169_history_backfill_and_responsible_reconstruction.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- A) BACKFILL DAS AUDITORIAS
-- ---------------------------------------------------------------------

-- A1. time_adjustments -> tempo_ajustado (empresa via task_instances)
insert into company_events (company_id, event_type, summary, details, actor_id, created_at, source, source_id)
select ti.company_id, 'tempo_ajustado',
  'Tempo da tarefa "' || coalesce(ti.title,'(sem título)') || '" ajustado de '
    || coalesce(a.old_seconds,0) || 's para ' || coalesce(a.new_seconds,0) || 's'
    || case when nullif(btrim(coalesce(a.reason,'')),'') is not null then ' — ' || a.reason else '' end,
  jsonb_build_object('taskId', a.task_id, 'de', a.old_seconds, 'para', a.new_seconds, 'motivo', a.reason),
  (select p.id from profiles p where p.id = a.adjusted_by),
  a.created_at, 'time_adjustments', a.id::text
from time_adjustments a
join task_instances ti on ti.id = a.task_id
where ti.company_id is not null
on conflict (source, source_id) where source is not null do nothing;

-- A2. cs_audit (SÓ NPS/datas) -> cs_alterado (admin-only pela RLS)
insert into company_events (company_id, event_type, summary, details, actor_id, created_at, source, source_id)
select a.company_id, 'cs_alterado',
  'Sucesso do Cliente — ' || (case a.field
      when 'nps_geral' then 'NPS geral' when 'nps_pessoa' then 'NPS por pessoa'
      when 'data_reuniao' then 'Data da reunião' when 'data_entrada' then 'Data de entrada'
      when 'data_fim' then 'Data de fim' else a.field end)
    || ': ' || coalesce(a.old_value,'(vazio)') || ' → ' || coalesce(a.new_value,'(vazio)'),
  jsonb_build_object('field', a.field, 'de', a.old_value, 'para', a.new_value, 'subjectUserId', a.subject_user_id),
  (select p.id from profiles p where p.id = a.changed_by),
  a.changed_at, 'cs_audit', a.id::text
from cs_audit a
where a.field in ('nps_geral','nps_pessoa','data_reuniao','data_entrada','data_fim')
on conflict (source, source_id) where source is not null do nothing;

-- A3. traffic_audit -> trafego_alterado (visibilidade 'trafego')
insert into company_events (company_id, event_type, summary, details, actor_id, created_at, source, source_id)
select a.company_id, 'trafego_alterado',
  'Tráfego — ' || (case a.field when 'grupo_manual' then 'grupo' when 'orcamento' then 'orçamento' else a.field end)
    || ': ' || coalesce(a.old_value,'(vazio)') || ' → ' || coalesce(a.new_value,'(vazio)'),
  jsonb_build_object('field', a.field, 'de', a.old_value, 'para', a.new_value),
  (select p.id from profiles p where p.id = a.changed_by),
  a.changed_at, 'traffic_audit', a.id::text
from traffic_audit a
on conflict (source, source_id) where source is not null do nothing;

-- A4. dev_audit -> dev_alterado (visibilidade 'dev')
insert into company_events (company_id, event_type, summary, details, actor_id, created_at, source, source_id)
select a.company_id, 'dev_alterado',
  'Desenvolvimento — ' || (case a.field when 'pausa_manual' then 'pausa' else a.field end)
    || ': ' || coalesce(a.old_value,'(vazio)') || ' → ' || coalesce(a.new_value,'(vazio)'),
  jsonb_build_object('field', a.field, 'de', a.old_value, 'para', a.new_value),
  (select p.id from profiles p where p.id = a.changed_by),
  a.changed_at, 'dev_audit', a.id::text
from dev_audit a
on conflict (source, source_id) where source is not null do nothing;

-- A5. meeting_timer_audit -> timer_reuniao_editado (company_id direto; 0155)
insert into company_events (company_id, event_type, summary, details, actor_id, created_at, source, source_id)
select a.company_id, 'timer_reuniao_editado',
  (case a.event_type when 'auto_close' then 'Timer de reunião fechado automaticamente' else 'Timer de reunião editado' end)
    || ': de ' || coalesce(a.old_seconds,0) || 's para ' || coalesce(a.new_seconds,0) || 's'
    || case when nullif(btrim(coalesce(a.justification,'')),'') is not null then ' — ' || a.justification else '' end,
  jsonb_build_object('timerId', a.timer_id, 'eventType', a.event_type, 'de', a.old_seconds, 'para', a.new_seconds, 'justificativa', a.justification),
  (select p.id from profiles p where p.id = a.edited_by),
  a.edited_at, 'meeting_timer_audit', a.id::text
from meeting_timer_audit a
where company_exists(a.company_id)
on conflict (source, source_id) where source is not null do nothing;

-- A6. company_revenue_audit -> faturamento_* (dedup por created_at = changed_at;
--     na prática 0, pois os eventos go-forward desde a 0072 já cobrem)
insert into company_events (company_id, event_type, summary, details, actor_id, created_at, source, source_id)
select a.company_id,
  case when a.old_amount is null then 'faturamento_lancado' else 'faturamento_corrigido' end,
  'Faturamento ' || sales_channel_label(a.channel) || ' ' || to_char(a.reference_month,'MM/YYYY') || ': '
    || case when a.old_amount is null then 'lançado R$ ' || trim(to_char(a.new_amount,'FM999999990.00'))
            when a.new_amount is null then 'removido (era R$ ' || trim(to_char(a.old_amount,'FM999999990.00')) || ')'
            else 'de R$ ' || trim(to_char(a.old_amount,'FM999999990.00')) || ' para R$ ' || trim(to_char(a.new_amount,'FM999999990.00')) end,
  jsonb_build_object('channel', a.channel, 'month', a.reference_month, 'oldAmount', a.old_amount, 'newAmount', a.new_amount, 'reason', a.reason),
  (select p.id from profiles p where p.id = a.changed_by),
  a.changed_at, 'company_revenue_audit', a.id::text
from company_revenue_audit a
where not exists (
  select 1 from company_events ce
  where ce.company_id = a.company_id
    and ce.event_type in ('faturamento_lancado','faturamento_corrigido')
    and ce.created_at = a.changed_at)
on conflict (source, source_id) where source is not null do nothing;

-- A7. cs_audit valor_projeto / parcelas -> valor_contrato_alterado (admin).
--     Uma linha por campo (de->para). Mesma fonte 'cs_audit' da A2, ids disjuntos.
insert into company_events (company_id, event_type, summary, details, actor_id, created_at, source, source_id)
select a.company_id, 'valor_contrato_alterado',
  case a.field
    when 'valor_projeto' then 'Valor do contrato atualizado — projeto: '
      || case when a.old_value is null then '(não definido)' else 'R$ ' || a.old_value end
      || ' → ' || case when a.new_value is null then '(não definido)' else 'R$ ' || a.new_value end
    else 'Valor do contrato atualizado — parcelas: '
      || coalesce(a.old_value,'(não definido)') || ' → ' || coalesce(a.new_value,'(não definido)') end,
  case a.field
    when 'valor_projeto' then jsonb_build_object('projeto',
      jsonb_build_object('de', nullif(a.old_value,'')::numeric, 'para', nullif(a.new_value,'')::numeric))
    else jsonb_build_object('parcelas',
      jsonb_build_object('de', nullif(a.old_value,'')::int, 'para', nullif(a.new_value,'')::int)) end,
  (select p.id from profiles p where p.id = a.changed_by),
  a.changed_at, 'cs_audit', a.id::text
from cs_audit a
where a.field in ('valor_projeto','parcelas')
on conflict (source, source_id) where source is not null do nothing;

-- A8. cs_audit field='churn' -> churn_registrado (admin). NUNCA o motivo:
--     new_value ("Cliente cancelado: <motivo>") embute o motivo -> derivar só o TIPO.
insert into company_events (company_id, event_type, summary, details, actor_id, created_at, source, source_id)
select a.company_id, 'churn_registrado',
  'Churn registrado: ' || (case when a.new_value ilike 'Projeto finalizado%' then 'finalizado' else 'cancelado' end),
  jsonb_build_object('churnType', case when a.new_value ilike 'Projeto finalizado%' then 'finalizado' else 'cancelado' end),
  (select p.id from profiles p where p.id = a.changed_by),
  a.changed_at, 'cs_audit', a.id::text
from cs_audit a
where a.field = 'churn'
on conflict (source, source_id) where source is not null do nothing;

-- A9. cs_audit field='churn_motivo' -> churn_editado. SÓ "Motivo: alterado"
--     (invariante 0120: o valor do motivo NUNCA entra no evento).
insert into company_events (company_id, event_type, summary, details, actor_id, created_at, source, source_id)
select a.company_id, 'churn_editado',
  'Churn editado — Motivo: alterado',
  jsonb_build_object('changes', jsonb_build_object('motivoAlterado', true)),
  (select p.id from profiles p where p.id = a.changed_by),
  a.changed_at, 'cs_audit', a.id::text
from cs_audit a
where a.field = 'churn_motivo'
on conflict (source, source_id) where source is not null do nothing;

-- A10. cs_audit field='churn_vendedor' -> churn_editado (vendedor de->para).
insert into company_events (company_id, event_type, summary, details, actor_id, created_at, source, source_id)
select a.company_id, 'churn_editado',
  'Churn editado — vendedor: ' || coalesce(a.old_value,'(vazio)') || ' → ' || coalesce(a.new_value,'(vazio)'),
  jsonb_build_object('changes', jsonb_build_object('vendedor',
    jsonb_build_object('de', a.old_value, 'para', a.new_value))),
  (select p.id from profiles p where p.id = a.changed_by),
  a.changed_at, 'cs_audit', a.id::text
from cs_audit a
where a.field = 'churn_vendedor'
on conflict (source, source_id) where source is not null do nothing;

-- A11. cs_audit field='churn_data' -> churn_editado (data de->para).
insert into company_events (company_id, event_type, summary, details, actor_id, created_at, source, source_id)
select a.company_id, 'churn_editado',
  'Churn editado — data: ' || coalesce(a.old_value,'(vazio)') || ' → ' || coalesce(a.new_value,'(vazio)'),
  jsonb_build_object('changes', jsonb_build_object('data',
    jsonb_build_object('de', a.old_value, 'para', a.new_value))),
  (select p.id from profiles p where p.id = a.changed_by),
  a.changed_at, 'cs_audit', a.id::text
from cs_audit a
where a.field = 'churn_data'
on conflict (source, source_id) where source is not null do nothing;

-- A12. company_pause_periods -> pausa_iniciada (TODA linha) + pausa_encerrada (ended_on).
--      Alcance. source='company_pause_periods'; source_id = id||':inicio' / ':fim'
--      (dois eventos por linha -> ids distintos p/ não colidir no índice único).
--      UMA pausa_iniciada por linha (12: inclui as 5 em aberto/Pausados). Linhas sem
--      started_on (pausa importada/pendente) -> "(data de início não registrada)" e a
--      posição na timeline usa created_at (data da importação).
insert into company_events (company_id, event_type, summary, details, actor_id, created_at, source, source_id)
select pp.company_id, 'pausa_iniciada',
  case when pp.started_on is not null
    then 'Pausa de contrato iniciada em ' || to_char(pp.started_on, 'DD/MM/YYYY')
    else 'Pausa de contrato iniciada (data de início não registrada)' end,
  jsonb_build_object('pauseId', pp.id, 'de', null, 'para', pp.started_on, 'source', pp.source),
  (select p.id from profiles p where p.id = pp.created_by),
  coalesce(pp.started_on::timestamptz, pp.created_at), 'company_pause_periods', pp.id::text || ':inicio'
from company_pause_periods pp
where company_exists(pp.company_id)
on conflict (source, source_id) where source is not null do nothing;

insert into company_events (company_id, event_type, summary, details, actor_id, created_at, source, source_id)
select pp.company_id, 'pausa_encerrada',
  'Pausa de contrato encerrada em ' || to_char(pp.ended_on, 'DD/MM/YYYY'),
  jsonb_build_object('pauseId', pp.id, 'de', null, 'para', pp.ended_on, 'source', pp.source),
  (select p.id from profiles p where p.id = coalesce(pp.updated_by, pp.created_by)),
  coalesce(pp.updated_at, pp.ended_on::timestamptz), 'company_pause_periods', pp.id::text || ':fim'
from company_pause_periods pp
where pp.ended_on is not null and company_exists(pp.company_id)
on conflict (source, source_id) where source is not null do nothing;

-- ---------------------------------------------------------------------
-- B) RECONSTRUÇÃO DE PERÍODOS DE RESPONSÁVEL (idempotente: zera 'reconstruido')
-- ---------------------------------------------------------------------
-- Decisão 1: consultor atual sem evento de adição grava com start_date NULL
-- ("início não registrado") -> a coluna precisa aceitar NULL (0168 criou NOT NULL).
alter table company_responsible_periods alter column start_date drop not null;

delete from company_responsible_periods where source = 'reconstruido';

-- B1. COLABORADORES — responsável da "Controle de Conta" diária por dia.
with cc_tmpl as (
  select id, company_id from task_templates
  where kind = 'diaria' and lower(title) like '%controle de conta%'
),
cc_daily as (
  select distinct on (ti.company_id, ti.task_date) ti.company_id, ti.task_date d, ti.collaborator_id resp
  from task_instances ti join cc_tmpl t on t.id = ti.template_id
  order by ti.company_id, ti.task_date, ti.created_at desc
),
cc_flag as (select company_id, d, resp, lag(resp) over (partition by company_id order by d) prev from cc_daily),
cc_chg  as (select company_id, d, resp from cc_flag where prev is distinct from resp),
cc_seq  as (select company_id, d, resp, lead(d) over (partition by company_id order by d) nxt from cc_chg)
insert into company_responsible_periods (company_id, person_id, role, start_date, end_date, source)
select company_id, resp, 'colaborador', d, case when nxt is null then null else nxt - 1 end, 'reconstruido'
from cc_seq
where resp is not null
on conflict (company_id, person_id, role) where end_date is null do nothing;

-- B2. CONSULTORES — intervalos por eventos add/remove.
with cev as (
  select company_id, (details->>'consultantId')::uuid pid,
         (created_at at time zone 'America/Sao_Paulo')::date d, created_at,
         (event_type = 'consultor_adicionado') added
  from company_events
  where event_type in ('consultor_adicionado','consultor_removido')
),
cadd as (select company_id, pid, d, created_at, row_number() over (partition by company_id,pid order by created_at) rn from cev where added),
crem as (select company_id, pid, d, created_at, row_number() over (partition by company_id,pid order by created_at) rn from cev where not added),
cpairs as (
  select a.company_id, a.pid, a.d start_date, r.d end_date
  from cadd a left join crem r on r.company_id=a.company_id and r.pid=a.pid and r.rn=a.rn
)
insert into company_responsible_periods (company_id, person_id, role, start_date, end_date, source)
select company_id, pid, 'consultor', start_date, end_date, 'reconstruido'
from cpairs
where pid is not null
on conflict (company_id, person_id, role) where end_date is null do nothing;

-- B3. CONSULTORES ATUAIS sem evento de adição -> período aberto, start NULL
--     (decisão 1: gravar com início não registrado).
insert into company_responsible_periods (company_id, person_id, role, start_date, end_date, source)
select cc.company_id, cc.consultant_id, 'consultor', null, null, 'reconstruido'
from company_consultants cc
where not exists (
  select 1 from company_events ce
  where ce.event_type = 'consultor_adicionado'
    and ce.company_id = cc.company_id
    and (ce.details->>'consultantId')::uuid = cc.consultant_id)
on conflict (company_id, person_id, role) where end_date is null do nothing;

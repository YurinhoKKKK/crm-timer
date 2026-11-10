-- =====================================================================
-- ROLLBACK 0171_company_trade_name
-- =====================================================================
-- Restaura todas as funções recriadas pela 0171 às versões anteriores
-- (removendo qualquer referência a trade_name), remove o helper e o trigger
-- volta a não disparar em trade_name; só então remove a coluna.
-- Ordem importa: funções que referenciam c.trade_name precisam voltar ANTES
-- do drop da coluna.
-- =====================================================================

-- Taxonomia (remove nome_fantasia_alterado)
create or replace function public.activity_type_label(p_type text)
returns text language sql immutable set search_path to 'public'
as $$
  select case p_type
    when 'atividade' then 'Atividade' when 'tarefa_criada' then 'Tarefa criada' when 'tarefa_editada' then 'Tarefa editada'
    when 'tarefa_concluida' then 'Tarefa concluída' when 'tarefa_excluida' then 'Tarefa excluída'
    when 'tarefa_cancelada' then 'Tarefa cancelada' when 'tarefa_reaberta' then 'Tarefa reaberta'
    when 'tarefa_expirada' then 'Tarefa expirada' when 'ocorrencia_prazo_alterado' then 'Prazo da ocorrência alterado'
    when 'ocorrencia_excluida' then 'Ocorrência excluída' when 'tarefa_recorrente_criada' then 'Tarefa recorrente criada'
    when 'tarefa_recorrente_editada' then 'Tarefa recorrente editada' when 'tarefa_recorrente_desativada' then 'Tarefa recorrente desativada'
    when 'tarefa_desativada_catalogo' then 'Tarefa desativada pelo catálogo' when 'tarefa_reativada_catalogo' then 'Tarefa reativada pelo catálogo'
    when 'tarefas_pausadas_grupo' then 'Tarefas pausadas (grupo)' when 'tarefas_retomadas_grupo' then 'Tarefas retomadas (grupo)'
    when 'tarefa_responsavel_alterada' then 'Responsável alterado' when 'tarefas_repassadas' then 'Tarefas repassadas'
    when 'consultor_adicionado' then 'Consultor adicionado' when 'consultor_removido' then 'Consultor removido' when 'consultor_trocado' then 'Consultor trocado'
    when 'colaborador_adicionado' then 'Colaborador adicionado' when 'colaborador_removido' then 'Colaborador removido' when 'colaborador_trocado' then 'Colaborador trocado'
    when 'tempo_ajustado' then 'Tempo ajustado' when 'informacoes_alteradas' then 'Informações alteradas'
    when 'faturamento_lancado' then 'Faturamento lançado' when 'faturamento_corrigido' then 'Faturamento corrigido'
    when 'valor_contrato_alterado' then 'Valor do contrato alterado' when 'canais_alterados' then 'Canais alterados'
    when 'pausa_iniciada' then 'Pausa iniciada' when 'pausa_encerrada' then 'Pausa encerrada'
    when 'cs_alterado' then 'Sucesso do Cliente alterado' when 'churn_registrado' then 'Churn registrado' when 'churn_editado' then 'Churn editado'
    when 'empresa_renomeada' then 'Empresa renomeada' when 'contato_digisac_alterado' then 'Contato do Digisac alterado' when 'grupo_whatsapp_alterado' then 'Grupo de WhatsApp alterado'
    when 'grupo_alterado' then 'Grupo alterado' when 'etiqueta_alterada' then 'Etiqueta alterada' when 'empresa_criada_crm' then 'Empresa criada (CRM)'
    when 'trafego_alterado' then 'Tráfego alterado' when 'dev_alterado' then 'Desenvolvimento alterado'
    when 'reuniao_criada' then 'Reunião criada' when 'reuniao_cancelada' then 'Reunião cancelada' when 'timer_reuniao_editado' then 'Timer de reunião editado'
    when 'acesso_cliente_criado' then 'Acesso do cliente criado' when 'acesso_cliente_senha_redefinida' then 'Senha do cliente redefinida'
    when 'acesso_cliente_link_girado' then 'Link do cliente girado' when 'acesso_cliente_revogado' then 'Acesso do cliente revogado'
    when 'anotacao_editada' then 'Anotação editada' when 'anotacao_excluida' then 'Anotação excluída' when 'listagem_validada' then 'Listagem validada'
    else p_type end;
$$;

create or replace function public.activity_type_category(p_type text)
returns text language sql immutable set search_path to 'public'
as $$
  select case p_type
    when 'atividade' then 'tempo' when 'tempo_ajustado' then 'tempo'
    when 'tarefa_criada' then 'tarefas' when 'tarefa_editada' then 'tarefas' when 'tarefa_concluida' then 'tarefas' when 'tarefa_excluida' then 'tarefas'
    when 'tarefa_cancelada' then 'tarefas' when 'tarefa_reaberta' then 'tarefas' when 'tarefa_expirada' then 'tarefas'
    when 'ocorrencia_prazo_alterado' then 'tarefas' when 'ocorrencia_excluida' then 'tarefas'
    when 'tarefa_recorrente_criada' then 'tarefas' when 'tarefa_recorrente_editada' then 'tarefas' when 'tarefa_recorrente_desativada' then 'tarefas'
    when 'tarefa_desativada_catalogo' then 'tarefas' when 'tarefa_reativada_catalogo' then 'tarefas'
    when 'tarefas_pausadas_grupo' then 'tarefas' when 'tarefas_retomadas_grupo' then 'tarefas'
    when 'tarefa_responsavel_alterada' then 'responsaveis' when 'tarefas_repassadas' then 'responsaveis'
    when 'consultor_adicionado' then 'responsaveis' when 'consultor_removido' then 'responsaveis' when 'consultor_trocado' then 'responsaveis'
    when 'colaborador_adicionado' then 'responsaveis' when 'colaborador_removido' then 'responsaveis' when 'colaborador_trocado' then 'responsaveis'
    when 'informacoes_alteradas' then 'contrato' when 'faturamento_lancado' then 'contrato' when 'faturamento_corrigido' then 'contrato'
    when 'valor_contrato_alterado' then 'contrato' when 'canais_alterados' then 'contrato' when 'pausa_iniciada' then 'contrato' when 'pausa_encerrada' then 'contrato'
    when 'cs_alterado' then 'cs' when 'churn_registrado' then 'cs' when 'churn_editado' then 'cs'
    when 'empresa_renomeada' then 'contato' when 'contato_digisac_alterado' then 'contato' when 'grupo_whatsapp_alterado' then 'contato'
    when 'grupo_alterado' then 'empresa' when 'etiqueta_alterada' then 'empresa' when 'empresa_criada_crm' then 'empresa'
    when 'trafego_alterado' then 'trafego' when 'dev_alterado' then 'desenvolvimento'
    when 'reuniao_criada' then 'reunioes' when 'reuniao_cancelada' then 'reunioes' when 'timer_reuniao_editado' then 'reunioes'
    when 'acesso_cliente_criado' then 'portal' when 'acesso_cliente_senha_redefinida' then 'portal' when 'acesso_cliente_link_girado' then 'portal' when 'acesso_cliente_revogado' then 'portal'
    when 'anotacao_editada' then 'anotacoes' when 'anotacao_excluida' then 'anotacoes' when 'listagem_validada' then 'tarefas'
    else 'empresa' end;
$$;

-- Trigger de contato (sem trade_name) + recria trigger sem OF trade_name
create or replace function public.companies_contact_event_trg()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.name is distinct from old.name then
    perform log_company_event(new.id, 'empresa_renomeada',
      'Empresa renomeada de “' || coalesce(old.name, '?') || '” para “' || coalesce(new.name, '?') || '”',
      jsonb_build_object('de', old.name, 'para', new.name), auth.uid());
  end if;
  if new.whatsapp_contact_id is distinct from old.whatsapp_contact_id then
    perform log_company_event(new.id, 'contato_digisac_alterado',
      case when old.whatsapp_contact_id is null then 'Contato do Digisac vinculado' when new.whatsapp_contact_id is null then 'Contato do Digisac removido' else 'Contato do Digisac trocado' end,
      jsonb_build_object('de', old.whatsapp_contact_id, 'para', new.whatsapp_contact_id), auth.uid());
  end if;
  if new.whatsapp_group_name is distinct from old.whatsapp_group_name then
    perform log_company_event(new.id, 'grupo_whatsapp_alterado',
      'Grupo de WhatsApp alterado de “' || coalesce(old.whatsapp_group_name, '(vazio)') || '” para “' || coalesce(new.whatsapp_group_name, '(vazio)') || '”',
      jsonb_build_object('de', old.whatsapp_group_name, 'para', new.whatsapp_group_name), auth.uid());
  end if;
  return null;
end; $$;

drop trigger if exists trg_companies_contact_event on public.companies;
create trigger trg_companies_contact_event
  after update of name, whatsapp_contact_id, whatsapp_group_name
  on public.companies for each row execute function companies_contact_event_trg();

-- Intake (sem nome_fantasia / sem trade_name no insert)
create or replace function public.crm_intake_create(p_payload jsonb, p_source text DEFAULT NULL::text, p_ip text DEFAULT NULL::text)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_ip_hash   text := case when p_ip is null then null else encode(digest(p_ip, 'sha256'), 'hex') end;
  v_recent    integer;
  v_num_txt   text := btrim(coalesce(p_payload->>'number', ''));
  v_log_num   integer := case when btrim(coalesce(p_payload->>'number','')) ~ '^\d{1,9}$' then btrim(p_payload->>'number')::int else null end;
  v_number    integer;
  v_razao     text := btrim(coalesce(p_payload->>'razao_social', ''));
  v_contato   text := nullif(btrim(coalesce(p_payload->>'contato', '')), '');
  v_cnpj      text := nullif(regexp_replace(coalesce(p_payload->>'cnpj', ''), '\D', '', 'g'), '');
  v_model     text := nullif(btrim(coalesce(p_payload->>'project_model', '')), '');
  v_cadence   text := nullif(btrim(coalesce(p_payload->>'cadence', '')), '');
  v_started   text := nullif(btrim(coalesce(p_payload->>'started_on', '')), '');
  v_ends      text := nullif(btrim(coalesce(p_payload->>'ends_on', '')), '');
  v_system    text := nullif(btrim(coalesce(p_payload->>'system_used', '')), '');
  v_pain      text := nullif(btrim(coalesce(p_payload->>'main_pain', '')), '');
  v_about     text := nullif(btrim(coalesce(p_payload->>'about', '')), '');
  v_closer    text := nullif(btrim(coalesce(p_payload->>'closer_name', '')), '');
  v_pv_raw    text := nullif(btrim(coalesce(p_payload->>'project_value', '')), '');
  v_inst_raw  text := nullif(btrim(coalesce(p_payload->>'installments', '')), '');
  v_pv        numeric(14,2);
  v_inst      integer;
  v_services  text[];
  v_svc       text;
  v_started_d date;
  v_ends_d    date;
  v_name      text;
  v_group     uuid;
  v_company   uuid;
  v_hit       record;
  v_date_re   text := '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$';
  v_text_cap  int := 5000;
begin
  select count(*) into v_recent from crm_intake_log where action = 'create' and received_at > now() - interval '1 minute';
  if v_recent >= 60 then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'rate_limited', 'Limite de requisições por minuto excedido.', 'rate_limited');
  end if;
  if v_num_txt = '' then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'validation', 'Número da empresa é obrigatório.', 'refused_validation');
  end if;
  if v_num_txt !~ '^\d{1,9}$' then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'validation', 'Número deve ser um inteiro positivo (até 9 dígitos).', 'refused_validation');
  end if;
  v_number := v_num_txt::int;
  if v_number < 1 then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'validation', 'Número deve ser maior que zero.', 'refused_validation');
  end if;
  if v_razao = '' then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'validation', 'Razão social é obrigatória.', 'refused_validation');
  end if;
  if char_length(v_razao) > 200 then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'validation', 'Razão social muito longa (máx. 200).', 'refused_validation');
  end if;
  if v_contato is not null and char_length(v_contato) > 120 then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'validation', 'Contato muito longo (máx. 120).', 'refused_validation');
  end if;
  if v_cnpj is null then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'validation', 'CNPJ é obrigatório.', 'refused_validation');
  end if;
  if length(v_cnpj) <> 14 or not is_valid_cnpj(v_cnpj) then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'validation', 'CNPJ inválido.', 'refused_validation');
  end if;
  if v_model is not null and v_model not in ('bpo', 'consultoria', 'ema') then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'validation', 'Modelo de projeto inválido (bpo|consultoria|ema).', 'refused_validation');
  end if;
  if v_cadence is not null and v_cadence not in ('semanal', 'quinzenal', 'semanal_quinzenal', 'quinzenal_semanal') then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'validation', 'Cadência inválida.', 'refused_validation');
  end if;
  if v_started is not null then
    if v_started !~ v_date_re then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'validation', 'started_on inválida (AAAA-MM-DD).', 'refused_validation');
    end if;
    begin v_started_d := v_started::date; exception when others then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'validation', 'started_on não é uma data válida.', 'refused_validation');
    end;
  end if;
  if v_ends is not null then
    if v_ends !~ v_date_re then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'validation', 'ends_on inválida (AAAA-MM-DD).', 'refused_validation');
    end if;
    begin v_ends_d := v_ends::date; exception when others then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'validation', 'ends_on não é uma data válida.', 'refused_validation');
    end;
  end if;
  if v_started_d is not null and v_ends_d is not null and v_ends_d < v_started_d then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'validation', 'ends_on não pode ser antes de started_on.', 'refused_validation');
  end if;
  if coalesce(char_length(v_system), 0) > v_text_cap or coalesce(char_length(v_pain), 0) > v_text_cap or coalesce(char_length(v_about), 0) > v_text_cap then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'validation', 'Um dos textos excede 5000 caracteres.', 'refused_validation');
  end if;
  if v_closer is not null and char_length(v_closer) > 200 then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'validation', 'closer_name muito longo (máx. 200).', 'refused_validation');
  end if;
  if p_payload ? 'monthly_value' or p_payload ? 'valor_mensal' or p_payload ? 'monthly_amount' then
    raise notice 'crm_intake: valor mensal recebido e IGNORADO (é derivado de project_value/installments). numero=%', v_number;
  end if;
  if v_pv_raw is not null then
    if v_pv_raw !~ '^\d+(\.\d+)?$' then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'validation', 'project_value inválido (número decimal não negativo).', 'refused_validation');
    end if;
    begin v_pv := v_pv_raw::numeric(14,2); exception when others then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'validation', 'project_value fora da faixa suportada.', 'refused_validation');
    end;
    if v_pv < 0 then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'validation', 'project_value não pode ser negativo.', 'refused_validation');
    end if;
  end if;
  if v_inst_raw is not null then
    if v_inst_raw !~ '^\d+$' then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'validation', 'installments inválido (inteiro positivo).', 'refused_validation');
    end if;
    begin v_inst := v_inst_raw::integer; exception when others then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'validation', 'installments fora da faixa suportada.', 'refused_validation');
    end;
    if v_inst < 1 then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'validation', 'installments deve ser maior que zero.', 'refused_validation');
    end if;
  end if;
  if p_payload ? 'contracted_services' and jsonb_typeof(p_payload->'contracted_services') is distinct from 'null' then
    if jsonb_typeof(p_payload->'contracted_services') <> 'array' then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'validation', 'contracted_services deve ser uma lista.', 'refused_validation');
    end if;
    select array_agg(distinct btrim(x)) into v_services from jsonb_array_elements_text(p_payload->'contracted_services') as t(x) where btrim(x) <> '';
    if v_services is not null then
      foreach v_svc in array v_services loop
        if v_svc not in ('mercado_livre','shopee','amazon','trafego','gestao_site','desenvolvimento_site') then
          return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'validation', 'Serviço contratado inválido: ' || v_svc, 'refused_validation');
        end if;
      end loop;
    end if;
  end if;
  select c.id, c.name into v_hit from companies c where c.cnpj = v_cnpj limit 1;
  if found then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'cnpj_in_use', 'O CNPJ informado já está cadastrado na empresa "' || v_hit.name || '".', 'refused_cnpj', jsonb_build_object('id', v_hit.id, 'name', v_hit.name));
  end if;
  select c.id, c.name into v_hit from companies c where crm_name_number(c.name) = v_number limit 1;
  if found then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'number_in_use', 'O número ' || v_number || ' já está em uso pela empresa "' || v_hit.name || '".', 'refused_number', jsonb_build_object('id', v_hit.id, 'name', v_hit.name));
  end if;
  select id into v_group from company_groups where lower(name) = 'on boarding' limit 1;
  if v_group is null then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'internal', 'Grupo "On Boarding" não encontrado.', 'error');
  end if;
  v_name := v_number || '. ' || v_razao || case when v_contato is not null then ' (' || v_contato || ')' else '' end;
  begin
    insert into companies (name, group_id, created_by, cnpj) values (v_name, v_group, null, v_cnpj) returning id into v_company;
    insert into company_events (company_id, event_type, summary, details, actor_id) values (v_company, 'empresa_criada_crm', 'Empresa criada a partir do CRM comercial', jsonb_build_object('number', v_number, 'source', p_source), null);
    insert into company_details (company_id, project_model, started_on, ends_on, cadence, system_used, main_pain, about, closer_name)
    values (v_company, v_model::project_model, v_started_d, v_ends_d, v_cadence::contract_cadence, v_system, v_pain, v_about, v_closer);
    if v_pv is not null or v_inst is not null then
      insert into company_contract_values (company_id, project_value, installments) values (v_company, v_pv, v_inst);
    end if;
    if v_services is not null and array_length(v_services, 1) > 0 then
      insert into company_contracted_channels (company_id, channel) select v_company, x::contracted_service from unnest(v_services) as x on conflict (company_id, channel) do nothing;
    end if;
  exception
    when unique_violation then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'duplicate', 'Já existe empresa com este nome ou CNPJ (' || v_name || ').', 'refused_duplicate');
    when others then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload, 'internal', 'Falha ao criar: ' || sqlerrm, 'error');
  end;
  insert into crm_intake_log (action, source, ip_hash, number, razao_social, result, reason, company_id, payload)
  values ('create', p_source, v_ip_hash, v_number, left(v_razao, 200), 'created', 'Empresa criada em On Boarding', v_company, p_payload);
  return jsonb_build_object('ok', true, 'id', v_company, 'name', v_name);
end;
$function$;

-- RPCs de busca: versões anteriores (sem trade_name). Inline (não reaplicar
-- 0166/0163, pois collaborator_tasks_page foi redefinida depois, na 0165 — com
-- criador; estes corpos são os vigentes antes da 0171).

create or replace function public.atrasos_list(p_start date, p_end date, p_include_standard boolean DEFAULT false, p_status text DEFAULT NULL::text, p_creator uuid DEFAULT NULL::uuid, p_responsible uuid DEFAULT NULL::uuid, p_company uuid DEFAULT NULL::uuid, p_type text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_order text DEFAULT 'atraso'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, title text, company_id uuid, company_name text, type_key text, type_label text, responsible_id uuid, responsible_name text, responsible_avatar_path text, creator_id uuid, creator_name text, creator_avatar_path text, created_at timestamp with time zone, due_at timestamp with time zone, granted_seconds double precision, finished_at timestamp with time zone, delay_seconds double precision, situation text, total_count bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_search text := lower(extensions.unaccent(coalesce(nullif(btrim(p_search), ''), '')));
begin
  if not (select is_admin()) then
    raise exception 'atrasos_list: acesso restrito a administradores.' using errcode = '42501';
  end if;
  return query
  with base as (
    select ti.id, ti.title, ti.company_id, c.name as company_name,
      ti.collaborator_id, rp.full_name as responsible_name, rp.avatar_path as responsible_avatar_path,
      tt.created_by, cp.full_name as creator_name, cp.avatar_path as creator_avatar_path,
      ti.created_at, ti.due_at, ti.finished_at, ti.description,
      case when tt.category is not null then 'cat:' || tt.category::text
           when tt.template_type = 'listagem' then 'cat:listagem'
           else 'title:' || coalesce(nullif(btrim(tt.title), ''), ti.title) end as type_key,
      case when tt.category is not null then tt.category::text
           when tt.template_type = 'listagem' then 'Listagem'
           else coalesce(nullif(btrim(tt.title), ''), ti.title) end as type_label,
      extract(epoch from (ti.due_at - case when tt.kind = 'diaria' then ti.created_at else coalesce(tt.created_at, ti.created_at) end))::double precision as granted_seconds,
      exists (select 1 from task_auto_expirations ae where ae.task_id = ti.id) as is_expired_raw,
      (ti.status = 'finalizada' and ti.finished_at is not null and ti.finished_at > ti.due_at) as done_late_raw,
      (ti.status in ('a_fazer','iniciada') and ti.due_at < now()) as open_overdue_raw,
      (select min(ae.expired_at) from task_auto_expirations ae where ae.task_id = ti.id) as expired_at
    from task_instances ti
    left join task_templates tt on tt.id = ti.template_id
    left join companies c on c.id = ti.company_id
    left join profiles rp on rp.id = ti.collaborator_id
    left join profiles cp on cp.id = tt.created_by
    where ti.due_at is not null and (p_include_standard or tt.standard_task_id is null)
      and ti.collaborator_id <> all(public.atrasos_excluded_ids())
      and (tt.created_by is null or tt.created_by <> all(public.atrasos_excluded_ids()))
      and (p_start is null or (ti.due_at at time zone 'America/Sao_Paulo')::date >= p_start)
      and (p_end   is null or (ti.due_at at time zone 'America/Sao_Paulo')::date <= p_end)
  ),
  universe as (
    select b.*,
      case when b.is_expired_raw then 'expired' when b.done_late_raw then 'completed_late'
           when b.open_overdue_raw then 'open_overdue' end as situation,
      (case when b.is_expired_raw then extract(epoch from (coalesce(b.expired_at, now()) - b.due_at))
            when b.done_late_raw then extract(epoch from (b.finished_at - b.due_at))
            when b.open_overdue_raw then extract(epoch from (now() - b.due_at)) end)::double precision as delay_seconds
    from base b where b.is_expired_raw or b.done_late_raw or b.open_overdue_raw
  ),
  filtered as (
    select u.* from universe u
    where (p_company is null or u.company_id = p_company)
      and (p_type is null or u.type_key = p_type)
      and (p_creator is null or u.created_by = p_creator)
      and (p_responsible is null or u.collaborator_id = p_responsible)
      and (p_status is null or p_status = '' or u.situation = p_status)
      and (v_search = ''
        or lower(extensions.unaccent(coalesce(u.title, '')))        like '%' || v_search || '%'
        or lower(extensions.unaccent(coalesce(u.company_name, ''))) like '%' || v_search || '%'
        or lower(extensions.unaccent(coalesce(u.description, '')))  like '%' || v_search || '%'
        or lower(extensions.unaccent(coalesce(u.creator_name, '')))  like '%' || v_search || '%')
  ),
  ordered as (
    select f.*, count(*) over() as total_count from filtered f
    order by
      case when p_order = 'recentes' then f.created_at end desc nulls last,
      case when p_order = 'prazo' then f.granted_seconds end asc nulls last,
      case when p_order not in ('recentes','prazo') then f.delay_seconds end desc nulls last,
      f.id desc
    limit greatest(p_limit, 0) offset greatest(p_offset, 0)
  )
  select o.id, o.title, o.company_id, o.company_name, o.type_key, o.type_label,
    o.collaborator_id, o.responsible_name, o.responsible_avatar_path,
    o.created_by, o.creator_name, o.creator_avatar_path,
    o.created_at, o.due_at, o.granted_seconds, o.finished_at, o.delay_seconds, o.situation, o.total_count
  from ordered o
  order by
    case when p_order = 'recentes' then o.created_at end desc nulls last,
    case when p_order = 'prazo' then o.granted_seconds end asc nulls last,
    case when p_order not in ('recentes','prazo') then o.delay_seconds end desc nulls last,
    o.id desc;
end;
$function$;

create or replace function public.atrasos_summary(p_start date, p_end date, p_include_standard boolean DEFAULT false, p_status text DEFAULT NULL::text, p_creator uuid DEFAULT NULL::uuid, p_responsible uuid DEFAULT NULL::uuid, p_company uuid DEFAULT NULL::uuid, p_type text DEFAULT NULL::text, p_search text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_search text := lower(extensions.unaccent(coalesce(nullif(btrim(p_search), ''), '')));
  v_result jsonb;
begin
  if not (select is_admin()) then
    raise exception 'atrasos_summary: acesso restrito a administradores.' using errcode = '42501';
  end if;
  with base as (
    select ti.id, ti.collaborator_id, tt.created_by, ti.company_id, c.name as company_name,
      ti.title, ti.description,
      case when tt.category is not null then 'cat:' || tt.category::text
           when tt.template_type = 'listagem' then 'cat:listagem'
           else 'title:' || coalesce(nullif(btrim(tt.title), ''), ti.title) end as type_key,
      cp.full_name as creator_name,
      exists (select 1 from task_auto_expirations ae where ae.task_id = ti.id) as is_expired_raw,
      (ti.status = 'finalizada' and ti.finished_at is not null and ti.finished_at > ti.due_at) as done_late_raw,
      (ti.status in ('a_fazer','iniciada') and ti.due_at < now()) as open_overdue_raw,
      (ti.status = 'finalizada' and ti.finished_at is not null and ti.finished_at <= ti.due_at) as on_time_raw,
      extract(epoch from (ti.finished_at - ti.due_at)) as done_delay_seconds,
      extract(epoch from (ti.due_at - case when tt.kind = 'diaria' then ti.created_at else coalesce(tt.created_at, ti.created_at) end)) as granted_seconds
    from task_instances ti
    left join task_templates tt on tt.id = ti.template_id
    left join companies c on c.id = ti.company_id
    left join profiles cp on cp.id = tt.created_by
    where ti.due_at is not null and (p_include_standard or tt.standard_task_id is null)
      and ti.collaborator_id <> all(public.atrasos_excluded_ids())
      and (tt.created_by is null or tt.created_by <> all(public.atrasos_excluded_ids()))
      and (p_start is null or (ti.due_at at time zone 'America/Sao_Paulo')::date >= p_start)
      and (p_end   is null or (ti.due_at at time zone 'America/Sao_Paulo')::date <= p_end)
  ),
  flagged as (
    select b.collaborator_id, b.created_by, b.is_expired_raw as is_expired,
      (not b.is_expired_raw and b.done_late_raw) as completed_late,
      (not b.is_expired_raw and b.open_overdue_raw) as open_overdue,
      (not b.is_expired_raw and b.on_time_raw) as on_time,
      b.done_delay_seconds, b.granted_seconds
    from base b
    where (p_company is null or b.company_id = p_company)
      and (p_type is null or b.type_key = p_type)
      and (p_creator is null or b.created_by = p_creator)
      and (p_responsible is null or b.collaborator_id = p_responsible)
      and (p_status is null or p_status = ''
        or (p_status = 'completed_late' and not b.is_expired_raw and b.done_late_raw)
        or (p_status = 'open_overdue'   and not b.is_expired_raw and b.open_overdue_raw)
        or (p_status = 'expired'        and b.is_expired_raw))
      and (v_search = ''
        or lower(extensions.unaccent(coalesce(b.title, '')))        like '%' || v_search || '%'
        or lower(extensions.unaccent(coalesce(b.company_name, ''))) like '%' || v_search || '%'
        or lower(extensions.unaccent(coalesce(b.description, '')))  like '%' || v_search || '%'
        or lower(extensions.unaccent(coalesce(b.creator_name, '')))  like '%' || v_search || '%')
  )
  select jsonb_build_object(
    'responsibles', coalesce((
      select jsonb_agg(row_to_json(t)::jsonb order by t.late desc, t.total desc)
      from (select collaborator_id as id, count(*) as total,
          count(*) filter (where is_expired or completed_late or open_overdue) as late,
          round(100.0 * count(*) filter (where on_time) / nullif(count(*), 0)) as on_time_pct,
          count(*) filter (where completed_late) as completed_late,
          count(*) filter (where open_overdue) as open_overdue,
          count(*) filter (where is_expired) as expired,
          coalesce(round(percentile_cont(0.5) within group (order by done_delay_seconds) filter (where completed_late)), 0) as median_delay_seconds
        from flagged group by collaborator_id
        having count(*) filter (where is_expired or completed_late or open_overdue) > 0) t
    ), '[]'::jsonb),
    'creators', coalesce((
      select jsonb_agg(row_to_json(t)::jsonb order by t.late desc, t.total desc)
      from (select created_by as id, count(*) as total,
          count(*) filter (where is_expired or completed_late or open_overdue) as late,
          round(100.0 * count(*) filter (where on_time) / nullif(count(*), 0)) as on_time_pct,
          count(*) filter (where completed_late) as completed_late,
          count(*) filter (where open_overdue) as open_overdue,
          count(*) filter (where is_expired) as expired,
          coalesce(round(percentile_cont(0.5) within group (order by done_delay_seconds) filter (where completed_late)), 0) as median_delay_seconds,
          count(*) filter (where (is_expired or completed_late or open_overdue) and granted_seconds is not null and granted_seconds < 86400) as under24_late
        from flagged where created_by is not null group by created_by
        having count(*) filter (where is_expired or completed_late or open_overdue) > 0) t
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

create or replace function public.atrasos_cell_tasks(p_start date, p_end date, p_dimension text, p_person uuid, p_metric text, p_include_standard boolean DEFAULT false, p_status text DEFAULT NULL::text, p_creator uuid DEFAULT NULL::uuid, p_responsible uuid DEFAULT NULL::uuid, p_company uuid DEFAULT NULL::uuid, p_type text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, title text, company_id uuid, company_name text, type_key text, type_label text, responsible_id uuid, responsible_name text, responsible_avatar_path text, creator_id uuid, creator_name text, creator_avatar_path text, created_at timestamp with time zone, due_at timestamp with time zone, granted_seconds double precision, finished_at timestamp with time zone, delay_seconds double precision, situation text, total_count bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_search text := lower(extensions.unaccent(coalesce(nullif(btrim(p_search), ''), '')));
begin
  if not (select is_admin()) then
    raise exception 'atrasos_cell_tasks: acesso restrito a administradores.' using errcode = '42501';
  end if;
  return query
  with base as (
    select ti.id, ti.title, ti.company_id, c.name as company_name,
      ti.collaborator_id, rp.full_name as responsible_name, rp.avatar_path as responsible_avatar_path,
      tt.created_by, cp.full_name as creator_name, cp.avatar_path as creator_avatar_path,
      ti.created_at, ti.due_at, ti.finished_at, ti.status, ti.description,
      case when tt.category is not null then 'cat:' || tt.category::text
           when tt.template_type = 'listagem' then 'cat:listagem'
           else 'title:' || coalesce(nullif(btrim(tt.title), ''), ti.title) end as type_key,
      case when tt.category is not null then tt.category::text
           when tt.template_type = 'listagem' then 'Listagem'
           else coalesce(nullif(btrim(tt.title), ''), ti.title) end as type_label,
      extract(epoch from (ti.due_at - case when tt.kind = 'diaria' then ti.created_at else coalesce(tt.created_at, ti.created_at) end))::double precision as granted_seconds,
      exists (select 1 from task_auto_expirations ae where ae.task_id = ti.id) as is_expired_raw,
      (ti.status = 'finalizada' and ti.finished_at is not null and ti.finished_at > ti.due_at) as done_late_raw,
      (ti.status in ('a_fazer','iniciada') and ti.due_at < now()) as open_overdue_raw,
      (ti.status = 'finalizada' and ti.finished_at is not null and ti.finished_at <= ti.due_at) as on_time_raw,
      (select min(ae.expired_at) from task_auto_expirations ae where ae.task_id = ti.id) as expired_at
    from task_instances ti
    left join task_templates tt on tt.id = ti.template_id
    left join companies c on c.id = ti.company_id
    left join profiles rp on rp.id = ti.collaborator_id
    left join profiles cp on cp.id = tt.created_by
    where ti.due_at is not null and (p_include_standard or tt.standard_task_id is null)
      and ti.collaborator_id <> all(public.atrasos_excluded_ids())
      and (tt.created_by is null or tt.created_by <> all(public.atrasos_excluded_ids()))
      and (p_start is null or (ti.due_at at time zone 'America/Sao_Paulo')::date >= p_start)
      and (p_end   is null or (ti.due_at at time zone 'America/Sao_Paulo')::date <= p_end)
      and (p_dimension <> 'creator'     or tt.created_by = p_person)
      and (p_dimension <> 'responsible' or ti.collaborator_id = p_person)
      and (p_company is null or ti.company_id = p_company)
      and (p_creator is null or tt.created_by = p_creator)
      and (p_responsible is null or ti.collaborator_id = p_responsible)
  ),
  typed as (
    select b.*,
      (p_type is null or b.type_key = p_type) as type_ok,
      (v_search = ''
        or lower(extensions.unaccent(coalesce(b.title, '')))        like '%' || v_search || '%'
        or lower(extensions.unaccent(coalesce(b.company_name, ''))) like '%' || v_search || '%'
        or lower(extensions.unaccent(coalesce(b.description, '')))  like '%' || v_search || '%'
        or lower(extensions.unaccent(coalesce(b.creator_name, '')))  like '%' || v_search || '%') as search_ok
    from base b
  ),
  flagged as (
    select t.*, t.is_expired_raw as is_expired,
      (not t.is_expired_raw and t.done_late_raw) as completed_late,
      (not t.is_expired_raw and t.open_overdue_raw) as open_overdue,
      case when t.is_expired_raw then 'expired' when t.done_late_raw then 'completed_late'
           when t.open_overdue_raw then 'open_overdue' when t.on_time_raw then 'on_time'
           else 'pending' end as situation,
      (case when t.is_expired_raw then extract(epoch from (coalesce(t.expired_at, now()) - t.due_at))
            when t.done_late_raw then extract(epoch from (t.finished_at - t.due_at))
            when t.open_overdue_raw then extract(epoch from (now() - t.due_at)) end)::double precision as delay_seconds
    from typed t
    where t.type_ok and t.search_ok
      and (p_status is null or p_status = ''
        or (p_status = 'completed_late' and not t.is_expired_raw and t.done_late_raw)
        or (p_status = 'open_overdue'   and not t.is_expired_raw and t.open_overdue_raw)
        or (p_status = 'expired'        and t.is_expired_raw))
  ),
  metric as (
    select f.* from flagged f
    where case p_metric
        when 'total' then true
        when 'completed_late' then f.completed_late
        when 'open_overdue' then f.open_overdue
        when 'expired' then f.is_expired
        when 'under24' then (f.is_expired or f.completed_late or f.open_overdue) and f.granted_seconds is not null and f.granted_seconds < 86400
        else true end
  ),
  ordered as (
    select m.*, count(*) over() as total_count from metric m
    order by m.delay_seconds desc nulls last, m.id desc
    limit greatest(p_limit, 0) offset greatest(p_offset, 0)
  )
  select o.id, o.title, o.company_id, o.company_name, o.type_key, o.type_label,
    o.collaborator_id, o.responsible_name, o.responsible_avatar_path,
    o.created_by, o.creator_name, o.creator_avatar_path,
    o.created_at, o.due_at, o.granted_seconds, o.finished_at, o.delay_seconds, o.situation, o.total_count
  from ordered o order by o.delay_seconds desc nulls last, o.id desc;
end;
$function$;

create or replace function public.collaborator_tasks_page(p_collaborator uuid, p_start date, p_end date, p_status text DEFAULT NULL::text, p_company uuid DEFAULT NULL::uuid, p_type text DEFAULT NULL::text, p_creator uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_order text DEFAULT 'recentes'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, title text, status task_status, due_at timestamp with time zone, task_date date, finished_at timestamp with time zone, total_seconds integer, company_id uuid, company_name text, type_key text, type_label text, only_by_work boolean, created_by uuid, creator_name text, creator_avatar_path text, from_standard boolean, system_generated boolean, has_origin boolean, adjustment_count integer, adjustments jsonb, total_count bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_search text := lower(extensions.unaccent(coalesce(nullif(btrim(p_search), ''), '')));
  v_from timestamptz := case when p_start is null then null else (p_start::timestamp at time zone 'America/Sao_Paulo') end;
  v_to   timestamptz := case when p_end is null then null else ((p_end + 1)::timestamp at time zone 'America/Sao_Paulo') end;
begin
  if not (select is_admin()) then
    raise exception 'collaborator_tasks_page: acesso restrito a administradores.' using errcode = '42501';
  end if;
  return query
  with rows as (
    select
      ti.id, ti.title, ti.status, ti.due_at, ti.task_date, ti.finished_at,
      ti.total_seconds, ti.company_id, c.name as company_name, ti.description,
      case when tt.category is not null then 'cat:' || tt.category::text
           when tt.template_type = 'listagem' then 'cat:listagem'
           else 'title:' || coalesce(nullif(btrim(tt.title), ''), ti.title) end as type_key,
      case when tt.category is not null then tt.category::text
           when tt.template_type = 'listagem' then 'Listagem'
           else coalesce(nullif(btrim(tt.title), ''), ti.title) end as type_label,
      not task_in_period(ti.due_at, ti.status, p_start, p_end) as only_by_work,
      tt.created_by as created_by,
      nullif(btrim(p2.full_name), '') as creator_name,
      p2.avatar_path as creator_avatar_path,
      (tt.standard_task_id is not null) as from_standard,
      (tt.created_at is not null and ti.created_at is not null
         and ti.created_at - tt.created_at > interval '5 minutes') as system_generated,
      (tt.id is not null) as has_origin
    from task_instances ti
    left join companies      c  on c.id  = ti.company_id
    left join task_templates tt on tt.id = ti.template_id
    left join profiles       p2 on p2.id = tt.created_by
    where ti.collaborator_id = p_collaborator
      and (task_in_period(ti.due_at, ti.status, p_start, p_end)
        or exists (select 1 from time_entries te where te.task_id = ti.id
          and (v_from is null or te.started_at >= v_from) and (v_to is null or te.started_at < v_to)))
  ),
  filtered as (
    select r.* from rows r
    where (p_company is null or r.company_id = p_company)
      and (p_type is null or r.type_key = p_type)
      and (p_creator is null or r.created_by = p_creator)
      and (p_status is null or p_status = ''
        or (p_status in ('atrasada','atrasadas') and r.status in ('a_fazer','iniciada') and r.due_at < now())
        or (p_status in ('a_fazer','iniciada','finalizada','cancelada') and r.status::text = p_status))
      and (v_search = ''
        or lower(extensions.unaccent(coalesce(r.title,''))) like '%' || v_search || '%'
        or lower(extensions.unaccent(coalesce(r.company_name,''))) like '%' || v_search || '%'
        or lower(extensions.unaccent(coalesce(r.description,''))) like '%' || v_search || '%'
        or lower(extensions.unaccent(coalesce(r.creator_name,''))) like '%' || v_search || '%')
  ),
  ordered as (
    select f.*, count(*) over() as total_count from filtered f
    order by case when p_order = 'antigas' then f.due_at end asc nulls last,
      case when p_order = 'proximo' then abs(extract(epoch from (f.due_at - now()))) end asc nulls last,
      case when p_order not in ('antigas','proximo') then f.due_at end desc nulls last, f.id desc
    limit greatest(p_limit, 0) offset greatest(p_offset, 0)
  )
  select
    o.id, o.title, o.status, o.due_at, o.task_date, o.finished_at,
    o.total_seconds, o.company_id, o.company_name, o.type_key, o.type_label, o.only_by_work,
    o.created_by, o.creator_name, o.creator_avatar_path, o.from_standard, o.system_generated, o.has_origin,
    coalesce(adj.cnt, 0), coalesce(adj.items, '[]'::jsonb), o.total_count
  from ordered o
  left join lateral (
    select count(*)::int as cnt,
      jsonb_agg(jsonb_build_object('oldSeconds', ta.old_seconds, 'newSeconds', ta.new_seconds,
        'reason', ta.reason, 'at', ta.created_at, 'by', coalesce(pr.full_name, pr.email, 'admin'))
        order by ta.created_at desc) as items
    from time_adjustments ta left join profiles pr on pr.id = ta.adjusted_by
    where ta.task_id = o.id
  ) adj on true
  order by case when p_order = 'antigas' then o.due_at end asc nulls last,
    case when p_order = 'proximo' then abs(extract(epoch from (o.due_at - now()))) end asc nulls last,
    case when p_order not in ('antigas','proximo') then o.due_at end desc nulls last, o.id desc;
end;
$function$;

-- Remove o helper e a coluna (por último, após as funções não a referenciarem)
drop function if exists public.company_search_match(text, text, text);
alter table public.companies drop column if exists trade_name;

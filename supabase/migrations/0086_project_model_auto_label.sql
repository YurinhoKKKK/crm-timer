-- =====================================================================
-- Etiqueta automática a partir do modelo do projeto
-- =====================================================================
-- Ao DEFINIR/TROCAR o modelo do projeto, a empresa recebe automaticamente a
-- etiqueta correspondente:
--   consultoria → "CONSULTORIA"    bpo → "BPO"    ema → "Ema"
--
-- REGRAS (idênticas nos DOIS caminhos — tela e intake do CRM):
--  · Resolve a etiqueta pelo NOME em tempo de execução (nunca id fixo).
--  · Ao TROCAR o modelo, remove a etiqueta de modelo ANTIGA e põe a nova — nunca
--    acumula duas etiquetas de modelo na mesma empresa. O "conjunto de modelo" é
--    exatamente {CONSULTORIA, BPO, Ema}; nenhuma OUTRA etiqueta (ALERTA etc.) é
--    tocada.
--  · Só age quando o modelo REALMENTE MUDA. Editar outros campos não re-sincroniza
--    — a etiqueta pode ter sido alterada à mão de propósito (divergência
--    consciente; ver aviso na tela). Modelo → "não informado" (null) não remove
--    nada (não há "nova" para pôr no lugar).
--  · Se a etiqueta não existir pelo nome (renomeada/apagada), NÃO falha a criação
--    nem o salvamento: segue normalmente e emite um NOTICE (aviso no log).
--
-- Implementação INLINE nas duas funções (bloco pequeno, sem função helper
-- compartilhada de propósito): na tela, company_details_save roda SECURITY
-- INVOKER e a escrita em company_labels é guardada pela RLS cl_manage (admin);
-- no intake, crm_intake_create roda SECURITY DEFINER (sistema, atrás do segredo).
-- =====================================================================

-- ---------------------------------------------------------------------
-- company_details_save — igual à 0083, agora com a etiqueta automática do
-- modelo aplicada SÓ quando o modelo muda (preserva divergência manual).
-- ---------------------------------------------------------------------
create or replace function company_details_save(
  p_company       uuid,
  p_project_model text,
  p_started_on    date,
  p_ends_on       date,
  p_cadence       text,
  p_system_used   text,
  p_main_pain     text,
  p_about         text,
  p_channels      text[]
)
returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_model     project_model    := nullif(btrim(coalesce(p_project_model, '')), '')::project_model;
  v_cadence   contract_cadence := nullif(btrim(coalesce(p_cadence, '')), '')::contract_cadence;
  v_system    text := nullif(btrim(coalesce(p_system_used, '')), '');
  v_pain      text := nullif(btrim(coalesce(p_main_pain, '')), '');
  v_about     text := nullif(btrim(coalesce(p_about, '')), '');
  v_old_model project_model;
  v_label_name text;
  v_label_id   uuid;
begin
  -- Modelo ANTES do upsert (para saber se está mudando).
  select project_model into v_old_model
    from company_details where company_id = p_company;

  insert into company_details
    (company_id, project_model, started_on, ends_on, cadence,
     system_used, main_pain, about)
  values
    (p_company, v_model, p_started_on, p_ends_on, v_cadence,
     v_system, v_pain, v_about)
  on conflict (company_id) do update set
    project_model = excluded.project_model,
    started_on    = excluded.started_on,
    ends_on       = excluded.ends_on,
    cadence       = excluded.cadence,
    system_used   = excluded.system_used,
    main_pain     = excluded.main_pain,
    about         = excluded.about;  -- trigger carimba updated_*

  -- Sincroniza os serviços contratados: remove os que saíram, insere os novos.
  delete from company_contracted_channels
   where company_id = p_company
     and channel <> all (
       select c::contracted_service
         from unnest(coalesce(p_channels, '{}')) as c
     );

  insert into company_contracted_channels (company_id, channel)
  select p_company, c::contracted_service
    from unnest(coalesce(p_channels, '{}')) as c
  on conflict (company_id, channel) do nothing;

  -- Etiqueta automática do modelo: SÓ quando o modelo realmente muda e o novo
  -- não é null (não re-sincroniza edições de outros campos; não desfaz ajuste
  -- manual da etiqueta).
  if v_model is not null and v_model is distinct from v_old_model then
    v_label_name := case v_model
                      when 'consultoria' then 'CONSULTORIA'
                      when 'bpo'         then 'BPO'
                      when 'ema'         then 'Ema'
                      else null end;
    if v_label_name is not null then
      select id into v_label_id
        from labels where lower(name) = lower(v_label_name) limit 1;

      -- Remove as etiquetas de modelo que NÃO são a alvo (não toca em outras).
      delete from company_labels cl
       using labels l
       where cl.company_id = p_company
         and cl.label_id = l.id
         and lower(l.name) in ('consultoria', 'bpo', 'ema')
         and (v_label_id is null or cl.label_id <> v_label_id);

      if v_label_id is not null then
        insert into company_labels (company_id, label_id)
        values (p_company, v_label_id)
        on conflict do nothing;
      else
        raise notice 'Etiqueta de modelo "%" não encontrada; empresa % salva sem a etiqueta.',
          v_label_name, p_company;
      end if;
    end if;
  end if;
end;
$$;

grant execute on function company_details_save(
  uuid, text, date, date, text, text, text, text, text[]
) to authenticated;

-- ---------------------------------------------------------------------
-- crm_intake_create — igual à 0085, agora aplicando a etiqueta do modelo logo
-- após criar company_details (empresa nova: modelo acabou de ser definido).
-- ---------------------------------------------------------------------
create or replace function crm_intake_create(
  p_payload jsonb,
  p_source  text default null,
  p_ip      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ip_hash   text := case when p_ip is null then null
                           else encode(digest(p_ip, 'sha256'), 'hex') end;
  v_recent    integer;
  v_num_txt   text := btrim(coalesce(p_payload->>'number', ''));
  v_log_num   integer := case when btrim(coalesce(p_payload->>'number','')) ~ '^\d{1,9}$'
                              then btrim(p_payload->>'number')::int else null end;
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
  v_services  text[];
  v_svc       text;
  v_started_d date;
  v_ends_d    date;
  v_name      text;
  v_group     uuid;
  v_company   uuid;
  v_hit       record;
  v_label_name text;
  v_label_id   uuid;
  v_date_re   text := '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$';
  v_text_cap  int := 5000;
begin
  select count(*) into v_recent
    from crm_intake_log
   where action = 'create'
     and received_at > now() - interval '1 minute';
  if v_recent >= 60 then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'rate_limited', 'Limite de requisições por minuto excedido.', 'rate_limited');
  end if;

  if v_num_txt = '' then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'Número da empresa é obrigatório.', 'refused_validation');
  end if;
  if v_num_txt !~ '^\d{1,9}$' then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'Número deve ser um inteiro positivo (até 9 dígitos).', 'refused_validation');
  end if;
  v_number := v_num_txt::int;
  if v_number < 1 then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'Número deve ser maior que zero.', 'refused_validation');
  end if;

  if v_razao = '' then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'Razão social é obrigatória.', 'refused_validation');
  end if;
  if char_length(v_razao) > 200 then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'Razão social muito longa (máx. 200).', 'refused_validation');
  end if;
  if v_contato is not null and char_length(v_contato) > 120 then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'Contato muito longo (máx. 120).', 'refused_validation');
  end if;

  if v_cnpj is null then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'CNPJ é obrigatório.', 'refused_validation');
  end if;
  if length(v_cnpj) <> 14 or not is_valid_cnpj(v_cnpj) then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'CNPJ inválido.', 'refused_validation');
  end if;

  if v_model is not null and v_model not in ('bpo', 'consultoria', 'ema') then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'Modelo de projeto inválido (bpo|consultoria|ema).', 'refused_validation');
  end if;
  if v_cadence is not null and v_cadence not in
       ('semanal', 'quinzenal', 'semanal_quinzenal', 'quinzenal_semanal') then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'Cadência inválida.', 'refused_validation');
  end if;

  if v_started is not null then
    if v_started !~ v_date_re then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'validation', 'started_on inválida (AAAA-MM-DD).', 'refused_validation');
    end if;
    begin v_started_d := v_started::date;
    exception when others then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'validation', 'started_on não é uma data válida.', 'refused_validation');
    end;
  end if;
  if v_ends is not null then
    if v_ends !~ v_date_re then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'validation', 'ends_on inválida (AAAA-MM-DD).', 'refused_validation');
    end if;
    begin v_ends_d := v_ends::date;
    exception when others then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'validation', 'ends_on não é uma data válida.', 'refused_validation');
    end;
  end if;
  if v_started_d is not null and v_ends_d is not null and v_ends_d < v_started_d then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'ends_on não pode ser antes de started_on.', 'refused_validation');
  end if;

  if coalesce(char_length(v_system), 0) > v_text_cap
     or coalesce(char_length(v_pain), 0) > v_text_cap
     or coalesce(char_length(v_about), 0) > v_text_cap then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'Um dos textos excede 5000 caracteres.', 'refused_validation');
  end if;

  if p_payload ? 'contracted_services'
     and jsonb_typeof(p_payload->'contracted_services') is distinct from 'null' then
    if jsonb_typeof(p_payload->'contracted_services') <> 'array' then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'validation', 'contracted_services deve ser uma lista.', 'refused_validation');
    end if;
    select array_agg(distinct btrim(x)) into v_services
      from jsonb_array_elements_text(p_payload->'contracted_services') as t(x)
     where btrim(x) <> '';
    if v_services is not null then
      foreach v_svc in array v_services loop
        if v_svc not in ('mercado_livre','shopee','amazon','trafego','gestao_site','desenvolvimento_site') then
          return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
                   'validation', 'Serviço contratado inválido: ' || v_svc, 'refused_validation');
        end if;
      end loop;
    end if;
  end if;

  select c.id, c.name into v_hit
    from companies c
   where c.cnpj = v_cnpj
   limit 1;
  if found then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'cnpj_in_use',
             'O CNPJ informado já está cadastrado na empresa "' || v_hit.name || '".',
             'refused_cnpj',
             jsonb_build_object('id', v_hit.id, 'name', v_hit.name));
  end if;

  select c.id, c.name into v_hit
    from companies c
   where crm_name_number(c.name) = v_number
   limit 1;
  if found then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'number_in_use',
             'O número ' || v_number || ' já está em uso pela empresa "' || v_hit.name || '".',
             'refused_number',
             jsonb_build_object('id', v_hit.id, 'name', v_hit.name));
  end if;

  select s.id, s.name, s.group_name, s.sim into v_hit
    from crm_similar_companies(v_razao, 0.80, 1) s
   where s.sim >= 0.80 or crm_core_name(s.name) = crm_core_name(v_razao)
   order by s.sim desc
   limit 1;
  if found then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'duplicate',
             'Já existe empresa muito parecida: "' || v_hit.name || '".',
             'refused_duplicate',
             jsonb_build_object('id', v_hit.id, 'name', v_hit.name,
                                'group', v_hit.group_name,
                                'similarity', round(v_hit.sim::numeric, 3)));
  end if;

  select id into v_group from company_groups where lower(name) = 'on boarding' limit 1;
  if v_group is null then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'internal', 'Grupo "On Boarding" não encontrado.', 'error');
  end if;

  v_name := v_number || '. ' || v_razao
            || case when v_contato is not null then ' (' || v_contato || ')' else '' end;

  begin
    insert into companies (name, group_id, created_by, cnpj)
    values (v_name, v_group, null, v_cnpj)
    returning id into v_company;

    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (v_company, 'empresa_criada_crm',
            'Empresa criada a partir do CRM comercial',
            jsonb_build_object('number', v_number, 'source', p_source),
            null);

    insert into company_details
      (company_id, project_model, started_on, ends_on, cadence,
       system_used, main_pain, about)
    values
      (v_company,
       v_model::project_model,
       v_started_d, v_ends_d,
       v_cadence::contract_cadence,
       v_system, v_pain, v_about);

    -- Etiqueta automática do modelo (empresa nova → modelo acabou de ser
    -- definido). Resolve por nome; não falha se a etiqueta não existir.
    if v_model is not null then
      v_label_name := case v_model
                        when 'consultoria' then 'CONSULTORIA'
                        when 'bpo'         then 'BPO'
                        when 'ema'         then 'Ema'
                        else null end;
      if v_label_name is not null then
        select id into v_label_id
          from labels where lower(name) = lower(v_label_name) limit 1;
        if v_label_id is not null then
          insert into company_labels (company_id, label_id)
          values (v_company, v_label_id)
          on conflict do nothing;
        else
          raise notice 'Etiqueta de modelo "%" não encontrada; empresa % criada sem a etiqueta.',
            v_label_name, v_company;
        end if;
      end if;
    end if;

    if v_services is not null and array_length(v_services, 1) > 0 then
      insert into company_contracted_channels (company_id, channel)
      select v_company, x::contracted_service
        from unnest(v_services) as x
      on conflict (company_id, channel) do nothing;
    end if;

  exception
    when unique_violation then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'duplicate',
               'Já existe empresa com este nome ou CNPJ (' || v_name || ').',
               'refused_duplicate');
    when others then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'internal', 'Falha ao criar: ' || sqlerrm, 'error');
  end;

  insert into crm_intake_log
    (action, source, ip_hash, number, razao_social, result, reason, company_id, payload)
  values ('create', p_source, v_ip_hash, v_number, left(v_razao, 200),
          'created', 'Empresa criada em On Boarding', v_company, p_payload);

  return jsonb_build_object('ok', true, 'id', v_company, 'name', v_name);
end;
$$;

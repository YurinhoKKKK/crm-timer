-- =====================================================================
-- Modelo de projeto "Ema" + CNPJ da empresa
-- =====================================================================
-- DUAS mudanças, ambas na fronteira "Informações do cliente" + intake do CRM:
--
--  1) NOVO modelo de projeto 'ema' no enum project_model (hoje bpo/consultoria).
--     É campo PRÓPRIO — NÃO é o grupo "Ema" nem a etiqueta "Ema" (três coisas
--     distintas, decisão consciente; não sincronizam). Ver [[informacoes-do-cliente]].
--
--  2) CNPJ da empresa (companies.cnpj). Antes NÃO existia em lugar nenhum.
--     · Guarda SOMENTE OS DÍGITOS (14), sem máscara — formatação é de exibição.
--     · ÚNICO quando não nulo (índice parcial).
--     · Validado no banco: 14 dígitos + os DOIS dígitos verificadores. CNPJ
--       inválido é RECUSADO (nunca "corrigido"). CHECK como rede de segurança.
--     · SEM backfill: as 148 empresas atuais ficam sem CNPJ (esperado).
--
--     O CNPJ passa a ser o CRITÉRIO FORTE de duplicidade no intake do CRM:
--     CNPJ igual = duplicado, bloqueio direto (409 cnpj_in_use), sem depender do
--     nome. A semelhança de nome CONTINUA como rede de segurança (as empresas
--     atuais não têm CNPJ e nunca casariam por ele).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Enum project_model ganha 'ema'. (PG12+ permite ADD VALUE dentro de
--    transação desde que o valor não seja USADO na mesma transação — e não é.)
-- ---------------------------------------------------------------------
alter type project_model add value if not exists 'ema';

-- ---------------------------------------------------------------------
-- 2a) Validador de CNPJ — 14 dígitos + dígitos verificadores. IMMUTABLE para
--     poder ser usado em CHECK. Recebe só dígitos (o chamador normaliza), mas é
--     defensivo: tira qualquer não-dígito antes de conferir.
-- ---------------------------------------------------------------------
create or replace function is_valid_cnpj(p text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  d  text  := regexp_replace(coalesce(p, ''), '\D', '', 'g');
  w1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  w2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  s  int;
  r  int;
  i  int;
begin
  if length(d) <> 14 then
    return false;
  end if;
  -- Sequências repetidas (00000000000000, 11111111111111, …) passam na conta
  -- dos dígitos verificadores mas são inválidas.
  if d ~ '^(\d)\1{13}$' then
    return false;
  end if;

  -- 1º dígito verificador (sobre os 12 primeiros).
  s := 0;
  for i in 1..12 loop
    s := s + substr(d, i, 1)::int * w1[i];
  end loop;
  r := s % 11;
  if (case when r < 2 then 0 else 11 - r end) <> substr(d, 13, 1)::int then
    return false;
  end if;

  -- 2º dígito verificador (sobre os 13 primeiros).
  s := 0;
  for i in 1..13 loop
    s := s + substr(d, i, 1)::int * w2[i];
  end loop;
  r := s % 11;
  if (case when r < 2 then 0 else 11 - r end) <> substr(d, 14, 1)::int then
    return false;
  end if;

  return true;
end;
$$;

-- ---------------------------------------------------------------------
-- 2b) Coluna cnpj + integridade. Só dígitos, 14 caracteres, verificadores
--     válidos; ÚNICO quando não nulo. Sem backfill.
-- ---------------------------------------------------------------------
alter table companies add column if not exists cnpj text;

alter table companies
  add constraint companies_cnpj_valid
  check (cnpj is null or (cnpj ~ '^\d{14}$' and is_valid_cnpj(cnpj)));

-- Único só entre os preenchidos (as empresas atuais, todas nulas, não colidem).
create unique index if not exists companies_cnpj_key
  on companies (cnpj) where cnpj is not null;

-- ---------------------------------------------------------------------
-- 2c) crm_intake_create — agora exige CNPJ, bloqueia CNPJ já em uso, aceita
--     o modelo 'ema' e grava companies.cnpj. Resto idêntico à 0084.
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
  v_cnpj_raw  text := btrim(coalesce(p_payload->>'cnpj', ''));
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
  v_date_re   text := '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$';
  v_text_cap  int := 5000;
begin
  -- Rate limit: 60 criações/min.
  select count(*) into v_recent
    from crm_intake_log
   where action = 'create'
     and received_at > now() - interval '1 minute';
  if v_recent >= 60 then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'rate_limited', 'Limite de requisições por minuto excedido.', 'rate_limited');
  end if;

  -- Número: obrigatório e inteiro positivo.
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

  -- Razão social: obrigatória.
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

  -- CNPJ: OBRIGATÓRIO. Aceita com ou sem máscara; guarda só os 14 dígitos.
  -- Valida os dígitos verificadores. Inválido/ausente → recusa (422).
  if v_cnpj is null then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'CNPJ é obrigatório.', 'refused_validation');
  end if;
  if length(v_cnpj) <> 14 or not is_valid_cnpj(v_cnpj) then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'CNPJ inválido.', 'refused_validation');
  end if;

  -- Enums opcionais.
  if v_model is not null and v_model not in ('bpo', 'consultoria', 'ema') then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'Modelo de projeto inválido (bpo|consultoria|ema).', 'refused_validation');
  end if;
  if v_cadence is not null and v_cadence not in
       ('semanal', 'quinzenal', 'semanal_quinzenal', 'quinzenal_semanal') then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'Cadência inválida.', 'refused_validation');
  end if;

  -- Datas: texto AAAA-MM-DD válido; fim >= início.
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

  -- Textos livres: teto de tamanho.
  if coalesce(char_length(v_system), 0) > v_text_cap
     or coalesce(char_length(v_pain), 0) > v_text_cap
     or coalesce(char_length(v_about), 0) > v_text_cap then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'Um dos textos excede 5000 caracteres.', 'refused_validation');
  end if;

  -- Marketplaces/serviços contratados: cada um dentro do enum contracted_service.
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

  -- CNPJ já cadastrado em outra empresa? DUPLICADO FORTE — bloqueia direto, sem
  -- depender do nome.
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

  -- Número já em uso no nome de outra empresa? Recusa.
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

  -- Duplicado FORTE por nome? Recusa (rede de segurança — as empresas atuais não
  -- têm CNPJ e nunca casariam por ele).
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

  -- Grupo "On Boarding" (resolvido por nome).
  select id into v_group from company_groups where lower(name) = 'on boarding' limit 1;
  if v_group is null then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'internal', 'Grupo "On Boarding" não encontrado.', 'error');
  end if;

  -- Monta o nome no padrão atual.
  v_name := v_number || '. ' || v_razao
            || case when v_contato is not null then ' (' || v_contato || ')' else '' end;

  -- Criação ATÔMICA. Subtransação: se qualquer passo falhar, nada é criado, e
  -- ainda assim conseguimos AUDITAR (o insert de log no handler persiste).
  begin
    insert into companies (name, group_id, created_by, cnpj)
    values (v_name, v_group, null, v_cnpj)
    returning id into v_company;

    -- Evento no histórico: veio do CRM comercial. Ator = sistema (null).
    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (v_company, 'empresa_criada_crm',
            'Empresa criada a partir do CRM comercial',
            jsonb_build_object('number', v_number, 'source', p_source),
            null);

    -- Informações do cliente (dispara o gatilho informacoes_alteradas).
    insert into company_details
      (company_id, project_model, started_on, ends_on, cadence,
       system_used, main_pain, about)
    values
      (v_company,
       v_model::project_model,
       v_started_d, v_ends_d,
       v_cadence::contract_cadence,
       v_system, v_pain, v_about);

    -- Serviços contratados.
    if v_services is not null and array_length(v_services, 1) > 0 then
      insert into company_contracted_channels (company_id, channel)
      select v_company, x::contracted_service
        from unnest(v_services) as x
      on conflict (company_id, channel) do nothing;
    end if;

  exception
    when unique_violation then
      -- Corrida: nome idêntico OU CNPJ criado em paralelo. Trata como duplicado.
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'duplicate',
               'Já existe empresa com este nome ou CNPJ (' || v_name || ').',
               'refused_duplicate');
    when others then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'internal', 'Falha ao criar: ' || sqlerrm, 'error');
  end;

  -- Sucesso.
  insert into crm_intake_log
    (action, source, ip_hash, number, razao_social, result, reason, company_id, payload)
  values ('create', p_source, v_ip_hash, v_number, left(v_razao, 200),
          'created', 'Empresa criada em On Boarding', v_company, p_payload);

  return jsonb_build_object('ok', true, 'id', v_company, 'name', v_name);
end;
$$;

-- ---------------------------------------------------------------------
-- 2d) crm_intake_check_duplicate — agora aceita cnpj (opcional) além da razão
--     social e SINALIZA a natureza da correspondência: por CNPJ (certeza,
--     match_type 'cnpj') ou por NOME (aproximada, match_type 'name').
--     Assinatura mudou (novo p_cnpj) → drop + recreate para não gerar overload
--     ambíguo com a versão de 3 args.
-- ---------------------------------------------------------------------
drop function if exists crm_intake_check_duplicate(text, text, text);

create or replace function crm_intake_check_duplicate(
  p_razao  text,
  p_source text default null,
  p_ip     text default null,
  p_cnpj   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_razao      text := btrim(coalesce(p_razao, ''));
  v_cnpj       text := nullif(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'), '');
  v_ip_hash    text := case when p_ip is null then null
                            else encode(digest(p_ip, 'sha256'), 'hex') end;
  v_recent     integer;
  v_matches    jsonb;
  v_cnpj_match jsonb := null;
begin
  -- Rate limit: 120 conferências/min (leitura, teto mais folgado que o de criar).
  select count(*) into v_recent
    from crm_intake_log
   where action = 'dedup'
     and received_at > now() - interval '1 minute';
  if v_recent >= 120 then
    return crm_intake_refuse('dedup', p_source, v_ip_hash, null, v_razao, null,
             'rate_limited', 'Limite de requisições por minuto excedido.', 'rate_limited');
  end if;

  if v_razao = '' then
    return crm_intake_refuse('dedup', p_source, v_ip_hash, null, null, null,
             'validation', 'Informe a razão social.', 'refused_validation');
  end if;

  -- Correspondência por CNPJ = CERTEZA (quando o CRM manda um CNPJ válido e ele
  -- já existe aqui). Independe do nome.
  if v_cnpj is not null and length(v_cnpj) = 14 and is_valid_cnpj(v_cnpj) then
    select jsonb_build_object(
             'id', c.id, 'name', c.name, 'group', g.name,
             'match_type', 'cnpj', 'certain', true
           )
      into v_cnpj_match
      from companies c
      left join company_groups g on g.id = c.group_id
     where c.cnpj = v_cnpj
     limit 1;
  end if;

  -- Correspondência por NOME = APROXIMADA (a rede de segurança de sempre).
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name, 'group', s.group_name,
           'similarity', round(s.sim::numeric, 3),
           'match_type', 'name', 'certain', false
         ) order by s.sim desc, s.name), '[]'::jsonb)
    into v_matches
    from crm_similar_companies(v_razao, 0.35, 20) s;

  insert into crm_intake_log (action, source, ip_hash, razao_social, result, reason)
  values ('dedup', p_source, v_ip_hash, left(v_razao, 200), 'ok',
          case when v_cnpj_match is not null then 'cnpj + ' else '' end
          || jsonb_array_length(v_matches) || ' por nome');

  return jsonb_build_object(
           'ok', true,
           'cnpj_match', coalesce(v_cnpj_match, 'null'::jsonb),
           'matches', v_matches
         );
end;
$$;

-- Concessões: SÓ o service_role chama a RPC (porta de servidor atrás do segredo).
revoke all on function crm_intake_check_duplicate(text, text, text, text) from public;
grant execute on function crm_intake_check_duplicate(text, text, text, text) to service_role;

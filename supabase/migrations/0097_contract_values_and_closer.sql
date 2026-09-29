-- =====================================================================
-- Valores do contrato (RESTRITOS) + Closer (exibido) — vindos do CRM comercial
-- =====================================================================
-- QUATRO campos novos chegam do CRM comercial no fechamento. TRÊS são valores
-- comerciais RESTRITOS (só admin) e UM é exibido (o closer).
--
-- DECISÕES (não reabrir):
--  1) Valor mensal NÃO é guardado. É DERIVADO de project_value / installments,
--     sempre na EXIBIÇÃO. Parcelas nula/zero não calcula (não divide por zero).
--  2) closer_name é TEXTO com o nome (não vínculo com profiles: os closers são do
--     time comercial e não têm conta aqui). Sem foto por ora.
--  3) closer_name NÃO é editável neste sistema — é RÉPLICA do que veio do CRM.
--  4) Os valores do contrato são visíveis SOMENTE para ADMIN.
--
-- POR QUE TABELA SEPARADA (ponto central): company_details é legível por todos
-- que ALCANÇAM a empresa — inclusive colaborador. "Oculto na tela" NÃO é oculto:
-- o valor chegaria na resposta da API mesmo sem ser renderizado. Estes números
-- são diferentes do faturamento (quanto o cliente VENDE); aqui é quanto o cliente
-- PAGA à Monvatti — informação comercial interna. Por isso: tabela própria com
-- RLS admin-only, fora de qualquer leitura que consultor/colaborador alcancem.
--
-- DINHEIRO em numeric(14,2), NUNCA float.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PARTE 1 — Valores do contrato (tabela NOVA, separada, RESTRITA a admin).
-- Não aparece em nenhuma tela por ora: fica guardada para o futuro quadro de
-- Sucesso do Cliente. O valor mensal NÃO é coluna — é derivado na exibição.
-- ---------------------------------------------------------------------
create table company_contract_values (
  company_id    uuid primary key references companies(id) on delete cascade,
  project_value numeric(14,2),   -- valor total do projeto (o que o cliente PAGA)
  installments  integer,         -- número de parcelas
  updated_at    timestamptz not null default now(),
  updated_by    uuid references profiles(id),
  check (installments is null or installments > 0)
);

alter table company_contract_values enable row level security;

-- RLS: leitura, escrita e QUALQUER acesso SOMENTE para admin. Consultor e
-- colaborador não leem — nem por RPC, nem por PostgREST. anon nunca.
-- (Uma única policy "for all" com is_admin() no using e no with check.)
create policy ccv_admin_all on company_contract_values
  for all
  using (is_admin())
  with check (is_admin());

-- Defesa em profundidade: mesmo com a RLS ligada, tiramos qualquer privilégio
-- de tabela de anon/authenticated concedido por padrão pelo Supabase. Quem grava
-- estes valores é a RPC crm_intake_create (SECURITY DEFINER, roda como dono e
-- ignora RLS); o admin lê/escreve pela RLS acima (authenticated + is_admin()).
revoke all on company_contract_values from anon;

-- Carimba updated_at/updated_by e congela a identidade da linha (mesmo padrão de
-- company_details). Em escrita pela RPC SECURITY DEFINER, auth.uid() é null
-- (ator = sistema), o que é esperado para o intake do CRM.
create or replace function company_contract_values_touch()
returns trigger
language plpgsql security invoker set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.company_id := old.company_id;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger trg_company_contract_values_touch
  before insert or update on company_contract_values
  for each row execute function company_contract_values_touch();

-- ---------------------------------------------------------------------
-- PARTE 2 — Closer (exibido). Réplica do CRM comercial; texto simples. Vai para
-- company_details (legível por quem alcança a empresa — e tudo bem: é o NOME do
-- vendedor, não valor comercial). Somente leitura na tela; nem admin edita.
-- ---------------------------------------------------------------------
alter table company_details add column if not exists closer_name text;

-- ---------------------------------------------------------------------
-- PARTE 3 — crm_intake_create passa a aceitar project_value, installments e
-- closer_name (todos OPCIONAIS). Valores do contrato vão para a tabela restrita;
-- closer_name vai para company_details. VALOR MENSAL não é aceito (é derivado):
-- se vier, é ignorado e um aviso é registrado (raise notice).
--
-- Base: versão de 0087 (dedup só por CNPJ). Só ACRESCENTA os campos novos.
-- ---------------------------------------------------------------------
create or replace function public.crm_intake_create(
  p_payload jsonb,
  p_source text default null,
  p_ip text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
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
  -- NOVOS campos comerciais (todos opcionais).
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

  -- Closer: texto simples, com teto de tamanho.
  if v_closer is not null and char_length(v_closer) > 200 then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'closer_name muito longo (máx. 200).', 'refused_validation');
  end if;

  -- Valor mensal NÃO é aceito (é derivado de project_value/installments). Se vier
  -- em qualquer grafia conhecida, é ignorado e um aviso é registrado.
  if p_payload ? 'monthly_value' or p_payload ? 'valor_mensal'
     or p_payload ? 'monthly_amount' then
    raise notice 'crm_intake: valor mensal recebido e IGNORADO (é derivado de project_value/installments). numero=%', v_number;
  end if;

  -- project_value: OPCIONAL, número decimal NÃO NEGATIVO. numeric(14,2), nunca float.
  if v_pv_raw is not null then
    if v_pv_raw !~ '^\d+(\.\d+)?$' then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'validation', 'project_value inválido (número decimal não negativo).', 'refused_validation');
    end if;
    begin
      v_pv := v_pv_raw::numeric(14,2);
    exception when others then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'validation', 'project_value fora da faixa suportada.', 'refused_validation');
    end;
    if v_pv < 0 then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'validation', 'project_value não pode ser negativo.', 'refused_validation');
    end if;
  end if;

  -- installments: OPCIONAL, inteiro MAIOR QUE ZERO.
  if v_inst_raw is not null then
    if v_inst_raw !~ '^\d+$' then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'validation', 'installments inválido (inteiro positivo).', 'refused_validation');
    end if;
    begin
      v_inst := v_inst_raw::integer;
    exception when others then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'validation', 'installments fora da faixa suportada.', 'refused_validation');
    end;
    if v_inst < 1 then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'validation', 'installments deve ser maior que zero.', 'refused_validation');
    end if;
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

  -- Duplicidade FORTE por CNPJ: igual = bloqueio direto, sem depender do nome.
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

  -- O número do cliente é único no nome (o CRM gera pronto).
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
    -- NOTA: os VALORES do contrato NÃO entram no evento acima (details é legível
    -- por quem alcança a empresa via activity feed). Ficam só na tabela restrita.

    -- Informações do cliente. closer_name entra aqui (é o NOME do vendedor).
    insert into company_details
      (company_id, project_model, started_on, ends_on, cadence,
       system_used, main_pain, about, closer_name)
    values
      (v_company,
       v_model::project_model,
       v_started_d, v_ends_d,
       v_cadence::contract_cadence,
       v_system, v_pain, v_about, v_closer);

    -- Valores do contrato (RESTRITOS): só grava se veio pelo menos um dos dois.
    -- Vai para a tabela própria admin-only, NUNCA para company_details.
    if v_pv is not null or v_inst is not null then
      insert into company_contract_values (company_id, project_value, installments)
      values (v_company, v_pv, v_inst);
    end if;

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
$function$;

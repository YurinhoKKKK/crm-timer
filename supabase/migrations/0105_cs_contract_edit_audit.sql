-- Quadro "Sucesso do Cliente" (CS) — FATIA 3: edição do Valor Mensal e histórico
-- dos valores/período do contrato.
--
-- · Valor Mensal = project_value ÷ installments (CALCULADO, nunca guardado).
--   Editar no CS altera company_contract_values (a MESMA tabela que a integração
--   do CRM preenche). Data de Entrada / Tempo de Projeto seguem SÓ LEITURA no CS
--   (editáveis apenas em "Editar empresa > Informações do cliente").
-- · O histórico (cs_audit) passa a registrar valor_projeto, parcelas, data_entrada
--   e data_fim — mesmo padrão dos gatilhos da 0104.
--
-- cs_board() NÃO muda: desde a fatia 1 já devolve project_value, installments e
-- months_total (os meses do tempo) — tudo o que o editor e o pré-preenchimento
-- precisam. Por isso não há DROP/CREATE aqui (uma assinatura permanece).
--
-- Valores de contrato continuam FORA de company_events: company_contract_values
-- não tem gatilho de evento (só o `touch`), e company_details_event_trg não lê
-- valores (project_value/installments vivem em outra tabela). Nada a ajustar lá.

-- ---------------------------------------------------------------------------
-- 1) CHECK de valor não-negativo (hoje só existe o de parcelas).
-- ---------------------------------------------------------------------------
alter table public.company_contract_values
  add constraint company_contract_values_project_value_check
  check (project_value is null or project_value >= 0);

-- ---------------------------------------------------------------------------
-- 2) RPC de escrita (SECURITY INVOKER; RLS admin-only é a barreira + guard).
--    Exatamente um de p_total/p_monthly; os três nulos = limpar. Um comando.
-- ---------------------------------------------------------------------------
create or replace function public.cs_set_contract_values(
  p_company_id uuid,
  p_installments integer,
  p_total text,
  p_monthly text
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_project numeric(14,2);
  v_monthly numeric(14,2);
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores alteram os valores do contrato.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Limpar: os três nulos → apaga a linha.
  if p_installments is null and p_total is null and p_monthly is null then
    delete from company_contract_values where company_id = p_company_id;
    return;
  end if;

  if p_installments is null or p_installments <= 0 then
    raise exception 'Informe o número de parcelas (inteiro maior que zero).'
      using errcode = 'check_violation';
  end if;

  -- Exatamente um dos dois valores.
  if (p_total is not null) = (p_monthly is not null) then
    raise exception 'Informe exatamente um valor: o total do projeto OU o valor mensal.'
      using errcode = 'check_violation';
  end if;

  if p_total is not null then
    if btrim(p_total) !~ '^\d+(\.\d{1,2})?$' then
      raise exception 'Valor total inválido.' using errcode = 'check_violation';
    end if;
    v_project := btrim(p_total)::numeric(14,2);
  else
    if btrim(p_monthly) !~ '^\d+(\.\d{1,2})?$' then
      raise exception 'Valor mensal inválido.' using errcode = 'check_violation';
    end if;
    v_monthly := btrim(p_monthly)::numeric(14,2);
    -- Multiplicação EXATA em numeric (nunca float): total = mensal × parcelas.
    v_project := (v_monthly * p_installments)::numeric(14,2);
  end if;

  if v_project < 0 then
    raise exception 'O valor não pode ser negativo.' using errcode = 'check_violation';
  end if;

  insert into company_contract_values (company_id, project_value, installments)
  values (p_company_id, v_project, p_installments)
  on conflict (company_id) do update
    set project_value = excluded.project_value,
        installments = excluded.installments;
end;
$$;

grant execute on function public.cs_set_contract_values(uuid, integer, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Gatilhos de auditoria (AFTER, SECURITY DEFINER) → cs_audit. Mesmo padrão
--    da 0104: um registro por campo, nada quando o valor não muda, e GUARD de
--    cascade reaproveitando company_exists() (0079).
-- ---------------------------------------------------------------------------

-- Valores do contrato: project_value → 'valor_projeto'; installments → 'parcelas'.
create or replace function company_contract_values_cs_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.project_value is not null then
      insert into cs_audit (company_id, field, old_value, new_value, changed_by)
      values (new.company_id, 'valor_projeto', null, new.project_value::text, auth.uid());
    end if;
    if new.installments is not null then
      insert into cs_audit (company_id, field, old_value, new_value, changed_by)
      values (new.company_id, 'parcelas', null, new.installments::text, auth.uid());
    end if;
    return null;
  elsif tg_op = 'UPDATE' then
    if new.project_value is distinct from old.project_value then
      insert into cs_audit (company_id, field, old_value, new_value, changed_by)
      values (new.company_id, 'valor_projeto',
              old.project_value::text, new.project_value::text, auth.uid());
    end if;
    if new.installments is distinct from old.installments then
      insert into cs_audit (company_id, field, old_value, new_value, changed_by)
      values (new.company_id, 'parcelas',
              old.installments::text, new.installments::text, auth.uid());
    end if;
    return null;
  else -- DELETE
    if not company_exists(old.company_id) then
      return null;
    end if;
    if old.project_value is not null then
      insert into cs_audit (company_id, field, old_value, new_value, changed_by)
      values (old.company_id, 'valor_projeto', old.project_value::text, null, auth.uid());
    end if;
    if old.installments is not null then
      insert into cs_audit (company_id, field, old_value, new_value, changed_by)
      values (old.company_id, 'parcelas', old.installments::text, null, auth.uid());
    end if;
    return null;
  end if;
end;
$$;

create trigger trg_company_contract_values_cs_audit
  after insert or update or delete on company_contract_values
  for each row execute function company_contract_values_cs_audit();

-- Período do contrato (company_details): started_on → 'data_entrada'; ends_on →
-- 'data_fim'. Só estes dois campos. Edições em "Editar empresa" (qualquer cargo)
-- entram no cs_audit — comportamento desejado.
create or replace function company_details_cs_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.started_on is not null then
      insert into cs_audit (company_id, field, old_value, new_value, changed_by)
      values (new.company_id, 'data_entrada', null,
              to_char(new.started_on, 'YYYY-MM-DD'), auth.uid());
    end if;
    if new.ends_on is not null then
      insert into cs_audit (company_id, field, old_value, new_value, changed_by)
      values (new.company_id, 'data_fim', null,
              to_char(new.ends_on, 'YYYY-MM-DD'), auth.uid());
    end if;
    return null;
  elsif tg_op = 'UPDATE' then
    if new.started_on is distinct from old.started_on then
      insert into cs_audit (company_id, field, old_value, new_value, changed_by)
      values (new.company_id, 'data_entrada',
              to_char(old.started_on, 'YYYY-MM-DD'),
              to_char(new.started_on, 'YYYY-MM-DD'), auth.uid());
    end if;
    if new.ends_on is distinct from old.ends_on then
      insert into cs_audit (company_id, field, old_value, new_value, changed_by)
      values (new.company_id, 'data_fim',
              to_char(old.ends_on, 'YYYY-MM-DD'),
              to_char(new.ends_on, 'YYYY-MM-DD'), auth.uid());
    end if;
    return null;
  else -- DELETE (só via cascade da empresa, na prática)
    if not company_exists(old.company_id) then
      return null;
    end if;
    if old.started_on is not null then
      insert into cs_audit (company_id, field, old_value, new_value, changed_by)
      values (old.company_id, 'data_entrada', to_char(old.started_on, 'YYYY-MM-DD'), null, auth.uid());
    end if;
    if old.ends_on is not null then
      insert into cs_audit (company_id, field, old_value, new_value, changed_by)
      values (old.company_id, 'data_fim', to_char(old.ends_on, 'YYYY-MM-DD'), null, auth.uid());
    end if;
    return null;
  end if;
end;
$$;

create trigger trg_company_details_cs_audit
  after insert or update or delete on company_details
  for each row execute function company_details_cs_audit();

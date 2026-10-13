-- =====================================================================
-- Controle de Churn — correções da aba (edição que não salvava + contagem de
-- Atualizações no balão).
-- =====================================================================
-- (1) As RPCs de edição (churn_set_date/reason/seller/mrr) eram SECURITY INVOKER:
--     o UPDATE passava pela RLS de company_churns, que só tem policy de SELECT
--     (admin) — nenhuma de UPDATE —, então alterava 0 linhas. reason/seller ainda
--     retornavam "sucesso" sem gravar. Agora são SECURITY DEFINER (search_path
--     fixo), mantendo `if not is_admin() then raise` como PRIMEIRA linha, e
--     company_churns segue SEM policy de escrita (só RPC/gatilho escrevem). As
--     quatro conferem o nº de linhas alteradas (get diagnostics) e levantam erro,
--     distinguindo "não encontrado" de "já revertido". auth.uid() dentro do
--     DEFINER continua sendo o admin que chamou → updated_by e o cs_audit
--     (trg_company_churns_cs_audit) gravam com changed_by do admin.
--
-- (2) churn_board passa a devolver cs_note_count (contagem de Atualizações do CS
--     da empresa — count(*) de cs_notes, a MESMA regra do cs_board), para o balão.
--     Mudança de retorno → DROP + CREATE.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) RPCs de edição → SECURITY DEFINER + conferência de linhas.
-- ---------------------------------------------------------------------
create or replace function public.churn_set_date(p_id uuid, p_date date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n integer;
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores editam o Controle de Churn.'
      using errcode = 'insufficient_privilege';
  end if;
  update company_churns
     set churned_on = p_date, updated_at = now(), updated_by = auth.uid()
   where id = p_id and reverted_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    if exists (select 1 from company_churns where id = p_id) then
      raise exception 'Registro de churn já revertido.' using errcode = 'P0001';
    else
      raise exception 'Registro de churn não encontrado.' using errcode = 'P0001';
    end if;
  end if;
end;
$function$;

create or replace function public.churn_set_reason(p_id uuid, p_reason churn_reason)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_type     text;
  v_reverted boolean;
  v_n        integer;
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores editam o Controle de Churn.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason = 'nao_informado' then
    raise exception 'Escolha um motivo válido.' using errcode = 'check_violation';
  end if;

  select churn_type, (reverted_at is not null)
    into v_type, v_reverted
    from company_churns where id = p_id;
  if v_type is null then
    raise exception 'Registro de churn não encontrado.' using errcode = 'P0001';
  end if;
  if v_reverted then
    raise exception 'Registro de churn já revertido.' using errcode = 'P0001';
  end if;
  if v_type = 'finalizado' then
    raise exception 'Projetos finalizados têm o motivo travado.'
      using errcode = 'check_violation';
  end if;

  update company_churns
     set reason = p_reason, updated_at = now(), updated_by = auth.uid()
   where id = p_id and reverted_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Registro de churn já revertido.' using errcode = 'P0001';
  end if;
end;
$function$;

create or replace function public.churn_set_seller(p_id uuid, p_text text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_clean text;
  v_n     integer;
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores editam o Controle de Churn.'
      using errcode = 'insufficient_privilege';
  end if;
  v_clean := nullif(btrim(coalesce(p_text, '')), '');
  if v_clean is not null and length(v_clean) > 200 then
    raise exception 'O nome do vendedor deve ter no máximo 200 caracteres.'
      using errcode = 'check_violation';
  end if;
  update company_churns
     set seller_name = v_clean, updated_at = now(), updated_by = auth.uid()
   where id = p_id and reverted_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    if exists (select 1 from company_churns where id = p_id) then
      raise exception 'Registro de churn já revertido.' using errcode = 'P0001';
    else
      raise exception 'Registro de churn não encontrado.' using errcode = 'P0001';
    end if;
  end if;
end;
$function$;

create or replace function public.churn_set_mrr(p_id uuid, p_text text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_clean text;
  v_mrr   numeric(14,2);
  v_n     integer;
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores editam o Controle de Churn.'
      using errcode = 'insufficient_privilege';
  end if;
  v_clean := nullif(btrim(coalesce(p_text, '')), '');
  if v_clean is null then
    v_mrr := null;
  elsif v_clean !~ '^\d+(\.\d{1,2})?$' then
    raise exception 'Valor de MRR inválido.' using errcode = 'check_violation';
  else
    v_mrr := v_clean::numeric(14,2);
  end if;
  -- NÃO altera company_contract_values: o MRR aqui é a FOTO do momento.
  update company_churns
     set mrr = v_mrr, updated_at = now(), updated_by = auth.uid()
   where id = p_id and reverted_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    if exists (select 1 from company_churns where id = p_id) then
      raise exception 'Registro de churn já revertido.' using errcode = 'P0001';
    else
      raise exception 'Registro de churn não encontrado.' using errcode = 'P0001';
    end if;
  end if;
end;
$function$;

grant execute on function public.churn_set_date(uuid, date)          to authenticated;
grant execute on function public.churn_set_reason(uuid, churn_reason) to authenticated;
grant execute on function public.churn_set_seller(uuid, text)         to authenticated;
grant execute on function public.churn_set_mrr(uuid, text)            to authenticated;

-- ---------------------------------------------------------------------
-- 2) churn_board + cs_note_count (balão de Atualizações do CS). DROP + CREATE
--    porque o tipo de retorno muda. Mesma regra de contagem do cs_board:
--    count(*) de cs_notes por empresa.
-- ---------------------------------------------------------------------
drop function if exists public.churn_board(date, date);

create function public.churn_board(
  p_start date default null,
  p_end   date default null
)
returns table (
  id               uuid,
  company_id       uuid,
  company_name     text,
  churn_type       text,
  churned_on       text,
  reason           text,
  seller_name      text,
  consultants      jsonb,
  mrr              text,
  months_contracted integer,
  months_stayed    integer,
  lost_revenue     text,
  cs_note_count    integer
)
language plpgsql
security invoker
set search_path to 'public'
as $fn$
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores acessam o Controle de Churn.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    r.id,
    r.company_id,
    r.company_name,
    r.churn_type,
    to_char(r.churned_on, 'YYYY-MM-DD'),
    r.reason::text,
    r.seller_name,
    r.consultants,
    r.mrr::text,
    r.months_contracted,
    r.months_stayed,
    r.lost::text,
    coalesce(n.cnt, 0)
  from churn_rows(p_start, p_end) r
  left join (
    -- alias de coluna (cid) para não colidir com a OUT column company_id da função.
    select cs.company_id as cid, count(*)::int as cnt from cs_notes cs group by cs.company_id
  ) n on n.cid = r.company_id
  order by r.churned_on desc nulls last, r.company_name;
end;
$fn$;

grant execute on function public.churn_board(date, date) to authenticated;

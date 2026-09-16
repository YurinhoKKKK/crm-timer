-- =====================================================================
-- CORREÇÃO (continuação da 0079/0080) — excluir empresa também quebrava por FK
-- em company_revenue_audit.
-- =====================================================================
-- Mesmo padrão: ao excluir a empresa, o cascade apaga as linhas de
-- company_revenues e o gatilho de auditoria company_revenues_audit_trg dispara
-- no DELETE, inserindo em company_revenue_audit com a company_id da empresa que
-- já sumiu → a FK company_revenue_audit_company_id_fkey recusa e aborta a
-- exclusão.
--
-- Guarda o ramo de DELETE: se a empresa não existe mais, sai sem gravar. UPDATE
-- e INSERT (dia a dia do faturamento) seguem gravando a auditoria normalmente —
-- a empresa existe nesses casos. FK intacta.
-- =====================================================================

create or replace function company_revenues_audit_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old    numeric(14,2);
  v_new    numeric(14,2);
  v_reason text;
begin
  if tg_op = 'INSERT' then
    v_old := null;
    v_new := new.amount;
    v_reason := null;  -- primeiro lançamento não pede motivo
  elsif tg_op = 'UPDATE' then
    if new.amount is not distinct from old.amount then
      return null;     -- valor não mudou de fato: não registra
    end if;
    v_old := old.amount;
    v_new := new.amount;
    v_reason := nullif(btrim(coalesce(current_setting('app.revenue_reason', true), '')), '');
  else -- DELETE
    -- GUARD: empresa em exclusão (cascade) → não há empresa a que amarrar a
    -- auditoria. A FK recusaria de qualquer forma; aqui sai limpo.
    if not company_exists(old.company_id) then
      return null;
    end if;
    v_old := old.amount;
    v_new := null;
    v_reason := nullif(btrim(coalesce(current_setting('app.revenue_reason', true), '')), '');
  end if;

  insert into company_revenue_audit
    (company_id, reference_month, channel, old_amount, new_amount, reason, changed_by)
  values (
    coalesce(new.company_id, old.company_id),
    coalesce(new.reference_month, old.reference_month),
    coalesce(new.channel, old.channel),
    v_old, v_new, v_reason, auth.uid()
  );
  return null;  -- AFTER trigger: valor de retorno ignorado
end;
$$;

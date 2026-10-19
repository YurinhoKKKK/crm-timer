-- =====================================================================
-- 0138_cs_set_company_label :: CRM/Timer - Monvatti
-- =====================================================================
-- Quadro de Sucesso do Cliente (admin-only): cada empresa ganha um controle
-- para ADICIONAR/REMOVER as etiquetas ALERTA e RISCO (só essas duas).
--
-- A gravação reusa a MESMA tabela company_labels da tela de Empresas (reflete lá
-- na hora, pela herança em tempo real). O registro em cs_audit segue o mesmo
-- padrão dos outros campos do CS. Como cs_audit só tem policy de SELECT (quem
-- escreve são funções DEFINER) e não dá para pôr gatilho de auditoria do CS na
-- company_labels (tabela compartilhada com Empresas), esta RPC é SECURITY
-- DEFINER e faz as duas coisas (grava a etiqueta + registra em cs_audit) numa
-- transação, guardada por is_admin().
--
-- NÃO mexe em RLS, policies nem dados existentes. Os gatilhos já existentes de
-- company_labels continuam valendo: trg_company_labels_reject_derived (recusa
-- etiqueta calculada — ALERTA/RISCO são manuais, passam) e
-- trg_company_labels_event (histórico de atividades da empresa).
--
-- Reversão: supabase/rollback/0138_cs_set_company_label.sql
-- =====================================================================

create or replace function public.cs_set_company_label(
  p_company_id uuid,
  p_label_id uuid,
  p_on boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_name   text;
  v_exists boolean;
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores alteram etiquetas no quadro de Sucesso do Cliente.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Só ALERTA e RISCO (e só se forem MANUAIS). Qualquer outra é recusada aqui —
  -- o controle do CS não mexe nas calculadas nem em etiquetas livres.
  select l.name into v_name
    from labels l
   where l.id = p_label_id
     and l.derived_kind is null
     and upper(l.name) in ('ALERTA', 'RISCO');
  if v_name is null then
    raise exception 'Só as etiquetas ALERTA e RISCO podem ser alteradas por aqui.'
      using errcode = 'check_violation';
  end if;

  select exists(
    select 1 from company_labels
     where company_id = p_company_id and label_id = p_label_id
  ) into v_exists;

  if p_on and not v_exists then
    insert into company_labels (company_id, label_id)
    values (p_company_id, p_label_id)
    on conflict (company_id, label_id) do nothing;
    insert into cs_audit (company_id, field, old_value, new_value, changed_by)
    values (p_company_id, 'etiqueta', null, v_name, auth.uid());
  elsif (not p_on) and v_exists then
    delete from company_labels
     where company_id = p_company_id and label_id = p_label_id;
    insert into cs_audit (company_id, field, old_value, new_value, changed_by)
    values (p_company_id, 'etiqueta', v_name, null, auth.uid());
  end if;
  -- Já estava no estado desejado (idempotente): não grava auditoria.
end;
$fn$;

-- A RLS/guard é a barreira; o EXECUTE a authenticated segue o padrão das demais
-- RPCs do CS (um não-admin que chamar recebe insufficient_privilege pelo guard).
grant execute on function public.cs_set_company_label(uuid, uuid, boolean) to authenticated;

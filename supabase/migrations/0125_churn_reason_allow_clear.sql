-- =====================================================================
-- Controle de Churn — a coluna Motivo ganhou botão "Limpar" (volta o motivo de um
-- cancelado para 'nao_informado' = "Não informado"), para ficar consistente com
-- Data/Vendedor/MRR. Para isso, churn_set_reason deixa de recusar 'nao_informado'.
--
-- As demais regras permanecem: finalizado tem o motivo TRAVADO, registro revertido
-- é recusado, "não encontrado" distinto de "já revertido", SECURITY DEFINER com
-- search_path fixo e conferência de linhas (get diagnostics). company_churns segue
-- sem policy de escrita (só RPC/gatilho escrevem). A GARANTIA de motivo ao ENTRAR
-- em 'cancelado' (gatilho BEFORE em companies, migration 0120) NÃO muda — continua
-- exigindo um motivo válido ao mover; aqui é só a edição de um registro existente.
-- =====================================================================
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

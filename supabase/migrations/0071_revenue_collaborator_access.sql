-- =====================================================================
-- Faturamento — colaborador passa a LER e ESCREVER (nas empresas que alcança)
-- =====================================================================
-- DECISÃO NOVA (substitui a de 0062/0067): o COLABORADOR passa a acessar o
-- faturamento das empresas que ele JÁ alcança — as mesmas em que atua hoje,
-- pelo vínculo derivado das tarefas. Antes o predicado das tabelas de
-- faturamento era só "admin OU consultor da empresa"; o colaborador não passava
-- de propósito. Agora passa, com o MESMO critério de alcance que o resto do
-- sistema já usa para esse cargo: my_collaborator_companies() (empresa em que o
-- colaborador tem ao menos uma tarefa — ver 0002).
--
-- IMPORTANTE — o que NÃO muda:
--   · admin continua em TODAS as empresas; consultor na própria carteira.
--   · o COLABORADOR não passa a alcançar nenhuma empresa nova: reusamos
--     my_collaborator_companies() tal como está, sem inventar critério. A
--     mudança é sobre o que ele pode FAZER nas empresas dele, não sobre QUAIS
--     empresas ele vê.
--   · o PORTAL DO CLIENTE e o anon continuam SEM acesso a faturamento — nenhuma
--     policy os inclui aqui.
--
-- AUDITORIA: nada a mudar no gatilho. company_revenues_audit_trg() já carimba
--   changed_by = auth.uid() para QUALQUER caminho de gravação; uma correção
--   feita por colaborador fica registrada com o id dele exatamente como a de um
--   consultor. As RPCs (company_revenue_upsert, set_company_channels,
--   company_revenue_overview/insights/month_detail) são SECURITY INVOKER — o
--   escopo é a RLS abaixo, então passam a valer para colaborador sem alteração.
--
-- Recriamos as quatro policies (drop + create) só para acrescentar o novo ramo
-- do OR — o predicado de admin/consultor permanece idêntico.
-- =====================================================================

-- company_sales_channels — leitura + escrita
drop policy csc_rw on company_sales_channels;
create policy csc_rw on company_sales_channels for all
  using (
    is_admin()
    or company_id in (select my_consultant_companies())
    or company_id in (select my_collaborator_companies())
  )
  with check (
    is_admin()
    or company_id in (select my_consultant_companies())
    or company_id in (select my_collaborator_companies())
  );

-- company_revenues — leitura + escrita
drop policy crev_rw on company_revenues;
create policy crev_rw on company_revenues for all
  using (
    is_admin()
    or company_id in (select my_consultant_companies())
    or company_id in (select my_collaborator_companies())
  )
  with check (
    is_admin()
    or company_id in (select my_consultant_companies())
    or company_id in (select my_collaborator_companies())
  );

-- company_revenue_notes — leitura + escrita
drop policy crn_rw on company_revenue_notes;
create policy crn_rw on company_revenue_notes for all
  using (
    is_admin()
    or company_id in (select my_consultant_companies())
    or company_id in (select my_collaborator_companies())
  )
  with check (
    is_admin()
    or company_id in (select my_consultant_companies())
    or company_id in (select my_collaborator_companies())
  );

-- company_revenue_audit — SÓ leitura (registro imutável, só o trigger escreve).
-- O colaborador passa a LER o histórico das empresas dele, junto do direito de
-- lançar/corrigir. Nenhuma policy de insert/update/delete — nada muda nisso.
drop policy cra_select on company_revenue_audit;
create policy cra_select on company_revenue_audit for select
  using (
    is_admin()
    or company_id in (select my_consultant_companies())
    or company_id in (select my_collaborator_companies())
  );

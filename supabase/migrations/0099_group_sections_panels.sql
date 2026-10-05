-- =====================================================================
-- 0099 — Seções de grupo nos painéis do consultor e do colaborador
--
-- Consultor e colaborador passam a ver TODAS as empresas que já alcançam,
-- inclusive as de grupos PARADOS (antes escondidas), separadas em seções por
-- grupo como no quadro do admin. Para pintar/ordenar/recolher essas seções, os
-- painéis precisam LER company_groups (hoje admin-only).
--
-- Duas mudanças de banco:
--   1. cg_select passa a liberar a LEITURA de company_groups para admin,
--      consultor e colaborador (escrita continua admin-only; pending sem acesso).
--   2. my_company_pause_state() deixa de existir: ela servia só para ESCONDER as
--      empresas paradas dos painéis; agora elas aparecem agrupadas. Sem nenhum
--      uso restante → DROP (ver relatório da fatia).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. LEITURA de company_groups para os três cargos operacionais.
--    Nome/cor/ordem/kind do grupo NÃO são dado sensível: o painel só os usa para
--    montar as seções das empresas que a pessoa já alcança (a RLS de companies
--    não muda — ninguém passa a ver empresa nova). Escrita segue is_admin().
--    Subselect em auth_role() (regra do projeto: avalia uma vez por query, não
--    por linha). pending → não está na lista → continua sem acesso.
-- ---------------------------------------------------------------------
drop policy if exists cg_select on company_groups;
create policy cg_select on company_groups
  for select
  using ((select auth_role()) in ('admin', 'consultor', 'colaborador'));

-- cg_insert / cg_update / cg_delete permanecem como estão (is_admin()) — só o
-- admin cria, renomeia, recolore, reordena e exclui grupo, e só o admin move
-- empresa de grupo (companies_admin_all). Nada a fazer aqui.

-- ---------------------------------------------------------------------
-- 2. my_company_pause_state() — aposentada.
--    Era SECURITY DEFINER e devolvia os ids de TODAS as empresas paradas do
--    sistema (id + has_open) para os painéis cruzarem e ESCONDEREM as paradas.
--    Agora os painéis agrupam as empresas em seções (company_groups ficou
--    legível), então nada mais esconde e ninguém mais chama a função. O grant a
--    authenticated cai junto com o DROP.
-- ---------------------------------------------------------------------
drop function if exists my_company_pause_state();

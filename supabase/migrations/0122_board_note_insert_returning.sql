-- =====================================================================
-- CORREÇÃO: cargos de quadro (Gestor de Tráfego, Desenvolvedor) não conseguiam
-- CRIAR Atualização pelo seu quadro — "new row violates row-level security
-- policy for table company_notes".
-- =====================================================================
-- Causa: o app insere a nota com RETURNING (`insert ... select('id')`). Com
-- RETURNING, o Postgres aplica a policy de SELECT (cn_select) à LINHA NOVA. No
-- ramo dos cargos de quadro, cn_select exigia note_has_area(id, área do cargo) —
-- mas a área ('trafego'/'site') é inserida pelo gatilho AFTER de origem→área, que
-- roda DEPOIS dessa checagem. No instante do RETURNING a área ainda não existe,
-- então note_has_area dava falso e o SELECT barrava a linha recém-inserida.
-- (Admin, consultor e colaborador não passam por esse ramo e não eram afetados.)
--
-- Reproduzido em rollback: o MESMO insert SEM returning passa; COM returning
-- falha. O gatilho cria a área 'trafego' normalmente (1 linha) na versão sem
-- returning.
--
-- Correção MÍNIMA: só o ramo dos cargos de quadro de cn_select. A condição de
-- área passa a aceitar TAMBÉM a área DERIVADA DA ORIGEM:
--     note_origin_area(origin) = board_area_for_role(auth_role())
--     OR note_has_area(id, board_area_for_role(auth_role()))
-- As demais condições do ramo (cargo de quadro com área; empresa em
-- my_traffic_companies()/my_dev_companies()) ficam idênticas.
--
-- Por que o conjunto de notas VISÍVEIS não muda: uma nota com origin de quadro
-- SEMPRE recebe a área do quadro (gatilho de origem) e NÃO pode perdê-la (trava),
-- então note_has_area já era verdadeiro para toda nota de quadro persistida. O
-- novo termo note_origin_area(origin) = área só adianta esse mesmo veredito para
-- o instante do INSERT ... RETURNING (antes do gatilho). Para notas sem origin de
-- quadro, note_origin_area é null e nada muda — continua valendo note_has_area.
--
-- Nenhuma outra policy muda. O diagnóstico confirmou que só cn_select é aplicada
-- à linha nova na criação: a inserção das áreas usa upsert SEM returning (cna_*
-- não é aplicada à linha nova) e resposta/edição/checkbox/menção agem sobre notas
-- JÁ persistidas (que já têm a área) — nenhum desses passos falha.
-- =====================================================================

alter policy cn_select on public.company_notes
using (
  is_admin()
  or (company_id in (select my_consultant_companies()))
  or (company_id in (select my_collaborator_companies()))
  or (
    board_area_for_role((select auth_role())) is not null
    and (
      company_id in (select my_traffic_companies())
      or company_id in (select my_dev_companies())
    )
    and (
      note_origin_area(origin) = board_area_for_role((select auth_role()))
      or note_has_area(id, board_area_for_role((select auth_role())))
    )
  )
);

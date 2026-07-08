-- =====================================================================
-- CRM/Timer - Monvatti :: Unicidade do nome da empresa
-- =====================================================================
-- Impede empresas com nome duplicado. Comparação "inteligente": ignora
-- maiúsculas/minúsculas e espaços nas bordas — "Timaco", "timaco" e
-- " Timaco " são o mesmo nome. Índice único funcional garante isso no banco
-- (mesmo sob clique repetido/duplo-submit), independente da validação da UI.
-- =====================================================================

create unique index if not exists companies_name_unique_ci
  on companies (lower(btrim(name)));

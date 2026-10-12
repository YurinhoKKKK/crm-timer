-- =====================================================================
-- 0118 — Cargo "Desenvolvedor": só o VALOR do enum (migration separada).
-- =====================================================================
-- Precisa vir ANTES e SOZINHA: um novo valor de enum não pode ser usado na
-- MESMA transação em que é criado. A 0119 (regras, policies, funções) usa o
-- valor com segurança por rodar depois, já commitado.
-- =====================================================================

alter type user_role add value if not exists 'desenvolvedor';

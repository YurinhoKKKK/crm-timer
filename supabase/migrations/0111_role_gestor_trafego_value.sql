-- =====================================================================
-- 0111 — Cargo "Gestor de Tráfego" (Fatia 4), PASSO 1: só o valor do enum.
-- =====================================================================
-- O Postgres não deixa USAR um valor de enum recém-adicionado na MESMA transação
-- em que foi criado. Por isso o ADD VALUE fica isolado nesta migration; a 0112
-- (seguinte) é que usa 'gestor_trafego' em funções e policies.
--
-- Nasce SEM acesso a nada (a RLS cita os cargos explicitamente): a 0112 concede
-- EXATAMENTE a lista fechada (quadro de Tráfego, Agenda, Suporte, notificações,
-- perfil). Tudo que a 0112 não listar continua negando o gestor.
-- =====================================================================

alter type user_role add value if not exists 'gestor_trafego';

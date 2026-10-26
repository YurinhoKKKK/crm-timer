-- =====================================================================
-- 0159 — Corrige "infinite recursion detected in policy for relation profiles"
-- =====================================================================
-- A 0134 envolveu as funções das policies de profiles em (select ...). Com isso,
-- o WITH CHECK de profiles_update_self — que fazia subconsulta DIRETA na própria
-- profiles para pegar o cargo atual (role = (select role from profiles where
-- id = auth.uid())) — passou a disparar recursão infinita em TODA atualização de
-- perfil (foto, nome, cargo na tela Usuários, timer de atendimento).
--
-- Correção: trocar a subconsulta em profiles por auth_role(), que já é SECURITY
-- DEFINER e devolve o cargo de quem está logado — mesma proteção de antes (usuário
-- comum não troca o próprio cargo), sem ler profiles no contexto da policy.
--
-- Varredura (pedido do usuário): a ÚNICA policy com o padrão "policy da tabela X
-- com subconsulta direta em X" era esta. As demais que citam o próprio nome o
-- fazem como coluna qualificada da linha atual dentro de EXISTS sobre OUTRA tabela
-- (seguras). Rollback = a definição anterior (0134). Nada mais é tocado.
-- =====================================================================

alter policy profiles_update_self on public.profiles
  using ((id = (select auth.uid())) or (select is_admin()))
  with check ((select is_admin()) or ((id = (select auth.uid())) and (role = (select auth_role()))));

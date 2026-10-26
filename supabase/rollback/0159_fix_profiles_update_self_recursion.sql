-- =====================================================================
-- ROLLBACK da 0159 — restaura a definição da 0134 (com a subconsulta em profiles).
-- =====================================================================
-- ATENÇÃO: esta é a versão que CAUSA a recursão infinita. Só restaurar se for
-- mesmo reverter a 0159. Cópia literal do que a 0134 deixou em profiles_update_self.
-- =====================================================================

ALTER POLICY profiles_update_self ON public.profiles
  USING (((id = (select auth.uid())) OR (select is_admin())))
  WITH CHECK (((select is_admin()) OR ((id = (select auth.uid())) AND (role = ( SELECT profiles_1.role
     FROM profiles profiles_1
    WHERE (profiles_1.id = (select auth.uid())))))));

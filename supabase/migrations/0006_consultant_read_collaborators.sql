-- =====================================================================
-- CRM/Timer - Monvatti :: Consultor lê perfis de colaboradores
-- =====================================================================
-- O consultor precisa ver os colaboradores para (a) escolher a quem atribuir
-- uma tarefa no cadastro e (b) exibir o nome do colaborador nas tarefas das
-- suas empresas. A policy original só permitia ver o próprio perfil (ou admin).
-- Ampliamos apenas para colaboradores; o restante do isolamento continua.
-- =====================================================================

drop policy if exists profiles_select on profiles;

create policy profiles_select on profiles for select
  using (
    id = auth.uid()
    or is_admin()
    or (auth_role() = 'consultor' and role = 'colaborador')
  );

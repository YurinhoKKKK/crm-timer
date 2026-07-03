-- =====================================================================
-- CRM/Timer - Monvatti :: Consultor lê perfis de admins
-- =====================================================================
-- Admins agora podem ser responsáveis de tarefas (e empresas), aparecendo nos
-- seletores de responsável como colaboradores e consultores já apareciam. No
-- painel do consultor, o dropdown de responsável de tarefa precisa listar os
-- admins e, ao exibir uma tarefa cujo responsável é um admin, precisa ler o
-- nome desse admin. A policy anterior (0006) só liberava, para o consultor, a
-- leitura de perfis de colaborador. Ampliamos para incluir admins.
--
-- O admin responsável, por sua vez, já enxerga e executa tudo via is_admin()
-- nas policies de task_instances/time_entries — nada a mudar lá.
-- =====================================================================

drop policy if exists profiles_select on profiles;

create policy profiles_select on profiles for select
  using (
    id = auth.uid()
    or is_admin()
    or (auth_role() = 'consultor' and role in ('colaborador', 'admin'))
  );

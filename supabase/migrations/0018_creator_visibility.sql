-- =====================================================================
-- Transparência: quem criou cada empresa/tarefa e quando
-- =====================================================================
-- 1. companies ganha created_by (não existia). Fica NULL para as empresas
--    já cadastradas antes deste registro (mostramos "não registrado").
-- 2. Função display_names(ids): resolve o NOME de qualquer perfil por id,
--    para qualquer usuário logado. É SECURITY DEFINER porque a RLS de
--    profiles restringe leitura (colaborador só vê o próprio perfil), mas o
--    nome de quem criou algo é transparência, não dado sensível. Devolve só
--    o nome (nunca e-mail), minimizando exposição.
-- =====================================================================

alter table companies
  add column if not exists created_by uuid references profiles(id) on delete set null;

comment on column companies.created_by is
  'Quem cadastrou a empresa (transparência). NULL = anterior a este registro.';

create or replace function display_names(p_ids uuid[])
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select id, full_name from profiles where id = any(p_ids);
$$;

-- anon não precisa; só usuários logados (evita o aviso do linter para anon).
revoke all on function display_names(uuid[]) from public;
grant execute on function display_names(uuid[]) to authenticated;

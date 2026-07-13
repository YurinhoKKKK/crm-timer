-- =====================================================================
-- CRM/Timer - Monvatti :: Avatares em todo o sistema
-- =====================================================================
-- Evolução da display_names (0018): além do nome, devolve o avatar_path, para
-- exibir a foto de perfil ao lado do nome em qualquer tela — inclusive onde a
-- RLS de profiles não deixa ler o perfil alheio (ex.: colaborador vendo o
-- autor de uma anotação). Continua expondo SOMENTE nome e caminho da foto
-- (nada de e-mail/cargo). Busca agrupada: uma chamada resolve N ids.
-- =====================================================================

create or replace function display_profiles(p_ids uuid[])
returns table (id uuid, name text, avatar_path text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.full_name, p.avatar_path
  from profiles p
  where p.id = any(p_ids);
$$;

revoke all on function display_profiles(uuid[]) from public;
grant execute on function display_profiles(uuid[]) to authenticated;

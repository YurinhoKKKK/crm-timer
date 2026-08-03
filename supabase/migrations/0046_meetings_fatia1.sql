-- =====================================================================
-- REUNIÕES — FATIA 1 (criar + listar). Segue a 0043/0044/0045.
--
-- A tabela meetings/meeting_participants e as policies de escrita já nasceram na
-- 0043; a 0044 tirou a recursão de visibilidade para meeting_is_visible(). Esta
-- migration só faz o que a Fatia 1 precisa a mais, tudo aditivo:
--   1. ALARGA a visibilidade para "todos os internos veem tudo" (decisão de
--      produto desta fatia) — sem tocar nas policies de ESCRITA.
--   2. meeting_directory() — roster de usuários internos para o SELETOR de
--      participantes e para resolver os e-mails dos convites (a RLS de profiles
--      não deixa um colaborador ler o perfil alheio; ver 0006/0015).
--   3. meeting_conflicts() — aviso (não bloqueio) de sobreposição de horário
--      entre reuniões DO SISTEMA, para o criador e os participantes.
-- Nenhuma tabela nova; nenhuma coluna nova.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Visibilidade: TODOS os internos veem TODAS as reuniões
-- ---------------------------------------------------------------------
-- Decisão de produto da Fatia 1: a equipe inteira enxerga as reuniões uns dos
-- outros, com detalhes e de qual empresa — replica o que já fazem no Google. A
-- 0044 restringia a admin/criador/consultor-da-empresa/participante; aqui basta
-- ser um usuário AUTENTICADO (= interno). O portal do cliente NÃO é afetado: o
-- cliente entra pelo /cliente/[token] com o papel `anon` (nunca faz login no
-- Supabase Auth), então auth.uid() é nulo para ele e nenhuma reunião aparece.
-- SECURITY DEFINER mantido só para não re-disparar a RLS por dentro (a função é
-- usada dentro das policies das duas tabelas) — continua devolvendo booleano,
-- nunca dado.
create or replace function meeting_is_visible(p_meeting uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select auth.uid() is not null
     and exists (select 1 from meetings m where m.id = p_meeting);
$$;

revoke execute on function meeting_is_visible(uuid) from public, anon;
grant  execute on function meeting_is_visible(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Roster interno — para o seletor de participantes e os e-mails dos convites
-- ---------------------------------------------------------------------
-- Por que DEFINER: profiles_select (0015) só deixa um colaborador ler o PRÓPRIO
-- perfil, e um consultor não lê outros consultores. Mas a Fatia 1 permite que
-- admin/consultor/colaborador criem reuniões e convidem qualquer interno — logo
-- todos precisam enxergar o roster. Consistente com a visibilidade total já
-- decidida: nomes/e-mails da equipe não são segredo entre colegas (eles já se
-- convidam no Google). Exclui `pending` (ainda sem cargo).
--
-- TRADEOFF: como o grant é `authenticated`, um interno curioso consegue chamar a
-- função e ver os e-mails de todos os colegas. Aceito: e-mail interno não é dado
-- sensível neste produto. O e-mail NÃO é usado no cliente (o seletor mostra só
-- nome+foto); serve ao servidor para montar os convites do Google.
create or replace function meeting_directory()
returns table (id uuid, full_name text, email text, avatar_path text, role text)
language sql stable security definer
set search_path = public
as $$
  select p.id, p.full_name, p.email, p.avatar_path, p.role
  from profiles p
  where p.role in ('admin', 'consultor', 'colaborador')
  order by p.full_name;
$$;

revoke execute on function meeting_directory() from public, anon;
grant  execute on function meeting_directory() to authenticated;

-- ---------------------------------------------------------------------
-- 3. Conflito de horário — AVISO, nunca bloqueio
-- ---------------------------------------------------------------------
-- Devolve, para a janela [p_starts, p_ends), as reuniões DO SISTEMA que se
-- sobrepõem e que envolvem algum dos usuários consultados (como criador OU
-- participante). `conflicting_user_ids` diz QUAIS dos consultados batem, para a
-- tela mostrar "com quem". Só metadados (título/horário/empresa), que todo
-- interno já pode ver. p_exclude ignora uma reunião (edição, na fatia seguinte).
--
-- Sobreposição meia-aberta: starts_at < p_ends AND ends_at > p_starts — encostar
-- (uma termina exatamente quando a outra começa) NÃO conta como conflito.
-- SECURITY DEFINER: enxerga as reuniões de todos os internos de forma robusta,
-- sem depender da amplitude da RLS. Não devolve reunião de ninguém de fora.
create or replace function meeting_conflicts(
  p_starts    timestamptz,
  p_ends      timestamptz,
  p_user_ids  uuid[],
  p_exclude   uuid default null
)
returns table (
  meeting_id           uuid,
  title                text,
  starts_at            timestamptz,
  ends_at              timestamptz,
  company_id           uuid,
  company_name         text,
  conflicting_user_ids uuid[]
)
language sql stable security definer
set search_path = public
as $$
  select m.id, m.title, m.starts_at, m.ends_at, m.company_id, c.name,
         array_agg(distinct cu.uid order by cu.uid)
  from meetings m
  join companies c on c.id = m.company_id
  -- só as reuniões que envolvem ao menos um dos usuários consultados
  join lateral (
    select u.uid
    from unnest(p_user_ids) as u(uid)
    where m.created_by = u.uid
       or exists (select 1 from meeting_participants mp
                   where mp.meeting_id = m.id and mp.user_id = u.uid)
  ) cu on true
  where m.starts_at < p_ends
    and m.ends_at   > p_starts
    and (p_exclude is null or m.id <> p_exclude)
  group by m.id, m.title, m.starts_at, m.ends_at, m.company_id, c.name
  order by m.starts_at;
$$;

revoke execute on function meeting_conflicts(timestamptz, timestamptz, uuid[], uuid) from public, anon;
grant  execute on function meeting_conflicts(timestamptz, timestamptz, uuid[], uuid) to authenticated;

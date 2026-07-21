-- =====================================================================
-- PASSO 32.1 — Caixa de entrada: fonte de verdade única + prévia com autor
--
-- Bug de origem: o badge e a lista da caixa de entrada saíam de consultas
-- IRMÃS, não IGUAIS — o badge (dinâmico) atualizava e a prévia (servida do
-- cache de navegação) ficava velha. Correção estrutural em duas partes:
--   1. Aqui no banco: my_unread_messages() passa a ser LITERALMENTE a soma
--      dos contadores de message_inbox() — uma única definição do que é
--      "não lida"; badge e lista não têm mais como divergir.
--   2. No front: a lista vira componente vivo (ressincroniza ao montar +
--      Realtime), como a conversa já é desde o 31.1.
--
-- message_inbox() também passa a devolver o NOME de quem respondeu (prefixo
-- da prévia: "Cliente:" ou o primeiro nome de quem falou pela equipe). O
-- nome vem de display_profiles (SECURITY DEFINER, só nome+foto) para não
-- esbarrar no RLS de profiles — um colaborador não lê o perfil de um
-- consultor, mas pode ver o primeiro nome de quem assinou a resposta (mesma
-- decisão do portal no passo 31).
--
-- A função continua SECURITY INVOKER: o escopo é o RLS cm_select. O lateral
-- em display_profiles só resolve nome de autor de mensagem QUE O USUÁRIO JÁ
-- PODE LER — não abre leitura nova.
-- =====================================================================

drop function if exists message_inbox();

create or replace function message_inbox()
returns table (
  company_id       uuid,
  company_name     text,
  last_body        text,
  last_author_type text,
  last_author      text,
  last_at          timestamptz,
  unread           bigint
)
language sql stable
as $$
  with last_msg as (
    select distinct on (m.company_id)
           m.company_id, m.body, m.author_type, m.author_id, m.created_at
      from company_messages m
     order by m.company_id, m.created_at desc
  ),
  unread_count as (
    select m.company_id,
           count(*) as unread
      from company_messages m
      left join company_message_reads r
        on r.company_id = m.company_id and r.user_id = auth.uid()
     where m.author_id is distinct from auth.uid()
       and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
     group by m.company_id
  )
  select l.company_id,
         c.name as company_name,
         l.body as last_body,
         l.author_type as last_author_type,
         case when l.author_type = 'interno'
              then split_part(coalesce(dp.name, 'Equipe'), ' ', 1)
              else null end as last_author,
         l.created_at as last_at,
         coalesce(u.unread, 0) as unread
    from last_msg l
    join companies c on c.id = l.company_id
    left join lateral (
      select name from display_profiles(array[l.author_id]::uuid[])
    ) dp on true
    left join unread_count u on u.company_id = l.company_id
   order by (coalesce(u.unread, 0) > 0) desc, l.created_at desc;
$$;

revoke execute on function message_inbox() from public, anon;
grant execute on function message_inbox() to authenticated;

-- O badge é a SOMA dos contadores da caixa de entrada — mesma fonte, por
-- construção. (Com o volume atual isso é barato; se um dia pesar, otimizar
-- mantendo UMA definição só.)
create or replace function my_unread_messages()
returns bigint
language sql stable
as $$
  select coalesce(sum(unread), 0) from message_inbox();
$$;

revoke execute on function my_unread_messages() from public, anon;
grant execute on function my_unread_messages() to authenticated;

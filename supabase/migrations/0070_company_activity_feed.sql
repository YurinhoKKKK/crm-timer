-- FATIA 1 do histórico de atividades da empresa — só APRESENTAÇÃO/DESEMPENHO.
--
-- Linha do tempo UNIFICADA, paginada e filtrada NO BANCO. Por que no banco: o
-- PostgREST trunca em 1.000 linhas em silêncio; juntar/filtrar fontes no cliente
-- deixaria o histórico errado sem avisar. A Fatia 2 vai UNIR várias fontes de
-- evento — por isso a CTE `feed` já tem o shape unificado (type, at, author_id,
-- summary, content, meta) e novas fontes entram como UNION ALL sem mexer no resto.
--
-- Fatia 1 NÃO cria eventos nem gatilhos: a única fonte é a `activity_log` atual.
-- SECURITY INVOKER: a RLS de activity_log/profiles é a fronteira (mesmo escopo do
-- que a página já lia direto — admin todas, consultor a carteira).

-- Índice para paginar por empresa + data desc sem varrer a tabela toda.
create index if not exists idx_activity_log_company_created
  on public.activity_log (company_id, created_at desc);

-- Feed paginado. Devolve { total, items[] }. Total vem do banco (nunca do array).
create or replace function public.company_activity_feed(
  p_company uuid,
  p_limit   int  default 20,
  p_offset  int  default 0,
  p_search  text default null,
  p_types   text[] default null,  -- filtro por TIPO; null/vazio = todos
  p_author  uuid default null,    -- filtro por PESSOA (autor do evento)
  p_from    date default null,    -- período inicial (BRT), opcional
  p_to      date default null     -- período final (BRT), opcional
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public', 'extensions'
as $function$
  with feed as (
    -- FONTE 1 (Fatia 1): activity_log. Fatia 2 = UNION ALL de outras fontes com
    -- ESTE mesmo shape. Resumo = primeira linha aparada, teto de 140 chars.
    select
      al.id,
      'atividade'::text                                   as type,
      al.created_at                                       as at,
      al.collaborator_id                                  as author_id,
      left(btrim(split_part(al.message, E'\n', 1)), 140)  as summary,
      al.message                                          as content,
      jsonb_build_object(
        'seconds',      al.seconds_spent,
        'sentWhatsapp', al.sent_whatsapp,
        'taskId',       al.task_id
      )                                                   as meta
    from public.activity_log al
    where al.company_id = p_company
  ),
  filtered as (
    select f.*, coalesce(p.full_name, p.email) as author_name, p.avatar_path
    from feed f
    left join public.profiles p on p.id = f.author_id
    where (p_types is null or array_length(p_types, 1) is null or f.type = any(p_types))
      and (p_author is null or f.author_id = p_author)
      and (p_from is null or (f.at at time zone 'America/Sao_Paulo')::date >= p_from)
      and (p_to   is null or (f.at at time zone 'America/Sao_Paulo')::date <= p_to)
      and (
        p_search is null or btrim(p_search) = ''
        or f.content ilike '%' || p_search || '%'
      )
  ),
  page as (
    select *
    from filtered
    order by at desc, id desc
    limit  greatest(0, least(coalesce(p_limit, 20), 100))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'items', coalesce(
      (select jsonb_agg(jsonb_build_object(
         'id',           page.id,
         'type',         page.type,
         'at',           page.at,
         'authorId',     page.author_id,
         'authorName',   page.author_name,
         'authorAvatar', page.avatar_path,
         'summary',      page.summary,
         'content',      page.content,
         'meta',         page.meta
       ) order by page.at desc, page.id desc)
       from page),
      '[]'::jsonb
    )
  );
$function$;

-- Autores distintos com evento nesta empresa — alimenta o filtro por PESSOA.
-- Independe da paginação e dos demais filtros (senão não dá para trocar de autor).
create or replace function public.company_activity_authors(p_company uuid)
returns jsonb
language sql
stable
security invoker
set search_path to 'public', 'extensions'
as $function$
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id',     a.author_id,
      'name',   coalesce(p.full_name, p.email),
      'avatar', p.avatar_path
    ) order by coalesce(p.full_name, p.email)),
    '[]'::jsonb
  )
  from (
    select distinct collaborator_id as author_id
    from public.activity_log
    where company_id = p_company
  ) a
  left join public.profiles p on p.id = a.author_id;
$function$;

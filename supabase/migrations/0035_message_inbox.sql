-- =====================================================================
-- PASSO 32 — Caixa de entrada de mensagens + badge de não lidas
--
-- Requisito: ninguém deveria precisar abrir empresa por empresa para saber
-- se um cliente escreveu. Decisão de produto (21/07): os TRÊS cargos têm
-- badge e caixa de entrada — coerente com o passo 31, onde o colaborador
-- também responde.
--
-- MARCAÇÃO DE LIDO POR USUÁRIO, não global: se o admin lê, o consultor não
-- pode perder a notificação. Uma linha (user, empresa) com o instante da
-- última leitura; "não lida" = mensagem depois desse instante que não é do
-- próprio usuário.
--
-- SEGURANÇA POR CONSTRUÇÃO: as duas funções são SECURITY INVOKER — quem
-- escopa é o RLS que já existe (cm_select: admin tudo; consultor nas dele;
-- colaborador onde tem tarefa). Não há caminho novo de leitura para blindar:
-- estas funções só reagrupam o que o usuário já podia ler.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Última leitura por usuário × empresa
-- ---------------------------------------------------------------------
create table company_message_reads (
  user_id      uuid not null references profiles(id) on delete cascade,
  company_id   uuid not null references companies(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, company_id)
);

alter table company_message_reads enable row level security;

-- Cada um só enxerga e escreve a PRÓPRIA marcação, e só de empresas a que
-- tem acesso (marcar "lido" de empresa alheia seria inócuo, mas é sujeira).
create policy cmr_select on company_message_reads for select
  using (user_id = auth.uid());

create policy cmr_insert on company_message_reads for insert
  with check (
    user_id = auth.uid()
    and (
      is_admin()
      or company_id in (select my_consultant_companies())
      or company_id in (select my_collaborator_companies())
    )
  );

create policy cmr_update on company_message_reads for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 2. Caixa de entrada: uma linha por conversa, não lidas primeiro
-- ---------------------------------------------------------------------
create or replace function message_inbox()
returns table (
  company_id       uuid,
  company_name     text,
  last_body        text,
  last_author_type text,
  last_at          timestamptz,
  unread           bigint
)
language sql stable
as $$
  select x.company_id, x.company_name, x.last_body,
         x.last_author_type, x.last_at, x.unread
    from (
      select m.company_id,
             c.name as company_name,
             (array_agg(m.body order by m.created_at desc))[1] as last_body,
             (array_agg(m.author_type order by m.created_at desc))[1]
               as last_author_type,
             max(m.created_at) as last_at,
             count(*) filter (
               where m.author_id is distinct from auth.uid()
                 and m.created_at > coalesce(r.last_read_at,
                                             '-infinity'::timestamptz)
             ) as unread
        from company_messages m
        join companies c on c.id = m.company_id
        left join company_message_reads r
          on r.company_id = m.company_id and r.user_id = auth.uid()
       group by m.company_id, c.name, r.last_read_at
    ) x
   order by (x.unread > 0) desc, x.last_at desc;
$$;

revoke execute on function message_inbox() from public, anon;
grant execute on function message_inbox() to authenticated;

-- ---------------------------------------------------------------------
-- 3. Total de não lidas (o badge) — um inteiro, consulta leve
-- ---------------------------------------------------------------------
create or replace function my_unread_messages()
returns bigint
language sql stable
as $$
  select count(*)
    from company_messages m
    left join company_message_reads r
      on r.company_id = m.company_id and r.user_id = auth.uid()
   where m.author_id is distinct from auth.uid()
     and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz);
$$;

revoke execute on function my_unread_messages() from public, anon;
grant execute on function my_unread_messages() to authenticated;

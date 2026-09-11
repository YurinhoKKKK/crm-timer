-- =====================================================================
-- CRM/Timer - Monvatti :: Menções (@usuário) em atualizações e chamados
-- =====================================================================
-- Permite marcar usuários em atualizações da empresa, em chamados do suporte e
-- nas respostas de ambos. A menção é gravada NO SERVIDOR a partir do conteúdo
-- salvo (nunca de uma lista vinda do navegador) e cada uma é validada: só
-- persiste se o marcado JÁ ALCANÇA aquele contexto.
--
-- POR QUE UMA TABELA (e não só o HTML): a menção precisa ser consultável
-- ("o que me marcaram?") sem varrer o HTML de todas as anotações do sistema.
-- É a fundação da futura central de notificações — que NÃO é construída aqui.
--
-- QUEM PODE SER MARCADO (regra de negócio, validada no servidor):
--   - atualização / resposta de atualização: quem alcança a EMPRESA da nota
--     (admin; consultor da carteira; colaborador com tarefa na empresa).
--   - chamado / resposta de chamado: qualquer cargo INTERNO (chamado é visível
--     a toda a equipe). Sem empresa associada.
-- Marcar alguém sem acesso geraria notificação de algo que a pessoa não abre e
-- exporia o nome do cliente a quem não deveria vê-lo — por isso a menção
-- inválida é simplesmente IGNORADA (o conteúdo salva normalmente).
-- =====================================================================

create table content_mentions (
  id                uuid primary key default gen_random_uuid(),
  mentioned_user_id uuid not null references profiles(id),
  author_id         uuid not null references profiles(id),
  source_type       text not null check (
                      source_type in (
                        'atualizacao', 'atualizacao_resposta',
                        'chamado', 'chamado_resposta'
                      )
                    ),
  source_id         uuid not null,
  company_id        uuid references companies(id) on delete cascade, -- nulo em chamado
  created_at        timestamptz not null default now(),
  -- Uma pessoa marcada uma vez por conteúdo (a reconciliação na edição respeita
  -- isto — não duplica menção já existente).
  unique (source_type, source_id, mentioned_user_id)
);

-- "o que me marcaram?" — alimenta a futura central de notificações.
create index idx_content_mentions_user
  on content_mentions(mentioned_user_id, created_at desc);
-- Reconciliação por conteúdo (ao salvar/editar).
create index idx_content_mentions_source
  on content_mentions(source_type, source_id);

-- ---------------------------------------------------------------------
-- RLS: leitura da PRÓPRIA menção (ou admin). NENHUMA policy de escrita — todo
-- insert/delete passa pela RPC sync_content_mentions (SECURITY DEFINER), que é
-- o único caminho de gravação. Assim o navegador nunca grava menção direto.
-- ---------------------------------------------------------------------
alter table content_mentions enable row level security;

create policy cm_select on content_mentions for select
  using (mentioned_user_id = auth.uid() or is_admin());

-- ---------------------------------------------------------------------
-- Helpers de acesso para um usuário ARBITRÁRIO (as funções my_* existentes só
-- respondem sobre auth.uid()). SECURITY DEFINER para enxergar profiles/vínculos
-- sem esbarrar na RLS de quem chama.
-- ---------------------------------------------------------------------
create or replace function is_internal_user(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = p_user and role in ('admin', 'consultor', 'colaborador')
  );
$$;

-- true se p_user ALCANÇA a empresa: admin (tudo), consultor da carteira, ou
-- colaborador com ao menos uma tarefa na empresa (mesmo vínculo derivado das
-- funções my_consultant_companies / my_collaborator_companies).
create or replace function user_reaches_company(p_user uuid, p_company uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_company is not null and (
    exists (select 1 from profiles where id = p_user and role = 'admin')
    or exists (
      select 1 from company_consultants
      where company_id = p_company and consultant_id = p_user
    )
    or exists (
      select 1 from task_instances
      where company_id = p_company and collaborator_id = p_user
    )
  );
$$;

-- ---------------------------------------------------------------------
-- Lista de quem PODE ser marcado num contexto — alimenta o seletor de @ do
-- editor. SECURITY DEFINER, mas se AUTO-GATEIA: quem chama precisa alcançar o
-- contexto, senão volta vazio (não vaza a equipe/carteira a estranhos).
-- ---------------------------------------------------------------------
create or replace function mentionable_users(p_source_type text, p_company uuid)
returns table (id uuid, full_name text, avatar_path text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if p_source_type in ('chamado', 'chamado_resposta') then
    -- Chamado é visível a toda a equipe interna.
    if not is_internal_user(auth.uid()) then
      return;
    end if;
    return query
      select p.id, p.full_name, p.avatar_path
      from profiles p
      where p.role in ('admin', 'consultor', 'colaborador')
      order by p.full_name;
  elsif p_source_type in ('atualizacao', 'atualizacao_resposta') then
    -- Só quem alcança a empresa da atualização.
    if not user_reaches_company(auth.uid(), p_company) then
      return;
    end if;
    return query
      select p.id, p.full_name, p.avatar_path
      from profiles p
      where p.role = 'admin'
         or exists (
           select 1 from company_consultants c
           where c.company_id = p_company and c.consultant_id = p.id
         )
         or exists (
           select 1 from task_instances t
           where t.company_id = p_company and t.collaborator_id = p.id
         )
      order by p.full_name;
  end if;
end;
$$;

grant execute on function mentionable_users(text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Reconciliação das menções de um conteúdo. Recebe os ids EXTRAÍDOS do HTML
-- salvo (no servidor) e:
--   - deriva a empresa a partir da PRÓPRIA fonte (nunca confia no cliente);
--   - exige que o CHAMADOR alcance o contexto (senão aborta);
--   - mantém só os ids que o marcado de fato ALCANÇA (ignora inválidos);
--   - apaga as menções que saíram do texto; insere as novas (sem duplicar).
-- SECURITY DEFINER: é o único caminho de escrita em content_mentions.
-- ---------------------------------------------------------------------
create or replace function sync_content_mentions(
  p_source_type text,
  p_source_id   uuid,
  p_user_ids    uuid[]
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_caller  uuid := auth.uid();
  v_company uuid;
  v_valid   uuid[];
begin
  -- Empresa derivada da fonte (não vem do navegador).
  if p_source_type = 'atualizacao' then
    select company_id into v_company from company_notes where id = p_source_id;
    if v_company is null then return; end if; -- fonte inexistente
  elsif p_source_type = 'atualizacao_resposta' then
    select n.company_id into v_company
    from company_note_replies r
    join company_notes n on n.id = r.note_id
    where r.id = p_source_id;
    if v_company is null then return; end if;
  elsif p_source_type in ('chamado', 'chamado_resposta') then
    v_company := null;
  else
    raise exception 'source_type invalido: %', p_source_type;
  end if;

  -- O chamador precisa alcançar o contexto (é quem está salvando o conteúdo).
  if p_source_type in ('chamado', 'chamado_resposta') then
    if not is_internal_user(v_caller) then
      raise exception 'sem acesso ao contexto';
    end if;
  else
    if not user_reaches_company(v_caller, v_company) then
      raise exception 'sem acesso ao contexto';
    end if;
  end if;

  -- Só os ids que o marcado ALCANÇA de fato.
  select coalesce(array_agg(distinct u), '{}'::uuid[])
  into v_valid
  from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u
  where case
    when p_source_type in ('chamado', 'chamado_resposta') then is_internal_user(u)
    else user_reaches_company(u, v_company)
  end;

  -- Menções que saíram do texto (ou inválidas) somem.
  delete from content_mentions
  where source_type = p_source_type
    and source_id = p_source_id
    and not (mentioned_user_id = any (v_valid));

  -- Novas válidas entram (a unique impede duplicar as já existentes).
  insert into content_mentions
    (mentioned_user_id, author_id, source_type, source_id, company_id)
  select u, v_caller, p_source_type, p_source_id, v_company
  from unnest(v_valid) as u
  on conflict (source_type, source_id, mentioned_user_id) do nothing;
end;
$$;

grant execute on function sync_content_mentions(text, uuid, uuid[]) to authenticated;

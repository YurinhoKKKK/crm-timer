-- =====================================================================
-- CRM/Timer - Monvatti :: Respostas DIRIGIDAS (encadeadas)
-- =====================================================================
-- Muda a mecânica de resposta: em vez de uma lista linear, cada resposta pode
-- apontar para OUTRA mensagem da MESMA conversa (parent_id). Nulo = resposta ao
-- chamado / à atualização em si (a raiz da conversa).
--
-- Vale em dois lugares, com o MESMO molde:
--   1. Chamados do suporte (support_ticket_replies, já existente) ganha parent_id.
--   2. Atualizações da empresa (company_note_replies, tabela NOVA) ganham a
--      mesma mecânica — antes não tinham resposta nenhuma.
--
-- INTEGRIDADE (garantida no banco, não só na tela):
--   - parent_id só pode apontar para resposta da MESMA conversa (mesmo ticket /
--     mesma nota). Resposta apontando para outra conversa é dado corrompido.
--   - Sem ciclo (A responde B, B responde A). Como parent_id é congelado no
--     update e a resposta-pai já precisa existir no insert, um ciclo é
--     estruturalmente impossível; ainda assim a checagem sobe a cadeia e aborta
--     se reencontrar a própria linha — defesa explícita.
--   - Append-only: ninguém exclui (sem policy de DELETE; o cascade do pai vale).
--   - Autoria carimbada no servidor (author_id = auth.uid()), nunca do navegador.
--   - Autor edita a PRÓPRIA resposta, com selo de editado; ninguém edita a de
--     outro (nem admin) — mesma filosofia da Fatia 2 do suporte.
--
-- PROFUNDIDADE: guardamos parent_id sempre, mas a tela exibe no MÁXIMO um nível
-- de indentação (o banco não limita profundidade — quem limita é a leitura).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Suporte: parent_id nas respostas existentes.
--    As 2 respostas atuais ficam com parent_id NULO (respostas ao chamado) —
--    o default já cuida disso, sem backfill inventando vínculo.
-- ---------------------------------------------------------------------
alter table support_ticket_replies
  add column parent_id uuid references support_ticket_replies(id) on delete cascade;

create index idx_support_ticket_replies_parent
  on support_ticket_replies(parent_id);

-- O trigger de auditoria da Fatia 2 congela vínculo/autoria/criação e carimba
-- edited_at. Agora congela também parent_id (o direcionamento não muda depois).
create or replace function support_ticket_replies_audit()
returns trigger
language plpgsql set search_path = public
as $$
begin
  new.ticket_id  := old.ticket_id;
  new.parent_id  := old.parent_id;
  new.author_id  := old.author_id;
  new.created_at := old.created_at;
  if new.body_html is distinct from old.body_html
     or new.attachments is distinct from old.attachments then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

-- Integridade do direcionamento: pai da MESMA conversa + anti-ciclo.
create or replace function support_ticket_replies_check_parent()
returns trigger
language plpgsql set search_path = public
as $$
declare
  parent_ticket uuid;
  cursor_id     uuid;
  hops          int := 0;
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'Uma resposta não pode responder a si mesma';
  end if;
  select ticket_id into parent_ticket
    from support_ticket_replies where id = new.parent_id;
  if parent_ticket is null then
    raise exception 'Resposta-pai inexistente';
  end if;
  if parent_ticket <> new.ticket_id then
    raise exception 'A resposta-pai pertence a outro chamado';
  end if;
  -- Sobe a cadeia de pais; se reencontrar a própria linha, há ciclo.
  cursor_id := new.parent_id;
  while cursor_id is not null loop
    if cursor_id = new.id then
      raise exception 'Ciclo de respostas detectado';
    end if;
    hops := hops + 1;
    if hops > 1000 then
      raise exception 'Cadeia de respostas longa demais';
    end if;
    select parent_id into cursor_id
      from support_ticket_replies where id = cursor_id;
  end loop;
  return new;
end;
$$;

create trigger trg_support_ticket_replies_check_parent
  before insert or update on support_ticket_replies
  for each row execute function support_ticket_replies_check_parent();

-- ---------------------------------------------------------------------
-- 2) Atualizações da empresa: nova tabela de respostas, no mesmo molde do
--    suporte. Inclui `attachments` de propósito: o formulário reusa o MESMO
--    editor (NoteEditor, com botão de anexo e imagem inline) — sem esta coluna
--    um anexo enviado na resposta seria silenciosamente perdido.
-- ---------------------------------------------------------------------
create table company_note_replies (
  id          uuid primary key default gen_random_uuid(),
  note_id     uuid not null references company_notes(id) on delete cascade,
  parent_id   uuid references company_note_replies(id) on delete cascade,
  body_html   text not null check (btrim(body_html) <> ''),
  attachments jsonb not null default '[]'::jsonb,
  author_id   uuid not null references profiles(id),
  created_at  timestamptz not null default now(),
  edited_at   timestamptz  -- null enquanto nunca foi editada
);

create index idx_company_note_replies_note
  on company_note_replies(note_id, created_at);
create index idx_company_note_replies_parent
  on company_note_replies(parent_id);

-- Auditoria + imutáveis (congela nota/pai/autoria/criação; carimba edited_at).
create or replace function company_note_replies_audit()
returns trigger
language plpgsql set search_path = public
as $$
begin
  new.note_id    := old.note_id;
  new.parent_id  := old.parent_id;
  new.author_id  := old.author_id;
  new.created_at := old.created_at;
  if new.body_html is distinct from old.body_html
     or new.attachments is distinct from old.attachments then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

create trigger trg_company_note_replies_audit
  before update on company_note_replies
  for each row execute function company_note_replies_audit();

-- Integridade do direcionamento: pai da MESMA atualização + anti-ciclo.
create or replace function company_note_replies_check_parent()
returns trigger
language plpgsql set search_path = public
as $$
declare
  parent_note uuid;
  cursor_id   uuid;
  hops        int := 0;
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'Uma resposta não pode responder a si mesma';
  end if;
  select note_id into parent_note
    from company_note_replies where id = new.parent_id;
  if parent_note is null then
    raise exception 'Resposta-pai inexistente';
  end if;
  if parent_note <> new.note_id then
    raise exception 'A resposta-pai pertence a outra atualização';
  end if;
  cursor_id := new.parent_id;
  while cursor_id is not null loop
    if cursor_id = new.id then
      raise exception 'Ciclo de respostas detectado';
    end if;
    hops := hops + 1;
    if hops > 1000 then
      raise exception 'Cadeia de respostas longa demais';
    end if;
    select parent_id into cursor_id
      from company_note_replies where id = cursor_id;
  end loop;
  return new;
end;
$$;

create trigger trg_company_note_replies_check_parent
  before insert or update on company_note_replies
  for each row execute function company_note_replies_check_parent();

-- ---------------------------------------------------------------------
-- RLS: espelha exatamente o escopo das atualizações (cn_* na 0024). Tudo é
-- derivado do registro pai em company_notes — quem alcança a nota pode ler/
-- responder; só o autor edita a própria resposta.
--   - A policy de SELECT NÃO relê a própria tabela pela PK (só company_notes),
--     então INSERT ... RETURNING não esbarra na armadilha do 42501.
-- ---------------------------------------------------------------------
alter table company_note_replies enable row level security;

create policy cnr_select on company_note_replies for select
  using (
    exists (
      select 1 from company_notes n
      where n.id = note_id
        and (
          is_admin()
          or n.company_id in (select my_consultant_companies())
          or n.company_id in (select my_collaborator_companies())
        )
    )
  );

create policy cnr_insert on company_note_replies for insert
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from company_notes n
      where n.id = note_id
        and (
          is_admin()
          or n.company_id in (select my_consultant_companies())
          or n.company_id in (select my_collaborator_companies())
        )
    )
  );

-- Só o autor edita a PRÓPRIA resposta (nem admin edita alheia).
create policy cnr_update on company_note_replies for update
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- Sem policy de DELETE de propósito: append-only. Um DELETE afeta 0 linhas.

-- ---------------------------------------------------------------------
-- Contagem de respostas por atualização NO BANCO (nunca contar array carregado:
-- o PostgREST trunca em 1000 sem avisar). Conta TODAS as respostas da conversa,
-- independente do nível (parent_id não entra na conta). SECURITY INVOKER: herda
-- a cnr_select. Escopada por empresa; só volta nota com >0 (a tela não pinta 0).
-- ---------------------------------------------------------------------
create or replace function company_note_reply_counts(p_company uuid)
returns table (note_id uuid, reply_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select r.note_id, count(*)
  from company_note_replies r
  join company_notes n on n.id = r.note_id
  where n.company_id = p_company
  group by r.note_id;
$$;

grant execute on function company_note_reply_counts(uuid) to authenticated;

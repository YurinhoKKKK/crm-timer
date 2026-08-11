-- =====================================================================
-- Chamados internos de suporte — Fatia 2: RESPOSTAS.
--
-- Cada chamado (support_tickets, Fatia 1) recebe respostas em rich text da
-- equipe interna. É histórico de ATENDIMENTO: append-only, ninguém apaga.
--
-- DECISÕES (no mesmo espírito da Fatia 1):
-- - SELECT/INSERT liberados a qualquer cargo INTERNO (admin, consultor,
--   colaborador); pending e anon nunca leem.
-- - Autoria carimbada no servidor (author_id = auth.uid()), nunca do navegador.
-- - UPDATE só do PRÓPRIO autor — nem admin edita resposta alheia; um trigger
--   congela ticket_id/author_id/created_at e carimba edited_at quando o corpo
--   muda (mesma filosofia do trigger da Fatia 1).
-- - SEM policy de DELETE para ninguém: resposta é imutável quanto à existência
--   (o cascade do ticket continua valendo — excluir o chamado leva as respostas).
--
-- ANEXOS: o formulário reusa o MESMO editor (NoteEditor) com upload de imagem
-- (inline em body_html, bucket note-images) E de arquivo (note-files). Para não
-- orfanar o arquivo enviado, `attachments` espelha support_tickets.attachments
-- (Fatia 1) — é o MESMO caminho de upload, não um paralelo.
-- =====================================================================

create table support_ticket_replies (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references support_tickets(id) on delete cascade,
  body_html   text not null check (btrim(body_html) <> ''),
  attachments jsonb not null default '[]'::jsonb,
  author_id   uuid not null references profiles(id),
  created_at  timestamptz not null default now(),
  edited_at   timestamptz  -- null enquanto nunca foi editada
);

-- Lista do chamado, mais recentes primeiro; e a contagem por ticket.
create index idx_support_ticket_replies_ticket
  on support_ticket_replies(ticket_id, created_at desc);

-- ---------------------------------------------------------------------
-- Campos imutáveis + carimbo de edição. Congela vínculo/autoria/criação e
-- preenche edited_at só quando o corpo de fato muda.
-- ---------------------------------------------------------------------
create or replace function support_ticket_replies_audit()
returns trigger
language plpgsql set search_path = public
as $$
begin
  new.ticket_id  := old.ticket_id;
  new.author_id  := old.author_id;
  new.created_at := old.created_at;
  if new.body_html is distinct from old.body_html
     or new.attachments is distinct from old.attachments then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

create trigger trg_support_ticket_replies_audit
  before update on support_ticket_replies
  for each row execute function support_ticket_replies_audit();

-- ---------------------------------------------------------------------
-- RLS. Cargo interno = admin/consultor/colaborador (auth_role() é o helper do
-- projeto). A policy de SELECT não relê a própria tabela pela PK, então o
-- INSERT ... RETURNING do supabase-js não esbarra na armadilha do 42501.
-- ---------------------------------------------------------------------
alter table support_ticket_replies enable row level security;

create policy str_select on support_ticket_replies for select
  using (auth_role() in ('admin', 'consultor', 'colaborador'));

create policy str_insert on support_ticket_replies for insert
  with check (
    author_id = auth.uid()
    and auth_role() in ('admin', 'consultor', 'colaborador')
  );

-- Só o autor edita a PRÓPRIA resposta (nem admin edita alheia).
create policy str_update on support_ticket_replies for update
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- Sem policy de DELETE de propósito: append-only. Um DELETE afeta 0 linhas.

-- ---------------------------------------------------------------------
-- Contagem de respostas por chamado NO BANCO (nunca contar array carregado: a
-- lista é paginada e o PostgREST trunca em 1000 sem avisar). SECURITY INVOKER:
-- herda a str_select. Só volta ticket com resposta (a tela não desenha 0).
-- ---------------------------------------------------------------------
create or replace function support_ticket_reply_counts()
returns table (ticket_id uuid, reply_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select ticket_id, count(*)
  from support_ticket_replies
  group by ticket_id;
$$;

grant execute on function support_ticket_reply_counts() to authenticated;

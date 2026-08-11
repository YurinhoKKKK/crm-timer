-- =====================================================================
-- Chamados internos de suporte (Fatia 1) — o quadro do Monday trazido para o
-- CRM. 100% INTERNO: o portal do cliente não é tocado; nenhuma tela do cliente
-- exibe chamado.
--
-- DECISÕES DE MODELAGEM (não reabrir):
-- - O título é TEXTO LIVRE. O chamado NÃO tem company_id — não é vinculado a
--   nenhuma empresa do sistema e não aparece na central da empresa.
-- - Os grupos "Tickets Abertos" e "Tickets Finalizados" são DERIVADOS do status
--   (finalizado = Finalizados; qualquer outro = Abertos). NÃO há coluna de grupo:
--   duas fontes de verdade para a mesma pergunta divergiriam.
-- - Todos os cargos INTERNOS (admin, consultor, colaborador) veem TODOS os
--   chamados — chamado é operação interna, não dado de cliente. `pending` não vê
--   nada; anon nunca lê.
-- - Sem responsável e sem posição/ordenação manual nesta fatia.
--
-- ANEXOS: o formulário reusa o editor das anotações (NoteEditor), que já sobe
-- imagem (inline no context_html, bucket note-images) E documentos (bucket
-- note-files, metadados em JSONB). Para não orfanar o arquivo enviado, a coluna
-- `attachments` espelha company_notes.attachments — é o MESMO caminho de upload,
-- não um paralelo.
-- =====================================================================

create type ticket_urgency    as enum ('baixa', 'media', 'alta');
create type ticket_issue_type as enum (
  'integracao', 'chamado', 'bo_tray', 'bo_ml', 'bo_amazon', 'bo_shopee', 'bo_notas'
);
create type ticket_status     as enum (
  'em_andamento', 'parado', 'aguardando_cliente', 'aguardando_email', 'finalizado'
);

create table support_tickets (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(btrim(title)) between 3 and 200),
  context_html text not null check (btrim(context_html) <> ''),
  attachments  jsonb not null default '[]'::jsonb,
  urgency      ticket_urgency    not null,
  issue_type   ticket_issue_type not null,
  status       ticket_status     not null default 'em_andamento',
  created_by   uuid not null references profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  updated_by   uuid references profiles(id),
  -- Carimbado quando o status passa a 'finalizado'; limpo quando sai (trigger).
  finished_at  timestamptz
);

-- Lista dividida em Abertos/Finalizados, mais recentes primeiro dentro de cada
-- grupo — o filtro por status + ordenação por created_at é o acesso quente.
create index idx_support_tickets_status_created on support_tickets(status, created_at desc);
create index idx_support_tickets_created_by on support_tickets(created_by);

-- ---------------------------------------------------------------------
-- Auditoria + campos imutáveis + coerência do finished_at.
--
-- Mesma filosofia do trigger company_notes_audit:
-- - created_by/created_at ficam CONGELADOS para todo mundo (nunca reescritos).
-- - title/context_html só podem ser alterados pelo AUTOR ou por admin; para os
--   demais (a analista que muda o status de um chamado alheio) são congelados —
--   ela mexe no status, nunca no corpo.
-- - updated_at/updated_by são preenchidos a cada update.
-- - finished_at acompanha o status: carimbado ao entrar em 'finalizado', limpo
--   ao sair (inclusive já no INSERT, se o chamado nascer finalizado).
-- ---------------------------------------------------------------------
create or replace function support_tickets_audit()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.finished_at := case when new.status = 'finalizado' then now() else null end;
    return new;
  end if;

  -- UPDATE
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  -- Quem não é autor nem admin não reescreve o corpo do chamado (só o status).
  if auth.uid() <> old.created_by and not is_admin() then
    new.title        := old.title;
    new.context_html := old.context_html;
    new.attachments  := old.attachments;
  end if;

  new.updated_at := now();
  new.updated_by := auth.uid();

  if new.status = 'finalizado' and old.status is distinct from 'finalizado' then
    new.finished_at := now();
  elsif new.status is distinct from 'finalizado' then
    new.finished_at := null;
  end if;

  return new;
end;
$$;

create trigger trg_support_tickets_audit
  before insert or update on support_tickets
  for each row execute function support_tickets_audit();

-- ---------------------------------------------------------------------
-- RLS. Cargo interno = admin, consultor ou colaborador (auth_role() já é o
-- helper do projeto; pending devolve 'pending' e cai fora; anon devolve null e
-- cai fora). Não há releitura da própria tabela na policy de SELECT, então o
-- INSERT ... RETURNING do supabase-js não esbarra na armadilha do 42501.
-- ---------------------------------------------------------------------
alter table support_tickets enable row level security;

create policy st_select on support_tickets for select
  using (auth_role() in ('admin', 'consultor', 'colaborador'));

create policy st_insert on support_tickets for insert
  with check (
    created_by = auth.uid()
    and auth_role() in ('admin', 'consultor', 'colaborador')
  );

-- Qualquer interno muda o status (a analista precisa mexer em chamado alheio);
-- o corpo fica protegido pelo trigger (autor/admin apenas).
create policy st_update on support_tickets for update
  using (auth_role() in ('admin', 'consultor', 'colaborador'))
  with check (auth_role() in ('admin', 'consultor', 'colaborador'));

create policy st_delete on support_tickets for delete
  using (is_admin() or created_by = auth.uid());

-- ---------------------------------------------------------------------
-- Contagem dos grupos NO BANCO (nunca contar o array carregado na tela: a lista
-- é paginada e o PostgREST trunca em 1000 linhas sem avisar). SECURITY INVOKER:
-- herda a st_select, então pending/anon contam 0. Uma linha só.
-- ---------------------------------------------------------------------
create or replace function support_ticket_counts()
returns table (open_count bigint, finished_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*) filter (where status <> 'finalizado'),
    count(*) filter (where status = 'finalizado')
  from support_tickets;
$$;

grant execute on function support_ticket_counts() to authenticated;

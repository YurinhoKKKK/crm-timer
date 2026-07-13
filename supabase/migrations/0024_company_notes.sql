-- =====================================================================
-- CRM/Timer - Monvatti :: Passo 24 — Anotações rich text na tela da empresa
-- =====================================================================
-- Anotações (resumos de reunião, planos de ação etc.) registradas na central
-- da empresa por admin, consultor e colaborador. O conteúdo é HTML gerado pelo
-- editor TipTap (imagens hospedadas no bucket note-images do Storage).
--
-- Visibilidade: toda anotação nasce INTERNA (visible_to_client = false). Só as
-- marcadas explicitamente como "visível ao cliente" aparecerão no acesso
-- externo do cliente (passo 25).
--
-- Auditoria de edição: trigger preenche updated_at/updated_by a cada update e
-- congela os campos imutáveis (autor, empresa, created_at).
-- =====================================================================

create table company_notes (
  id                uuid primary key default uuid_generate_v4(),
  company_id        uuid not null references companies(id) on delete cascade,
  author_id         uuid not null references profiles(id) on delete cascade,
  content_html      text not null check (btrim(content_html) <> ''),
  visible_to_client boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz,
  updated_by        uuid references profiles(id) on delete set null
);

-- Lista da central: as anotações de UMA empresa, mais recentes primeiro.
create index idx_company_notes_company on company_notes(company_id, created_at desc);
create index idx_company_notes_author on company_notes(author_id);
create index idx_company_notes_updated_by on company_notes(updated_by);

-- ---------------------------------------------------------------------
-- Auditoria + campos imutáveis: quem editou e quando ficam registrados no
-- próprio registro; autor/empresa/criação não podem ser reescritos por update.
-- ---------------------------------------------------------------------
create or replace function company_notes_audit()
returns trigger
language plpgsql set search_path = public
as $$
begin
  new.company_id := old.company_id;
  new.author_id  := old.author_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger trg_company_notes_audit
  before update on company_notes
  for each row execute function company_notes_audit();

-- ---------------------------------------------------------------------
-- RLS (opção A):
-- - leitura: quem tem acesso à empresa (admin tudo; consultor nas empresas
--   dele; colaborador nas empresas onde tem tarefa — vínculo derivado).
-- - criação: o mesmo escopo, sempre como o próprio autor.
-- - edição/exclusão: só o AUTOR (ainda com acesso à empresa) ou admin.
-- ---------------------------------------------------------------------
alter table company_notes enable row level security;

create policy cn_select on company_notes for select
  using (
    is_admin()
    or company_id in (select my_consultant_companies())
    or company_id in (select my_collaborator_companies())
  );

create policy cn_insert on company_notes for insert
  with check (
    author_id = auth.uid()
    and (
      is_admin()
      or company_id in (select my_consultant_companies())
      or company_id in (select my_collaborator_companies())
    )
  );

create policy cn_update on company_notes for update
  using (
    is_admin()
    or (
      author_id = auth.uid()
      and (
        company_id in (select my_consultant_companies())
        or company_id in (select my_collaborator_companies())
      )
    )
  )
  with check (
    is_admin()
    or (
      author_id = auth.uid()
      and (
        company_id in (select my_consultant_companies())
        or company_id in (select my_collaborator_companies())
      )
    )
  );

create policy cn_delete on company_notes for delete
  using (is_admin() or author_id = auth.uid());

-- ---------------------------------------------------------------------
-- Storage: bucket público "note-images" para as imagens inseridas no texto
-- (mesmo modelo do avatars: leitura liberada, escrita só na pasta do próprio
-- usuário — prefixo <uid>/ no caminho).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('note-images', 'note-images', true)
on conflict (id) do update set public = true;

drop policy if exists "note_images_read" on storage.objects;
create policy "note_images_read" on storage.objects for select
  using (bucket_id = 'note-images');

drop policy if exists "note_images_insert_own" on storage.objects;
create policy "note_images_insert_own" on storage.objects for insert
  with check (
    bucket_id = 'note-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "note_images_delete_own" on storage.objects;
create policy "note_images_delete_own" on storage.objects for delete
  using (
    bucket_id = 'note-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

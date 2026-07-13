-- =====================================================================
-- CRM/Timer - Monvatti :: Passo 24.1 — anexos de documentos nas anotações
-- =====================================================================
-- Além das imagens inline, uma anotação pode ter DOCUMENTOS anexos (PDF, docx,
-- xlsx, csv, txt). Ficam como metadados JSONB na própria anotação (não têm
-- ciclo de vida próprio: nascem e morrem com ela, e herdam as políticas cn_*
-- sem RLS extra): [{ path, name, size, mime }]. Os arquivos vão no bucket
-- público note-files (mesmo modelo do note-images: leitura liberada, escrita
-- só na pasta <uid>/ do próprio usuário).
-- =====================================================================

alter table company_notes
  add column attachments jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public)
values ('note-files', 'note-files', true)
on conflict (id) do update set public = true;

drop policy if exists "note_files_read" on storage.objects;
create policy "note_files_read" on storage.objects for select
  using (bucket_id = 'note-files');

drop policy if exists "note_files_insert_own" on storage.objects;
create policy "note_files_insert_own" on storage.objects for insert
  with check (
    bucket_id = 'note-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "note_files_delete_own" on storage.objects;
create policy "note_files_delete_own" on storage.objects for delete
  using (
    bucket_id = 'note-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

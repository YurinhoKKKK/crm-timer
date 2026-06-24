-- =====================================================================
-- Passo 13: foto de perfil
-- =====================================================================
-- Coluna para o caminho do avatar no Storage + bucket público "avatars"
-- com políticas: leitura liberada; cada usuário só escreve/remove na sua
-- própria pasta (prefixo = uid).
-- =====================================================================

alter table profiles add column if not exists avatar_path text;

-- Bucket público (a URL pública é usada direto na <img>).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- Leitura: qualquer um pode ler os objetos do bucket (além da URL pública).
drop policy if exists "avatars_read" on storage.objects;
create policy "avatars_read" on storage.objects for select
  using (bucket_id = 'avatars');

-- Escrita restrita à própria pasta: o primeiro segmento do caminho
-- (<uid>/arquivo) tem que ser o id do usuário logado.
drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

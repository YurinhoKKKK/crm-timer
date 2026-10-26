-- =====================================================================
-- 0160 — Endurece o bucket "avatars" (foto de perfil recortada no cliente)
-- =====================================================================
-- Desde que a foto é recortada e comprimida no navegador (512×512 JPEG 0.85, bem
-- abaixo de 1 MB), o bucket pode recusar uploads grandes/estranhos no servidor:
--   · file_size_limit = 1 MB
--   · allowed_mime_types = image/jpeg, image/png, image/webp
-- NÃO mexe nas policies do bucket (decisão 7). Rollback volta aos limites nulos.
-- =====================================================================

update storage.buckets
   set file_size_limit = 1048576,  -- 1 MB em bytes
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'avatars';

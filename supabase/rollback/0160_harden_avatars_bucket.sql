-- =====================================================================
-- ROLLBACK da 0160 — remove os limites do bucket "avatars" (volta a sem limite).
-- =====================================================================

update storage.buckets
   set file_size_limit = null,
       allowed_mime_types = null
 where id = 'avatars';

-- Setup Storage per Blog Images
-- Esegui questo script in Supabase SQL Editor

-- 1. Crea il bucket "blog-images" (se non esiste)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'blog-images',
  'blog-images',
  true,
  5242880, -- 5MB in bytes
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- 2. Policy per lettura pubblica (chiunque può leggere le immagini)
DROP POLICY IF EXISTS "Public Access for blog-images" ON storage.objects;
CREATE POLICY "Public Access for blog-images"
ON storage.objects
FOR SELECT
USING (bucket_id = 'blog-images');

-- Nota: L'upload viene gestito tramite SERVICE_ROLE_KEY nell'API route,
-- quindi non serve una policy pubblica per INSERT. L'API route usa
-- il SERVICE_ROLE_KEY che bypassa le RLS policies.

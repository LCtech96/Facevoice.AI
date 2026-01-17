-- Migration: Aggiunge campo slug alla tabella blog_posts
-- Esegui questo script in Supabase SQL Editor

-- Abilita estensione unaccent se disponibile (per rimuovere accenti)
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Aggiungi colonna slug se non esiste
ALTER TABLE blog_posts 
ADD COLUMN IF NOT EXISTS slug TEXT;

-- Crea indice per ricerca veloce per slug
CREATE INDEX IF NOT EXISTS idx_blog_posts_slug ON blog_posts(slug);

-- Funzione per generare slug da titolo
-- Usa unaccent se disponibile, altrimenti usa replace per rimuovere accenti comuni
CREATE OR REPLACE FUNCTION generate_slug_from_title(title_text TEXT)
RETURNS TEXT AS $$
DECLARE
  cleaned_text TEXT;
BEGIN
  -- Prova a usare unaccent se disponibile
  BEGIN
    SELECT unaccent(title_text) INTO cleaned_text;
  EXCEPTION WHEN OTHERS THEN
    -- Fallback: rimuove accenti manualmente
    cleaned_text := title_text;
    cleaned_text := replace(cleaned_text, 'à', 'a');
    cleaned_text := replace(cleaned_text, 'á', 'a');
    cleaned_text := replace(cleaned_text, 'è', 'e');
    cleaned_text := replace(cleaned_text, 'é', 'e');
    cleaned_text := replace(cleaned_text, 'ì', 'i');
    cleaned_text := replace(cleaned_text, 'í', 'i');
    cleaned_text := replace(cleaned_text, 'ò', 'o');
    cleaned_text := replace(cleaned_text, 'ó', 'o');
    cleaned_text := replace(cleaned_text, 'ù', 'u');
    cleaned_text := replace(cleaned_text, 'ú', 'u');
    cleaned_text := replace(cleaned_text, 'À', 'A');
    cleaned_text := replace(cleaned_text, 'Á', 'A');
    cleaned_text := replace(cleaned_text, 'È', 'E');
    cleaned_text := replace(cleaned_text, 'É', 'E');
    cleaned_text := replace(cleaned_text, 'Ì', 'I');
    cleaned_text := replace(cleaned_text, 'Í', 'I');
    cleaned_text := replace(cleaned_text, 'Ò', 'O');
    cleaned_text := replace(cleaned_text, 'Ó', 'O');
    cleaned_text := replace(cleaned_text, 'Ù', 'U');
    cleaned_text := replace(cleaned_text, 'Ú', 'U');
  END;
  
  RETURN lower(
    regexp_replace(
      regexp_replace(cleaned_text, '[^a-z0-9]+', '-', 'g'),
      '^-+|-+$', '', 'g'
    )
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Genera slug per tutti i post esistenti che non hanno slug
UPDATE blog_posts
SET slug = generate_slug_from_title(title)
WHERE slug IS NULL OR slug = '';

-- Aggiungi constraint per slug unico (opzionale, commentato per ora)
-- ALTER TABLE blog_posts ADD CONSTRAINT blog_posts_slug_unique UNIQUE (slug);

-- Commento sulla colonna
COMMENT ON COLUMN blog_posts.slug IS 'Slug SEO-friendly generato dal titolo per URL leggibili';

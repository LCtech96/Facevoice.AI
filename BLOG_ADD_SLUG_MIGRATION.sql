-- Migration: Aggiunge campo slug alla tabella blog_posts
-- Esegui questo script in Supabase SQL Editor

-- Aggiungi colonna slug se non esiste
ALTER TABLE blog_posts 
ADD COLUMN IF NOT EXISTS slug TEXT;

-- Crea indice per ricerca veloce per slug
CREATE INDEX IF NOT EXISTS idx_blog_posts_slug ON blog_posts(slug);

-- Funzione per generare slug da titolo
CREATE OR REPLACE FUNCTION generate_slug_from_title(title_text TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN lower(
    regexp_replace(
      regexp_replace(
        unaccent(title_text),
        '[^a-z0-9]+', '-', 'g'
      ),
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

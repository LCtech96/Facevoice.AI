-- Schema per Entertainment Posts (Fischietto)
-- Esegui questo script in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS entertainment_posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  image_url TEXT,
  author TEXT NOT NULL DEFAULT 'Fischietto',
  slug TEXT UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entertainment_posts_created_at ON entertainment_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entertainment_posts_slug ON entertainment_posts(slug);

-- Trigger per aggiornare updated_at
CREATE OR REPLACE FUNCTION update_entertainment_post_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_entertainment_posts_updated_at
  BEFORE UPDATE ON entertainment_posts
  FOR EACH ROW
  EXECUTE FUNCTION update_entertainment_post_updated_at();

-- RLS
ALTER TABLE entertainment_posts ENABLE ROW LEVEL SECURITY;

-- Policy: chiunque può leggere i post
DROP POLICY IF EXISTS "Anyone can read entertainment_posts" ON entertainment_posts;
CREATE POLICY "Anyone can read entertainment_posts" ON entertainment_posts 
  FOR SELECT 
  USING (true);

-- Policy: solo admin può inserire (gestito via API con SERVICE_ROLE_KEY)

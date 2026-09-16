-- Schema per Blog Posts
-- Esegui questo script in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS blog_posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  image_url TEXT,
  author TEXT NOT NULL DEFAULT 'Facevoice.ai',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_created_at ON blog_posts(created_at DESC);

-- RLS
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;

-- Policy: chiunque può leggere i post
DROP POLICY IF EXISTS "Anyone can read blog_posts" ON blog_posts;
CREATE POLICY "Anyone can read blog_posts" ON blog_posts 
  FOR SELECT 
  USING (true);

-- Policy: solo admin può inserire (gestito via API con SERVICE_ROLE_KEY)


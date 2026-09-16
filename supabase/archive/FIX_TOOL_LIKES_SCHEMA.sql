-- Fix Tool Likes Schema
-- Esegui questo script in Supabase SQL Editor per creare/aggiornare la tabella tool_likes

-- Crea la tabella se non esiste
CREATE TABLE IF NOT EXISTS tool_likes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tool_id TEXT NOT NULL,
  user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(tool_id, user_id)
);

-- Crea la tabella ai_tools se non esiste (necessaria per foreign key)
CREATE TABLE IF NOT EXISTS ai_tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  cover_image TEXT,
  category TEXT NOT NULL,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Aggiungi foreign key se non esiste (senza constraint name per evitare errori)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'tool_likes_tool_id_fkey'
  ) THEN
    ALTER TABLE tool_likes 
    ADD CONSTRAINT tool_likes_tool_id_fkey 
    FOREIGN KEY (tool_id) REFERENCES ai_tools(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Crea indici per performance
CREATE INDEX IF NOT EXISTS idx_tool_likes_tool_id ON tool_likes(tool_id);
CREATE INDEX IF NOT EXISTS idx_tool_likes_user_id ON tool_likes(user_id);

-- Abilita RLS
ALTER TABLE tool_likes ENABLE ROW LEVEL SECURITY;

-- Rimuovi policy esistenti se ci sono
DROP POLICY IF EXISTS "Anyone can read tool_likes" ON tool_likes;
DROP POLICY IF EXISTS "Authenticated users can create tool_likes" ON tool_likes;
DROP POLICY IF EXISTS "Users can delete own tool_likes" ON tool_likes;
DROP POLICY IF EXISTS "Users can delete own tool_likes" ON tool_likes;

-- Crea policy per SELECT: chiunque può leggere
CREATE POLICY "Anyone can read tool_likes" 
ON tool_likes 
FOR SELECT 
USING (true);

-- Crea policy per INSERT: solo utenti autenticati
CREATE POLICY "Authenticated users can create tool_likes" 
ON tool_likes 
FOR INSERT 
WITH CHECK (auth.role() = 'authenticated');

-- Crea policy per DELETE: utenti possono eliminare solo i propri like
CREATE POLICY "Users can delete own tool_likes" 
ON tool_likes 
FOR DELETE 
USING (auth.uid() = user_id);

-- Crea policy per UPDATE: utenti possono aggiornare solo i propri like (se necessario)
DROP POLICY IF EXISTS "Users can update own tool_likes" ON tool_likes;
CREATE POLICY "Users can update own tool_likes" 
ON tool_likes 
FOR UPDATE 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

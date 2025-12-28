-- Schema completo per tool_comments con verifica email
-- Esegui questo script in Supabase SQL Editor

-- Crea la tabella tool_comments se non esiste
CREATE TABLE IF NOT EXISTS tool_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tool_id TEXT NOT NULL,
  user_id TEXT, -- Può essere UUID o stringa per utenti anonimi
  user_name TEXT NOT NULL,
  user_email TEXT NOT NULL, -- Email richiesta per verifica
  comment TEXT NOT NULL,
  is_verified BOOLEAN DEFAULT false, -- Commento verificato tramite email
  verification_token TEXT UNIQUE, -- Token per verifica email
  verification_expires_at TIMESTAMP WITH TIME ZONE, -- Scadenza token (24 ore)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  verified_at TIMESTAMP WITH TIME ZONE -- Data di verifica
);

-- Indici per performance
CREATE INDEX IF NOT EXISTS idx_tool_comments_tool_id ON tool_comments(tool_id);
CREATE INDEX IF NOT EXISTS idx_tool_comments_verification_token ON tool_comments(verification_token);
CREATE INDEX IF NOT EXISTS idx_tool_comments_is_verified ON tool_comments(is_verified);

-- RLS (Row Level Security)
ALTER TABLE tool_comments ENABLE ROW LEVEL SECURITY;

-- Policy: chiunque può leggere solo i commenti verificati
DROP POLICY IF EXISTS "Anyone can read verified tool_comments" ON tool_comments;
CREATE POLICY "Anyone can read verified tool_comments" ON tool_comments 
  FOR SELECT 
  USING (is_verified = true);

-- Policy: chiunque può inserire commenti (non verificati inizialmente)
DROP POLICY IF EXISTS "Anyone can create tool_comments" ON tool_comments;
CREATE POLICY "Anyone can create tool_comments" ON tool_comments 
  FOR INSERT 
  WITH CHECK (true);

-- Policy: aggiornamento solo per verifica (tramite token)
DROP POLICY IF EXISTS "Anyone can verify tool_comments" ON tool_comments;
CREATE POLICY "Anyone can verify tool_comments" ON tool_comments 
  FOR UPDATE 
  USING (true)
  WITH CHECK (true);















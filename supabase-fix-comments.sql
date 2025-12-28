-- Fix per commenti pubblici e supporto utenti anonimi
-- Esegui questo script in Supabase SQL Editor

-- 1. Modifica la colonna user_id per supportare TEXT (anonimi) o UUID (autenticati)
ALTER TABLE tool_comments 
  ALTER COLUMN user_id TYPE TEXT;

-- 2. Rimuovi la vecchia policy che richiede autenticazione
DROP POLICY IF EXISTS "Authenticated users can create tool_comments" ON tool_comments;

-- 3. Crea nuova policy che permette a chiunque di inserire commenti
CREATE POLICY "Anyone can create tool_comments" ON tool_comments 
  FOR INSERT 
  WITH CHECK (true);

-- 4. Assicurati che la policy di lettura esista
DROP POLICY IF EXISTS "Anyone can read tool_comments" ON tool_comments;
CREATE POLICY "Anyone can read tool_comments" ON tool_comments 
  FOR SELECT 
  USING (true);















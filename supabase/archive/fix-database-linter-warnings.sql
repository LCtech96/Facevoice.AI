-- Script SQL per risolvere tutti i warning del Database Linter di Supabase
-- Esegui questo script nella SQL Editor di Supabase
-- Questo script è sicuro da eseguire più volte (idempotente)

-- ============================================================================
-- PARTE 1: Fix Auth RLS Initialization Plan
-- Sostituisce auth.uid() e auth.role() con (select auth.uid()) e (select auth.role())
-- per evitare ri-valutazioni per ogni riga
-- ============================================================================

-- Fix per properties table (se esiste)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'properties') THEN
    
    DROP POLICY IF EXISTS "Hosts can insert properties" ON properties;
    CREATE POLICY "Hosts can insert properties"
      ON properties FOR INSERT
      WITH CHECK ((select auth.role()) = 'authenticated');
    
    DROP POLICY IF EXISTS "Users can insert own properties" ON properties;
    CREATE POLICY "Users can insert own properties"
      ON properties FOR INSERT
      WITH CHECK ((select auth.uid()) = owner_id);
    
    DROP POLICY IF EXISTS "Users can delete own properties" ON properties;
    CREATE POLICY "Users can delete own properties"
      ON properties FOR DELETE
      USING ((select auth.uid()) = owner_id);
    
    DROP POLICY IF EXISTS "Users can update own properties" ON properties;
    CREATE POLICY "Users can update own properties"
      ON properties FOR UPDATE
      USING ((select auth.uid()) = owner_id);
    
  END IF;
END $$;

-- Fix per posts table (se esiste)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'posts') THEN
    
    DROP POLICY IF EXISTS "Only creators can insert posts" ON posts;
    CREATE POLICY "Only creators can insert posts"
      ON posts FOR INSERT
      WITH CHECK ((select auth.uid()) = creator_id);
    
  END IF;
END $$;

-- Fix per collaborations table (se esiste)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'collaborations') THEN
    
    DROP POLICY IF EXISTS "Users can view their own collaborations" ON collaborations;
    CREATE POLICY "Users can view their own collaborations"
      ON collaborations FOR SELECT
      USING (
        (select auth.uid()) = creator_id 
        OR (select auth.uid()) = host_id
      );
    
    DROP POLICY IF EXISTS "Creators can request collaborations" ON collaborations;
    CREATE POLICY "Creators can request collaborations"
      ON collaborations FOR INSERT
      WITH CHECK ((select auth.uid()) = creator_id);
    
  END IF;
END $$;

-- Fix per messages table (se esiste)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'messages') THEN
    
    DROP POLICY IF EXISTS "Users can view their own messages" ON messages;
    CREATE POLICY "Users can view their own messages"
      ON messages FOR SELECT
      USING (
        (select auth.uid()) = sender_id 
        OR (select auth.uid()) = receiver_id
      );
    
    DROP POLICY IF EXISTS "Users can send messages" ON messages;
    CREATE POLICY "Users can send messages"
      ON messages FOR INSERT
      WITH CHECK ((select auth.uid()) = sender_id);
    
  END IF;
END $$;

-- Fix per profiles table (se esiste)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'profiles') THEN
    
    DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
    CREATE POLICY "Users can insert own profile"
      ON profiles FOR INSERT
      WITH CHECK ((select auth.uid()) = id);
    
    DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
    CREATE POLICY "Users can update own profile"
      ON profiles FOR UPDATE
      USING ((select auth.uid()) = id);
    
    DROP POLICY IF EXISTS "Users can delete own profile" ON profiles;
    CREATE POLICY "Users can delete own profile"
      ON profiles FOR DELETE
      USING ((select auth.uid()) = id);
    
  END IF;
END $$;

-- ============================================================================
-- PARTE 2: Fix Multiple Permissive Policies
-- Rimuove le policy duplicate e mantiene solo quelle necessarie
-- ============================================================================

-- Fix per shared_chat_messages table - Rimuovi policy duplicate
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'shared_chat_messages') THEN
    
    -- Rimuovi policy duplicate (mantieni solo "Anyone can...")
    DROP POLICY IF EXISTS "Allow authenticated users to insert messages into shared_chats" ON shared_chat_messages;
    DROP POLICY IF EXISTS "Allow public read access to shared_chat_messages" ON shared_chat_messages;
    
    -- Assicurati che le policy "Anyone can..." esistano
    DROP POLICY IF EXISTS "Anyone can read shared chat messages" ON shared_chat_messages;
    CREATE POLICY "Anyone can read shared chat messages"
      ON shared_chat_messages FOR SELECT
      USING (true);
    
    DROP POLICY IF EXISTS "Anyone can insert shared chat messages" ON shared_chat_messages;
    CREATE POLICY "Anyone can insert shared chat messages"
      ON shared_chat_messages FOR INSERT
      WITH CHECK (true);
    
  END IF;
END $$;

-- ============================================================================
-- PARTE 3: Fix Unindexed Foreign Keys
-- Aggiunge indici per tutte le foreign keys mancanti
-- ============================================================================

-- Indici per collaborations table
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'collaborations') THEN
    CREATE INDEX IF NOT EXISTS idx_collaborations_creator_id ON collaborations(creator_id);
    CREATE INDEX IF NOT EXISTS idx_collaborations_host_id ON collaborations(host_id);
    CREATE INDEX IF NOT EXISTS idx_collaborations_property_id ON collaborations(property_id);
  END IF;
END $$;

-- Indici per messages table
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'messages') THEN
    CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
    CREATE INDEX IF NOT EXISTS idx_messages_receiver_id ON messages(receiver_id);
  END IF;
END $$;

-- Indici per posts table
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'posts') THEN
    CREATE INDEX IF NOT EXISTS idx_posts_creator_id ON posts(creator_id);
    CREATE INDEX IF NOT EXISTS idx_posts_property_id ON posts(property_id);
  END IF;
END $$;

-- Indici per properties table
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'properties') THEN
    CREATE INDEX IF NOT EXISTS idx_properties_owner_id ON properties(owner_id);
  END IF;
END $$;

-- ============================================================================
-- PARTE 4: Rimuovi Unused Indexes (Opzionale)
-- ============================================================================

-- Rimuovi indici non utilizzati (solo se sei sicuro che non servano)
-- ATTENZIONE: Rimuovi solo se sei certo che non verranno usati in futuro

-- Per profiles.points (se esiste)
DROP INDEX IF EXISTS idx_profiles_points;

-- Per shared_chat_messages.chat_id (ATTENZIONE: questo potrebbe essere usato!)
-- Mantieni questo indice perché chat_id è probabilmente usato per JOIN
-- DROP INDEX IF EXISTS idx_shared_chat_messages_chat_id;

-- Per tool_comments.is_verified (ATTENZIONE: questo potrebbe essere usato!)
-- Mantieni questo indice perché is_verified è probabilmente usato per filtrare
-- DROP INDEX IF EXISTS idx_tool_comments_is_verified;

-- ============================================================================
-- VERIFICA FINALE
-- ============================================================================

-- Verifica che le policy siano state aggiornate correttamente
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename IN ('properties', 'posts', 'collaborations', 'messages', 'profiles', 'shared_chat_messages')
ORDER BY tablename, policyname;

-- Verifica che gli indici siano stati creati
SELECT 
  tablename,
  indexname
FROM pg_indexes
WHERE tablename IN ('collaborations', 'messages', 'posts', 'properties')
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;

-- Messaggio di completamento
DO $$
BEGIN
  RAISE NOTICE 'Script completato! Verifica i risultati sopra.';
END $$;

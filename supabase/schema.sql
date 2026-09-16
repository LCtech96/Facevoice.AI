-- =====================================================================
-- Facevoice.AI — Schema Supabase (fonte di verita')
-- =====================================================================
-- Questo file rispecchia lo stato reale del database di produzione.
-- E' idempotente: puo' essere rieseguito senza rompere nulla.
--
-- Prima di questo file il repository conteneva ~20 script .sql che
-- definivano le stesse tabelle in modo incoerente. Ora sono in
-- supabase/archive/ solo come storico: NON eseguirli.
--
-- Quando cambi lo schema del database, aggiorna QUESTO file.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. ESTENSIONI
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "unaccent";


-- ---------------------------------------------------------------------
-- 2. FUNZIONI CONDIVISE
-- ---------------------------------------------------------------------
-- Aggiorna updated_at a ogni UPDATE. Usata da piu' tabelle.
-- search_path fissato per evitare il warning "role mutable search_path".
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc', NOW());
  RETURN NEW;
END;
$$;

-- Genera uno slug SEO-friendly da un titolo.
CREATE OR REPLACE FUNCTION public.generate_slug_from_title(title_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $$
BEGIN
  RETURN lower(
    regexp_replace(
      regexp_replace(unaccent(title_text), '[^a-zA-Z0-9]+', '-', 'g'),
      '^-+|-+$', '', 'g'
    )
  );
END;
$$;


-- ---------------------------------------------------------------------
-- 3. TEAM
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_members (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL,
  description TEXT,
  email       TEXT,
  linkedin    TEXT,
  image_url   TEXT,
  image_path  TEXT,                                   -- path nello Storage
  created_at  TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_members_select_public" ON public.team_members;
CREATE POLICY "team_members_select_public"
  ON public.team_members FOR SELECT USING (true);

-- Le modifiche passano dalle API route con SERVICE_ROLE_KEY, che bypassa RLS.

DROP TRIGGER IF EXISTS update_team_members_updated_at ON public.team_members;
CREATE TRIGGER update_team_members_updated_at
  BEFORE UPDATE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ---------------------------------------------------------------------
-- 4. BLOG
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.blog_posts (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title      TEXT NOT NULL,
  slug       TEXT,
  content    TEXT NOT NULL,
  image_url  TEXT,
  author     TEXT NOT NULL DEFAULT 'Facevoice.ai',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN public.blog_posts.slug IS 'Slug SEO-friendly generato dal titolo per URL leggibili';

CREATE INDEX IF NOT EXISTS idx_blog_posts_created_at ON public.blog_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_posts_slug       ON public.blog_posts(slug);

ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "blog_posts_select_public" ON public.blog_posts;
CREATE POLICY "blog_posts_select_public"
  ON public.blog_posts FOR SELECT USING (true);

-- La scrittura passa dalle API route con SERVICE_ROLE_KEY.


-- ---------------------------------------------------------------------
-- 5. PRENOTAZIONI
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bookings (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  whatsapp   TEXT NOT NULL,
  service    TEXT NOT NULL,
  datetime   TIMESTAMPTZ,
  address    JSONB,
  status     TEXT DEFAULT 'pending'
             CHECK (status IN ('pending', 'contacted', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_email      ON public.bookings(email);
CREATE INDEX IF NOT EXISTS idx_bookings_status     ON public.bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON public.bookings(created_at DESC);

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bookings_insert_public" ON public.bookings;
CREATE POLICY "bookings_insert_public"
  ON public.bookings FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "bookings_select_admin" ON public.bookings;
CREATE POLICY "bookings_select_admin"
  ON public.bookings FOR SELECT
  USING (LOWER(auth.jwt() ->> 'email') = 'luca@facevoice.ai');

DROP POLICY IF EXISTS "bookings_update_admin" ON public.bookings;
CREATE POLICY "bookings_update_admin"
  ON public.bookings FOR UPDATE
  USING (LOWER(auth.jwt() ->> 'email') = 'luca@facevoice.ai');

DROP POLICY IF EXISTS "bookings_delete_admin" ON public.bookings;
CREATE POLICY "bookings_delete_admin"
  ON public.bookings FOR DELETE
  USING (LOWER(auth.jwt() ->> 'email') = 'luca@facevoice.ai');

DROP TRIGGER IF EXISTS update_bookings_updated_at ON public.bookings;
CREATE TRIGGER update_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ---------------------------------------------------------------------
-- 6. AI TOOLS (feed, like, commenti, condivisioni)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_tools (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  cover_image TEXT,
  category    TEXT NOT NULL,
  likes       INTEGER DEFAULT 0,        -- contatore denormalizzato
  comments    INTEGER DEFAULT 0,        -- contatore denormalizzato
  shares      INTEGER DEFAULT 0,        -- contatore denormalizzato
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tool_likes (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tool_id    TEXT NOT NULL REFERENCES public.ai_tools(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tool_id, user_id)
);

-- NB: tool_comments.tool_id NON ha foreign key verso ai_tools (la tabella e'
-- stata creata prima di ai_tools). user_id e' TEXT per ammettere commenti
-- anonimi, a differenza di tool_likes.user_id che e' UUID.
CREATE TABLE IF NOT EXISTS public.tool_comments (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tool_id                 TEXT NOT NULL,
  user_id                 TEXT,
  user_name               TEXT NOT NULL,
  user_email              TEXT NOT NULL,
  comment                 TEXT NOT NULL,
  is_verified             BOOLEAN DEFAULT false,
  verification_token      TEXT UNIQUE,
  verification_expires_at TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  verified_at             TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.tool_shares (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tool_id    TEXT NOT NULL REFERENCES public.ai_tools(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tool_likes_tool_id    ON public.tool_likes(tool_id);
CREATE INDEX IF NOT EXISTS idx_tool_likes_user_id    ON public.tool_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_tool_shares_tool_id   ON public.tool_shares(tool_id);
CREATE INDEX IF NOT EXISTS idx_tool_comments_tool_id ON public.tool_comments(tool_id);
CREATE INDEX IF NOT EXISTS idx_tool_comments_token   ON public.tool_comments(verification_token);
CREATE INDEX IF NOT EXISTS idx_tool_comments_verified ON public.tool_comments(is_verified);

ALTER TABLE public.ai_tools      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_likes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_shares   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_tools_select_public" ON public.ai_tools;
CREATE POLICY "ai_tools_select_public"
  ON public.ai_tools FOR SELECT USING (true);

DROP POLICY IF EXISTS "tool_likes_select_public" ON public.tool_likes;
CREATE POLICY "tool_likes_select_public"
  ON public.tool_likes FOR SELECT USING (true);

DROP POLICY IF EXISTS "tool_likes_insert_own" ON public.tool_likes;
CREATE POLICY "tool_likes_insert_own"
  ON public.tool_likes FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "tool_likes_delete_own" ON public.tool_likes;
CREATE POLICY "tool_likes_delete_own"
  ON public.tool_likes FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Solo i commenti verificati via email sono pubblici.
DROP POLICY IF EXISTS "tool_comments_select_verified" ON public.tool_comments;
CREATE POLICY "tool_comments_select_verified"
  ON public.tool_comments FOR SELECT USING (is_verified = true);

DROP POLICY IF EXISTS "tool_comments_insert_public" ON public.tool_comments;
CREATE POLICY "tool_comments_insert_public"
  ON public.tool_comments FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "tool_comments_update_verify" ON public.tool_comments;
CREATE POLICY "tool_comments_update_verify"
  ON public.tool_comments FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "tool_shares_select_public" ON public.tool_shares;
CREATE POLICY "tool_shares_select_public"
  ON public.tool_shares FOR SELECT USING (true);

DROP POLICY IF EXISTS "tool_shares_insert_public" ON public.tool_shares;
CREATE POLICY "tool_shares_insert_public"
  ON public.tool_shares FOR INSERT WITH CHECK (true);


-- ---------------------------------------------------------------------
-- 7. COMMENTI CASE STUDY
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.case_study_comments (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  case_study_id TEXT NOT NULL,
  user_name     TEXT NOT NULL,
  user_email    TEXT NOT NULL,
  comment       TEXT NOT NULL,
  is_approved   BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_study_comments_case_id  ON public.case_study_comments(case_study_id);
CREATE INDEX IF NOT EXISTS idx_case_study_comments_approved ON public.case_study_comments(is_approved);

ALTER TABLE public.case_study_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "case_study_comments_select_approved" ON public.case_study_comments;
CREATE POLICY "case_study_comments_select_approved"
  ON public.case_study_comments FOR SELECT USING (is_approved = true);

DROP POLICY IF EXISTS "case_study_comments_insert_public" ON public.case_study_comments;
CREATE POLICY "case_study_comments_insert_public"
  ON public.case_study_comments FOR INSERT WITH CHECK (true);


-- ---------------------------------------------------------------------
-- 8. CHAT CONDIVISE (realtime)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shared_chats (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT NOT NULL DEFAULT 'Shared Chat',
  model      TEXT DEFAULT 'llama-3.1-8b-instant',
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.shared_chat_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id    UUID NOT NULL REFERENCES public.shared_chats(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content    TEXT NOT NULL,
  user_id    TEXT,
  user_name  TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shared_chat_messages_chat_id    ON public.shared_chat_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_shared_chat_messages_created_at ON public.shared_chat_messages(chat_id, created_at);

-- Propaga updated_at sulla chat a ogni nuovo messaggio.
CREATE OR REPLACE FUNCTION public.update_shared_chat_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.shared_chats SET updated_at = NOW() WHERE id = NEW.chat_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_shared_chat_timestamp ON public.shared_chat_messages;
CREATE TRIGGER update_shared_chat_timestamp
  AFTER INSERT ON public.shared_chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_shared_chat_updated_at();

ALTER TABLE public.shared_chats         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_chat_messages ENABLE ROW LEVEL SECURITY;

-- Le chat condivise sono pubbliche per definizione: chi ha il link partecipa.
DROP POLICY IF EXISTS "shared_chats_select_public" ON public.shared_chats;
CREATE POLICY "shared_chats_select_public"
  ON public.shared_chats FOR SELECT USING (true);

DROP POLICY IF EXISTS "shared_chats_insert_public" ON public.shared_chats;
CREATE POLICY "shared_chats_insert_public"
  ON public.shared_chats FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "shared_chats_update_public" ON public.shared_chats;
CREATE POLICY "shared_chats_update_public"
  ON public.shared_chats FOR UPDATE USING (true);

DROP POLICY IF EXISTS "shared_chat_messages_select_public" ON public.shared_chat_messages;
CREATE POLICY "shared_chat_messages_select_public"
  ON public.shared_chat_messages FOR SELECT USING (true);

DROP POLICY IF EXISTS "shared_chat_messages_insert_public" ON public.shared_chat_messages;
CREATE POLICY "shared_chat_messages_insert_public"
  ON public.shared_chat_messages FOR INSERT WITH CHECK (true);

-- Realtime (ignora l'errore se le tabelle sono gia' nella publication).
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.shared_chats;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.shared_chat_messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ---------------------------------------------------------------------
-- 9. CONOSCENZA AI
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_knowledge (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  is_active  BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.ai_knowledge ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_knowledge_select_active" ON public.ai_knowledge;
CREATE POLICY "ai_knowledge_select_active"
  ON public.ai_knowledge FOR SELECT USING (is_active = true);

DROP TRIGGER IF EXISTS update_ai_knowledge_updated_at ON public.ai_knowledge;
CREATE TRIGGER update_ai_knowledge_updated_at
  BEFORE UPDATE ON public.ai_knowledge
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ---------------------------------------------------------------------
-- 10. PAGAMENTI COLLABORATORI
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_name  TEXT,
  collaborator_email TEXT NOT NULL,
  client_name        TEXT,
  sale_reference     TEXT,
  amount             NUMERIC(10,2) NOT NULL,
  currency           TEXT DEFAULT 'EUR' NOT NULL,
  note               TEXT,
  entry_date         DATE NOT NULL,
  entry_time         TIME NOT NULL,
  due_date           DATE NOT NULL,
  created_by         TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at         TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.payment_shares (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id        UUID REFERENCES public.payments(id) ON DELETE CASCADE,
  shared_with_email TEXT NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (payment_id, shared_with_email)
);

ALTER TABLE public.payments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_shares ENABLE ROW LEVEL SECURITY;

-- Un collaboratore vede solo i propri pagamenti, o quelli condivisi con lui.
DROP POLICY IF EXISTS "payments_select_own" ON public.payments;
CREATE POLICY "payments_select_own"
  ON public.payments FOR SELECT
  USING (collaborator_email = LOWER(auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS "payments_select_shared" ON public.payments;
CREATE POLICY "payments_select_shared"
  ON public.payments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.payment_shares
    WHERE payment_shares.payment_id = payments.id
      AND payment_shares.shared_with_email = LOWER(auth.jwt() ->> 'email')
  ));

DROP POLICY IF EXISTS "payments_write_authenticated" ON public.payments;
CREATE POLICY "payments_write_authenticated"
  ON public.payments FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "payment_shares_select_own" ON public.payment_shares;
CREATE POLICY "payment_shares_select_own"
  ON public.payment_shares FOR SELECT
  USING (shared_with_email = LOWER(auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS "payment_shares_write_authenticated" ON public.payment_shares;
CREATE POLICY "payment_shares_write_authenticated"
  ON public.payment_shares FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS update_payments_updated_at ON public.payments;
CREATE TRIGGER update_payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ---------------------------------------------------------------------
-- 11. STORAGE
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('team-photos', 'team-photos', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'blog-images', 'blog-images', true,
  5242880,                                            -- 5 MB
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "storage_team_photos_read" ON storage.objects;
CREATE POLICY "storage_team_photos_read"
  ON storage.objects FOR SELECT USING (bucket_id = 'team-photos');

DROP POLICY IF EXISTS "storage_team_photos_upload" ON storage.objects;
CREATE POLICY "storage_team_photos_upload"
  ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'team-photos');

DROP POLICY IF EXISTS "storage_blog_images_read" ON storage.objects;
CREATE POLICY "storage_blog_images_read"
  ON storage.objects FOR SELECT USING (bucket_id = 'blog-images');

-- L'upload delle immagini del blog passa dall'API route con SERVICE_ROLE_KEY.


-- =====================================================================
-- NOTE
-- =====================================================================
-- Gli utenti registrati stanno in auth.users (schema Supabase Auth), non
-- in public: non esiste una tabella 'profiles'.
--
-- Tabelle rimosse a settembre 2026 perche' residui di un progetto
-- precedente, tutte vuote e senza riferimenti nel codice:
--   properties, posts, collaborations, messages, profiles,
--   entertainment_posts
-- Vedi supabase/archive/CLEANUP_UNUSED_TABLES.sql.

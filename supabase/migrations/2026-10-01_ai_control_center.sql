-- =====================================================================
-- Centro di controllo AI: memoria con categorie, canali social, post
-- programmati
-- =====================================================================
-- Additiva, non tocca nulla di esistente. Idempotente.
--
-- Nota sui canali: qui c'e' solo lo stato di avanzamento (non connesso /
-- in corso / connesso) e delle note libere, NON credenziali. Finche'
-- non esiste un'app approvata da Meta (o da altre piattaforme), non ha
-- senso avere una colonna per un token che non esiste ancora — quando
-- l'integrazione vera partira', si aggiungera' con una ALTER TABLE a
-- parte, pensata per quella fase (che non e' "salvare il token in
-- chiaro in questa tabella").
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Categorie per la memoria AI
-- ---------------------------------------------------------------------
ALTER TABLE public.ai_knowledge
  ADD COLUMN IF NOT EXISTS category TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_category ON public.ai_knowledge(category);

-- ---------------------------------------------------------------------
-- 2. Canali social — solo stato e promemoria, non integrazione vera
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.social_channels (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform     TEXT NOT NULL UNIQUE
               CHECK (platform IN ('whatsapp', 'instagram', 'facebook', 'tiktok', 'linkedin', 'x')),
  display_name TEXT,
  handle       TEXT,
  status       TEXT NOT NULL DEFAULT 'not_connected'
               CHECK (status IN ('not_connected', 'in_progress', 'connected', 'error')),
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

DROP TRIGGER IF EXISTS update_social_channels_updated_at ON public.social_channels;
CREATE TRIGGER update_social_channels_updated_at
  BEFORE UPDATE ON public.social_channels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- 3. Post programmati
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.scheduled_posts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Riferimento logico a social_channels.platform, non FK: un post si
  -- puo' programmare per una piattaforma anche prima che la riga
  -- social_channels esista (es. "voglio preparare i contenuti ora, li
  -- collego quando il canale sara' approvato").
  platforms      TEXT[] NOT NULL DEFAULT '{}',
  caption        TEXT NOT NULL DEFAULT '',
  media_urls     TEXT[] NOT NULL DEFAULT '{}',
  scheduled_at   TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'scheduled', 'published', 'failed', 'canceled')),
  published_at   TIMESTAMPTZ,
  error_message  TEXT,
  created_by     TEXT NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status       ON public.scheduled_posts(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_scheduled_at ON public.scheduled_posts(scheduled_at);

DROP TRIGGER IF EXISTS update_scheduled_posts_updated_at ON public.scheduled_posts;
CREATE TRIGGER update_scheduled_posts_updated_at
  BEFORE UPDATE ON public.scheduled_posts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- 4. RLS — difesa in profondita'. L'accesso vero passa dalle API route
--    con SERVICE_ROLE_KEY, che gia' verificano isAdminEmail() lato
--    server; queste policy proteggono solo un eventuale accesso diretto
--    via PostgREST.
-- ---------------------------------------------------------------------
ALTER TABLE public.social_channels  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_posts  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "social_channels_admin_only" ON public.social_channels;
CREATE POLICY "social_channels_admin_only"
  ON public.social_channels FOR ALL
  USING (LOWER(auth.jwt() ->> 'email') IN ('luca@facevoice.ai', 'lucacorrao1996@gmail.com'))
  WITH CHECK (LOWER(auth.jwt() ->> 'email') IN ('luca@facevoice.ai', 'lucacorrao1996@gmail.com'));

DROP POLICY IF EXISTS "scheduled_posts_admin_only" ON public.scheduled_posts;
CREATE POLICY "scheduled_posts_admin_only"
  ON public.scheduled_posts FOR ALL
  USING (LOWER(auth.jwt() ->> 'email') IN ('luca@facevoice.ai', 'lucacorrao1996@gmail.com'))
  WITH CHECK (LOWER(auth.jwt() ->> 'email') IN ('luca@facevoice.ai', 'lucacorrao1996@gmail.com'));

-- ---------------------------------------------------------------------
-- 5. Una riga per piattaforma, per far comparire subito tutte le card
--    nella UI con stato "non connesso" invece di partire da una
--    schermata vuota.
-- ---------------------------------------------------------------------
INSERT INTO public.social_channels (platform) VALUES
  ('whatsapp'), ('instagram'), ('facebook'), ('tiktok'), ('linkedin'), ('x')
ON CONFLICT (platform) DO NOTHING;

COMMIT;

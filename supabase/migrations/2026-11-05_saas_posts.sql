-- =====================================================================
-- SaaS: post dei clienti (creati dall'Assistente AI o caricati a mano)
-- =====================================================================
-- - scheduled_posts: post in bozza, programmati o pubblicati su Instagram e
--   Facebook, con le immagini (indirizzi pubblici) e l'esito per ogni social.
-- - bucket workspace-media: foto caricate dai clienti e immagini dei post
--   (cartella = id dello spazio di lavoro).
-- Idempotente. Da eseguire DOPO 2026-11-03_saas_inbox.sql.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.scheduled_posts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- draft (da controllare) | scheduled (programmato) | publishing | published | failed | cancelled
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled')),
  -- photos: le foto del cliente cosi' come sono | carousel: slide grafiche con testo
  kind          TEXT NOT NULL DEFAULT 'photos' CHECK (kind IN ('photos', 'carousel')),
  title         TEXT,
  caption       TEXT NOT NULL DEFAULT '' CHECK (length(caption) <= 2200),
  facebook_text TEXT CHECK (length(facebook_text) <= 5000),
  media         JSONB NOT NULL DEFAULT '[]',          -- indirizzi pubblici delle immagini, in ordine
  platforms     TEXT[] NOT NULL DEFAULT ARRAY['instagram'],
  publish_at    TIMESTAMPTZ,
  results       JSONB NOT NULL DEFAULT '{}',          -- { instagram: id, facebook: id, errors: [...] }
  error_message TEXT,
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_due ON public.scheduled_posts (publish_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_workspace ON public.scheduled_posts (workspace_id, created_at DESC);

ALTER TABLE public.scheduled_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scheduled_posts_members" ON public.scheduled_posts;
CREATE POLICY "scheduled_posts_members" ON public.scheduled_posts
  FOR SELECT USING (public.is_workspace_member(workspace_id));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('workspace-media', 'workspace-media', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "storage_workspace_media_read" ON storage.objects;
CREATE POLICY "storage_workspace_media_read"
  ON storage.objects FOR SELECT USING (bucket_id = 'workspace-media');

COMMIT;

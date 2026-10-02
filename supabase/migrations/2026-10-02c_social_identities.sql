-- Stessa persona su piu' canali (es. Instagram + Messenger): Meta non espone
-- alcun legame tra gli id dei due canali, quindi il collegamento lo decide
-- l'admin (con suggerimenti per nome). Idempotente.

BEGIN;

CREATE TABLE IF NOT EXISTS public.social_identities (
  platform   TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  person_id  UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (platform, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_social_identities_person ON public.social_identities (person_id);

ALTER TABLE public.social_identities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "social_identities_admin_only" ON public.social_identities;
CREATE POLICY "social_identities_admin_only" ON public.social_identities
  FOR ALL
  USING (LOWER(auth.jwt() ->> 'email') IN ('luca@facevoice.ai', 'lucacorrao1996@gmail.com'))
  WITH CHECK (LOWER(auth.jwt() ->> 'email') IN ('luca@facevoice.ai', 'lucacorrao1996@gmail.com'));

COMMIT;

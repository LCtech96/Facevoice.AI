-- Messaggi ricevuti e inviati sui canali social (per ora WhatsApp).
-- Servono come storico della conversazione per l'agente AI e come
-- registro consultabile dall'admin. Idempotente.

BEGIN;

CREATE TABLE IF NOT EXISTS public.social_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL CHECK (platform IN ('whatsapp', 'instagram', 'facebook', 'tiktok', 'linkedin', 'x')),
  contact_id TEXT NOT NULL,
  contact_name TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  -- ID del messaggio lato piattaforma: Meta ritenta i webhook, e l'unicita'
  -- impedisce di rispondere due volte allo stesso messaggio.
  external_id TEXT UNIQUE,
  body TEXT NOT NULL DEFAULT '',
  status TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_messages_contact
  ON public.social_messages (platform, contact_id, created_at DESC);

ALTER TABLE public.social_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "social_messages_admin_only" ON public.social_messages;
CREATE POLICY "social_messages_admin_only" ON public.social_messages
  FOR ALL
  USING (LOWER(auth.jwt() ->> 'email') IN ('luca@facevoice.ai', 'lucacorrao1996@gmail.com'))
  WITH CHECK (LOWER(auth.jwt() ->> 'email') IN ('luca@facevoice.ai', 'lucacorrao1996@gmail.com'));

COMMIT;

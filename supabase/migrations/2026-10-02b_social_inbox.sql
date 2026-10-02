-- Casella unificata dei messaggi social: approvazione delle risposte AI,
-- notifiche push. Idempotente.

BEGIN;

-- 'approval' = l'AI prepara una bozza che l'admin approva; 'auto' = invio diretto.
ALTER TABLE public.social_channels
  ADD COLUMN IF NOT EXISTS reply_mode TEXT NOT NULL DEFAULT 'approval';
ALTER TABLE public.social_channels DROP CONSTRAINT IF EXISTS social_channels_reply_mode_check;
ALTER TABLE public.social_channels
  ADD CONSTRAINT social_channels_reply_mode_check CHECK (reply_mode IN ('auto', 'approval'));

-- kind: messaggio privato o commento pubblico.
-- channel_account_id: numero WhatsApp (phone_number_id) o Pagina che ha ricevuto.
-- reply_to: id del commento a cui rispondere (solo per kind = 'comment').
-- status sui messaggi in uscita: pending | sent | failed | rejected.
ALTER TABLE public.social_messages ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'message';
ALTER TABLE public.social_messages ADD COLUMN IF NOT EXISTS channel_account_id TEXT;
ALTER TABLE public.social_messages ADD COLUMN IF NOT EXISTS reply_to TEXT;
ALTER TABLE public.social_messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_social_messages_pending
  ON public.social_messages (status) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "push_subscriptions_admin_only" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_admin_only" ON public.push_subscriptions
  FOR ALL
  USING (LOWER(auth.jwt() ->> 'email') IN ('luca@facevoice.ai', 'lucacorrao1996@gmail.com'))
  WITH CHECK (LOWER(auth.jwt() ->> 'email') IN ('luca@facevoice.ai', 'lucacorrao1996@gmail.com'));

-- Impostazioni interne lette solo dal server (service role). Nessuna policy:
-- con RLS attivo nessun client puo' leggerle. Contiene le chiavi VAPID del push.
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

COMMIT;

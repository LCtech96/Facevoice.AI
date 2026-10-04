-- Chat del sito pubblico come canale 'web' della casella Messaggi. Idempotente.
BEGIN;
ALTER TABLE public.social_messages DROP CONSTRAINT IF EXISTS social_messages_platform_check;
ALTER TABLE public.social_messages
  ADD CONSTRAINT social_messages_platform_check
  CHECK (platform IN ('whatsapp', 'instagram', 'facebook', 'email', 'web', 'tiktok', 'linkedin', 'x'));
COMMIT;

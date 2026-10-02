-- Canale email (casella Google Workspace collegata via OAuth) nella casella
-- unificata. Il token OAuth sta in app_settings, mai in social_channels.
-- Idempotente.

BEGIN;

ALTER TABLE public.social_channels DROP CONSTRAINT IF EXISTS social_channels_platform_check;
ALTER TABLE public.social_channels
  ADD CONSTRAINT social_channels_platform_check
  CHECK (platform IN ('whatsapp', 'instagram', 'facebook', 'email', 'tiktok', 'linkedin', 'x'));

ALTER TABLE public.social_messages DROP CONSTRAINT IF EXISTS social_messages_platform_check;
ALTER TABLE public.social_messages
  ADD CONSTRAINT social_messages_platform_check
  CHECK (platform IN ('whatsapp', 'instagram', 'facebook', 'email', 'tiktok', 'linkedin', 'x'));

COMMIT;

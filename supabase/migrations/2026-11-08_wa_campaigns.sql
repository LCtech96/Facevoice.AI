-- Campagne WhatsApp: contattabili con il loro consenso, campagne e destinatari.
-- Impostazioni, prezzi e modelli stanno in app_settings (chiavi wa_*).
-- Solo il server (service role) legge e scrive: RLS attiva e nessuna policy pubblica.
-- Solo aggiunte, rieseguibile senza rompere nulla.

CREATE TABLE IF NOT EXISTS public.wa_contacts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone                 TEXT NOT NULL UNIQUE,              -- formato internazionale, es. +393331234567
  name                  TEXT,
  company               TEXT,
  sector                TEXT,
  tags                  TEXT[] NOT NULL DEFAULT '{}',
  consent_source        TEXT NOT NULL CHECK (consent_source IN ('ha_scritto', 'modulo_sito', 'manuale', 'import', 'risposta_si')),
  consent_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  consent_note          TEXT,
  consent_requested_at  TIMESTAMPTZ,
  consent_declined_at   TIMESTAMPTZ,
  status                TEXT NOT NULL DEFAULT 'attivo' CHECK (status IN ('attivo', 'disiscritto')),
  unsubscribed_at       TIMESTAMPTZ,
  last_inbound_at       TIMESTAMPTZ,
  lead_id               UUID,
  consent_log           JSONB NOT NULL DEFAULT '[]'::jsonb,  -- storico: chi, quando, come
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.wa_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wa_contacts FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS idx_wa_contacts_status ON public.wa_contacts(status);

CREATE TABLE IF NOT EXISTS public.wa_campaigns (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  template_name      TEXT NOT NULL,
  template_language  TEXT NOT NULL,
  template_category  TEXT NOT NULL,
  template_snapshot  JSONB NOT NULL,
  variables          JSONB NOT NULL DEFAULT '{}'::jsonb,
  audience           JSONB NOT NULL DEFAULT '{}'::jsonb,
  status             TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sending', 'paused', 'completed', 'cancelled')),
  paused_reason      TEXT,
  scheduled_at       TIMESTAMPTZ NOT NULL,
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  created_by         TEXT,
  total              INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.wa_campaigns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wa_campaigns FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS idx_wa_campaigns_status ON public.wa_campaigns(status, scheduled_at);

CREATE TABLE IF NOT EXISTS public.wa_campaign_recipients (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       UUID NOT NULL REFERENCES public.wa_campaigns(id) ON DELETE CASCADE,
  contact_id        UUID REFERENCES public.wa_contacts(id) ON DELETE SET NULL,
  phone             TEXT NOT NULL,
  name              TEXT,
  status            TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped')),
  claim             TEXT,
  claimed_at        TIMESTAMPTZ,
  wamid             TEXT UNIQUE,
  sent_at           TIMESTAMPTZ,
  delivered_at      TIMESTAMPTZ,
  read_at           TIMESTAMPTZ,
  failed_at         TIMESTAMPTZ,
  error_code        TEXT,
  error_message     TEXT,
  skip_reason       TEXT,
  replied_at        TIMESTAMPTZ,
  billable          BOOLEAN,
  pricing_category  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, phone)
);
ALTER TABLE public.wa_campaign_recipients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wa_campaign_recipients FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS idx_wa_recipients_campaign ON public.wa_campaign_recipients(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_wa_recipients_sent ON public.wa_campaign_recipients(sent_at) WHERE sent_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wa_recipients_phone ON public.wa_campaign_recipients(phone, sent_at);

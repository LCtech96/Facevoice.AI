-- Ricerca clienti: attivita' trovate su Google Maps, analisi AI del sito,
-- bozze di primo contatto e stato commerciale. Idempotente.

BEGIN;

CREATE TABLE IF NOT EXISTS public.leads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id        TEXT UNIQUE,
  search_query    TEXT,
  name            TEXT NOT NULL,
  address         TEXT,
  phone           TEXT,
  website         TEXT,
  email           TEXT,
  instagram       TEXT,
  facebook        TEXT,
  rating          NUMERIC,
  reviews_count   INTEGER,
  maps_url        TEXT,
  -- Analisi AI: punteggio di priorita' 1-10 e punti deboli trovati.
  score           INTEGER,
  analysis        TEXT,
  email_subject   TEXT,
  email_body      TEXT,
  dm_text         TEXT,
  -- new | contacted | replied | client | discarded | do_not_contact
  status          TEXT NOT NULL DEFAULT 'new',
  notes           TEXT,
  analyzed_at     TIMESTAMPTZ,
  contacted_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON public.leads (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_email ON public.leads (LOWER(email));

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leads_admin_only" ON public.leads;
CREATE POLICY "leads_admin_only" ON public.leads
  FOR ALL
  USING (LOWER(auth.jwt() ->> 'email') IN ('luca@facevoice.ai', 'lucacorrao1996@gmail.com'))
  WITH CHECK (LOWER(auth.jwt() ->> 'email') IN ('luca@facevoice.ai', 'lucacorrao1996@gmail.com'));

COMMIT;

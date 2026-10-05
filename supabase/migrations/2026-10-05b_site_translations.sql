-- Cache delle traduzioni automatiche del sito pubblico: ogni frase si traduce
-- una volta sola per lingua, poi arriva da qui.
CREATE TABLE IF NOT EXISTS public.site_translations (
  lang        TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  source      TEXT NOT NULL,
  translated  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lang, source_hash)
);
-- Solo il server (service role) legge e scrive.
ALTER TABLE public.site_translations ENABLE ROW LEVEL SECURITY;

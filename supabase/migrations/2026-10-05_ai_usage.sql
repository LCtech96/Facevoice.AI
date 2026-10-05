-- Consumo delle AI automatiche (chat del sito, risposte email/social, Ricerca clienti).
-- Una riga per chiamata: Gemini (gratuito) o Claude (a pagamento, quando Gemini e' al limite).
CREATE TABLE IF NOT EXISTS public.ai_usage (
  id            BIGSERIAL PRIMARY KEY,
  feature       TEXT NOT NULL,
  provider      TEXT NOT NULL CHECK (provider IN ('gemini', 'claude')),
  model         TEXT NOT NULL,
  outcome       TEXT NOT NULL DEFAULT 'ok' CHECK (outcome IN ('ok', 'limit', 'error')),
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd      NUMERIC(12, 6) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON public.ai_usage(created_at DESC);
-- Solo il server (service role) legge e scrive.
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

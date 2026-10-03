-- Provenienza delle risposte inviate: le risposte approvate, corrette o scritte
-- a mano da Luca diventano esempi di stile per l'agente. Idempotente.
-- Valori: ai_auto | ai_approved | ai_edited | manual
ALTER TABLE public.social_messages ADD COLUMN IF NOT EXISTS origin TEXT;

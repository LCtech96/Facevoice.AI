-- Schema: Conoscenza AI + Pagamenti Collaboratori
-- Esegui questo script nel Supabase SQL Editor

-- Estensione per UUID (se non già presente)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Tabella per Conoscenza AI
CREATE TABLE IF NOT EXISTS ai_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Tabella per Pagamenti Collaboratori
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_name TEXT,
  collaborator_email TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT DEFAULT 'EUR' NOT NULL,
  note TEXT,
  entry_date DATE NOT NULL,
  entry_time TIME NOT NULL,
  due_date DATE NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Tabella per Condivisione Pagamenti
CREATE TABLE IF NOT EXISTS payment_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID REFERENCES payments(id) ON DELETE CASCADE,
  shared_with_email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (payment_id, shared_with_email)
);

-- Trigger per aggiornare updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc', NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_ai_knowledge_updated_at ON ai_knowledge;
CREATE TRIGGER update_ai_knowledge_updated_at BEFORE UPDATE ON ai_knowledge
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_payments_updated_at ON payments;
CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

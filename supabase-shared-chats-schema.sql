-- Schema per chat condivise in tempo reale

-- Tabella per le chat condivise
CREATE TABLE IF NOT EXISTS shared_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL DEFAULT 'Shared Chat',
  model TEXT DEFAULT 'llama-3.1-8b-instant',
  created_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabella per i messaggi delle chat condivise
CREATE TABLE IF NOT EXISTS shared_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES shared_chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  user_id TEXT,
  user_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_role CHECK (role IN ('user', 'assistant', 'system'))
);

-- Abilita Realtime per le tabelle
ALTER PUBLICATION supabase_realtime ADD TABLE shared_chats;
ALTER PUBLICATION supabase_realtime ADD TABLE shared_chat_messages;

-- Indici per performance
CREATE INDEX IF NOT EXISTS idx_shared_chat_messages_chat_id ON shared_chat_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_shared_chat_messages_created_at ON shared_chat_messages(chat_id, created_at);

-- Funzione per aggiornare updated_at
CREATE OR REPLACE FUNCTION update_shared_chat_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE shared_chats
  SET updated_at = NOW()
  WHERE id = NEW.chat_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger per aggiornare updated_at quando viene aggiunto un messaggio
CREATE TRIGGER update_shared_chat_timestamp
AFTER INSERT ON shared_chat_messages
FOR EACH ROW
EXECUTE FUNCTION update_shared_chat_updated_at();

-- RLS (Row Level Security) - Permetti lettura e scrittura pubblica per le chat condivise
ALTER TABLE shared_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_chat_messages ENABLE ROW LEVEL SECURITY;

-- Policy per shared_chats: tutti possono leggere e scrivere
CREATE POLICY "Anyone can read shared chats"
  ON shared_chats FOR SELECT
  USING (true);

CREATE POLICY "Anyone can create shared chats"
  ON shared_chats FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update shared chats"
  ON shared_chats FOR UPDATE
  USING (true);

-- Policy per shared_chat_messages: tutti possono leggere e scrivere
CREATE POLICY "Anyone can read shared chat messages"
  ON shared_chat_messages FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert shared chat messages"
  ON shared_chat_messages FOR INSERT
  WITH CHECK (true);











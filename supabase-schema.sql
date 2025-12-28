-- Schema per AI Tools Feed
-- Esegui questo script in Supabase SQL Editor

-- Tabella principale per gli AI Tools
CREATE TABLE IF NOT EXISTS ai_tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  cover_image TEXT,
  category TEXT NOT NULL,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabella per i like
CREATE TABLE IF NOT EXISTS tool_likes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tool_id TEXT NOT NULL REFERENCES ai_tools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(tool_id, user_id)
);

-- Tabella per i commenti
CREATE TABLE IF NOT EXISTS tool_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tool_id TEXT NOT NULL REFERENCES ai_tools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  user_name TEXT NOT NULL,
  comment TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabella per le condivisioni
CREATE TABLE IF NOT EXISTS tool_shares (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tool_id TEXT NOT NULL REFERENCES ai_tools(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indici per performance
CREATE INDEX IF NOT EXISTS idx_tool_likes_tool_id ON tool_likes(tool_id);
CREATE INDEX IF NOT EXISTS idx_tool_likes_user_id ON tool_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_tool_comments_tool_id ON tool_comments(tool_id);
CREATE INDEX IF NOT EXISTS idx_tool_shares_tool_id ON tool_shares(tool_id);

-- Inserisci dati iniziali (mock data)
INSERT INTO ai_tools (id, name, description, cover_image, category, likes, comments, shares) VALUES
  ('1', 'AI Chat Assistant', 'Chat intelligente con modelli LLM avanzati. Supporta multiple conversazioni, progetti organizzati e integrazione con vari modelli AI.', '/team/Trinacria.png', 'Chat & Conversazione', 124, 23, 45),
  ('2', 'Voice Recognition AI', 'Sistema avanzato di riconoscimento vocale con supporto multilingua e trascrizione in tempo reale.', '/team/Trinacria.png', 'Audio & Voice', 89, 15, 32),
  ('3', 'Image Generator AI', 'Genera immagini AI di alta qualità da descrizioni testuali. Supporta vari stili artistici e personalizzazioni.', '/team/Trinacria.png', 'Immagini & Design', 256, 42, 78),
  ('4', 'Code Assistant AI', 'Assistente per sviluppatori che aiuta a scrivere, debuggare e ottimizzare codice in vari linguaggi di programmazione.', '/team/Trinacria.png', 'Sviluppo', 312, 67, 91),
  ('5', 'Document Analyzer AI', 'Analizza e estrae informazioni da documenti PDF, Word e altri formati. Supporta OCR e analisi semantica.', '/team/Trinacria.png', 'Produttività', 178, 28, 56),
  ('6', 'Translation AI', 'Traduzione istantanea in oltre 100 lingue con supporto per contesto e tono conversazionale.', '/team/Trinacria.png', 'Linguistica', 203, 35, 64)
ON CONFLICT (id) DO NOTHING;

-- RLS (Row Level Security) Policies
ALTER TABLE ai_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_shares ENABLE ROW LEVEL SECURITY;

-- Policy: chiunque può leggere gli AI tools
CREATE POLICY "Anyone can read ai_tools" ON ai_tools FOR SELECT USING (true);

-- Policy: chiunque può leggere i like
CREATE POLICY "Anyone can read tool_likes" ON tool_likes FOR SELECT USING (true);

-- Policy: solo utenti autenticati possono creare like
CREATE POLICY "Authenticated users can create tool_likes" ON tool_likes FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Policy: utenti possono eliminare solo i propri like
CREATE POLICY "Users can delete own tool_likes" ON tool_likes FOR DELETE USING (auth.uid() = user_id);

-- Policy: chiunque può leggere i commenti
CREATE POLICY "Anyone can read tool_comments" ON tool_comments FOR SELECT USING (true);

-- Policy: solo utenti autenticati possono creare commenti
CREATE POLICY "Authenticated users can create tool_comments" ON tool_comments FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Policy: chiunque può leggere le condivisioni
CREATE POLICY "Anyone can read tool_shares" ON tool_shares FOR SELECT USING (true);

-- Policy: chiunque può creare condivisioni
CREATE POLICY "Anyone can create tool_shares" ON tool_shares FOR INSERT WITH CHECK (true);















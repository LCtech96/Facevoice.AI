-- Tabella per i membri del team
CREATE TABLE IF NOT EXISTS team_members (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  description TEXT,
  email TEXT,
  linkedin TEXT,
  image_url TEXT,
  image_path TEXT, -- Path nello storage di Supabase
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

-- Abilita Row Level Security
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

-- Rimuovi le policy esistenti se esistono (per evitare errori)
DROP POLICY IF EXISTS "Team members are viewable by everyone" ON team_members;
DROP POLICY IF EXISTS "Only authenticated users can insert team members" ON team_members;
DROP POLICY IF EXISTS "Only authenticated users can update team members" ON team_members;

-- Policy per permettere lettura pubblica
CREATE POLICY "Team members are viewable by everyone"
  ON team_members
  FOR SELECT
  USING (true);

-- Policy per permettere inserimento/modifica solo agli autenticati (puoi modificare questa policy secondo le tue esigenze)
CREATE POLICY "Only authenticated users can insert team members"
  ON team_members
  FOR INSERT
  WITH CHECK (true); -- Cambia questo con auth.role() = 'authenticated' se vuoi autenticazione

CREATE POLICY "Only authenticated users can update team members"
  ON team_members
  FOR UPDATE
  USING (true); -- Cambia questo con auth.role() = 'authenticated' se vuoi autenticazione

-- Bucket per le immagini del team in Storage
INSERT INTO storage.buckets (id, name, public)
VALUES ('team-photos', 'team-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Rimuovi le policy esistenti se esistono (per evitare errori)
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Public can upload team photos" ON storage.objects;

-- Policy per permettere lettura pubblica delle immagini
CREATE POLICY "Public Access"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'team-photos');

-- Policy per permettere upload delle immagini (puoi restringere secondo le tue esigenze)
CREATE POLICY "Public can upload team photos"
  ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'team-photos');

-- Trigger per aggiornare updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc', NOW());
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Rimuovi il trigger se esiste (per evitare errori)
DROP TRIGGER IF EXISTS update_team_members_updated_at ON team_members;

CREATE TRIGGER update_team_members_updated_at BEFORE UPDATE ON team_members
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Inserisci i membri del team esistenti
INSERT INTO team_members (name, role, description, email, linkedin, image_url) VALUES
  ('Luca Corrao', 'CEO & Founder', 'Visionary leader with expertise in AI and blockchain technologies', 'luca@facevoice.ai', 'https://linkedin.com/in/luca-corrao', '/team/Luca professionale fv.png'),
  ('Sevara Urmanaeva', 'CMO', 'Strategic marketing expert driving brand growth and digital innovation', 'sevara@facevoice.ai', 'https://linkedin.com/in/sevara-urmanaeva', '/team/Sevara professionale fv.png'),
  ('Giuseppe Delli Paoli', 'Co-founder, AI & Automation Specialist', 'Expert in AI solutions and automation systems, transforming workflows through intelligent technology', 'giuseppe@facevoice.ai', 'https://linkedin.com/in/giuseppe-delli-paoli', '/team/Giuseppe professionale fv.png'),
  ('Sara Siddique', 'Data Engineer, Data Scientist', 'Specialized in data engineering and data science, building scalable data pipelines and extracting actionable insights', 'sara@facevoice.ai', 'https://linkedin.com/in/sara-siddique', '/team/Sara professionale fv.png'),
  ('Jonh Mcnova', 'Prompt Engineer, DevOps Engineer / Site Reliability Engineer (SRE)', 'Expert in prompt engineering and DevOps practices, ensuring reliable and scalable infrastructure for AI systems', 'jonh@facevoice.ai', 'https://linkedin.com/in/jonh-mcnova', '/team/Jonh professionale fv.png'),
  ('Leonardo Alotta', 'Chief Financial Officer (CFO)', 'Strategic financial leader driving growth and ensuring fiscal responsibility across all business operations', 'leonardo@facevoice.ai', 'https://linkedin.com/in/leonardo-alotta', '/team/Leonardo professionale fv.png'),
  ('Abraham Caur', 'Product Manager (PM), UX/UI Designer', 'Expert in product management and UX/UI design, crafting intuitive and engaging user experiences', 'abraham@facevoice.ai', 'https://linkedin.com/in/abraham-caur', '/team/Abraham professionale fv.png')
ON CONFLICT DO NOTHING;


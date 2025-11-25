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

CREATE TRIGGER update_team_members_updated_at BEFORE UPDATE ON team_members
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Inserisci i membri del team esistenti
INSERT INTO team_members (name, role, description, email, linkedin) VALUES
  ('Luca Corrao', 'CEO & Founder', 'Visionary leader with expertise in AI and blockchain technologies', 'luca@facevoice.ai', 'https://linkedin.com/in/luca-corrao'),
  ('Sevara Urmanaeva', 'CMO', 'Strategic marketing expert driving brand growth and digital innovation', 'sevara@facevoice.ai', 'https://linkedin.com/in/sevara-urmanaeva'),
  ('Giuseppe Delli Paoli', 'AI & Automation Specialist', 'Expert in AI solutions and automation systems, transforming workflows through intelligent technology', 'giuseppe@facevoice.ai', 'https://linkedin.com/in/giuseppe-delli-paoli'),
  ('Sara Siddique', 'Data Engineer, Data Scientist', 'Specialized in data engineering and data science, building scalable data pipelines and extracting actionable insights', 'sara@facevoice.ai', 'https://linkedin.com/in/sara-siddique'),
  ('Jonh Mcnova', 'Prompt Engineer, DevOps Engineer / Site Reliability Engineer (SRE)', 'Expert in prompt engineering and DevOps practices, ensuring reliable and scalable infrastructure for AI systems', 'jonh@facevoice.ai', 'https://linkedin.com/in/jonh-mcnova'),
  ('Leonardo Alotta', 'Chief Financial Officer (CFO)', 'Strategic financial leader driving growth and ensuring fiscal responsibility across all business operations', 'leonardo@facevoice.ai', 'https://linkedin.com/in/leonardo-alotta'),
  ('Abraham Caur', 'Product Manager (PM), UX/UI Designer', 'Expert in product management and UX/UI design, crafting intuitive and engaging user experiences', 'abraham@facevoice.ai', 'https://linkedin.com/in/abraham-caur')
ON CONFLICT DO NOTHING;


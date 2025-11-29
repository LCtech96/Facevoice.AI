-- Script SQL per aggiungere Alessio come Client Success Manager
-- Esegui questo script nella SQL Editor di Supabase

-- Verifica se Alessio esiste già e aggiorna, altrimenti inserisci
INSERT INTO team_members (name, role, description, email, linkedin, image_url)
VALUES (
  'Alessio',
  'Client Success Manager',
  'Dedicated to ensuring client satisfaction and success, building strong relationships and driving value for our partners',
  'alessio@facevoice.ai',
  NULL,
  '/team/Alessio professionale fv.png'
)
ON CONFLICT (name) DO UPDATE
SET 
  role = EXCLUDED.role,
  description = EXCLUDED.description,
  email = EXCLUDED.email,
  image_url = EXCLUDED.image_url,
  updated_at = NOW();

-- Se il nome non è univoco, usa questo invece:
-- INSERT INTO team_members (name, role, description, email, linkedin, image_url)
-- SELECT 
--   'Alessio',
--   'Client Success Manager',
--   'Dedicated to ensuring client satisfaction and success, building strong relationships and driving value for our partners',
--   'alessio@facevoice.ai',
--   NULL,
--   '/team/Alessio professionale fv.png'
-- WHERE NOT EXISTS (
--   SELECT 1 FROM team_members WHERE name ILIKE '%Alessio%'
-- );


-- Inserisce Umberto (alias Fischietto) nella tabella team_members
-- Esegui questo script in Supabase SQL Editor

-- Inserisci Umberto
INSERT INTO team_members (
  name,
  role,
  description,
  image_url,
  email,
  linkedin,
  instagram,
  x,
  google,
  is_contractor
) VALUES (
  'Umberto (alias Fischietto)',
  'Director of Digital Strategy',
  'Director of Digital Strategy social media, content creator.',
  '/team/Umberto-Facevoice.png',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  false
)
ON CONFLICT DO NOTHING;

-- Verifica che sia stato inserito
SELECT * FROM team_members WHERE name LIKE '%Umberto%';

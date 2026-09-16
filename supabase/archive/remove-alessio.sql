-- Script SQL per rimuovere completamente Alessio dal team
-- Esegui questo script nella SQL Editor di Supabase

-- PRIMA: Verifica cosa stai per rimuovere
SELECT id, name, role, email, image_url, image_path
FROM team_members
WHERE name ILIKE '%Alessio%';

-- SECONDA: Rimuovi Alessio
DELETE FROM team_members
WHERE name ILIKE '%Alessio%';

-- TERZA: Verifica finale - dovrebbe restituire 0 righe
SELECT id, name, role
FROM team_members
WHERE name ILIKE '%Alessio%';

-- Se la query sopra restituisce 0 righe, Alessio è stato completamente rimosso












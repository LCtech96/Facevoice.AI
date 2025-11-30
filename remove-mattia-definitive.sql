-- Script SQL DEFINITIVO per rimuovere COMPLETAMENTE Mattia Orlando
-- Esegui questo script nella SQL Editor di Supabase
-- Questo script rimuove Mattia Orlando con ID 10 direttamente

-- PRIMA: Verifica cosa stai per rimuovere
SELECT id, name, role, email, image_url, image_path, created_at
FROM team_members
WHERE id = 10 OR name ILIKE '%Mattia%' OR name ILIKE '%Orlando%';

-- SECONDA: Rimuovi direttamente per ID (più sicuro)
DELETE FROM team_members
WHERE id = 10;

-- TERZA: Rimuovi anche per nome (per sicurezza)
DELETE FROM team_members
WHERE name ILIKE '%Mattia Orlando%'
   OR (name ILIKE '%Mattia%' AND name ILIKE '%Orlando%');

-- QUARTA: Verifica finale - dovrebbe restituire 0 righe
SELECT id, name, role
FROM team_members
WHERE id = 10 OR name ILIKE '%Mattia%' OR name ILIKE '%Orlando%';

-- Se la query sopra restituisce 0 righe, Mattia è stato COMPLETAMENTE rimosso
-- La card non dovrebbe più apparire sul sito


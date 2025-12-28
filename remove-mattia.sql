-- Script SQL per rimuovere Mattia Orlando dal team
-- Esegui questo script nella SQL Editor di Supabase

-- Rimuovi Mattia Orlando dal database
DELETE FROM team_members
WHERE name ILIKE '%Mattia%' OR name ILIKE '%Orlando%';

-- Verifica che sia stato rimosso
SELECT * FROM team_members WHERE name ILIKE '%Mattia%' OR name ILIKE '%Orlando%';
-- Dovrebbe restituire 0 righe










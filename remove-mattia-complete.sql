-- Script SQL per rimuovere COMPLETAMENTE Mattia Orlando dal database
-- Esegui questo script nella SQL Editor di Supabase

-- Rimuovi Mattia Orlando con qualsiasi variazione del nome
DELETE FROM team_members
WHERE 
  name ILIKE '%Mattia%' 
  OR name ILIKE '%Orlando%'
  OR name ILIKE '%Mattia Orlando%'
  OR (name ILIKE '%MO%' AND role ILIKE '%Digital Concept Design%');

-- Verifica che sia stato rimosso (dovrebbe restituire 0 righe)
SELECT id, name, role 
FROM team_members 
WHERE 
  name ILIKE '%Mattia%' 
  OR name ILIKE '%Orlando%'
  OR name ILIKE '%Mattia Orlando%'
  OR (name ILIKE '%MO%' AND role ILIKE '%Digital Concept Design%');

-- Se la query sopra restituisce 0 righe, Mattia è stato completamente rimosso




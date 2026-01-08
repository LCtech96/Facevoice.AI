-- Query SQL per eliminare TUTTI gli utenti da Supabase Auth
-- ⚠️ ATTENZIONE: Questa query elimina TUTTI gli account. Usa con cautela!

-- 1. Prima verifica quanti utenti ci sono:
-- SELECT COUNT(*) FROM auth.users;

-- 2. Elimina TUTTI gli utenti:
DELETE FROM auth.users;

-- 3. (Opzionale) Se vuoi eliminare anche le sessioni e i refresh token:
-- DELETE FROM auth.refresh_tokens;
-- DELETE FROM auth.sessions;

-- 4. (Opzionale) Se vuoi eliminare anche i metadati degli utenti:
-- DELETE FROM auth.identities;

-- ⚠️ NOTA: Questa query elimina tutti gli utenti senza possibilità di recupero.
-- Esegui prima un backup se necessario.
-- ═══════════════════════════════════════════════════════════════════════════
-- RESET COMPLETO SISTEMA AUTENTICAZIONE - Supabase Auth
-- ═══════════════════════════════════════════════════════════════════════════
-- 
-- ⚠️ ATTENZIONE: Queste query eliminano TUTTI gli utenti e dati correlati.
-- Usa solo se vuoi resettare completamente il sistema di autenticazione.
--
-- Prima di eseguire:
-- 1. Fai un backup se necessario
-- 2. Verifica che non ci siano dati importanti da preservare
-- 3. Esegui le query nell'ordine indicato
--
-- ═══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- STEP 1: Verifica stato attuale
-- ──────────────────────────────────────────────────────────────────────────

-- Conta gli utenti esistenti
SELECT 
  COUNT(*) as total_users,
  COUNT(CASE WHEN email_confirmed_at IS NOT NULL THEN 1 END) as confirmed_users,
  COUNT(CASE WHEN email_confirmed_at IS NULL THEN 1 END) as unconfirmed_users
FROM auth.users;

-- Mostra gli ultimi 10 utenti (opzionale, per verificare prima di eliminare)
-- SELECT id, email, created_at, email_confirmed_at 
-- FROM auth.users 
-- ORDER BY created_at DESC 
-- LIMIT 10;

-- ──────────────────────────────────────────────────────────────────────────
-- STEP 2: Elimina le sessioni e i refresh token (DEVI eliminare prima questi)
-- ──────────────────────────────────────────────────────────────────────────

-- Elimina tutti i refresh token
DELETE FROM auth.refresh_tokens;

-- Elimina tutte le sessioni (se esistono)
DELETE FROM auth.sessions;

-- Elimina tutte le identità (linked accounts, OAuth, etc.)
DELETE FROM auth.identities;

-- ──────────────────────────────────────────────────────────────────────────
-- STEP 3: Elimina tutti gli utenti
-- ──────────────────────────────────────────────────────────────────────────

-- Elimina tutti gli utenti (questo elimina anche i dati correlati per cascade)
DELETE FROM auth.users;

-- ──────────────────────────────────────────────────────────────────────────
-- STEP 4: Verifica che tutto sia stato eliminato
-- ──────────────────────────────────────────────────────────────────────────

-- Verifica che non ci siano più utenti
SELECT COUNT(*) as remaining_users FROM auth.users;

-- Verifica che non ci siano più refresh token
SELECT COUNT(*) as remaining_refresh_tokens FROM auth.refresh_tokens;

-- Verifica che non ci siano più sessioni
SELECT COUNT(*) as remaining_sessions FROM auth.sessions;

-- Verifica che non ci siano più identità
SELECT COUNT(*) as remaining_identities FROM auth.identities;

-- ──────────────────────────────────────────────────────────────────────────
-- STEP 5: (Opzionale) Reset sequenze e autovalori se necessario
-- ──────────────────────────────────────────────────────────────────────────

-- Nota: Supabase gestisce automaticamente le sequenze, 
-- ma se vuoi resettarle completamente:

-- RESET SEQUENCE auth.users_id_seq;
-- RESET SEQUENCE auth.refresh_tokens_id_seq;
-- RESET SEQUENCE auth.sessions_id_seq;
-- RESET SEQUENCE auth.identities_id_seq;

-- ──────────────────────────────────────────────────────────────────────────
-- STEP 6: Verifica configurazioni Auth (esegui manualmente nel Dashboard)
-- ──────────────────────────────────────────────────────────────────────────
--
-- Dopo aver eseguito le query sopra, vai su Supabase Dashboard:
-- 1. Authentication → Settings
-- 2. Verifica che "Enable email confirmations" sia impostato come preferisci:
--    - ON: gli utenti devono confermare l'email prima di accedere
--    - OFF: gli utenti possono accedere subito dopo la registrazione
-- 3. Verifica che "Enable sign ups" sia attivo
-- 4. Verifica che "Email" provider sia attivo
--
-- ──────────────────────────────────────────────────────────────────────────
-- QUERY RAPIDA (Tutto in una volta)
-- ──────────────────────────────────────────────────────────────────────────
--
-- Se vuoi eseguire tutto rapidamente, usa questa query combinata:
--
-- BEGIN;
-- DELETE FROM auth.refresh_tokens;
-- DELETE FROM auth.sessions;
-- DELETE FROM auth.identities;
-- DELETE FROM auth.users;
-- COMMIT;
--
-- ──────────────────────────────────────────────────────────────────────────
-- ⚠️ AVVERTENZE FINALI
-- ──────────────────────────────────────────────────────────────────────────
--
-- 1. Queste query sono IRREVERSIBILI - non c'è modo di recuperare i dati
-- 2. Dopo aver eseguito queste query, tutti gli utenti dovranno registrarsi di nuovo
-- 3. Assicurati di avere backup se necessario
-- 4. Verifica le impostazioni di autenticazione dopo il reset
--
-- ═══════════════════════════════════════════════════════════════════════════


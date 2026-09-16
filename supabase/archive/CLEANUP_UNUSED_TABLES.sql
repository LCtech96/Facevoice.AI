-- =====================================================================
-- Facevoice.AI — Conteggio utenti + pulizia tabelle non utilizzate
-- =====================================================================
-- Esegui i blocchi NELL'ORDINE. Lo STEP 3 e' distruttivo e irreversibile.
-- =====================================================================


-- =====================================================================
-- STEP 1 — QUANTI UTENTI SONO REGISTRATI
-- =====================================================================
-- Gli utenti NON stanno in public: stanno in auth.users (Supabase Auth).

SELECT COUNT(*) AS utenti_totali FROM auth.users;

-- Dettaglio piu' utile (confermati, attivi, nuovi):
SELECT
  COUNT(*)                                                          AS totali,
  COUNT(*) FILTER (WHERE email_confirmed_at IS NOT NULL)            AS email_confermata,
  COUNT(*) FILTER (WHERE last_sign_in_at IS NOT NULL)               AS almeno_un_accesso,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')  AS nuovi_ultimi_30gg,
  COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)                    AS eliminati,
  MIN(created_at)                                                   AS primo_iscritto,
  MAX(created_at)                                                   AS ultimo_iscritto
FROM auth.users;

-- Iscrizioni per mese:
SELECT DATE_TRUNC('month', created_at)::date AS mese, COUNT(*) AS iscritti
FROM auth.users
GROUP BY 1
ORDER BY 1 DESC;


-- =====================================================================
-- STEP 2 — VERIFICA PRIMA DI CANCELLARE (non distruttivo)
-- =====================================================================

-- 2a. Quante righe contengono davvero le tabelle candidate?
--     Se qualcuna ha righe che ti servono, fermati e fai un export CSV.
SELECT
  c.relname                AS tabella,
  c.reltuples::bigint      AS righe_stimate,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS spazio
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN ('properties', 'posts', 'collaborations', 'messages',
                    'profiles', 'entertainment_posts')
ORDER BY 1;

-- 2b. Conteggio esatto (piu' lento ma preciso):
SELECT 'properties' AS t, COUNT(*) FROM public.properties
UNION ALL SELECT 'posts',              COUNT(*) FROM public.posts
UNION ALL SELECT 'collaborations',     COUNT(*) FROM public.collaborations
UNION ALL SELECT 'messages',           COUNT(*) FROM public.messages
UNION ALL SELECT 'profiles',           COUNT(*) FROM public.profiles
UNION ALL SELECT 'entertainment_posts',COUNT(*) FROM public.entertainment_posts;

-- 2c. IMPORTANTE: qualche tabella CHE TIENI dipende da quelle da cancellare?
--     Se questa query restituisce righe, NON usare CASCADE alla cieca:
--     cancelleresti anche la tabella elencata nella colonna "tabella_dipendente".
SELECT
  src.relname  AS tabella_dipendente,
  con.conname  AS foreign_key,
  tgt.relname  AS punta_a
FROM pg_constraint con
JOIN pg_class src ON src.oid = con.conrelid
JOIN pg_class tgt ON tgt.oid = con.confrelid
WHERE con.contype = 'f'
  AND tgt.relname IN ('properties', 'posts', 'collaborations', 'messages',
                      'profiles', 'entertainment_posts')
  AND src.relname NOT IN ('properties', 'posts', 'collaborations', 'messages',
                          'profiles', 'entertainment_posts');

-- 2d. Trigger su auth.users che scrivono su profiles (es. handle_new_user)?
--     Se esistono, vanno rimossi PRIMA, altrimenti le nuove registrazioni
--     falliscono con "relation public.profiles does not exist".
SELECT tgname AS trigger_su_auth_users, pg_get_triggerdef(oid) AS definizione
FROM pg_trigger
WHERE tgrelid = 'auth.users'::regclass
  AND NOT tgisinternal;


-- =====================================================================
-- STEP 3 — CANCELLAZIONE  ⚠️ IRREVERSIBILE
-- =====================================================================
-- Esegui SOLO dopo aver letto i risultati dello STEP 2.
-- Fai prima un backup: Supabase Dashboard > Database > Backups.
--
-- Tutto in una transazione: se una riga fallisce, non viene cancellato nulla.

BEGIN;

  -- Se lo STEP 2d ha trovato un trigger su auth.users, decommenta e adatta:
  -- DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
  -- DROP FUNCTION IF EXISTS public.handle_new_user();

  -- Ordine: prima le tabelle "figlie", poi quelle a cui puntano.
  DROP TABLE IF EXISTS public.messages            CASCADE;
  DROP TABLE IF EXISTS public.collaborations      CASCADE;
  DROP TABLE IF EXISTS public.posts               CASCADE;
  DROP TABLE IF EXISTS public.properties          CASCADE;
  DROP TABLE IF EXISTS public.entertainment_posts CASCADE;
  DROP TABLE IF EXISTS public.profiles            CASCADE;

  -- Funzione trigger rimasta orfana da entertainment_posts:
  DROP FUNCTION IF EXISTS public.update_entertainment_post_updated_at();

  -- Controlla l'output qui sotto PRIMA di confermare.
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
  ORDER BY 1;

COMMIT;
-- Se qualcosa non torna, al posto di COMMIT esegui:  ROLLBACK;


-- =====================================================================
-- NOTE
-- =====================================================================
-- NON cancellare 'bookings': e' usata dal sito (app/bookings, app/api/bookings).
-- Tabelle in uso da tenere: ai_knowledge, ai_tools, blog_posts, bookings,
--   case_study_comments, payment_shares, payments, shared_chats,
--   shared_chat_messages, team_members, tool_comments, tool_likes, tool_shares.
--
-- CASCADE qui e' sicuro solo perche' lo STEP 2c ha dato zero righe: elimina
-- vincoli, viste e policy dipendenti. Se 2c ha restituito qualcosa, togli
-- CASCADE e risolvi le dipendenze a mano.

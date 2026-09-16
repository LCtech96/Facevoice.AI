-- =====================================================================
-- Workspace chat interno: membri, progetti, chat, messaggi, consumo
-- =====================================================================
-- Migrazione additiva: non tocca nulla di esistente.
-- Dopo averla eseguita, aggiungi te stesso come admin (ultima sezione).
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. MEMBRI ABILITATI
-- ---------------------------------------------------------------------
-- Chiunque puo' registrarsi sul sito, ma solo chi e' in questa tabella
-- puo' usare la chat interna. E' la lista dei dipendenti.
CREATE TABLE IF NOT EXISTS public.chat_members (
  user_id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email            TEXT NOT NULL,
  display_name     TEXT,
  role             TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('admin', 'employee')),
  -- Tetto di spesa mensile in USD (i prezzi dei modelli sono in USD).
  monthly_limit_usd NUMERIC(10,2) NOT NULL DEFAULT 20.00 CHECK (monthly_limit_usd >= 0),
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at       TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_members_email ON public.chat_members(LOWER(email));

DROP TRIGGER IF EXISTS update_chat_members_updated_at ON public.chat_members;
CREATE TRIGGER update_chat_members_updated_at
  BEFORE UPDATE ON public.chat_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ---------------------------------------------------------------------
-- 2. PROGETTI (una cartella per cliente, con istruzioni dedicate)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_projects (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  color               TEXT DEFAULT '#3b82f6',
  -- Contesto e istruzioni iniettati come system prompt in ogni chat
  -- del progetto: e' cio' che compartimenta la memoria per cliente.
  system_instructions TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_projects_user ON public.chat_projects(user_id, created_at DESC);

DROP TRIGGER IF EXISTS update_chat_projects_updated_at ON public.chat_projects;
CREATE TRIGGER update_chat_projects_updated_at
  BEFORE UPDATE ON public.chat_projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ---------------------------------------------------------------------
-- 3. CHAT
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_chats (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.chat_projects(id) ON DELETE SET NULL,
  title      TEXT NOT NULL DEFAULT 'Nuova chat',
  model      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_chats_user    ON public.user_chats(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_chats_project ON public.user_chats(project_id);

DROP TRIGGER IF EXISTS update_user_chats_updated_at ON public.user_chats;
CREATE TRIGGER update_user_chats_updated_at
  BEFORE UPDATE ON public.user_chats
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ---------------------------------------------------------------------
-- 4. MESSAGGI
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id     UUID NOT NULL REFERENCES public.user_chats(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL DEFAULT '',
  -- [{ mimeType, data }] in base64, come le manda gia' il frontend.
  attachments JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_chat_messages_chat ON public.user_chat_messages(chat_id, created_at);


-- ---------------------------------------------------------------------
-- 5. CONSUMO
-- ---------------------------------------------------------------------
-- Una riga per ogni chiamata al modello. E' la base sia del tetto di
-- spesa sia della dashboard admin.
CREATE TABLE IF NOT EXISTS public.chat_usage (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id                     UUID REFERENCES public.user_chats(id) ON DELETE SET NULL,
  model                       TEXT NOT NULL,
  input_tokens                INTEGER NOT NULL DEFAULT 0,
  output_tokens               INTEGER NOT NULL DEFAULT 0,
  cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_input_tokens     INTEGER NOT NULL DEFAULT 0,
  cost_usd                    NUMERIC(12,6) NOT NULL DEFAULT 0,
  created_at                  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_usage_user_date ON public.chat_usage(user_id, created_at DESC);


-- ---------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------
-- Tutte le scritture passano dalle API route con SERVICE_ROLE_KEY (che
-- bypassa RLS). Le policy qui sotto servono a garantire che, anche in
-- caso di accesso diretto via PostgREST, un utente veda solo i propri
-- dati e non possa alterare limiti o consumo.
ALTER TABLE public.chat_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_projects      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_chats         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_usage         ENABLE ROW LEVEL SECURITY;

-- Ognuno legge solo la propria riga di membership (per sapere il proprio
-- limite). Nessuno puo' modificarla: solo l'admin via service role.
DROP POLICY IF EXISTS "chat_members_select_self" ON public.chat_members;
CREATE POLICY "chat_members_select_self"
  ON public.chat_members FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "chat_projects_all_own" ON public.chat_projects;
CREATE POLICY "chat_projects_all_own"
  ON public.chat_projects FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "user_chats_all_own" ON public.user_chats;
CREATE POLICY "user_chats_all_own"
  ON public.user_chats FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "user_chat_messages_all_own" ON public.user_chat_messages;
CREATE POLICY "user_chat_messages_all_own"
  ON public.user_chat_messages FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Il consumo e' in sola lettura per l'utente: scriverlo spetta al server.
DROP POLICY IF EXISTS "chat_usage_select_own" ON public.chat_usage;
CREATE POLICY "chat_usage_select_own"
  ON public.chat_usage FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

COMMIT;


-- =====================================================================
-- 7. ABILITA L'ADMIN  — esegui questa parte a mano
-- =====================================================================
-- Sostituisci l'email se serve. L'utente deve essersi gia' registrato
-- sul sito, altrimenti non esiste in auth.users e la INSERT non inserisce
-- nulla (non e' un errore, semplicemente 0 righe).

INSERT INTO public.chat_members (user_id, email, display_name, role, monthly_limit_usd)
SELECT id, email, 'Luca Corrao', 'admin', 200.00
FROM auth.users
WHERE LOWER(email) = 'luca@facevoice.ai'
ON CONFLICT (user_id) DO UPDATE
  SET role = 'admin', is_active = true;

-- Verifica:
SELECT email, role, monthly_limit_usd, is_active FROM public.chat_members ORDER BY role, email;

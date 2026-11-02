-- =====================================================================
-- SaaS, Fase 0: spazi di lavoro (un cliente = uno spazio)
-- =====================================================================
-- Chi si registra crea il suo spazio di lavoro e puo' avere colleghi.
-- Canali, messaggi, contatti, istruzioni AI e consumi appartengono a uno
-- spazio: il database stesso impedisce di vedere quelli degli altri.
--
-- Facevoice diventa lo spazio n. 1 (id fisso qui sotto): i dati che ci
-- sono gia' finiscono li', e il codice attuale continua a funzionare
-- perche' le nuove colonne hanno come valore predefinito proprio quello
-- spazio.
--
-- Idempotente: si puo' rieseguire. Da eseguire DOPO schema.sql.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Spazi di lavoro e membri
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workspaces (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- free | pro | business: per ora solo un'etichetta, gli abbonamenti arrivano dopo.
  plan       TEXT NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_workspaces_updated_at ON public.workspaces;
CREATE TRIGGER update_workspaces_updated_at
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.workspace_members (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- owner: tutto, anche eliminare lo spazio | admin: tutto tranne questo | member: usa le pagine
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON public.workspace_members (user_id);

-- Lo spazio di Facevoice.
INSERT INTO public.workspaces (id, name, plan)
VALUES ('00000000-0000-0000-0000-000000000001', 'Facevoice AI', 'business')
ON CONFLICT (id) DO NOTHING;

-- Funzioni usate dalle regole di accesso. SECURITY DEFINER: leggono
-- workspace_members senza passare dalle sue regole (altrimenti si
-- richiamerebbero all'infinito).
CREATE OR REPLACE FUNCTION public.is_workspace_member(ws UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ws AND user_id = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_admin(ws UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ws AND user_id = (SELECT auth.uid()) AND role IN ('owner', 'admin')
  );
$$;

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

-- I membri vedono il loro spazio e i colleghi. Creare spazi e aggiungere
-- membri passa dal server (service role), che controlla limiti e inviti.
DROP POLICY IF EXISTS "workspaces_select_members" ON public.workspaces;
CREATE POLICY "workspaces_select_members" ON public.workspaces
  FOR SELECT USING (public.is_workspace_member(id));

DROP POLICY IF EXISTS "workspaces_update_admins" ON public.workspaces;
CREATE POLICY "workspaces_update_admins" ON public.workspaces
  FOR UPDATE USING (public.is_workspace_admin(id)) WITH CHECK (public.is_workspace_admin(id));

DROP POLICY IF EXISTS "workspace_members_select_members" ON public.workspace_members;
CREATE POLICY "workspace_members_select_members" ON public.workspace_members
  FOR SELECT USING (public.is_workspace_member(workspace_id));

-- luca@facevoice.ai e' il titolare dello spazio Facevoice: subito se
-- l'utente esiste gia', altrimenti appena si registra (trigger sotto).
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT '00000000-0000-0000-0000-000000000001', id, 'owner'
FROM auth.users WHERE LOWER(email) = 'luca@facevoice.ai'
ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner';

UPDATE public.workspaces SET created_by = (SELECT id FROM auth.users WHERE LOWER(email) = 'luca@facevoice.ai' LIMIT 1)
WHERE id = '00000000-0000-0000-0000-000000000001' AND created_by IS NULL;

CREATE OR REPLACE FUNCTION public.link_facevoice_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF LOWER(NEW.email) = 'luca@facevoice.ai' THEN
    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES ('00000000-0000-0000-0000-000000000001', NEW.id, 'owner')
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_link_facevoice ON auth.users;
CREATE TRIGGER on_auth_user_link_facevoice
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.link_facevoice_owner();

-- ---------------------------------------------------------------------
-- 2. Ogni dato dei canali appartiene a uno spazio
-- ---------------------------------------------------------------------
-- DEFAULT = spazio Facevoice: il codice che non conosce ancora gli spazi
-- (es. il sito pubblico durante il passaggio) continua a scrivere li'.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['social_channels', 'social_messages', 'social_identities', 'ai_knowledge', 'ai_usage']
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS workspace_id UUID NOT NULL
         DEFAULT ''00000000-0000-0000-0000-000000000001''
         REFERENCES public.workspaces(id) ON DELETE CASCADE', t);
  END LOOP;
END $$;

-- Un canale per tipo in ogni spazio (prima: uno per tipo in tutto il database).
ALTER TABLE public.social_channels DROP CONSTRAINT IF EXISTS social_channels_platform_key;
CREATE UNIQUE INDEX IF NOT EXISTS social_channels_workspace_platform_key
  ON public.social_channels (workspace_id, platform);
-- Anche il sito ('web') e' un canale che si puo' accendere e spegnere.
ALTER TABLE public.social_channels DROP CONSTRAINT IF EXISTS social_channels_platform_check;
ALTER TABLE public.social_channels
  ADD CONSTRAINT social_channels_platform_check
  CHECK (platform IN ('whatsapp', 'instagram', 'facebook', 'email', 'web', 'tiktok', 'linkedin', 'x'));
-- Interruttore dell'automazione per canale (l'omnichat lo accende e spegne).
ALTER TABLE public.social_channels ADD COLUMN IF NOT EXISTS automation_enabled BOOLEAN NOT NULL DEFAULT true;

-- Lo stesso messaggio (es. una email inoltrata a due clienti) puo' arrivare
-- in due spazi: l'id esterno e' unico dentro lo spazio, non in assoluto.
ALTER TABLE public.social_messages DROP CONSTRAINT IF EXISTS social_messages_external_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS social_messages_workspace_external_id_key
  ON public.social_messages (workspace_id, external_id);
CREATE INDEX IF NOT EXISTS idx_social_messages_workspace
  ON public.social_messages (workspace_id, created_at DESC);

-- La stessa persona puo' scrivere a due clienti diversi: le schede sono separate.
ALTER TABLE public.social_identities DROP CONSTRAINT IF EXISTS social_identities_pkey;
ALTER TABLE public.social_identities
  ADD CONSTRAINT social_identities_pkey PRIMARY KEY (workspace_id, platform, contact_id);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_workspace ON public.ai_knowledge (workspace_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_workspace ON public.ai_usage (workspace_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 3. Account collegati (Pagina, profilo Instagram, numero WhatsApp, casella email)
-- ---------------------------------------------------------------------
-- external_id e' cio' che arriva nei webhook (id Pagina, id Instagram,
-- phone_number_id, indirizzo email): serve a capire di quale cliente e'
-- un messaggio. Un account si collega a un solo spazio alla volta.
CREATE TABLE IF NOT EXISTS public.channel_connections (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL CHECK (platform IN ('whatsapp', 'instagram', 'facebook', 'email')),
  external_id  TEXT NOT NULL,
  display_name TEXT,
  -- connected | expired (va ricollegato) | error | disconnected
  status       TEXT NOT NULL DEFAULT 'connected'
               CHECK (status IN ('connected', 'expired', 'error', 'disconnected')),
  last_error   TEXT,
  -- Dati non segreti utili alla pagina (es. foto profilo, server IMAP).
  meta         JSONB NOT NULL DEFAULT '{}',
  connected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform, external_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_connections_workspace ON public.channel_connections (workspace_id);

DROP TRIGGER IF EXISTS update_channel_connections_updated_at ON public.channel_connections;
CREATE TRIGGER update_channel_connections_updated_at
  BEFORE UPDATE ON public.channel_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Le credenziali (token, password IMAP) stanno in una tabella a parte,
-- cifrate dal server con una chiave che il database non conosce, e senza
-- nessuna regola di accesso: le legge solo il server.
CREATE TABLE IF NOT EXISTS public.channel_secrets (
  connection_id UUID PRIMARY KEY REFERENCES public.channel_connections(id) ON DELETE CASCADE,
  ciphertext    TEXT NOT NULL,
  expires_at    TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.channel_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.channel_secrets FROM anon, authenticated;

DROP POLICY IF EXISTS "channel_connections_select_members" ON public.channel_connections;
CREATE POLICY "channel_connections_select_members" ON public.channel_connections
  FOR SELECT USING (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------
-- 4. Regole di accesso: i membri dello spazio, non piu' "solo l'admin"
-- ---------------------------------------------------------------------
-- Il server usa la service role (che salta queste regole) e controlla da
-- se' l'appartenenza; queste regole sono la seconda difesa.
DROP POLICY IF EXISTS "social_channels_admin_only" ON public.social_channels;
DROP POLICY IF EXISTS "social_channels_members" ON public.social_channels;
CREATE POLICY "social_channels_members" ON public.social_channels
  FOR ALL USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "social_messages_admin_only" ON public.social_messages;
DROP POLICY IF EXISTS "social_messages_members" ON public.social_messages;
CREATE POLICY "social_messages_members" ON public.social_messages
  FOR ALL USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "social_identities_admin_only" ON public.social_identities;
DROP POLICY IF EXISTS "social_identities_members" ON public.social_identities;
CREATE POLICY "social_identities_members" ON public.social_identities
  FOR ALL USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id));

-- La memoria AI attiva era leggibile da chiunque (la chat del sito la usa
-- dal server): ora solo dai membri dello spazio.
DROP POLICY IF EXISTS "ai_knowledge_select_active" ON public.ai_knowledge;
DROP POLICY IF EXISTS "ai_knowledge_members" ON public.ai_knowledge;
CREATE POLICY "ai_knowledge_members" ON public.ai_knowledge
  FOR ALL USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "ai_usage_select_members" ON public.ai_usage;
CREATE POLICY "ai_usage_select_members" ON public.ai_usage
  FOR SELECT USING (public.is_workspace_member(workspace_id));

-- Nuovi messaggi in tempo reale nell'omnichat.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.social_messages;
EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL;
END $$;

COMMIT;

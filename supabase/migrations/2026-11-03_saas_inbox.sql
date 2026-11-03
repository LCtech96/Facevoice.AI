-- =====================================================================
-- SaaS, Fase 1: omnichat e istruzioni per canale
-- =====================================================================
-- - social_messages.subject: oggetto delle email (serve a rispondere nello
--   stesso filo con "Re: ...").
-- - workspace_instructions: le istruzioni che il cliente scrive per l'AI,
--   una generale e una per ogni canale.
-- Idempotente. Da eseguire DOPO 2026-11-02_saas_workspaces.sql.
-- =====================================================================

BEGIN;

ALTER TABLE public.social_messages ADD COLUMN IF NOT EXISTS subject TEXT;

CREATE TABLE IF NOT EXISTS public.workspace_instructions (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- 'general' oppure il canale: email | instagram | facebook | whatsapp | web
  channel      TEXT NOT NULL CHECK (channel IN ('general', 'email', 'instagram', 'facebook', 'whatsapp', 'web')),
  content      TEXT NOT NULL DEFAULT '' CHECK (length(content) <= 20000),
  updated_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, channel)
);

ALTER TABLE public.workspace_instructions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_instructions_members" ON public.workspace_instructions;
CREATE POLICY "workspace_instructions_members" ON public.workspace_instructions
  FOR ALL USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id));

COMMIT;

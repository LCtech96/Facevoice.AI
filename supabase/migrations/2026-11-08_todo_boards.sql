-- Todo list condivise (pagina /admin/todo e link /todo/<link>).
-- Ogni todo list ha un link segreto e una password scelta dall'admin: del link si
-- salvano solo l'impronta (per riconoscerlo) e una copia cifrata (per «Copia link»),
-- della password solo un hash scrypt con sale. Solo il server (service role) legge e
-- scrive: RLS attiva e nessuna policy pubblica. Rieseguibile senza rompere nulla.

CREATE TABLE IF NOT EXISTS public.todo_boards (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  token_hash       TEXT NOT NULL UNIQUE,
  token_enc        TEXT NOT NULL,
  password_hash    TEXT NOT NULL,
  session_version  INTEGER NOT NULL DEFAULT 1,
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.todo_boards ENABLE ROW LEVEL SECURITY;

-- Le «tabelle» (colonne) di una todo list.
CREATE TABLE IF NOT EXISTS public.todo_lists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id    UUID NOT NULL REFERENCES public.todo_boards(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  position    DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_todo_lists_board ON public.todo_lists(board_id, position);
ALTER TABLE public.todo_lists ENABLE ROW LEVEL SECURITY;

-- Le attivita'. links: anteprime dei link (titolo, descrizione, immagine);
-- images: foto caricate ({id, path, name}).
CREATE TABLE IF NOT EXISTS public.todo_tasks (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id             UUID NOT NULL REFERENCES public.todo_boards(id) ON DELETE CASCADE,
  list_id              UUID NOT NULL REFERENCES public.todo_lists(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  notes                TEXT NOT NULL DEFAULT '',
  done                 BOOLEAN NOT NULL DEFAULT false,
  done_at              TIMESTAMPTZ,
  priority             SMALLINT NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 4),
  position             DOUBLE PRECISION NOT NULL DEFAULT 0,
  deadline             TIMESTAMPTZ,
  assignee             TEXT,
  notify_email         TEXT,
  reminders_per_day    SMALLINT NOT NULL DEFAULT 1 CHECK (reminders_per_day BETWEEN 1 AND 6),
  remind_hours_before  INTEGER NOT NULL DEFAULT 24 CHECK (remind_hours_before BETWEEN 1 AND 168),
  links                JSONB NOT NULL DEFAULT '[]'::jsonb,
  images               JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_todo_tasks_board ON public.todo_tasks(board_id, list_id, position);
CREATE INDEX IF NOT EXISTS idx_todo_tasks_deadline ON public.todo_tasks(deadline) WHERE done = false AND deadline IS NOT NULL AND notify_email IS NOT NULL;
ALTER TABLE public.todo_tasks ENABLE ROW LEVEL SECURITY;

-- Solleciti inviati: una riga per attivita', giorno (ora italiana) e fascia.
-- Il vincolo UNIQUE impedisce doppi invii anche se due giri del cron si sovrappongono.
-- board_id serve al limite giornaliero di email per todo list.
CREATE TABLE IF NOT EXISTS public.todo_reminders_sent (
  id        BIGSERIAL PRIMARY KEY,
  task_id   UUID NOT NULL REFERENCES public.todo_tasks(id) ON DELETE CASCADE,
  board_id  UUID NOT NULL REFERENCES public.todo_boards(id) ON DELETE CASCADE,
  day       DATE NOT NULL,
  slot      SMALLINT NOT NULL,
  email     TEXT NOT NULL,
  sent_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, day, slot)
);
CREATE INDEX IF NOT EXISTS idx_todo_reminders_task ON public.todo_reminders_sent(task_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_todo_reminders_board ON public.todo_reminders_sent(board_id, day);
ALTER TABLE public.todo_reminders_sent ENABLE ROW LEVEL SECURITY;

-- Tentativi di password (per bloccare chi prova a indovinarla). Dell'IP solo un'impronta.
CREATE TABLE IF NOT EXISTS public.todo_login_attempts (
  id          BIGSERIAL PRIMARY KEY,
  board_id    UUID NOT NULL REFERENCES public.todo_boards(id) ON DELETE CASCADE,
  ip_hash     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_todo_login_board ON public.todo_login_attempts(board_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_todo_login_ip ON public.todo_login_attempts(ip_hash, created_at DESC);
ALTER TABLE public.todo_login_attempts ENABLE ROW LEVEL SECURITY;

-- Foto: aggiunta e rimozione in un colpo solo (due caricamenti insieme non si perdono).
CREATE OR REPLACE FUNCTION public.todo_task_add_image(p_task UUID, p_board UUID, p_image JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  UPDATE public.todo_tasks
     SET images = images || jsonb_build_array(p_image), updated_at = now()
   WHERE id = p_task AND board_id = p_board AND jsonb_array_length(images) < 20;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.todo_task_remove_image(p_task UUID, p_board UUID, p_image_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  removed JSONB;
BEGIN
  SELECT e INTO removed
    FROM public.todo_tasks t, jsonb_array_elements(t.images) e
   WHERE t.id = p_task AND t.board_id = p_board AND e->>'id' = p_image_id
   LIMIT 1;
  IF removed IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE public.todo_tasks
     SET images = COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(images) e WHERE e->>'id' IS DISTINCT FROM p_image_id), '[]'::jsonb),
         updated_at = now()
   WHERE id = p_task AND board_id = p_board;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.todo_task_add_image(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.todo_task_remove_image(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.todo_task_add_image(UUID, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.todo_task_remove_image(UUID, UUID, TEXT) TO service_role;

-- Spazio privato per le foto delle attivita' (si aprono solo dalla todo list, con link a tempo).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('todo-images', 'todo-images', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO NOTHING;

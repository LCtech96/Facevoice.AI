-- Todo list: persone con nome e password personale (aggiunta a 2026-11-08_todo_boards.sql).
-- Un link per todo list; ognuno entra con il suo nome e la sua password (solo hash scrypt).
-- Ognuno vede solo le attivita' assegnate a lui, quelle che ha creato e quelle dell'admin
-- senza persona. created_by_member NULL = creata dall'admin.
-- Nessun vincolo verso todo_members sulle colonne nuove: se l'admin toglie una persona,
-- le sue attivita' e tabelle restano e le vede solo l'admin (e chi e' assegnato), invece
-- di diventare "dell'admin" e quindi visibili a tutti.
-- Solo il server (service role) legge e scrive: RLS attiva e nessuna policy pubblica.
-- Solo aggiunte, rieseguibile senza rompere nulla.

CREATE TABLE IF NOT EXISTS public.todo_members (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id         UUID NOT NULL REFERENCES public.todo_boards(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  name_key         TEXT NOT NULL,
  email            TEXT,
  password_hash    TEXT NOT NULL,
  session_version  INTEGER NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (board_id, name_key)
);
ALTER TABLE public.todo_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.todo_members FROM anon, authenticated;

ALTER TABLE public.todo_tasks ADD COLUMN IF NOT EXISTS created_by_member UUID;
ALTER TABLE public.todo_tasks ADD COLUMN IF NOT EXISTS assignee_member UUID;
-- Ultimo avviso "fatta" mandato all'admin (un solo avviso anche se spostata avanti e indietro).
ALTER TABLE public.todo_tasks ADD COLUMN IF NOT EXISTS done_notified_at TIMESTAMPTZ;
ALTER TABLE public.todo_lists ADD COLUMN IF NOT EXISTS created_by_member UUID;

CREATE INDEX IF NOT EXISTS idx_todo_tasks_assignee_member ON public.todo_tasks(board_id, assignee_member) WHERE assignee_member IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_todo_tasks_created_by_member ON public.todo_tasks(board_id, created_by_member) WHERE created_by_member IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_todo_lists_created_by_member ON public.todo_lists(board_id, created_by_member) WHERE created_by_member IS NOT NULL;
-- Solleciti senza email scritta: si usa l'email della persona assegnata.
CREATE INDEX IF NOT EXISTS idx_todo_tasks_deadline_member ON public.todo_tasks(deadline) WHERE done = false AND deadline IS NOT NULL AND assignee_member IS NOT NULL;

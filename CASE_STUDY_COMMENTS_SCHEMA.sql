-- Schema per commenti Case Studies
-- Esegui questo script in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS case_study_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  case_study_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  user_email TEXT NOT NULL,
  comment TEXT NOT NULL,
  is_approved BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_study_comments_case_study_id ON case_study_comments(case_study_id);
CREATE INDEX IF NOT EXISTS idx_case_study_comments_is_approved ON case_study_comments(is_approved);

-- RLS
ALTER TABLE case_study_comments ENABLE ROW LEVEL SECURITY;

-- Policy: chiunque può leggere solo i commenti approvati
DROP POLICY IF EXISTS "Anyone can read approved case_study_comments" ON case_study_comments;
CREATE POLICY "Anyone can read approved case_study_comments" ON case_study_comments 
  FOR SELECT 
  USING (is_approved = true);

-- Policy: chiunque può inserire commenti
DROP POLICY IF EXISTS "Anyone can create case_study_comments" ON case_study_comments;
CREATE POLICY "Anyone can create case_study_comments" ON case_study_comments 
  FOR INSERT 
  WITH CHECK (true);


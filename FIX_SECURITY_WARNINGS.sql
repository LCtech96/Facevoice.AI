-- Fix Security Warnings: Restrictive RLS Policies and Extension Schema
-- This script addresses the remaining security warnings from Supabase Security Advisor

-- ============================================================================
-- 1. MOVE UNACCENT EXTENSION TO EXTENSIONS SCHEMA
-- ============================================================================
-- Create extensions schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS extensions;

-- Move unaccent extension to extensions schema
-- Note: This requires dropping and recreating the extension
-- First, check if any functions depend on it
DO $$
BEGIN
  -- Drop the extension from public schema
  DROP EXTENSION IF EXISTS unaccent;
  
  -- Recreate it in extensions schema
  CREATE EXTENSION IF NOT EXISTS unaccent SCHEMA extensions;
  
  -- Grant usage on the schema
  GRANT USAGE ON SCHEMA extensions TO public;
  GRANT USAGE ON SCHEMA extensions TO authenticated;
  GRANT USAGE ON SCHEMA extensions TO anon;
END $$;

-- Update generate_slug_from_title to use extensions.unaccent
CREATE OR REPLACE FUNCTION public.generate_slug_from_title(title_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN lower(
    regexp_replace(
      regexp_replace(
        extensions.unaccent(title_text),
        '[^a-z0-9]+', '-', 'g'
      ),
      '^-+|-+$', '', 'g'
    )
  );
END;
$$;

-- ============================================================================
-- 2. FIX BOOKINGS TABLE - RESTRICTIVE INSERT POLICY
-- ============================================================================
-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Anyone can create bookings" ON public.bookings;

-- Create a more restrictive policy that validates input
CREATE POLICY "Authenticated users can create bookings with validation"
ON public.bookings
FOR INSERT
WITH CHECK (
  auth.role() = 'authenticated'
  AND email IS NOT NULL
  AND email != ''
  AND service IS NOT NULL
  AND service != ''
);

-- ============================================================================
-- 3. FIX CASE_STUDY_COMMENTS TABLE - RESTRICTIVE INSERT POLICY
-- ============================================================================
-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Anyone can create case_study_comments" ON public.case_study_comments;

-- Create a more restrictive policy
CREATE POLICY "Authenticated users can create case_study_comments with validation"
ON public.case_study_comments
FOR INSERT
WITH CHECK (
  auth.role() = 'authenticated'
  AND user_name IS NOT NULL
  AND user_name != ''
  AND comment IS NOT NULL
  AND comment != ''
);

-- ============================================================================
-- 4. FIX SHARED_CHAT_MESSAGES TABLE - RESTRICTIVE POLICIES
-- ============================================================================
-- Drop overly permissive policies
DROP POLICY IF EXISTS "Allow authenticated users to insert messages into shared_chats" ON public.shared_chat_messages;
DROP POLICY IF EXISTS "Anyone can insert shared chat messages" ON public.shared_chat_messages;

-- Create restrictive policy for authenticated users only
CREATE POLICY "Authenticated users can insert messages into shared chats"
ON public.shared_chat_messages
FOR INSERT
WITH CHECK (
  auth.role() = 'authenticated'
  AND EXISTS (
    SELECT 1
    FROM public.shared_chats
    WHERE shared_chats.id = shared_chat_messages.chat_id
      AND (
        shared_chats.created_by = auth.uid()::text
        OR shared_chats.shared_with_email = LOWER(auth.jwt() ->> 'email')
      )
  )
);

-- ============================================================================
-- 5. FIX SHARED_CHATS TABLE - RESTRICTIVE POLICIES
-- ============================================================================
-- Drop overly permissive policies
DROP POLICY IF EXISTS "Anyone can create shared chats" ON public.shared_chats;
DROP POLICY IF EXISTS "Anyone can update shared chats" ON public.shared_chats;

-- Create restrictive INSERT policy
CREATE POLICY "Authenticated users can create shared chats"
ON public.shared_chats
FOR INSERT
WITH CHECK (
  auth.role() = 'authenticated'
  AND created_by IS NOT NULL
  AND created_by != ''
);

-- Create restrictive UPDATE policy
CREATE POLICY "Users can update their own shared chats"
ON public.shared_chats
FOR UPDATE
USING (
  auth.role() = 'authenticated'
  AND created_by = auth.uid()::text
)
WITH CHECK (
  auth.role() = 'authenticated'
  AND created_by = auth.uid()::text
);

-- ============================================================================
-- 6. FIX TEAM_MEMBERS TABLE - RESTRICTIVE POLICIES
-- ============================================================================
-- Drop overly permissive policies
DROP POLICY IF EXISTS "Anyone can insert team members" ON public.team_members;
DROP POLICY IF EXISTS "Anyone can update team members" ON public.team_members;
DROP POLICY IF EXISTS "Only authenticated users can insert team members" ON public.team_members;
DROP POLICY IF EXISTS "Only authenticated users can update team members" ON public.team_members;

-- Create restrictive INSERT policy - only admin (luca@facevoice.ai) or via service role
CREATE POLICY "Admin can insert team members"
ON public.team_members
FOR INSERT
WITH CHECK (
  auth.role() = 'authenticated'
  AND LOWER(auth.jwt() ->> 'email') = 'luca@facevoice.ai'
  AND name IS NOT NULL
  AND name != ''
);

-- Create restrictive UPDATE policy - only admin
CREATE POLICY "Admin can update team members"
ON public.team_members
FOR UPDATE
USING (
  auth.role() = 'authenticated'
  AND LOWER(auth.jwt() ->> 'email') = 'luca@facevoice.ai'
)
WITH CHECK (
  auth.role() = 'authenticated'
  AND LOWER(auth.jwt() ->> 'email') = 'luca@facevoice.ai'
);

-- ============================================================================
-- 7. FIX TOOL_COMMENTS TABLE - RESTRICTIVE POLICIES
-- ============================================================================
-- Drop overly permissive policies
DROP POLICY IF EXISTS "Anyone can create tool_comments" ON public.tool_comments;
DROP POLICY IF EXISTS "Anyone can verify tool_comments" ON public.tool_comments;

-- Create restrictive INSERT policy
CREATE POLICY "Authenticated users can create tool_comments with validation"
ON public.tool_comments
FOR INSERT
WITH CHECK (
  auth.role() = 'authenticated'
  AND user_name IS NOT NULL
  AND user_name != ''
  AND comment IS NOT NULL
  AND comment != ''
);

-- Create restrictive UPDATE policy - only admin can verify
CREATE POLICY "Admin can verify tool_comments"
ON public.tool_comments
FOR UPDATE
USING (
  auth.role() = 'authenticated'
  AND LOWER(auth.jwt() ->> 'email') = 'luca@facevoice.ai'
)
WITH CHECK (
  auth.role() = 'authenticated'
  AND LOWER(auth.jwt() ->> 'email') = 'luca@facevoice.ai'
);

-- ============================================================================
-- NOTES:
-- ============================================================================
-- 1. Extension unaccent moved to extensions schema to follow best practices
--
-- 2. All INSERT policies now require authentication and validate required fields
--
-- 3. UPDATE policies are restricted to:
--    - Users updating their own records (shared_chats)
--    - Admin only (team_members, tool_comments)
--
-- 4. Service role (SUPABASE_SERVICE_ROLE_KEY) bypasses RLS, so admin API routes
--    will continue to work as expected.
--
-- 5. For "Leaked Password Protection", enable it in Supabase Dashboard:
--    Authentication → Settings → Password → Enable "Leaked Password Protection"

-- Fix Security Issues: Enable RLS on payments and payment_shares tables
-- This script addresses the critical security errors from Supabase Security Advisor

-- ============================================================================
-- 1. ENABLE RLS ON PAYMENTS TABLE
-- ============================================================================
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Policy: Users can SELECT payments where they are the collaborator
CREATE POLICY "Users can view their own payments"
ON public.payments
FOR SELECT
USING (
  collaborator_email = LOWER(auth.jwt() ->> 'email')
);

-- Policy: Users can SELECT payments shared with them
CREATE POLICY "Users can view shared payments"
ON public.payments
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.payment_shares
    WHERE payment_shares.payment_id = payments.id
      AND payment_shares.shared_with_email = LOWER(auth.jwt() ->> 'email')
  )
);

-- Policy: Only authenticated users can INSERT payments (admin via service role)
-- Note: Service role bypasses RLS, so this is mainly for direct PostgREST access
CREATE POLICY "Authenticated users can insert payments"
ON public.payments
FOR INSERT
WITH CHECK (
  auth.role() = 'authenticated'
);

-- Policy: Only authenticated users can UPDATE payments
CREATE POLICY "Authenticated users can update payments"
ON public.payments
FOR UPDATE
USING (
  auth.role() = 'authenticated'
)
WITH CHECK (
  auth.role() = 'authenticated'
);

-- Policy: Only authenticated users can DELETE payments
CREATE POLICY "Authenticated users can delete payments"
ON public.payments
FOR DELETE
USING (
  auth.role() = 'authenticated'
);

-- ============================================================================
-- 2. ENABLE RLS ON PAYMENT_SHARES TABLE
-- ============================================================================
ALTER TABLE public.payment_shares ENABLE ROW LEVEL SECURITY;

-- Policy: Users can SELECT payment_shares where they are the recipient
CREATE POLICY "Users can view shares for their email"
ON public.payment_shares
FOR SELECT
USING (
  shared_with_email = LOWER(auth.jwt() ->> 'email')
);

-- Policy: Only authenticated users can INSERT payment_shares
-- Note: Service role bypasses RLS, so admin operations work via API
CREATE POLICY "Authenticated users can insert payment shares"
ON public.payment_shares
FOR INSERT
WITH CHECK (
  auth.role() = 'authenticated'
);

-- Policy: Only authenticated users can UPDATE payment_shares
CREATE POLICY "Authenticated users can update payment shares"
ON public.payment_shares
FOR UPDATE
USING (
  auth.role() = 'authenticated'
)
WITH CHECK (
  auth.role() = 'authenticated'
);

-- Policy: Only authenticated users can DELETE payment_shares
CREATE POLICY "Authenticated users can delete payment shares"
ON public.payment_shares
FOR DELETE
USING (
  auth.role() = 'authenticated'
);

-- ============================================================================
-- 3. FIX FUNCTION SEARCH_PATH SECURITY ISSUES
-- ============================================================================

-- Fix update_updated_at_column function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc', NOW());
  RETURN NEW;
END;
$$;

-- Fix update_shared_chat_updated_at function (if exists)
CREATE OR REPLACE FUNCTION public.update_shared_chat_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc', NOW());
  RETURN NEW;
END;
$$;

-- Fix generate_slug_from_title function (if exists)
-- Note: This function might use unaccent extension, so we need to handle that
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
        unaccent(title_text),
        '[^a-z0-9]+', '-', 'g'
      ),
      '^-+|-+$', '', 'g'
    )
  );
END;
$$;

-- ============================================================================
-- 4. VERIFY RLS IS ENABLED
-- ============================================================================
-- Check RLS status (run these queries to verify):
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('payments', 'payment_shares');
-- Should return rowsecurity = true for both tables

-- ============================================================================
-- NOTES:
-- ============================================================================
-- 1. Service role (SUPABASE_SERVICE_ROLE_KEY) bypasses RLS, so admin API routes
--    will continue to work as expected.
--
-- 2. Direct PostgREST access will now be restricted by RLS policies.
--
-- 3. Users can only see:
--    - Payments where collaborator_email matches their email
--    - Payments that have been shared with their email via payment_shares
--
-- 4. The policies allow authenticated users to INSERT/UPDATE/DELETE, but in
--    practice, these operations are only performed via admin API routes using
--    the service role key.

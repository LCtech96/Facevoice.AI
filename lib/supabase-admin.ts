import { createClient } from '@supabase/supabase-js'

const PLACEHOLDER_URL = 'https://placeholder.supabase.co'
const PLACEHOLDER_KEY = 'placeholder-key'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || PLACEHOLDER_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || PLACEHOLDER_KEY

// Client con privilegi admin — safe at build time if env vars are missing
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

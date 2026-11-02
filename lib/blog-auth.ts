import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isAdminEmail } from '@/lib/admin-auth'

// Chi puo' pubblicare nel blog: l'admin e il collaboratore abilitato nella home.
// Prima la pubblicazione e il caricamento delle immagini erano aperti a chiunque.
const BLOG_EDITORS = ['umberto.fischietto@gmail.com']

const supabaseAuth = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key'
)

export async function canPublishBlog(req: NextRequest): Promise<boolean> {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return false
  const { data } = await supabaseAuth.auth.getUser(token)
  const email = data.user?.email?.toLowerCase()
  return Boolean(email && (isAdminEmail(email) || BLOG_EDITORS.includes(email)))
}

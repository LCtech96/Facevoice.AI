import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAdminEmail } from '@/lib/admin-auth'

/** Email dell'admin che fa la richiesta, o null se non e' un admin autenticato. */
export async function getAdminEmail(req: NextRequest): Promise<string | null> {
  const header = req.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  const { data } = await supabaseAdmin.auth.getUser(header.slice(7).trim())
  const email = data.user?.email
  return isAdminEmail(email) ? email!.toLowerCase() : null
}

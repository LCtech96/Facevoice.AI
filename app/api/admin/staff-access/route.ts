import { NextRequest, NextResponse } from 'next/server'
import { getAdminEmail } from '@/lib/admin-request'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { allPermissions, setPermissions } from '@/lib/staff-access'

export const dynamic = 'force-dynamic'

/** Permessi di tutti i dipendenti (solo admin). */
export async function GET(req: NextRequest) {
  if (!(await getAdminEmail(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const map = await allPermissions()
  return NextResponse.json({ permissions: Object.fromEntries(map) })
}

/** Imposta i permessi di un dipendente (solo admin). body: { userId, permissions } */
export async function POST(req: NextRequest) {
  if (!(await getAdminEmail(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const userId = typeof body?.userId === 'string' ? body.userId : ''
  if (!userId) return NextResponse.json({ error: 'Dipendente non indicato' }, { status: 400 })
  // Solo membri del team: niente permessi a utenti qualsiasi.
  const { data: member } = await supabaseAdmin.from('chat_members').select('user_id').eq('user_id', userId).maybeSingle()
  if (!member) return NextResponse.json({ error: 'Non è un dipendente del team' }, { status: 404 })
  const permissions = await setPermissions(userId, body.permissions)
  return NextResponse.json({ permissions })
}

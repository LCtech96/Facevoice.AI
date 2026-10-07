import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requestAccess, statusOf } from '@/lib/chat-access'

export const dynamic = 'force-dynamic'

async function currentUser(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const { data } = await supabaseAdmin.auth.getUser(token)
  return data.user && data.user.email ? data.user : null
}

/** Stato della richiesta di accesso alla chat interna dell'utente collegato. */
export async function GET(req: NextRequest) {
  const user = await currentUser(req)
  if (!user) return NextResponse.json({ error: 'Accedi per continuare' }, { status: 401 })
  return NextResponse.json({ status: await statusOf(user.id) })
}

/** "Richiedi accesso": avvisa l'admin con push ed email. */
export async function POST(req: NextRequest) {
  const user = await currentUser(req)
  if (!user) return NextResponse.json({ error: 'Accedi per continuare' }, { status: 401 })
  const status = await requestAccess(user.id, user.email!.toLowerCase())
  return NextResponse.json({ status })
}

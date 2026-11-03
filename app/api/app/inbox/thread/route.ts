import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

// Omnichat: i messaggi di una conversazione. Aprendola, i messaggi ricevuti
// diventano letti.

export async function GET(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  const platform = req.nextUrl.searchParams.get('platform') || ''
  const contact = req.nextUrl.searchParams.get('contact') || ''
  if (!platform || !contact) return NextResponse.json({ error: 'Conversazione non indicata' }, { status: 400 })
  const { data, error } = await access.db
    .from('social_messages')
    .select('id, direction, body, subject, status, origin, error_message, contact_name, created_at')
    .eq('platform', platform)
    .eq('contact_id', contact)
    .neq('status', 'rejected')
    .order('created_at', { ascending: true })
    .limit(200)
  if (error) return NextResponse.json({ error: 'Messaggi non disponibili, riprova.' }, { status: 500 })
  await access.db
    .from('social_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('platform', platform)
    .eq('contact_id', contact)
    .eq('direction', 'in')
    .is('read_at', null)
  return NextResponse.json({ messages: data || [] })
}

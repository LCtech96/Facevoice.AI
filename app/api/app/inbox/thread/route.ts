import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { chatSendWindow } from '@/lib/saas/assistant-send'
import { campaignMarks } from '@/lib/saas/campaign'
import { threadVideos } from '@/lib/saas/video-replies'

export const dynamic = 'force-dynamic'

// Omnichat: i messaggi di una conversazione. Aprendola, i messaggi ricevuti
// diventano letti. sendWindow: se ora si puo' scrivere in questa chat (Correggi).
// campaign: nome della campagna con cui l'AI ha scritto la risposta ('' senza nome), altrimenti null.

export async function GET(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  const platform = req.nextUrl.searchParams.get('platform') || ''
  const contact = req.nextUrl.searchParams.get('contact') || ''
  if (!platform || !contact) return NextResponse.json({ error: 'Conversazione non indicata' }, { status: 400 })
  const { data, error } = await access.db
    .from('social_messages')
    .select('id, direction, body, subject, status, origin, error_message, contact_name, external_id, reply_to, created_at')
    .eq('platform', platform)
    .eq('contact_id', contact)
    .eq('kind', 'message')
    // Le righe senza stato (messaggi ricevuti) vanno tenute: neq da solo le scarterebbe.
    .or('status.is.null,status.neq.rejected')
    .order('created_at', { ascending: true })
    .limit(200)
  if (error) return NextResponse.json({ error: 'Messaggi non disponibili, riprova.' }, { status: 500 })
  const { data: lastIn } = await access.db
    .from('social_messages')
    .select('created_at')
    .eq('platform', platform)
    .eq('contact_id', contact)
    .eq('kind', 'message')
    .eq('direction', 'in')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  await access.db
    .from('social_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('platform', platform)
    .eq('contact_id', contact)
    .eq('kind', 'message')
    .eq('direction', 'in')
    .is('read_at', null)
  const rows = data || []
  const marks = await campaignMarks(
    access.workspace.id,
    rows.filter((m) => m.direction === 'out' && String(m.origin || '').startsWith('ai')).map((m) => m.id as string)
  )
  // Video risposte: proposto sulla bozza (+ video) o inviato (anteprima nella conversazione).
  const videos = await threadVideos(access.workspace.id, platform, contact, rows as { id: string; origin: string | null; status: string | null; direction: string }[])
  return NextResponse.json({
    messages: rows.map((m) => ({ ...m, campaign: marks.get(m.id as string) ?? null, video: videos.get(m.id as string) ?? null })),
    sendWindow: chatSendWindow(platform, lastIn?.created_at as string | undefined),
  })
}

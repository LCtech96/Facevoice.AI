import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { TO_CONFIRM_PREFIX } from '@/lib/saas/responder'

export const dynamic = 'force-dynamic'

// Omnichat: elenco delle conversazioni dello spazio (una per persona e canale),
// dalla piu' recente, con messaggi non letti, bozze da approvare e risposte dell'AI
// già inviate con un dettaglio da confermare alla persona ("te lo confermo a breve").

type Row = {
  id: string
  platform: string
  contact_id: string
  contact_name: string | null
  direction: 'in' | 'out'
  body: string
  subject: string | null
  status: string | null
  origin: string | null
  error_message: string | null
  read_at: string | null
  created_at: string
}

export async function GET(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  const platform = req.nextUrl.searchParams.get('platform')
  let query = access.db
    .from('social_messages')
    .select('id, platform, contact_id, contact_name, direction, body, subject, status, origin, error_message, read_at, created_at')
    // Le righe senza stato (messaggi ricevuti) vanno tenute: neq da solo le scarterebbe.
    .or('status.is.null,status.neq.rejected')
    // I commenti hanno la loro pagina.
    .eq('kind', 'message')
    .order('created_at', { ascending: false })
    .limit(600)
  if (platform) query = query.eq('platform', platform)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Messaggi non disponibili, riprova.' }, { status: 500 })

  const map = new Map<string, {
    platform: string
    contactId: string
    name: string | null
    subject: string | null
    last: { body: string; direction: 'in' | 'out'; at: string; status: string | null }
    unread: number
    pending: number
    /** Risposta dell'AI inviata con "Da confermare: …" e dopo nessun messaggio del team. */
    toConfirm: boolean
  }>()
  /** Conversazioni in cui il team ha gia' scritto dopo (dalla piu' recente): la conferma l'ha data lui. */
  const handled = new Set<string>()
  for (const row of (data || []) as Row[]) {
    const key = `${row.platform}:${row.contact_id}`
    let conv = map.get(key)
    if (!conv) {
      conv = {
        platform: row.platform,
        contactId: row.contact_id,
        name: row.contact_name,
        subject: row.subject,
        last: { body: row.body.slice(0, 160), direction: row.direction, at: row.created_at, status: row.status },
        unread: 0,
        pending: 0,
        toConfirm: false,
      }
      map.set(key, conv)
    }
    if (!conv.name && row.contact_name) conv.name = row.contact_name
    if (!conv.subject && row.subject) conv.subject = row.subject
    if (row.direction === 'in' && !row.read_at) conv.unread++
    if (row.direction === 'out' && row.status === 'pending') conv.pending++
    if (row.direction === 'out' && row.status === 'sent') {
      if (!String(row.origin || '').startsWith('ai')) handled.add(key)
      else if (!handled.has(key) && row.error_message?.startsWith(TO_CONFIRM_PREFIX)) conv.toConfirm = true
    }
  }
  return NextResponse.json({ conversations: [...map.values()] })
}

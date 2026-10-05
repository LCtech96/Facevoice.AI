import { supabaseAdmin } from '@/lib/supabase-admin'

// Stato delle schede della Ricerca clienti ricavato dalla conversazione email vera:
// - ultimo messaggio nostro (inviato)  → "contacted" (Contattato, aspettiamo lui)
// - ultimo messaggio suo               → "replied"   (Ha risposto, tocca a noi)
// Le bozze in attesa non contano finche' non partono. Gli stati scelti a mano
// (cliente, scartato, non contattare) non vengono mai toccati.

const AUTO_STATUSES = ['new', 'contacted', 'replied']

type Row = {
  contact_id: string
  channel_account_id: string | null
  direction: 'in' | 'out'
  created_at: string
}

export async function syncLeadStatuses(): Promise<number> {
  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('id, email, status, contacted_at')
    .in('status', AUTO_STATUSES)
    .not('email', 'is', null)
  if (!leads?.length) return 0

  const emails = [...new Set(leads.map((l) => String(l.email).toLowerCase()))]
  const { data: direct } = await supabaseAdmin
    .from('social_messages')
    .select('contact_id, channel_account_id, direction, created_at')
    .eq('platform', 'email')
    .eq('direction', 'out')
    .eq('status', 'sent')
    .in('contact_id', emails)
    .order('created_at', { ascending: false })
    .limit(2000)
  const { data: incoming } = await supabaseAdmin
    .from('social_messages')
    .select('contact_id, channel_account_id, direction, created_at')
    .eq('platform', 'email')
    .eq('direction', 'in')
    .in('contact_id', emails)
    .order('created_at', { ascending: false })
    .limit(2000)

  const rows: Row[] = [...(direct || []), ...(incoming || [])] as Row[]

  // Chi risponde da un altro indirizzo resta nello stesso thread della nostra email.
  const threadOwner = new Map<string, string>()
  for (const row of rows) {
    if (row.direction === 'out' && row.channel_account_id) threadOwner.set(row.channel_account_id, row.contact_id)
  }
  const threads = [...threadOwner.keys()]
  if (threads.length) {
    const { data: others } = await supabaseAdmin
      .from('social_messages')
      .select('contact_id, channel_account_id, direction, created_at')
      .eq('platform', 'email')
      .eq('direction', 'in')
      .in('channel_account_id', threads)
      .limit(2000)
    for (const row of (others || []) as Row[]) {
      const owner = row.channel_account_id ? threadOwner.get(row.channel_account_id) : undefined
      if (owner && owner !== row.contact_id) rows.push({ ...row, contact_id: owner })
    }
  }

  const latest = new Map<string, Row>()
  const firstOut = new Map<string, string>()
  for (const row of rows) {
    const current = latest.get(row.contact_id)
    if (!current || row.created_at > current.created_at) latest.set(row.contact_id, row)
    if (row.direction === 'out') {
      const first = firstOut.get(row.contact_id)
      if (!first || row.created_at < first) firstOut.set(row.contact_id, row.created_at)
    }
  }

  let changed = 0
  for (const lead of leads) {
    const email = String(lead.email).toLowerCase()
    const last = latest.get(email)
    if (!last) continue
    // Ci ha scritto lui per primo senza nostra email: non e' un contatto della ricerca.
    if (!firstOut.has(email) && !lead.contacted_at) continue
    const status = last.direction === 'in' ? 'replied' : 'contacted'
    if (status === lead.status) continue
    const update: Record<string, string> = { status }
    if (!lead.contacted_at && firstOut.get(email)) update.contacted_at = firstOut.get(email)!
    const { error } = await supabaseAdmin.from('leads').update(update).eq('id', lead.id).in('status', AUTO_STATUSES)
    if (!error) changed++
  }
  return changed
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAdminEmail } from '@/lib/admin-request'
import { deliver, setOrigin, type SocialPlatform } from '@/lib/meta/agent'
import { resolveKey, type Member } from '@/lib/meta/identities'
import { isHidden, loadHidden } from '@/lib/inbox-hidden'

export const dynamic = 'force-dynamic'

const PLATFORMS = ['whatsapp', 'facebook', 'instagram', 'email', 'web']
const SELECT =
  'id, platform, contact_id, kind, direction, body, status, error_message, contact_name, reply_to, created_at'

async function readMembers(req: NextRequest): Promise<Member[]> {
  const key = req.nextUrl.searchParams.get('c') || ''
  const members = key ? await resolveKey(key) : []
  return members.filter((m) => PLATFORMS.includes(m.platform) && m.contactId)
}

function membersFilter(members: Member[]) {
  return members.map((m) => `and(platform.eq.${m.platform},contact_id.eq.${m.contactId})`).join(',')
}

/** Messaggi della conversazione (tutti i canali della persona); segna come letti quelli in arrivo. */
export async function GET(req: NextRequest) {
  if (!(await getAdminEmail(req))) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }
  const members = await readMembers(req)
  if (!members.length) return NextResponse.json({ error: 'Conversazione non trovata' }, { status: 404 })

  const { data, error } = await supabaseAdmin
    .from('social_messages')
    .select(SELECT)
    .or(membersFilter(members))
    .order('created_at', { ascending: true })
    .limit(800)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabaseAdmin
    .from('social_messages')
    .update({ read_at: new Date().toISOString() })
    .or(membersFilter(members))
    .eq('direction', 'in')
    .is('read_at', null)

  // Dopo un'eliminazione dalla casella si vedono solo i messaggi nuovi (come su WhatsApp).
  const hidden = await loadHidden()
  const visible = (data || []).filter((m) => !isHidden(hidden, m.platform, m.contact_id, m.created_at))

  return NextResponse.json({ messages: visible, members })
}

/** Risposta scritta a mano. body: { text, platform? } — senza platform si usa l'ultimo canale privato usato. */
export async function POST(req: NextRequest) {
  if (!(await getAdminEmail(req))) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }
  const members = await readMembers(req)
  if (!members.length) return NextResponse.json({ error: 'Conversazione non trovata' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const text = String(body?.text || '').trim().slice(0, 10000)
  if (!text) return NextResponse.json({ error: 'Scrivi un messaggio' }, { status: 400 })

  const candidates = body?.platform ? members.filter((m) => m.platform === body.platform) : members

  const { data: last } = candidates.length
    ? await supabaseAdmin
        .from('social_messages')
        .select('platform, contact_id, channel_account_id, contact_name')
        .or(membersFilter(candidates))
        .eq('direction', 'in')
        .eq('kind', 'message')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null }

  if (!last) {
    return NextResponse.json(
      { error: 'Su questo canale il contatto non ti ha mai scritto in privato: puoi rispondere solo ai suoi commenti.' },
      { status: 400 }
    )
  }

  if (last.platform !== 'email' && text.length > 1900) {
    return NextResponse.json({ error: 'Messaggio troppo lungo (massimo 1900 caratteri)' }, { status: 400 })
  }

  const target = {
    platform: last.platform as SocialPlatform,
    kind: 'message' as const,
    contact_id: last.contact_id,
    channel_account_id: last.channel_account_id,
    reply_to: null,
  }
  const sent = await deliver(target, text)

  const { data: row, error } = await supabaseAdmin
    .from('social_messages')
    .insert({
      ...target,
      contact_name: last.contact_name,
      direction: 'out',
      external_id: sent.id ?? null,
      body: text,
      status: sent.error ? 'failed' : 'sent',
      error_message: sent.error ?? null,
    })
    .select(SELECT)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!sent.error) await setOrigin(row.id, 'manual')
  if (sent.error) return NextResponse.json({ error: `Invio non riuscito: ${sent.error}`, message: row }, { status: 502 })
  return NextResponse.json({ message: row })
}

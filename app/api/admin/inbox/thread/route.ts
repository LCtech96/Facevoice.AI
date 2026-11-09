import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { guard } from '@/lib/staff-access'
import { deliver, setOrigin, type SocialPlatform } from '@/lib/meta/agent'
import { resolveKey, type Member } from '@/lib/meta/identities'
import { isHidden, loadHidden } from '@/lib/inbox-hidden'
import { sendWhatsAppMediaReply } from '@/lib/wa-media'
import { WaError } from '@/lib/wa-store'

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
  const access = await guard(req, 'inbox', 'view')
  if (access instanceof NextResponse) return access
  const members = await readMembers(req)
  if (!members.length) return NextResponse.json({ error: 'Conversazione non trovata' }, { status: 404 })

  // origin: i messaggi scritti a mano dall'app di Instagram/Facebook si vedono come "dall'app".
  const read = (columns: string) =>
    supabaseAdmin.from('social_messages').select(columns).or(membersFilter(members)).order('created_at', { ascending: true }).limit(800)
  let { data, error } = await read(`${SELECT}, origin`)
  // Senza la colonna origin (migrazione non eseguita) la conversazione si vede lo stesso.
  if (error) ({ data, error } = await read(SELECT))

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabaseAdmin
    .from('social_messages')
    .update({ read_at: new Date().toISOString() })
    .or(membersFilter(members))
    .eq('direction', 'in')
    .is('read_at', null)

  // Dopo un'eliminazione dalla casella si vedono solo i messaggi nuovi (come su WhatsApp).
  const hidden = await loadHidden()
  const rows = (data || []) as unknown as { platform: string; contact_id: string; created_at: string }[]
  const visible = rows.filter((m) => !isHidden(hidden, m.platform, m.contact_id, m.created_at))

  return NextResponse.json({ messages: visible, members })
}

/** Risposta scritta a mano. body: { text, platform? } — senza platform si usa l'ultimo canale privato usato. */
export async function POST(req: NextRequest) {
  const access = await guard(req, 'inbox', 'reply')
  if (access instanceof NextResponse) return access
  const members = await readMembers(req)
  if (!members.length) return NextResponse.json({ error: 'Conversazione non trovata' }, { status: 404 })

  const body = await req.json().catch(() => ({}))

  // Foto o video su WhatsApp (caricato prima con /api/admin/inbox/media): solo entro le 24 ore.
  if (body?.media) {
    const wa = members.find((m) => m.platform === 'whatsapp')
    if (!wa) return NextResponse.json({ error: 'Foto e video si possono mandare solo nelle conversazioni WhatsApp.' }, { status: 400 })
    try {
      const res = await sendWhatsAppMediaReply({ contactId: wa.contactId, url: String(body.media?.url || ''), caption: typeof body.text === 'string' ? body.text : '' })
      if (res.error) return NextResponse.json({ error: `Invio non riuscito: ${res.error}`, message: res.message }, { status: 502 })
      return NextResponse.json({ message: res.message })
    } catch (error) {
      if (error instanceof WaError) return NextResponse.json({ error: error.message }, { status: error.status })
      console.error('casella, foto/video WhatsApp:', error)
      return NextResponse.json({ error: 'Invio non riuscito: riprova.' }, { status: 500 })
    }
  }

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

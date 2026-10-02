import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAdminEmail } from '@/lib/admin-request'
import { deliver, type SocialPlatform } from '@/lib/meta/agent'

export const dynamic = 'force-dynamic'

const PLATFORMS = ['whatsapp', 'facebook', 'instagram']

function readParams(req: NextRequest) {
  const platform = req.nextUrl.searchParams.get('platform') || ''
  const contact = req.nextUrl.searchParams.get('contact') || ''
  return PLATFORMS.includes(platform) && contact ? { platform, contact } : null
}

/** Messaggi di una conversazione; segna come letti quelli in arrivo. */
export async function GET(req: NextRequest) {
  if (!(await getAdminEmail(req))) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }
  const p = readParams(req)
  if (!p) return NextResponse.json({ error: 'Parametri mancanti' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('social_messages')
    .select('id, kind, direction, body, status, error_message, contact_name, reply_to, created_at')
    .eq('platform', p.platform)
    .eq('contact_id', p.contact)
    .order('created_at', { ascending: true })
    .limit(500)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabaseAdmin
    .from('social_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('platform', p.platform)
    .eq('contact_id', p.contact)
    .eq('direction', 'in')
    .is('read_at', null)

  return NextResponse.json({ messages: data || [] })
}

/** Risposta scritta a mano dall'admin (messaggio privato). */
export async function POST(req: NextRequest) {
  if (!(await getAdminEmail(req))) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }
  const p = readParams(req)
  if (!p) return NextResponse.json({ error: 'Parametri mancanti' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const text = String(body?.text || '').trim().slice(0, 1900)
  if (!text) return NextResponse.json({ error: 'Scrivi un messaggio' }, { status: 400 })

  // Il numero/Pagina da cui rispondere e' quello che ha ricevuto l'ultimo messaggio privato.
  const { data: last } = await supabaseAdmin
    .from('social_messages')
    .select('channel_account_id, contact_name')
    .eq('platform', p.platform)
    .eq('contact_id', p.contact)
    .eq('direction', 'in')
    .eq('kind', 'message')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!last) {
    return NextResponse.json(
      { error: 'Questo contatto non ti ha mai scritto in privato: si può rispondere solo ai commenti.' },
      { status: 400 }
    )
  }

  const target = {
    platform: p.platform as SocialPlatform,
    kind: 'message' as const,
    contact_id: p.contact,
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
    .select('id, kind, direction, body, status, error_message, contact_name, reply_to, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (sent.error) return NextResponse.json({ error: `Invio non riuscito: ${sent.error}`, message: row }, { status: 502 })
  return NextResponse.json({ message: row })
}

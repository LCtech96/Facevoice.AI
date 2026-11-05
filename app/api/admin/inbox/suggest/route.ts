import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { guard } from '@/lib/staff-access'
import { prepareInboxReply, type SocialPlatform } from '@/lib/meta/agent'
import { resolveKey } from '@/lib/meta/identities'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Bozza AI a richiesta (pulsante ✨ della casella Messaggi): l'AI prepara la risposta
// per l'ultimo canale privato della conversazione (o quello scelto) e la lascia in
// bozza da approvare, al posto di eventuali bozze vecchie dello stesso contatto.

const PLATFORMS = ['whatsapp', 'facebook', 'instagram', 'email', 'web']

export async function POST(req: NextRequest) {
  const access = await guard(req, 'inbox', 'reply')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  const key = String(body?.c || '')
  const members = (key ? await resolveKey(key) : []).filter((m) => PLATFORMS.includes(m.platform) && m.contactId)
  if (!members.length) return NextResponse.json({ error: 'Conversazione non trovata' }, { status: 404 })
  const candidates = body?.platform ? members.filter((m) => m.platform === body.platform) : members
  if (!candidates.length) return NextResponse.json({ error: 'Canale non trovato in questa conversazione' }, { status: 400 })

  const { data: last } = await supabaseAdmin
    .from('social_messages')
    .select('platform, contact_id')
    .or(candidates.map((m) => `and(platform.eq.${m.platform},contact_id.eq.${m.contactId})`).join(','))
    .eq('direction', 'in')
    .eq('kind', 'message')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const target = last ? { platform: last.platform as string, contactId: last.contact_id as string } : candidates[0]

  const result = await prepareInboxReply(target.platform as SocialPlatform, target.contactId, typeof body?.instructions === 'string' ? body.instructions.slice(0, 500) : undefined)
  if (!result.ok) return NextResponse.json({ error: result.reason || 'Bozza non preparata, riprova' }, { status: 400 })
  return NextResponse.json({ ok: true, warning: result.warning || null })
}

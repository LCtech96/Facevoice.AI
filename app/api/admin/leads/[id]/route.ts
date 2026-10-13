import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { canAccess, guard } from '@/lib/staff-access'
import { LEAD_STATUSES } from '@/lib/leads'
import { setCalled, withCalls } from '@/lib/lead-calls'

export const dynamic = 'force-dynamic'

const TEXT_FIELDS = ['notes', 'email', 'email_subject', 'email_body', 'dm_text', 'instagram', 'facebook', 'phone'] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard(req, 'leads', 'view')
  if (access instanceof NextResponse) return access
  const { id } = await params
  const body = await req.json().catch(() => ({}))

  // Permessi per tipo di modifica: chiamate, stato e note da una parte; contatti ed email dall'altra.
  const touches = (fields: string[]) => fields.some((f) => body?.[f] !== undefined)
  if (touches(['called', 'status', 'notes']) && !canAccess(access, 'leads', 'calls')) {
    return NextResponse.json({ error: 'Non hai il permesso di segnare chiamate, stato o note.' }, { status: 403 })
  }
  if (touches(['email', 'email_subject', 'email_body', 'dm_text', 'instagram', 'facebook', 'phone']) && !canAccess(access, 'leads', 'email')) {
    return NextResponse.json({ error: 'Non hai il permesso di modificare contatti ed email.' }, { status: 403 })
  }

  const updates: Record<string, unknown> = {}
  for (const field of TEXT_FIELDS) {
    if (typeof body?.[field] === 'string') updates[field] = body[field].trim() || null
  }
  if (typeof updates.email === 'string') updates.email = (updates.email as string).toLowerCase()
  if (typeof body?.status === 'string') {
    if (!(LEAD_STATUSES as readonly string[]).includes(body.status)) {
      return NextResponse.json({ error: 'Stato non valido' }, { status: 400 })
    }
    updates.status = body.status
  }
  const calling = typeof body?.called === 'boolean'
  if (!Object.keys(updates).length && !calling) return NextResponse.json({ error: 'Nessuna modifica' }, { status: 400 })

  const { data, error } = Object.keys(updates).length
    ? await supabaseAdmin.from('leads').update(updates).eq('id', id).select('*').maybeSingle()
    : await supabaseAdmin.from('leads').select('*').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Contatto non trovato' }, { status: 404 })
  // Casella "Chiamato": telefonata fatta o da fare.
  if (calling) await setCalled(id, body.called)
  const [lead] = await withCalls([data])
  return NextResponse.json({ lead })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Eliminare schede fa parte della gestione delle ricerche.
  const access = await guard(req, 'leads', 'search')
  if (access instanceof NextResponse) return access
  const { id } = await params
  await supabaseAdmin.from('leads').delete().eq('id', id)
  await setCalled(id, false).catch(() => undefined)
  return NextResponse.json({ success: true })
}

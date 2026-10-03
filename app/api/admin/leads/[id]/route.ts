import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAdminEmail } from '@/lib/admin-request'
import { LEAD_STATUSES } from '@/lib/leads'

export const dynamic = 'force-dynamic'

const TEXT_FIELDS = ['notes', 'email', 'email_subject', 'email_body', 'dm_text', 'instagram', 'facebook', 'phone'] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getAdminEmail(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))

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
  if (!Object.keys(updates).length) return NextResponse.json({ error: 'Nessuna modifica' }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('leads').update(updates).eq('id', id).select('*').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Contatto non trovato' }, { status: 404 })
  return NextResponse.json({ lead: data })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getAdminEmail(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const { id } = await params
  await supabaseAdmin.from('leads').delete().eq('id', id)
  return NextResponse.json({ success: true })
}

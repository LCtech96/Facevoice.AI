import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { guard } from '@/lib/staff-access'
import { withCalls } from '@/lib/lead-calls'
import { cleanContact } from '@/lib/contacts'

export const dynamic = 'force-dynamic'

/** Modifica i dati di un contatto (nome, telefono, email, sito, indirizzo, social, note). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard(req, 'contacts', 'edit')
  if (access instanceof NextResponse) return access
  const { id } = await params
  const updates = cleanContact((await req.json().catch(() => ({}))) || {})
  if ('name' in updates && !updates.name) return NextResponse.json({ error: 'Il nome non può essere vuoto' }, { status: 400 })
  if (!Object.keys(updates).length) return NextResponse.json({ error: 'Nessuna modifica' }, { status: 400 })
  const { data, error } = await supabaseAdmin.from('leads').update(updates).eq('id', id).select('*').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Contatto non trovato' }, { status: 404 })
  const [contact] = await withCalls([data])
  return NextResponse.json({ contact })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard(req, 'contacts', 'edit')
  if (access instanceof NextResponse) return access
  const { id } = await params
  await supabaseAdmin.from('leads').delete().eq('id', id)
  return NextResponse.json({ success: true })
}

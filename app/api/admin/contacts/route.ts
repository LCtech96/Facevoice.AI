import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { guard } from '@/lib/staff-access'
import { withCalls } from '@/lib/lead-calls'
import { SOURCE_MANUAL, addContact } from '@/lib/contacts'

export const dynamic = 'force-dynamic'

/** Rubrica: tutti i contatti (ricerche, inseriti a mano, super chat), dal piu' recente. */
export async function GET(req: NextRequest) {
  const access = await guard(req, 'contacts', 'view')
  if (access instanceof NextResponse) return access
  const rows: Record<string, unknown>[] = []
  // A blocchi: Supabase restituisce al massimo 1000 righe per richiesta.
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })
      .range(from, from + 999)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return NextResponse.json({ contacts: await withCalls(rows as { id: string }[]) })
}

/** Nuovo contatto inserito a mano. body: { name, phone, email, website, address, instagram, facebook, notes } */
export async function POST(req: NextRequest) {
  const access = await guard(req, 'contacts', 'edit')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  try {
    const result = await addContact(body || {}, SOURCE_MANUAL)
    const [lead] = await withCalls([result.lead])
    return NextResponse.json({ contact: lead, created: result.created })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Contatto non salvato' }, { status: 400 })
  }
}

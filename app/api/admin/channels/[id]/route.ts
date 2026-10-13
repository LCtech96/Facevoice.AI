import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { canAccess, getStaffAccess } from '@/lib/staff-access'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key')


// Admin, oppure dipendente con il permesso su "Canali e AI" (vedere / modificare).
const isAdminRequest = async (req: NextRequest, cap: 'view' | 'edit' = 'edit') =>
  canAccess(await getStaffAccess(req), 'control', cap)

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await isAdminRequest(req))) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
    }

    const { id } = await params
    const body = await req.json()

    const updates: Record<string, unknown> = {}
    if (typeof body?.display_name === 'string') {
      updates.display_name = body.display_name.trim() || null
    }
    if (typeof body?.handle === 'string') {
      updates.handle = body.handle.trim() || null
    }
    if (typeof body?.status === 'string') {
      if (!['not_connected', 'in_progress', 'connected', 'error'].includes(body.status)) {
        return NextResponse.json({ error: 'Stato non valido' }, { status: 400 })
      }
      updates.status = body.status
    }
    if (body?.reply_mode === 'auto' || body?.reply_mode === 'approval') {
      updates.reply_mode = body.reply_mode
    }
    if (typeof body?.notes === 'string') {
      updates.notes = body.notes.trim() || null
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nessuna modifica richiesta' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('social_channels')
      .update(updates)
      .eq('id', id)
      .select()
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'Canale non trovato' }, { status: 404 })
    }

    return NextResponse.json({ channel: data })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Errore nell\'aggiornamento del canale' },
      { status: 500 }
    )
  }
}

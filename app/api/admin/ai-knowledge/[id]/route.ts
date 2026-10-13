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
    if (typeof body?.title === 'string' && body.title.trim()) {
      updates.title = body.title.trim()
    }
    if (typeof body?.content === 'string' && body.content.trim()) {
      updates.content = body.content.trim()
    }
    if ('category' in (body || {})) {
      updates.category = body.category?.trim() || null
    }
    if (typeof body?.is_active === 'boolean') {
      updates.is_active = body.is_active
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nessuna modifica richiesta' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('ai_knowledge')
      .update(updates)
      .eq('id', id)
      .select()
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'Voce non trovata' }, { status: 404 })
    }

    return NextResponse.json({ item: data })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Errore nell\'aggiornamento' },
      { status: 500 }
    )
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await isAdminRequest(req))) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
    }

    const { id } = await params
    const { error } = await supabaseAdmin
      .from('ai_knowledge')
      .delete()
      .eq('id', id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Errore nell\'eliminazione' },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { canAccess, getStaffAccess } from '@/lib/staff-access'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key')


// Admin, oppure dipendente con il permesso su "Canali e AI" (vedere / modificare).
const isAdminRequest = async (req: NextRequest, cap: 'view' | 'edit' = 'edit') =>
  canAccess(await getStaffAccess(req), 'control', cap)

/**
 * Stato di avanzamento dei canali social, non un'integrazione vera.
 * Niente credenziali qui: solo a che punto e' la richiesta di accesso
 * presso ogni piattaforma, per tenerne traccia senza un foglio a parte.
 */
export async function GET(req: NextRequest) {
  try {
    if (!(await isAdminRequest(req, 'view'))) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
    }

    const { data, error } = await supabaseAdmin
      .from('social_channels')
      .select('*')
      .order('platform', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ channels: data || [] })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Errore nel recuperare i canali' },
      { status: 500 }
    )
  }
}

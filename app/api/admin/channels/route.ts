import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isAdminEmail } from '@/lib/admin-auth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key')

const supabaseAuth = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key')

const isAdminRequest = async (req: NextRequest) => {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return false
  const token = authHeader.replace('Bearer ', '')
  const { data } = await supabaseAuth.auth.getUser(token)
  return isAdminEmail(data.user?.email)
}

/**
 * Stato di avanzamento dei canali social, non un'integrazione vera.
 * Niente credenziali qui: solo a che punto e' la richiesta di accesso
 * presso ogni piattaforma, per tenerne traccia senza un foglio a parte.
 */
export async function GET(req: NextRequest) {
  try {
    if (!(await isAdminRequest(req))) {
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

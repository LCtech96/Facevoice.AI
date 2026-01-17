import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const supabaseAuth = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const getUserEmail = async (req: NextRequest) => {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return null
  const token = authHeader.replace('Bearer ', '')
  const { data } = await supabaseAuth.auth.getUser(token)
  return data.user?.email?.toLowerCase() || null
}

export async function GET(req: NextRequest) {
  try {
    const email = await getUserEmail(req)
    if (!email) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
    }

    const { data: shares } = await supabaseAdmin
      .from('payment_shares')
      .select('payment_id')
      .eq('shared_with_email', email)

    const sharedIds = (shares || []).map((s: any) => s.payment_id).filter(Boolean)

    let query = supabaseAdmin
      .from('payments')
      .select('*')
      .order('due_date', { ascending: true })

    if (sharedIds.length > 0) {
      query = query.or(`collaborator_email.eq.${email},id.in.(${sharedIds.join(',')})`)
    } else {
      query = query.eq('collaborator_email', email)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ payments: data || [] })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Errore nel recuperare i pagamenti' },
      { status: 500 }
    )
  }
}

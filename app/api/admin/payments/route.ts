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

const isAdminRequest = async (req: NextRequest) => {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return false
  const token = authHeader.replace('Bearer ', '')
  const { data } = await supabaseAuth.auth.getUser(token)
  return data.user?.email === 'luca@facevoice.ai'
}

export async function GET(req: NextRequest) {
  try {
    if (!(await isAdminRequest(req))) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
    }

    const { data, error } = await supabaseAdmin
      .from('payments')
      .select('*')
      .order('due_date', { ascending: true })

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

export async function POST(req: NextRequest) {
  try {
    if (!(await isAdminRequest(req))) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
    }

    const body = await req.json()
    const {
      collaborator_name,
      collaborator_email,
      amount,
      note,
      entry_date,
      entry_time,
      due_date,
      currency = 'EUR',
    } = body

    if (!collaborator_email || !amount || !entry_date || !entry_time || !due_date) {
      return NextResponse.json(
        { error: 'Email, importo, data, ora e scadenza sono obbligatori' },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('payments')
      .insert({
        collaborator_name: collaborator_name?.trim() || null,
        collaborator_email: collaborator_email.trim().toLowerCase(),
        amount,
        currency,
        note: note?.trim() || null,
        entry_date,
        entry_time,
        due_date,
        created_by: 'luca@facevoice.ai',
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ payment: data })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Errore nel creare il pagamento' },
      { status: 500 }
    )
  }
}

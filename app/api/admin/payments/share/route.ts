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

export async function POST(req: NextRequest) {
  try {
    if (!(await isAdminRequest(req))) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
    }

    const { payment_id, shared_with_email } = await req.json()

    if (!payment_id || !shared_with_email) {
      return NextResponse.json(
        { error: 'Pagamento ed email sono obbligatori' },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('payment_shares')
      .insert({
        payment_id,
        shared_with_email: shared_with_email.trim().toLowerCase(),
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Invia email di notifica (se configurato)
    const RESEND_API_KEY = process.env.RESEND_API_KEY
    const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL

    if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
      return NextResponse.json({
        share: data,
        warning: 'RESEND_FROM_EMAIL o RESEND_API_KEY non configurato. Email non inviata.',
      })
    }

    const { data: payment } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('id', payment_id)
      .single()

    const amountText = payment?.amount ? `${Number(payment.amount).toFixed(2)} ${payment.currency || 'EUR'}` : ''
    const subject = 'Nuovo pagamento condiviso su FacevoiceAI'
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2>Pagamento condiviso</h2>
        <p>Hai un nuovo pagamento disponibile su FacevoiceAI.</p>
        <ul>
          <li><strong>Collaboratore:</strong> ${payment?.collaborator_name || payment?.collaborator_email || ''}</li>
          <li><strong>Cliente:</strong> ${payment?.client_name || '-'}</li>
          <li><strong>Vendita:</strong> ${payment?.sale_reference || '-'}</li>
          <li><strong>Importo:</strong> ${amountText}</li>
          <li><strong>Scadenza:</strong> ${payment?.due_date || '-'}</li>
        </ul>
        <p>Accedi alla tua area pagamenti qui:</p>
        <p><a href="https://www.facevoice.ai/payments">https://www.facevoice.ai/payments</a></p>
      </div>
    `

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `FacevoiceAI <${RESEND_FROM_EMAIL}>`,
        to: shared_with_email.trim().toLowerCase(),
        subject,
        html,
      }),
    })

    return NextResponse.json({ share: data })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Errore nella condivisione' },
      { status: 500 }
    )
  }
}

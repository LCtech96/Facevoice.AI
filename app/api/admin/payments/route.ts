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
      client_name,
      sale_reference,
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
        client_name: client_name?.trim() || null,
        sale_reference: sale_reference?.trim() || null,
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

    // Invia email al collaboratore e all'admin
    const RESEND_API_KEY = process.env.RESEND_API_KEY
    const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL

    if (RESEND_API_KEY && RESEND_FROM_EMAIL) {
      const amountText = `${Number(amount).toFixed(2)} ${currency}`
      const formattedDate = new Date(entry_date).toLocaleDateString('it-IT')
      const formattedDueDate = new Date(due_date).toLocaleDateString('it-IT')
      
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">Nuovo Pagamento Registrato</h2>
          <p>Ciao,</p>
          <p>È stato registrato un nuovo pagamento su FacevoiceAI:</p>
          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Collaboratore:</strong> ${collaborator_name || collaborator_email}</p>
            ${client_name ? `<p><strong>Cliente:</strong> ${client_name}</p>` : ''}
            ${sale_reference ? `<p><strong>Vendita:</strong> ${sale_reference}</p>` : ''}
            <p><strong>Importo:</strong> ${amountText}</p>
            <p><strong>Data:</strong> ${formattedDate} alle ${entry_time}</p>
            <p><strong>Scadenza:</strong> ${formattedDueDate}</p>
            ${note ? `<p><strong>Note:</strong> ${note}</p>` : ''}
          </div>
          <p>Puoi visualizzare tutti i tuoi pagamenti accedendo alla tua area personale.</p>
        </div>
      `

      // Email al collaboratore
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: `FacevoiceAI <${RESEND_FROM_EMAIL}>`,
            to: collaborator_email.trim().toLowerCase(),
            subject: `Nuovo pagamento registrato - ${amountText}`,
            html: emailHtml,
          }),
        })
      } catch (emailError) {
        console.error('Error sending email to collaborator:', emailError)
      }

      // Email all'admin (luca@facevoice.ai)
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: `FacevoiceAI <${RESEND_FROM_EMAIL}>`,
            to: 'luca@facevoice.ai',
            subject: `Nuovo pagamento registrato per ${collaborator_email} - ${amountText}`,
            html: emailHtml,
          }),
        })
      } catch (emailError) {
        console.error('Error sending email to admin:', emailError)
      }
    }

    return NextResponse.json({ payment: data })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Errore nel creare il pagamento' },
      { status: 500 }
    )
  }
}

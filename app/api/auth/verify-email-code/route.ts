import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getOTP, deleteOTP } from '../send-otp/route'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { email, code } = await req.json()

    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Indirizzo email non valido' },
        { status: 400 }
      )
    }

    if (!code || code.length !== 6) {
      return NextResponse.json(
        { error: 'Codice non valido' },
        { status: 400 }
      )
    }

    // Verifica il codice OTP
    const storedOTP = getOTP(email)
    
    if (!storedOTP) {
      return NextResponse.json(
        { error: 'Codice non valido o scaduto. Richiedi un nuovo codice.' },
        { status: 400 }
      )
    }

    if (storedOTP.code !== code) {
      return NextResponse.json(
        { error: 'Codice non valido' },
        { status: 400 }
      )
    }

    // Codice valido! Trova l'utente e conferma l'email
    try {
      // Cerca l'utente per email
      const { data: usersList, error: listError } = await supabaseAdmin.auth.admin.listUsers()
      
      if (listError) {
        throw listError
      }

      const user = usersList?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase())
      
      if (!user) {
        return NextResponse.json(
          { error: 'Utente non trovato. Completa prima la registrazione.' },
          { status: 404 }
        )
      }

      // Conferma l'email dell'utente
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
        email_confirm: true,
        user_metadata: {
          ...user.user_metadata,
          email_verified_at: new Date().toISOString(),
        },
      })

      if (updateError) {
        throw updateError
      }

      // Rimuovi il codice OTP dopo l'uso
      deleteOTP(email)

      return NextResponse.json({
        success: true,
        message: 'Email verificata con successo! Ora puoi accedere.',
        user: {
          id: user.id,
          email: user.email,
        },
      })
    } catch (authError: any) {
      console.error('Auth error:', authError)
      throw authError
    }
  } catch (error: any) {
    console.error('Error in verify-email-code:', error)
    return NextResponse.json(
      { error: error.message || 'Errore nella verifica del codice' },
      { status: 500 }
    )
  }
}


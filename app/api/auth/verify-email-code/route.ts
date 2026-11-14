import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getOTP, deleteOTP, failOTP } from '../send-otp/route'
import { getRegistration, deleteRegistration } from '../store-registration/route'

// Crea il client admin solo se la chiave è disponibile
const getSupabaseAdmin = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY non configurata')
  }

  return createClient(supabaseUrl, serviceRoleKey)
}

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

    if (storedOTP.code !== String(code)) {
      failOTP(email)
      return NextResponse.json(
        { error: 'Codice non valido' },
        { status: 400 }
      )
    }

    // Codice valido! Crea l'utente con email confermata
    try {
      const supabaseAdmin = getSupabaseAdmin()
      
      // Recupera email e password dalla registrazione temporanea
      const registration = getRegistration(email)
      
      if (!registration) {
        return NextResponse.json(
          { error: 'Registrazione non trovata o scaduta. Riprova la registrazione.' },
          { status: 404 }
        )
      }

      // Solo account nuovi: un account gia' esistente NON cambia password da qui (prima bastava
      // il codice per sovrascriverla). Chi e' gia' registrato accede o usa «Password dimenticata».
      const { data: newUserData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: registration.email,
        password: registration.password,
        email_confirm: true, // Email già verificata via OTP
        user_metadata: {
          email_verified_at: new Date().toISOString(),
          verified_via: 'otp',
        },
      })

      if (createError) {
        if (/already|registered|exists/i.test(createError.message)) {
          deleteOTP(email)
          deleteRegistration(email)
          return NextResponse.json(
            { error: 'Questa email è già registrata: accedi oppure usa «Password dimenticata».' },
            { status: 409 }
          )
        }
        throw createError
      }

      const user = newUserData.user

      // Rimuovi il codice OTP e la registrazione dopo l'uso
      deleteOTP(email)
      deleteRegistration(email)

      return NextResponse.json({
        success: true,
        message: 'Email verificata con successo! Ora puoi accedere.',
        user: {
          id: user.id,
          email: user.email,
        },
        password: registration.password, // Restituisci la password per il signIn
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


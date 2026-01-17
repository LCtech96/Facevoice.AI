import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getOTP, deleteOTP } from '../send-otp/route'
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

    if (storedOTP.code !== code) {
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

      // Verifica se l'utente esiste già
      const { data: usersList, error: listError } = await supabaseAdmin.auth.admin.listUsers()
      
      if (listError) {
        throw listError
      }

      let user = usersList?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase())
      
      if (!user) {
        // Crea un nuovo utente con email già confermata
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
          throw createError
        }

        user = newUserData.user
      } else {
        // Utente esiste già, aggiorna password e conferma email
        const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
          password: registration.password,
          email_confirm: true,
          user_metadata: {
            ...user.user_metadata,
            email_verified_at: new Date().toISOString(),
            verified_via: 'otp',
          },
        })

        if (updateError) {
          throw updateError
        }
      }

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


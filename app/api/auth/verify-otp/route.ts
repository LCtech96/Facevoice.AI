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

    // Codice valido! Crea o aggiorna l'utente in Supabase
    try {
      let user
      
      // Prova prima a creare un nuovo utente
      const { data: newUserData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true, // Conferma automaticamente l'email
        user_metadata: {
          verified_via: 'otp',
          verified_at: new Date().toISOString(),
        },
      })

      if (createError) {
        // Se l'errore indica che l'utente esiste già, cerca l'utente con listUsers
        if (createError.message?.includes('already registered') || createError.message?.includes('already exists')) {
          // Cerca l'utente esistente usando listUsers
          const { data: usersList, error: listError } = await supabaseAdmin.auth.admin.listUsers()
          
          if (listError) {
            throw listError
          }

          // Trova l'utente per email
          const existingUser = usersList?.users?.find(u => u.email === email.toLowerCase())
          
          if (existingUser) {
            user = existingUser
            
            // Aggiorna i metadati
            const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
              user_metadata: {
                ...user.user_metadata,
                verified_via: 'otp',
                last_verified_at: new Date().toISOString(),
              },
            })

            if (updateError) {
              console.warn('Error updating user metadata:', updateError)
            }
          } else {
            throw new Error('Utente non trovato dopo errore di creazione')
          }
        } else {
          throw createError
        }
      } else {
        // Utente creato con successo
        user = newUserData.user
      }

      // Genera una password temporanea per l'utente (solo per sviluppo)
      // Nota: in produzione, usa sempre magic link
      const tempPassword = process.env.NODE_ENV === 'development' 
        ? `temp_${Math.random().toString(36).slice(2)}_${Date.now()}`
        : undefined
      
      // Se in sviluppo, aggiorna la password temporanea per permettere il login
      if (tempPassword && user) {
        await supabaseAdmin.auth.admin.updateUserById(user.id, {
          password: tempPassword,
        }).catch((err) => {
          console.warn('Error setting temp password:', err)
        })
      }

      // Crea una sessione usando la password temporanea
      // Il client dovrà fare signInWithPassword con questa password
      // Per sicurezza, restituiamo solo un token che il client può usare
      
      // Alternativa: genera un magic link
      const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: {
          redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/auth/callback`,
        },
      })

      if (linkError) {
        // Fallback: restituisci la password temporanea (solo per sviluppo)
        // In produzione, usa sempre magic link
        console.warn('Magic link error, using temp password (dev only):', linkError)
        
        // Rimuovi il codice OTP dopo l'uso
        deleteOTP(email)

        return NextResponse.json({
          success: true,
          message: 'Verifica completata',
          user: {
            id: user.id,
            email: user.email,
          },
          tempPassword: process.env.NODE_ENV === 'development' ? tempPassword : undefined,
          // In produzione, non restituire mai la password
        })
      }

      // Rimuovi il codice OTP dopo l'uso
      deleteOTP(email)

      // Estrai il token dal link
      const magicLink = linkData.properties?.action_link
      const token = magicLink ? new URL(magicLink).searchParams.get('token') : null

      return NextResponse.json({
        success: true,
        message: 'Verifica completata',
        user: {
          id: user.id,
          email: user.email,
        },
        token: token || linkData.properties?.hashed_token,
        magicLink: magicLink,
      })
    } catch (authError: any) {
      console.error('Auth error:', authError)
      throw authError
    }
  } catch (error: any) {
    console.error('Error in verify-otp:', error)
    return NextResponse.json(
      { error: error.message || 'Errore nella verifica del codice' },
      { status: 500 }
    )
  }
}


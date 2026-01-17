import { NextRequest, NextResponse } from 'next/server'

// Store temporaneo per le registrazioni in corso (in produzione usa Redis o database)
const registrationStore = new Map<string, { email: string; password: string; expiresAt: number }>()

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json()

    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Indirizzo email non valido' },
        { status: 400 }
      )
    }

    if (!password || password.length < 6) {
      return NextResponse.json(
        { error: 'La password deve contenere almeno 6 caratteri' },
        { status: 400 }
      )
    }

    // Salva temporaneamente email e password per 15 minuti
    const expiresAt = Date.now() + 15 * 60 * 1000
    registrationStore.set(email.toLowerCase(), {
      email: email.toLowerCase(),
      password,
      expiresAt,
    })

    return NextResponse.json({
      success: true,
      message: 'Registrazione salvata temporaneamente',
    })
  } catch (error: any) {
    console.error('Error in store-registration:', error)
    return NextResponse.json(
      { error: error.message || 'Errore nel salvare la registrazione' },
      { status: 500 }
    )
  }
}

// Funzione helper per recuperare la registrazione
export function getRegistration(email: string): { email: string; password: string } | null {
  const stored = registrationStore.get(email.toLowerCase())
  if (!stored || Date.now() > stored.expiresAt) {
    registrationStore.delete(email.toLowerCase())
    return null
  }
  return { email: stored.email, password: stored.password }
}

// Funzione helper per rimuovere la registrazione dopo l'uso
export function deleteRegistration(email: string) {
  registrationStore.delete(email.toLowerCase())
}

import { NextRequest, NextResponse } from 'next/server'
import { bridgeAuthError } from '@/lib/bridge-auth'
import { TERMS_VERSION } from '@/lib/terms'
import { publishedTerms } from '@/lib/terms-acceptance'

export const dynamic = 'force-dynamic'

// Per il pannello di Facevoice (pagina Utenti, "Vedi i termini accettati"): il testo esatto
// di una versione dei termini e la sua impronta SHA-256. GET ?version=AAAA-MM-GG
// (senza: la versione in vigore). Solo con la chiave del collegamento.

export async function GET(req: NextRequest) {
  const denied = bridgeAuthError(req)
  if (denied) return denied
  const version = req.nextUrl.searchParams.get('version')?.trim() || TERMS_VERSION
  if (version.length > 40 || !/^[0-9A-Za-z._-]+$/.test(version)) {
    return NextResponse.json({ error: 'Versione non valida' }, { status: 400 })
  }
  const terms = publishedTerms(version)
  if (!terms) return NextResponse.json({ error: 'Versione dei termini non trovata' }, { status: 404 })
  return NextResponse.json(
    { version: terms.version, title: terms.title, text: terms.text, hash: terms.hash, items: [terms.items.a, terms.items.b, terms.items.c], current: terms.version === TERMS_VERSION },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}

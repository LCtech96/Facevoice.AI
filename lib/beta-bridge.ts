import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

// Collegamento tra questo sito e la beta (beta.facevoice.ai, database separato).
// I due siti si parlano solo con un segreto condiviso, FACEVOICE_BRIDGE_SECRET,
// mandato nell'intestazione x-bridge-secret. Nessun dato della beta passa di
// qui se non tramite queste chiamate.

export const BRIDGE_HEADER = 'x-bridge-secret'
const TIMEOUT_MS = 15_000

export const betaBaseUrl = () => (process.env.BETA_APP_URL?.trim() || 'https://beta.facevoice.ai').replace(/\/+$/, '')

const bridgeSecret = () => process.env.FACEVOICE_BRIDGE_SECRET?.trim() || ''

/**
 * Per le route che la beta chiama (/api/bridge/*): null se il segreto e' giusto,
 * altrimenti la risposta di errore pronta (503 se manca la variabile, 401 se sbagliato).
 */
export function checkBridgeSecret(req: NextRequest): NextResponse | null {
  const secret = bridgeSecret()
  if (!secret) return NextResponse.json({ error: 'Collegamento non configurato' }, { status: 503 })
  const expected = Buffer.from(secret)
  const given = Buffer.from(req.headers.get(BRIDGE_HEADER) || '')
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }
  return null
}

export class BridgeError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

/**
 * Chiama la beta con il segreto e restituisce il JSON della risposta.
 * Gli errori diventano BridgeError con un messaggio in italiano da mostrare all'admin.
 */
export async function callBeta(path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<unknown> {
  const secret = bridgeSecret()
  if (!secret) {
    throw new BridgeError('Collegamento con la beta non configurato: manca FACEVOICE_BRIDGE_SECRET su questo sito.', 503)
  }

  let res: Response
  try {
    res = await fetch(`${betaBaseUrl()}${path}`, {
      method: init.method || 'GET',
      headers: {
        [BRIDGE_HEADER]: secret,
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    console.error('Beta bridge:', path, error)
    throw new BridgeError(
      timeout ? 'La beta non risponde (oltre 15 secondi): riprova tra poco.' : 'La beta non è raggiungibile in questo momento: riprova tra poco.',
      504
    )
  }

  const data = await res.json().catch(() => null)
  if (res.ok) {
    if (data === null) throw new BridgeError('La beta ha risposto in un formato non valido.', 502)
    return data
  }

  console.error('Beta bridge:', path, res.status, data)
  if (res.status === 401) {
    throw new BridgeError('La beta ha rifiutato il collegamento: FACEVOICE_BRIDGE_SECRET deve essere uguale sui due siti.', 502)
  }
  if (res.status === 503) {
    throw new BridgeError('Sulla beta il collegamento non è configurato: manca FACEVOICE_BRIDGE_SECRET.', 502)
  }
  if (res.status === 404) {
    // Per la scelta del gettone: utente non trovato sulla beta.
    const message = data && typeof data.error === 'string' ? data.error : 'Non trovato sulla beta.'
    throw new BridgeError(message, 404)
  }
  if (res.status === 400) {
    const message = data && typeof data.error === 'string' ? data.error : 'Richiesta non valida.'
    throw new BridgeError(message, 400)
  }
  throw new BridgeError(`La beta ha risposto con un errore (${res.status}): riprova tra poco.`, 502)
}

export function bridgeErrorResponse(error: unknown) {
  if (error instanceof BridgeError) return NextResponse.json({ error: error.message }, { status: error.status })
  console.error('Beta bridge:', error)
  return NextResponse.json({ error: 'Errore nel collegamento con la beta.' }, { status: 500 })
}

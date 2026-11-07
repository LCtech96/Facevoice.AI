import { NextRequest, NextResponse } from 'next/server'
import {
  ContractError,
  INVALID_LINK,
  checkPin,
  clientDevice,
  clientIp,
  contractPdf,
  markSeen,
  openWithSession,
  publicView,
  requestChange,
  sendSignedEmails,
  signContract,
  cookieName,
  tokenHash,
} from '@/lib/saas/contracts'
import { workspaceDb } from '@/lib/workspace-db'

export const dynamic = 'force-dynamic'

// Pagina pubblica del contratto (/c/<token>): senza account, ma solo con il link E il PIN.
// Il token si cerca per hash; link sconosciuto, revocato o di un contratto annullato: sempre
// lo stesso "Link non valido". PIN giusto -> cookie httpOnly, Secure, SameSite=Lax, firmato con
// una chiave del server, valido 2 ore e solo per questo link (path /api/c/<token>). PIN sbagliati
// limitati per link e per indirizzo IP. Il PIN non torna mai indietro e non si scrive nei log.
//   GET                   { pin: true } (serve il PIN) | la pagina del contratto
//   GET ?pdf=1            PDF (bozza con la scritta "BOZZA – non firmato", oppure firmato)
//   POST { op: "pin", pin } | { op: "change", text, section?, versionId } | { op: "sign", ... }

const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
}
const MAX_BODY = 300_000

const json = (body: unknown, status = 200) => {
  const res = NextResponse.json(body, { status })
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v)
  return res
}
const invalid = () => json({ error: INVALID_LINK, code: 'invalid_link' }, 404)

/** Cookie del link dalla richiesta (letto a mano: stesso codice con le richieste vere e quelle delle prove). */
function readCookie(req: NextRequest, name: string): string | null {
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const at = part.indexOf('=')
    if (at > 0 && part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim())
  }
  return null
}

const tokenOf = async (params: Promise<{ token: string }>) => {
  const { token } = await params
  return typeof token === 'string' ? token : ''
}

/** Solo dal nostro sito: una pagina di un altro sito non puo' mandare richieste con il cookie. */
function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true
  try {
    return new URL(origin).host === req.nextUrl.host
  } catch {
    return false
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const token = await tokenOf(params)
  try {
    const opened = await openWithSession(token, readCookie(req, cookieName(tokenHash(token))))
    if (!opened) return invalid()
    // PDF senza sessione (cookie scaduto): si torna al PIN.
    if (opened === 'pin') return req.nextUrl.searchParams.get('pdf') === '1' ? json({ error: 'Scrivi di nuovo il PIN nella pagina del contratto.', code: 'pin' }, 401) : json({ pin: true })
    const contract = opened.contract
    if (req.nextUrl.searchParams.get('pdf') === '1') {
      const file = contractPdf(contract)
      const download = req.nextUrl.searchParams.get('download') === '1'
      const res = new NextResponse(new Uint8Array(file.pdf), {
        status: 200,
        headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${file.filename}"`, 'Content-Length': String(file.pdf.length) },
      })
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v)
      return res
    }
    const view = publicView(contract)
    await markSeen(contract)
    return json({ contract: view })
  } catch (error) {
    if (error instanceof ContractError && error.code === 'no_secret') return json({ error: 'Pagina non disponibile in questo momento.' }, 503)
    console.error('contratti (link):', error instanceof Error ? error.message.slice(0, 200) : 'errore')
    return json({ error: 'Non riuscito, riprova.' }, 500)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const token = await tokenOf(params)
  if (!sameOrigin(req)) return json({ error: 'Richiesta non valida.' }, 403)
  const raw = await req.text().catch(() => '')
  if (raw.length > MAX_BODY) return json({ error: 'Richiesta troppo grande.' }, 413)
  let body: Record<string, unknown> = {}
  try {
    body = (JSON.parse(raw || '{}') as Record<string, unknown>) || {}
  } catch {
    return json({ error: 'Richiesta non valida.' }, 400)
  }
  const ip = clientIp(req.headers)
  try {
    if (body.op === 'pin') {
      const outcome = await checkPin(token, body.pin, ip)
      if (!outcome.ok) return json({ error: outcome.message, code: outcome.code, ...(outcome.retryAt ? { retryAt: outcome.retryAt } : {}) }, outcome.code === 'invalid_link' ? 404 : outcome.code === 'locked' ? 429 : outcome.code === 'busy' ? 503 : 401)
      const res = json({ contract: publicView(outcome.contract) })
      const s = outcome.session
      // Solo per questo link: il cookie va solo alle richieste di /api/c/<token>.
      res.headers.append('Set-Cookie', `${s.name}=${encodeURIComponent(s.value)}; Path=/api/c/${token}; Max-Age=${s.maxAge}; HttpOnly; Secure; SameSite=Lax`)
      await markSeen(outcome.contract)
      return res
    }
    const opened = await openWithSession(token, readCookie(req, cookieName(tokenHash(token))))
    if (!opened) return invalid()
    if (opened === 'pin') return json({ error: 'Scrivi di nuovo il PIN: la sessione è scaduta.', code: 'pin' }, 401)
    if (body.op === 'change') {
      const contract = await requestChange(opened, { text: body.text, section: body.section, versionId: body.versionId })
      return json({ ok: true, contract: publicView(contract) })
    }
    if (body.op === 'sign') {
      const signed = await signContract(
        opened.contract.workspaceId,
        opened.contract.id,
        'destinatario',
        { versionId: body.versionId, name: body.name, accept: body.accept, strokes: body.strokes, ratio: body.ratio, fields: body.fields },
        { ip, device: clientDevice(req.headers) },
        { hash: opened.hash }
      )
      if (signed.completed) await sendSignedEmails(workspaceDb(signed.contract.workspaceId), signed.contract).catch(() => 0)
      return json({ ok: true, completed: signed.completed, contract: publicView(signed.contract) })
    }
    return json({ error: 'Operazione sconosciuta.' }, 400)
  } catch (error) {
    if (error instanceof ContractError) return json({ error: error.message, code: error.code }, error.status)
    console.error('contratti (link):', error instanceof Error ? error.message.slice(0, 200) : 'errore')
    return json({ error: 'Non riuscito, riprova.' }, 500)
  }
}

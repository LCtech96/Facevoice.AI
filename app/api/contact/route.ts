import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_EMAILS } from '@/lib/admin-auth'
import { emailLayout, escapeHtml, sendEmail } from '@/lib/email'
import { sendPushToAdmins } from '@/lib/push'
import { SITE_URL } from '@/lib/seo/site'

export const dynamic = 'force-dynamic'

// Modulo "Parliamo del tuo progetto" della home: conferma a chi scrive,
// avviso all'admin (email + push). Nessun dato salvato oltre alle email.

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/
const RATE_WINDOW_MS = 10 * 60_000
const RATE_MAX = 3
const recent = new Map<string, number[]>()

function rateLimited(key: string) {
  const now = Date.now()
  const hits = (recent.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS)
  hits.push(now)
  recent.set(key, hits)
  return hits.length > RATE_MAX
}

const clean = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max)

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))

  // Campo esca invisibile: i bot lo compilano, le persone no.
  if (clean(body?.website, 200)) return NextResponse.json({ success: true })

  const firstName = clean(body?.firstName, 80)
  const lastName = clean(body?.lastName, 80)
  const email = clean(body?.email, 160).toLowerCase()
  const phone = clean(body?.phone, 40)
  const message = clean(body?.message, 3000)

  if (!firstName || !lastName) return NextResponse.json({ error: 'Inserisci nome e cognome' }, { status: 400 })
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'Email non valida' }, { status: 400 })
  if (phone.replace(/[^\d]/g, '').length < 6) return NextResponse.json({ error: 'Numero di cellulare non valido' }, { status: 400 })
  if (message.length < 5) return NextResponse.json({ error: 'Scrivi in breve il motivo del contatto' }, { status: 400 })
  if (body?.privacy !== true) return NextResponse.json({ error: 'Serve il consenso al trattamento dei dati' }, { status: 400 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (rateLimited(ip) || rateLimited(email)) {
    return NextResponse.json({ error: 'Hai già inviato alcune richieste: riprova tra qualche minuto.' }, { status: 429 })
  }

  const fullName = `${firstName} ${lastName}`
  const waLink = `https://wa.me/${phone.replace(/[^\d]/g, '').replace(/^(?!39)(3\d{8,9})$/, '39$1')}`

  const [adminSent] = await Promise.all([
    sendEmail({
      to: [...ADMIN_EMAILS],
      replyTo: email,
      subject: `Nuova richiesta dal sito: ${fullName}`,
      text: `${fullName} ha compilato il modulo "Parliamo del tuo progetto".\n\nEmail: ${email}\nCellulare: ${phone}\n\nMotivo:\n${message}\n\nRispondi a questa email per scrivergli direttamente.`,
      html: emailLayout(`
<p><strong>${escapeHtml(fullName)}</strong> ha compilato il modulo «Parliamo del tuo progetto» sul sito.</p>
<p>Email: <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a><br />
Cellulare: <a href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a> · <a href="${escapeHtml(waLink)}">WhatsApp</a></p>
<p><strong>Motivo del contatto:</strong></p>
<div style="background: #f5f5f5; border-left: 4px solid #ff6a1a; padding: 12px 16px; border-radius: 4px; white-space: pre-wrap;">${escapeHtml(message)}</div>
<p style="color: #666; font-size: 13px;">Rispondi a questa email per scrivergli direttamente.</p>`),
    }),
    sendEmail({
      to: email,
      subject: 'Abbiamo ricevuto il tuo messaggio · Facevoice AI',
      text: `Ciao ${firstName},\n\nil tuo messaggio è stato recapitato al team di Facevoice AI: ti ricontatteremo a breve al numero ${phone} o a questa email.\n\nEcco cosa ci hai scritto:\n${message}\n\nA presto,\nIl team di Facevoice AI\n${SITE_URL}`,
      html: emailLayout(`
<p>Ciao ${escapeHtml(firstName)},</p>
<p>il tuo messaggio è stato <strong>recapitato al team di Facevoice AI</strong>: ti ricontatteremo a breve al numero ${escapeHtml(phone)} o a questa email.</p>
<p>Ecco cosa ci hai scritto:</p>
<div style="background: #f5f5f5; border-left: 4px solid #ff6a1a; padding: 12px 16px; border-radius: 4px; white-space: pre-wrap;">${escapeHtml(message)}</div>
<p>A presto,<br />Il team di Facevoice AI</p>`),
    }),
    sendPushToAdmins({
      title: `Nuova richiesta dal sito · ${fullName}`,
      body: message.length > 140 ? `${message.slice(0, 140)}…` : message,
      url: '/admin/inbox',
    }).catch(() => null),
  ])

  if (!adminSent) {
    console.error('contact: email all\'admin non inviata', fullName, email)
    return NextResponse.json(
      { error: 'Invio non riuscito per un problema tecnico. Scrivici a info@facevoice.ai o su WhatsApp.' },
      { status: 502 }
    )
  }
  return NextResponse.json({ success: true })
}

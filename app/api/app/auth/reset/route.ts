import { NextRequest, NextResponse, after } from 'next/server'
import { createHash } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { emailLayout, escapeHtml, sendEmail } from '@/lib/email'
import { appBaseUrl } from '@/lib/app-url'
import { ipHashOf } from '@/lib/shared-access'
import { reserveSlot, takeHourly } from '@/lib/limiter'

export const dynamic = 'force-dynamic'

// «Password dimenticata»: una sola email con il link per scegliere la nuova password E un
// codice da scrivere nella pagina di reimpostazione. Link e codice sono lo stesso permesso
// di Supabase (usato uno, l'altro non vale piu'). Il link porta a una nostra pagina che
// chiede un tocco prima di usarlo: i filtri antivirus delle email che aprono i link da
// soli non lo consumano. Risposta sempre uguale (non si scopre se l'email e' registrata);
// limiti per email, per IP e in tutto, che si chiudono in caso di errore.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const WINDOW_MS = 15 * 60_000
// Per email: solo una finestra breve (niente tetto giornaliero, che chiunque potrebbe riempire
// per tenere fuori il titolare un giorno intero); ogni richiesta annulla il codice di prima.
// Il tetto generale conta solo le email vere (chi prova indirizzi a caso non blocca gli altri).
const LIMITS = { emailWindow: 5, ipWindow: 10, globalHour: 1000 }

function resetEmail(link: string, page: string, code: string) {
  const text = [
    'Hai chiesto di reimpostare la password del tuo account Facevoice AI.',
    '',
    `Scegli una nuova password da qui: ${link}`,
    '',
    `Oppure apri ${page} e scrivi questo codice: ${code}`,
    '',
    'Il link e il codice valgono una volta sola e per poco tempo (di solito un’ora).',
    'È la password con cui entri tu. Per sicurezza, dopo il cambio la password dei collaboratori (se attiva) si spegne: la riattivi da Account.',
    'Se non sei stato tu, ignora questa email: la password resta quella di prima.',
  ].join('\n')
  const html = emailLayout(`
<p>Hai chiesto di reimpostare la password del tuo account Facevoice AI.</p>
<p><a href="${escapeHtml(link)}" style="display: inline-block; background: #1f4fe0; color: #ffffff; padding: 12px 20px; border-radius: 999px; text-decoration: none; font-weight: 600;">Scegli una nuova password</a></p>
<p>Oppure apri <a href="${escapeHtml(page)}">la pagina di reimpostazione</a> e scrivi questo codice:</p>
<p style="font-size: 32px; font-weight: 700; letter-spacing: 6px; margin: 12px 0;">${escapeHtml(code)}</p>
<p style="color: #666; font-size: 13px;">Il link e il codice valgono una volta sola e per poco tempo (di solito un’ora).</p>
<p style="color: #666; font-size: 13px;">È la password con cui entri tu. Per sicurezza, dopo il cambio la password dei collaboratori (se attiva) si spegne: la riattivi da Account.</p>
<p style="color: #666; font-size: 13px;">Se non sei stato tu, ignora questa email: la password resta quella di prima.</p>`)
  return { subject: 'Reimposta la password del tuo account Facevoice AI', text, html }
}

async function sendReset(email: string, base: string, now: number) {
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: `${base}/auth/reset-password?da=app` } })
  // Email non registrata (o errore): nessun invio, e chi ha chiesto non lo viene a sapere.
  if (error || !data?.properties?.hashed_token || !data.properties.email_otp) {
    if (error && !/not.?found|user/i.test(error.message)) console.error('recupero password: link non creato', error.message.slice(0, 160))
    return
  }
  // Tetto generale per ora: solo per le email registrate (in caso di errore si chiude).
  const underCap = await takeHourly('pw_reset_global', LIMITS.globalHour, now).catch(() => false)
  if (!underCap) {
    console.error('recupero password: tetto orario raggiunto (o non verificabile), email non inviata')
    return
  }
  const link = `${base}/auth/reset-password?da=app&type=recovery&token_hash=${encodeURIComponent(data.properties.hashed_token)}&email=${encodeURIComponent(email)}`
  const page = `${base}/auth/reset-password?da=app&email=${encodeURIComponent(email)}`
  const mail = resetEmail(link, page, data.properties.email_otp)
  let sent = await sendEmail({ to: email, ...mail })
  if (!sent) {
    await new Promise((r) => setTimeout(r, 1000))
    sent = await sendEmail({ to: email, ...mail })
  }
  if (!sent) console.error('recupero password: email non inviata (Resend)')
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!EMAIL_RE.test(email) || email.length > 200) return NextResponse.json({ error: 'Scrivi un indirizzo email valido.' }, { status: 400 })
  const now = Date.now()
  const emailKey = `pw_reset_email:${createHash('sha256').update(email).digest('hex')}`
  let allowed: boolean
  try {
    if (!(await reserveSlot(`pw_reset_ip:${ipHashOf(req.headers)}`, [{ windowMs: WINDOW_MS, max: LIMITS.ipWindow }], undefined, now))) {
      return NextResponse.json({ error: 'Troppe richieste: riprova tra qualche minuto.' }, { status: 429 })
    }
    allowed = await reserveSlot(emailKey, [{ windowMs: WINDOW_MS, max: LIMITS.emailWindow }], undefined, now)
  } catch {
    return NextResponse.json({ error: 'Non riesco a mandare l’email in questo momento, riprova tra poco.' }, { status: 503 })
  }
  // Oltre il limite di quell'email: stessa risposta, ma niente invio (niente email a raffica).
  if (!allowed) console.warn('recupero password: limite per email raggiunto, nessun invio')
  if (allowed) {
    const base = appBaseUrl(req)
    after(() => sendReset(email, base, now).catch((error) => console.error('recupero password:', error instanceof Error ? error.message.slice(0, 160) : 'errore')))
  }
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}

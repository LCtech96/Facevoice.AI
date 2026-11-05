import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { checkBridgeSecret } from '@/lib/beta-bridge'
import { formatEur, isAlertLevel, type AlertLevel } from '@/lib/beta-users'
import { emailLayout, escapeHtml, sendEmail } from '@/lib/email'
import { sendPushToAdmins } from '@/lib/push'
import { SITE_URL } from '@/lib/seo/site'
import { updateSetting } from '@/lib/settings-store'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// La beta avvisa qui quando un utente cambia gettone (verde, arancione, rosso,
// bloccato): al massimo una volta per livello e per periodo, lo decide la beta.
// Si manda una notifica push ai dispositivi dell'admin e un'email: se uno dei
// due non parte si prova comunque l'altro. Nessuna sessione admin: vale solo il
// segreto del collegamento (x-bridge-secret).

const ALERT_EMAIL = 'luca@facevoice.ai'

const EMOJI: Record<AlertLevel, string> = { green: '🟢', orange: '🟠', red: '🔴', blocked: '⛔' }

const LEVEL_NAME: Record<AlertLevel, string> = {
  green: 'Gettone verde',
  orange: 'Gettone arancione',
  red: 'Gettone rosso',
  blocked: 'Bloccato',
}

function levelText(level: AlertLevel, limit: string | null) {
  switch (level) {
    case 'green':
      return 'Gettone verde: ha iniziato a usare l’AI in questo periodo.'
    case 'orange':
      return 'Gettone arancione: ha superato la prima soglia del suo piano.'
    case 'red':
      return `Gettone rosso: è vicino al limite${limit ? ` di ${limit}` : ''}.`
    case 'blocked':
      return `Bloccato: ha raggiunto il limite${limit ? ` di ${limit}` : ''}. L’AI è ferma finché non passa al piano superiore.`
  }
}

type Alert = {
  userId: string
  email: string
  name: string
  planLabel: string
  level: AlertLevel
  eur: number
  limitEur: number | null
  periodEnd: string | null
  daysLeft: number | null
  byConnection: { label: string; eur: number }[]
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : '')
const amount = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null)

function parseAlert(body: any): Alert | string {
  if (!body || typeof body !== 'object') return 'Dati mancanti'
  const userId = clean(body.userId, 100)
  if (!userId || !/^[A-Za-z0-9-]+$/.test(userId)) return 'userId non valido'
  if (!isAlertLevel(body.level)) return 'level non valido'
  const eur = amount(body.eur)
  if (eur === null) return 'eur non valido'
  const email = clean(body.email, 200)
  const periodEnd = clean(body.periodEnd, 40)
  const daysLeft = typeof body.daysLeft === 'number' && Number.isFinite(body.daysLeft) ? Math.max(0, Math.round(body.daysLeft)) : null
  const limitEur = amount(body.limitEur)
  return {
    userId,
    email,
    name: clean(body.name, 120) || email || 'Utente della beta',
    planLabel: clean(body.planLabel, 40),
    level: body.level,
    eur,
    limitEur: limitEur && limitEur > 0 ? limitEur : null,
    periodEnd: periodEnd && !Number.isNaN(Date.parse(periodEnd)) ? periodEnd : null,
    daysLeft,
    byConnection: (Array.isArray(body.byConnection) ? body.byConnection : [])
      .map((c: any) => ({ label: clean(c?.label, 60), eur: amount(c?.eur) }))
      .filter((c: { label: string; eur: number | null }): c is { label: string; eur: number } => Boolean(c.label) && c.eur !== null && c.eur > 0)
      .sort((a: { eur: number }, b: { eur: number }) => b.eur - a.eur)
      .slice(0, 20),
  }
}

// Doppioni: la beta segna un livello come avvisato solo se riceve la risposta in
// tempo; se rinuncia prima lo rimanda alla prossima chiamata AI, anche se qui push
// ed email erano gia' partite. Ogni avviso (utente, periodo, livello) ha quindi una
// chiave in app_settings: "sending" mentre si invia, "sent" se e' arrivato,
// "failed" se non e' partito niente (e la beta puo' riprovare).
type Seen = { state: 'sending' | 'sent' | 'failed'; at: string; token: string }

// Oltre maxDuration: chi stava inviando non c'e' piu', si puo' riprovare.
const STALE_MS = 2 * 60_000

function parseSeen(raw: unknown): Seen | null {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw
    return v && typeof v === 'object' && typeof v.state === 'string' && typeof v.token === 'string' ? (v as Seen) : null
  } catch {
    return null
  }
}

/** 'mine': tocca a questa richiesta inviare; 'sent': gia' consegnato; 'busy': un'altra richiesta sta inviando. */
async function claimAlert(key: string, token: string): Promise<'mine' | 'sent' | 'busy'> {
  const seen = await updateSetting(key, parseSeen, (cur): Seen | false => {
    if (cur?.state === 'sent') return false
    if (cur?.state === 'sending' && Date.now() - Date.parse(cur.at) < STALE_MS) return false
    return { state: 'sending', at: new Date().toISOString(), token }
  })
  if (seen?.token === token) return 'mine'
  return seen?.state === 'sent' ? 'sent' : 'busy'
}

async function finishAlert(key: string, token: string, delivered: boolean) {
  await updateSetting(key, parseSeen, (cur): Seen | false =>
    cur?.token === token ? { state: delivered ? 'sent' : 'failed', at: new Date().toISOString(), token } : false
  )
}

function renewalText(a: Alert) {
  const date = a.periodEnd ? new Date(a.periodEnd).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'long' }) : null
  if (a.daysLeft === null) return date ? `Rinnovo il ${date}.` : ''
  const days = a.daysLeft === 0 ? 'oggi' : a.daysLeft === 1 ? 'tra 1 giorno' : `tra ${a.daysLeft} giorni`
  return `Rinnovo ${days}${date ? ` (${date})` : ''}.`
}

export async function POST(req: NextRequest) {
  const denied = checkBridgeSecret(req)
  if (denied) return denied

  const alert = parseAlert(await req.json().catch(() => null))
  if (typeof alert === 'string') return NextResponse.json({ error: alert }, { status: 400 })

  // Senza fine periodo non si sa a quale mese appartiene: si invia senza controllo.
  let seenKey = alert.periodEnd ? `usage_alert_seen:${alert.userId}:${alert.periodEnd}:${alert.level}` : null
  const token = randomUUID()
  if (seenKey) {
    try {
      const claim = await claimAlert(seenKey, token)
      if (claim === 'sent') return NextResponse.json({ ok: true, duplicate: true })
      if (claim === 'busy') return NextResponse.json({ error: 'Avviso già in invio: riprova più tardi.' }, { status: 409 })
    } catch (error) {
      // Meglio un avviso doppio che nessun avviso.
      console.error('Avviso consumi AI: controllo doppioni non riuscito:', error)
      seenKey = null
    }
  }

  const total = formatEur(alert.eur)
  const limit = alert.limitEur !== null ? formatEur(alert.limitEur) : null
  const level = levelText(alert.level, limit)
  const plan = alert.planLabel ? `Piano ${alert.planLabel}` : ''
  const path = `/admin/utenti?u=${encodeURIComponent(alert.userId)}`
  const link = `${SITE_URL}${path}`
  const connections = alert.byConnection.map((c) => `${c.label} ${formatEur(c.eur)}`)
  const renewal = renewalText(alert)

  // Push: chi e quanto nel titolo, i collegamenti che pesano di piu' nel testo.
  const push = (async () => {
    const result = await sendPushToAdmins({
      title: `${EMOJI[alert.level]} ${alert.name}: ${total} di AI`,
      body: [
        connections.slice(0, 3).join(' · '),
        [LEVEL_NAME[alert.level], plan, limit ? `limite ${limit}` : ''].filter(Boolean).join(' · '),
      ]
        .filter(Boolean)
        .join('\n'),
      url: path,
      // Un tag per fase: con lo stesso tag il browser sostituirebbe la notifica senza suono.
      tag: `usage-${alert.userId}-${alert.level}${alert.periodEnd ? `-${alert.periodEnd}` : ''}`,
    })
    console.log(`push consumi AI ${alert.level} ${alert.userId}: ${result.sent} inviate, ${result.failed} fallite`)
    return result.sent > 0
  })()

  const subject = `Consumi AI: ${alert.name} è arrivato a ${total}${alert.level === 'blocked' ? ' (bloccato)' : ''}`
  const who = alert.email && alert.email !== alert.name ? `${alert.name} (${alert.email})` : alert.name
  const spent = `${who} ha consumato ${total} di AI${limit ? ` su ${limit}` : ''} in questo periodo.`
  const text = [
    spent,
    level,
    plan ? `${plan}.` : '',
    renewal,
    connections.length ? `\nPer collegamento:\n${connections.map((c) => `- ${c}`).join('\n')}` : '',
    `\nApri la scheda: ${link}`,
  ]
    .filter(Boolean)
    .join('\n')
  const rows = alert.byConnection
    .map(
      (c) =>
        `<tr><td style="padding: 4px 12px 4px 0;">${escapeHtml(c.label)}</td><td style="padding: 4px 0; text-align: right; white-space: nowrap;">${escapeHtml(formatEur(c.eur))}</td></tr>`
    )
    .join('')
  const details = [plan, renewal].filter(Boolean).map(escapeHtml).join('<br>')
  const html = emailLayout(`
<p><strong>${escapeHtml(alert.name)}</strong>${alert.email ? ` &middot; ${escapeHtml(alert.email)}` : ''}</p>
<p style="font-size: 18px;">${EMOJI[alert.level]} <strong>${escapeHtml(total)}</strong> di AI${limit ? ` su ${escapeHtml(limit)}` : ''} in questo periodo</p>
<p>${escapeHtml(level)}${details ? `<br>${details}` : ''}</p>
${rows ? `<p style="margin-bottom: 4px;"><strong>Per collegamento</strong></p><table style="border-collapse: collapse;">${rows}</table>` : ''}
<p><a href="${link}" style="display: inline-block; background: #0b1f3a; color: #ffffff; padding: 10px 18px; border-radius: 8px; text-decoration: none;">Apri la scheda dell'utente</a></p>`)
  const email = sendEmail({ to: ALERT_EMAIL, subject, text, html })

  const [pushResult, emailResult] = await Promise.allSettled([push, email])
  const pushed = pushResult.status === 'fulfilled' && pushResult.value
  const emailed = emailResult.status === 'fulfilled' && emailResult.value
  if (pushResult.status === 'rejected') console.error('Push consumi AI non inviata:', pushResult.reason)
  if (emailResult.status === 'rejected') console.error('Email consumi AI non inviata:', emailResult.reason)
  if (seenKey) {
    await finishAlert(seenKey, token, pushed || emailed).catch((error) => console.error('Avviso consumi AI: stato non salvato:', error))
  }

  if (!pushed && !emailed) {
    return NextResponse.json({ error: 'Avviso non consegnato: né push né email sono partite.' }, { status: 502 })
  }
  return NextResponse.json({ ok: true, push: pushed, email: emailed })
}

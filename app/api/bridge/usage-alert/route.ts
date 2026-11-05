import { NextRequest, NextResponse } from 'next/server'
import { checkBridgeSecret } from '@/lib/beta-bridge'
import { DEFAULT_THRESHOLDS, formatEur, isAlertLevel, type AlertLevel } from '@/lib/beta-users'
import { emailLayout, escapeHtml, sendEmail } from '@/lib/email'
import { sendPushToAdmins } from '@/lib/push'
import { SITE_URL } from '@/lib/seo/site'

export const dynamic = 'force-dynamic'

// La beta avvisa qui quando un utente cambia gettone (verde, arancione, rosso,
// bloccato). Si manda una notifica push ai dispositivi dell'admin e un'email:
// se uno dei due non parte si prova comunque l'altro. Nessuna sessione admin:
// vale solo il segreto del collegamento.

const ALERT_EMAIL = 'luca@facevoice.ai'

const EMOJI: Record<AlertLevel, string> = { green: '🟢', orange: '🟠', red: '🔴', blocked: '⛔' }

const LEVEL_TEXT: Record<AlertLevel, (limit: string) => string> = {
  green: () => 'Gettone verde: ha iniziato a usare l’AI in questo periodo.',
  orange: () => `Gettone arancione: ha superato ${formatEur(DEFAULT_THRESHOLDS.orange)}.`,
  red: () => `Gettone rosso: ha superato ${formatEur(DEFAULT_THRESHOLDS.red)}.`,
  blocked: (limit) => `Bloccato: ha raggiunto il limite di ${limit}. L’AI è ferma finché non passa al piano superiore.`,
}

type Alert = {
  userId: string
  email: string
  name: string
  level: AlertLevel
  eur: number
  limitEur: number
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
  return {
    userId,
    email,
    name: clean(body.name, 120) || email || 'Utente della beta',
    level: body.level,
    eur,
    limitEur: amount(body.limitEur) || DEFAULT_THRESHOLDS.limit,
    periodEnd: periodEnd && !Number.isNaN(Date.parse(periodEnd)) ? periodEnd : null,
    daysLeft,
    byConnection: (Array.isArray(body.byConnection) ? body.byConnection : [])
      .map((c: any) => ({ label: clean(c?.label, 60), eur: amount(c?.eur) }))
      .filter((c: { label: string; eur: number | null }): c is { label: string; eur: number } => Boolean(c.label) && c.eur !== null && c.eur > 0)
      .sort((a: { eur: number }, b: { eur: number }) => b.eur - a.eur)
      .slice(0, 20),
  }
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

  const total = formatEur(alert.eur)
  const limit = formatEur(alert.limitEur)
  const levelText = LEVEL_TEXT[alert.level](limit)
  const path = `/admin/utenti?u=${encodeURIComponent(alert.userId)}`
  const link = `${SITE_URL}${path}`
  const connections = alert.byConnection.map((c) => `${c.label} ${formatEur(c.eur)}`)

  const push = (async () => {
    const result = await sendPushToAdmins({
      title: `${EMOJI[alert.level]} ${alert.name}: ${total} di AI`,
      body: [connections.slice(0, 3).join(' · '), alert.level === 'blocked' ? `Bloccato al limite di ${limit}.` : '']
        .filter(Boolean)
        .join('\n') || levelText,
      url: path,
      tag: `usage-${alert.userId}`,
    })
    console.log(`push consumi AI ${alert.level} ${alert.userId}: ${result.sent} inviate, ${result.failed} fallite`)
    return result.sent > 0
  })()

  const subject =
    alert.level === 'blocked'
      ? `Consumi AI: ${alert.name} è arrivato a ${total} (bloccato)`
      : `Consumi AI: ${alert.name} è arrivato a ${total}`
  const who = alert.email && alert.email !== alert.name ? `${alert.name} (${alert.email})` : alert.name
  const renewal = renewalText(alert)
  const text = [
    `${who} ha consumato ${total} di AI su ${limit} in questo periodo.`,
    levelText,
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
  const html = emailLayout(`
<p><strong>${escapeHtml(alert.name)}</strong>${alert.email ? ` &middot; ${escapeHtml(alert.email)}` : ''}</p>
<p style="font-size: 18px;">${EMOJI[alert.level]} <strong>${escapeHtml(total)}</strong> di AI su ${escapeHtml(limit)} in questo periodo</p>
<p>${escapeHtml(levelText)}${renewal ? `<br>${escapeHtml(renewal)}` : ''}</p>
${rows ? `<p style="margin-bottom: 4px;"><strong>Per collegamento</strong></p><table style="border-collapse: collapse;">${rows}</table>` : ''}
<p><a href="${link}" style="display: inline-block; background: #0b1f3a; color: #ffffff; padding: 10px 18px; border-radius: 8px; text-decoration: none;">Apri la scheda dell'utente</a></p>`)
  const email = sendEmail({ to: ALERT_EMAIL, subject, text, html })

  const [pushResult, emailResult] = await Promise.allSettled([push, email])
  const pushed = pushResult.status === 'fulfilled' && pushResult.value
  const emailed = emailResult.status === 'fulfilled' && emailResult.value
  if (pushResult.status === 'rejected') console.error('Push consumi AI non inviata:', pushResult.reason)

  if (!pushed && !emailed) {
    return NextResponse.json({ error: 'Avviso non consegnato: né push né email sono partite.' }, { status: 502 })
  }
  return NextResponse.json({ ok: true, push: pushed, email: emailed })
}

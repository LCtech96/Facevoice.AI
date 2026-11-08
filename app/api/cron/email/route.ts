import { createHmac } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { pollGmail } from '@/lib/gmail-poll'
import { SCOPES, loadState } from '@/lib/assistant-state'
import { resumeOrClose } from '@/lib/assistant-launch'
import { autopilotTick } from '@/lib/autopilot'
import { blogAutoTick } from '@/lib/blog-auto'
import { sendDueOutreachReplies } from '@/lib/outreach-reply'
import { autoLinkBackfillTick } from '@/lib/meta/auto-link'
import { processDueDmReplies } from '@/lib/meta/reply-queue'
import { videoPostsTick } from '@/lib/video-posts'
import { todoRemindersTick } from '@/lib/todo-reminders'
import { photoPostsTick } from '@/lib/photo-library'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Cron Vercel (vedi vercel.json): legge le nuove email ogni minuto e fa ripartire
 * i lavori della super chat rimasti fermi, anche se nessuno ha la pagina aperta;
 * all'ora scelta avvia l'automazione giornaliera del Motore clienti e invia le
 * controrisposte automatiche programmate.
 */
/**
 * La piattaforma clienti in anteprima (beta) non ha il cron di Vercel: ogni
 * minuto la si sveglia da qui (post programmati, email, accessi Instagram).
 * Firma con la chiave dell'app Meta, uguale nei due ambienti; risposta immediata.
 */
async function wakeSaasPreview() {
  const url = process.env.SAAS_CRON_FORWARD_URL?.trim()
  const secret = process.env.META_APP_SECRET?.trim()
  if (!url || !secret) return
  const ts = String(Date.now())
  const mac = createHmac('sha256', secret).update(`saas-cron:${ts}`).digest('hex')
  const res = await fetch(url, { headers: { 'x-saas-cron': `${ts}.${mac}` }, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) console.warn(`saas cron: la beta ha risposto ${res.status}`)
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }
  // Collegamento automatico delle conversazioni gia' esistenti: pochi secondi a ogni giro, riprende da dove
  // era rimasto. Va in parallelo e non ritarda la lettura delle email.
  const backfill = autoLinkBackfillTick().catch((error) => console.error('collegamento automatico:', error))
  // Risposte ai messaggi privati in coda (almeno 30 secondi dopo l'ultimo messaggio) non inviate dal
  // webhook: quelle gia' all'ora prevista e quelle dei prossimi 15 secondi. In parallelo, come sopra.
  const dmReplies = processDueDmReplies({ horizonMs: 15_000 }).catch((error) => console.error('risposte in coda:', error))
  await Promise.all([
    autopilotTick(req.nextUrl.origin).catch((error) => console.error('autopilot:', error)),
    blogAutoTick(req.nextUrl.origin).catch((error) => console.error('blog auto:', error)),
    sendDueOutreachReplies().catch((error) => console.error('outreach replies:', error)),
    // Video programmati (Reel e Facebook): un controllo per video, il Reel lento si finisce al giro dopo.
    videoPostsTick().catch((error) => console.error('video programmati:', error)),
    // Caroselli programmati (super chat e autopilota della Libreria foto) e uscite dell'autopilota.
    photoPostsTick(req.nextUrl.origin).catch((error) => console.error('caroselli e autopilota foto:', error)),
    // Solleciti via email delle todo list condivise (scadenze vicine).
    todoRemindersTick(req.nextUrl.origin).catch((error) => console.error('todo solleciti:', error)),
    wakeSaasPreview().catch((error) => console.warn('saas cron:', error instanceof Error ? error.message : error)),
    ...SCOPES.map(async (scope) => resumeOrClose(req.nextUrl.origin, scope, await loadState(scope)).catch((error) => console.error('assistant resume:', error))),
  ])
  const result = await pollGmail()
  await Promise.all([backfill, dmReplies])
  return NextResponse.json(result)
}

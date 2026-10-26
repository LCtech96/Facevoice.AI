import { supabaseAdmin } from '@/lib/supabase-admin'
import { readSetting, updateSetting } from '@/lib/settings-store'
import { DAILY_EMAIL_LIMIT, MAX_RESULTS, SYSTEM_EMAIL, analyzeLead, searchPlaces, type Lead } from '@/lib/leads'
import { sendFirstEmail, sentToday } from '@/lib/lead-send'
import { sendPushToAdmins } from '@/lib/push'

// Automazione giornaliera del Motore clienti. Ogni giorno all'ora scelta (ora
// italiana): 1) ricerche su Google Maps, a rotazione dalla lista; 2) lettura dei
// siti delle attivita' nuove (email, social, bozza della prima email); 3) invio
// delle prime email, distanziate, fino al numero scelto (mai oltre il limite di
// DAILY_EMAIL_LIMIT al giorno). Il cron di ogni minuto la avvia e, se il server
// la ferma, la fa ripartire; ogni giro dura al massimo ~4 minuti e passa il
// resto al giro successivo.

const SETTINGS_KEY = 'autopilot:settings'
const RUN_KEY = 'autopilot:run'
/** Schede lette al massimo in un giorno (ogni lettura costa una chiamata AI). */
const ANALYZE_MAX = 40
const ROUND_MS = 230_000
/** Oltre questo tempo senza aggiornamenti il giro e' fermo: il server l'ha chiuso. */
const STALE_MS = 330_000
const MAX_ROUNDS = 15
/** Pausa tra un'email e l'altra: invii distanziati arrivano meglio. */
const SEND_GAP_MS: [number, number] = [20_000, 45_000]

export type AutopilotSettings = {
  enabled: boolean
  /** Ora italiana, "HH:MM". */
  time: string
  /** Ricerche su Google Maps, usate a rotazione (es. "alimentari Palermo"). */
  searches: string[]
  searchesPerDay: number
  resultsPerSearch: number
  emailsPerDay: number
  /** Prossima ricerca della lista da usare. */
  next: number
}

export type AutopilotRun = {
  /** Giorno italiano YYYY-MM-DD. */
  date: string
  status: 'running' | 'done' | 'error'
  phase: 'search' | 'analyze' | 'send' | 'done'
  statusText: string
  round: number
  /** Giro in esecuzione: i giri vecchi non possono piu' scrivere. */
  run: string
  startedAt: string
  updatedAt: string
  manual?: boolean
  /** Prima ricerca della lista usata in questa esecuzione. */
  searchStart: number
  searched: { query: string; found: number; added: number; error?: string }[]
  analyzed: number
  withEmail: number
  sent: { id: string; name: string; email: string }[]
  /** Schede che non si possono inviare (indirizzo gia' contattato, non valido…): saltate. */
  skipped?: string[]
  errors: string[]
}

export const DEFAULT_SETTINGS: AutopilotSettings = {
  enabled: false,
  time: '15:30',
  searches: [],
  searchesPerDay: 2,
  resultsPerSearch: 20,
  emailsPerDay: 20,
  next: 0,
}

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

/** Impostazioni valide (valori fuori misura riportati nei limiti). */
export function cleanSettings(input: Partial<AutopilotSettings> | null | undefined, base = DEFAULT_SETTINGS): AutopilotSettings {
  const time = typeof input?.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.time) ? input.time : base.time
  const searches = Array.isArray(input?.searches)
    ? [...new Set(input.searches.map((s) => String(s).trim().slice(0, 120)).filter((s) => s.length >= 3))].slice(0, 100)
    : base.searches
  return {
    enabled: typeof input?.enabled === 'boolean' ? input.enabled : base.enabled,
    time,
    searches,
    searchesPerDay: clamp(input?.searchesPerDay ?? base.searchesPerDay, 1, 5, DEFAULT_SETTINGS.searchesPerDay),
    resultsPerSearch: clamp(input?.resultsPerSearch ?? base.resultsPerSearch, 5, MAX_RESULTS, DEFAULT_SETTINGS.resultsPerSearch),
    emailsPerDay: clamp(input?.emailsPerDay ?? base.emailsPerDay, 0, DAILY_EMAIL_LIMIT, DEFAULT_SETTINGS.emailsPerDay),
    next: clamp(input?.next ?? base.next, 0, 10_000, 0),
  }
}

const parseSettings = (raw: string | null) => {
  try {
    return cleanSettings(raw ? JSON.parse(raw) : null)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}
const parseRun = (raw: string | null): AutopilotRun | null => {
  try {
    return raw ? (JSON.parse(raw) as AutopilotRun) : null
  } catch {
    return null
  }
}

export const loadSettings = async () => parseSettings((await readSetting(SETTINGS_KEY)).value)
export const loadRun = async () => parseRun((await readSetting(RUN_KEY)).value)

export function saveSettings(input: Partial<AutopilotSettings>) {
  return updateSetting(SETTINGS_KEY, parseSettings, (current) => cleanSettings({ ...current, ...input }, current))
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Giorno e ora italiani adesso. */
export function romeNow(now = new Date()) {
  return {
    date: now.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' }),
    time: now.toLocaleTimeString('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false }),
  }
}

export const isActive = (run: AutopilotRun | null) =>
  Boolean(run && run.status === 'running' && Date.now() - new Date(run.updatedAt).getTime() < STALE_MS)

const isStale = (run: AutopilotRun | null) => Boolean(run && run.status === 'running' && !isActive(run))

// ---------------------------------------------------------------------
// Avvio e giri successivi
// ---------------------------------------------------------------------

const internalKey = () => (process.env.CRON_SECRET || '').trim()

/** Fa partire il giro in una funzione nuova (tempo pieno). */
async function requestRound(origin: string, runId: string) {
  const key = internalKey()
  if (!key) throw new Error('CRON_SECRET mancante nelle variabili di Vercel')
  const res = await fetch(`${origin}/api/admin/autopilot/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': key },
    body: JSON.stringify({ runId }),
  })
  if (!res.ok) throw new Error(`giro rifiutato: ${res.status}`)
}

/** Crea l'esecuzione di oggi (se non ce n'e' una in corso) e la avvia. */
export async function startRun(origin: string, manual: boolean): Promise<{ run?: AutopilotRun; error?: string }> {
  const settings = await loadSettings()
  const today = romeNow().date
  const now = new Date().toISOString()
  let created: AutopilotRun | null = null
  await updateSetting(RUN_KEY, parseRun, (current) => {
    if (isActive(current)) return false
    // Avvio automatico: una volta al giorno.
    if (!manual && current?.date === today) return false
    created = {
      date: today,
      status: 'running',
      phase: settings.searches.length ? 'search' : 'analyze',
      statusText: 'Parto…',
      round: 0,
      run: newId(),
      startedAt: now,
      updatedAt: now,
      manual,
      searchStart: settings.next,
      searched: [],
      analyzed: 0,
      withEmail: 0,
      sent: [],
      errors: [],
    }
    return created
  })
  if (!created) return { error: 'L’automazione sta già lavorando (o ha già lavorato oggi).' }
  const run = created as AutopilotRun
  await requestRound(origin, run.run).catch(async (error) => {
    await finish(run.run, 'error', `Non sono riuscito ad avviarla: ${error instanceof Error ? error.message : error}`)
  })
  return { run }
}

/** Dal cron di ogni minuto: avvia l'esecuzione del giorno all'ora giusta e riprende quelle ferme. */
export async function autopilotTick(origin: string) {
  const [settings, run] = await Promise.all([loadSettings(), loadRun()])
  if (isStale(run)) {
    const current = run!
    if (current.round >= MAX_ROUNDS) return finish(current.run, 'error', 'Mi sono fermato: troppi giri senza finire.')
    let next: string | null = null
    await updateSetting(RUN_KEY, parseRun, (r) => {
      if (!r || r.run !== current.run || !isStale(r)) return false
      next = newId()
      return { ...r, round: r.round + 1, run: next, updatedAt: new Date().toISOString(), statusText: 'Riprendo da dove mi ero fermato…' }
    })
    if (next) await requestRound(origin, next).catch(() => undefined)
    return
  }
  const now = romeNow()
  if (settings.enabled && now.time >= settings.time && run?.date !== now.date) await startRun(origin, false)
}

// ---------------------------------------------------------------------
// Esecuzione di un giro
// ---------------------------------------------------------------------

/** Modifica l'esecuzione solo se il giro e' ancora quello giusto. */
function patch(runId: string, fn: (run: AutopilotRun) => void) {
  return updateSetting(RUN_KEY, parseRun, (run) => {
    if (!run || run.run !== runId || run.status !== 'running') return false
    fn(run)
    run.updatedAt = new Date().toISOString()
    return run
  })
}

async function finish(runId: string, status: 'done' | 'error', note?: string) {
  let closed = false
  const run = await patch(runId, (r) => {
    r.status = status
    r.phase = 'done'
    r.statusText = ''
    if (note) r.errors.push(note)
    closed = true
  })
  // Gia' chiusa da un altro giro: niente seconda notifica.
  if (!closed || !run) return
  const added = run.searched.reduce((n, s) => n + s.added, 0)
  await sendPushToAdmins({
    title: status === 'done' ? 'Motore clienti: lavoro di oggi finito' : 'Motore clienti: si è fermato',
    body:
      status === 'done'
        ? `${added} nuove attività, ${run.withEmail} email trovate, ${run.sent.length} email inviate.`
        : note || 'Apri la pagina per i dettagli.',
    url: '/admin/pipeline',
  }).catch(() => undefined)
}

/** Esegue un giro dell'esecuzione runId; se il tempo finisce passa il resto al giro successivo. */
export async function runRound(origin: string, runId: string) {
  const deadline = Date.now() + ROUND_MS
  const timeLeft = () => deadline - Date.now()
  const run = await loadRun()
  if (!run || run.run !== runId || run.status !== 'running') return
  const settings = await loadSettings()

  const nextRound = async () => {
    const next = newId()
    const saved = await patch(runId, (r) => {
      r.round += 1
      r.run = next
    })
    if (saved?.run !== next) return
    if (saved.round > MAX_ROUNDS) return finish(next, 'error', 'Mi sono fermato: troppi giri senza finire.')
    await requestRound(origin, next).catch(() => undefined) // se fallisce lo riprende il cron
  }

  try {
    // 1) Ricerche
    let phase = run.phase
    if (phase === 'search') {
      for (let i = run.searched.length; i < Math.min(settings.searchesPerDay, settings.searches.length); i++) {
        if (timeLeft() < 40_000) return nextRound()
        const query = settings.searches[(run.searchStart + i) % settings.searches.length]
        await patch(runId, (r) => void (r.statusText = `Cerco su Google Maps: “${query}”…`))
        const entry = await searchPlaces(query, settings.resultsPerSearch).then(
          (found) => ({ query, found: found.found, added: found.added }),
          (error) => ({ query, found: 0, added: 0, error: error instanceof Error ? error.message : String(error) })
        )
        await patch(runId, (r) => void r.searched.push(entry))
      }
      // La rotazione riparte dalla ricerca successiva il giorno dopo.
      const used = Math.min(settings.searchesPerDay, settings.searches.length)
      if (used) await saveSettings({ next: (run.searchStart + used) % settings.searches.length })
      phase = 'analyze'
      await patch(runId, (r) => void (r.phase = 'analyze'))
    }

    // 2) Lettura dei siti e 3) invio, alternati: se una scheda si rivela non
    // inviabile (doppione, indirizzo non valido) si torna a leggere altri siti.
    let failures = 0
    for (;;) {
      if (phase === 'analyze') {
        const quota = Math.max(0, settings.emailsPerDay - (await sentToday()))
        let current = (await loadRun())!
        while (current.analyzed < ANALYZE_MAX && (await sendable(quota, current.skipped)).length < quota) {
          if (timeLeft() < 60_000) return nextRound()
          const batch = await toAnalyze(4)
          if (!batch.length) break
          await patch(runId, (r) => void (r.statusText = `Leggo i siti: ${batch.map((l) => l.name).join(', ')}…`))
          const results = await Promise.all(
            batch.map((lead) =>
              analyzeLead(lead).catch(async (error) => {
                // Sito illeggibile: si segna come letto, cosi' domani non si riprova all'infinito.
                await supabaseAdmin.from('leads').update({ analyzed_at: new Date().toISOString() }).eq('id', lead.id)
                return { error: error instanceof Error ? error.message : String(error) }
              })
            )
          )
          const saved = await patch(runId, (r) => {
            r.analyzed += batch.length
            r.withEmail += results.filter((x) => 'email' in x && x.email).length
          })
          // Esecuzione passata a un altro giro (o chiusa): questo si ferma.
          if (!saved || saved.run !== runId || saved.status !== 'running') return
          current = saved
        }
        phase = 'send'
        await patch(runId, (r) => void (r.phase = 'send'))
      }

      // Invio delle prime email, distanziate
      const quota = Math.max(0, settings.emailsPerDay - (await sentToday()))
      if (!quota) break
      const latest = await loadRun()
      // Esecuzione passata a un altro giro (o chiusa): questo non invia piu' niente.
      if (!latest || latest.run !== runId || latest.status !== 'running') return
      const [lead] = await sendable(1, latest.skipped)
      if (!lead) {
        // Coda vuota: si leggono altri siti, se restano schede e letture per oggi.
        if (latest.analyzed < ANALYZE_MAX && (await toAnalyze(1)).length) {
          phase = 'analyze'
          await patch(runId, (r) => void (r.phase = 'analyze'))
          continue
        }
        break
      }
      if (timeLeft() < SEND_GAP_MS[1] + 20_000) return nextRound()
      const done = latest.sent.length
      await patch(runId, (r) => void (r.statusText = `Invio l’email a ${lead.name} (${done + 1}/${done + quota})…`))
      const result = await sendFirstEmail(lead.id)
      if ('error' in result) {
        await patch(runId, (r) => {
          r.errors.push(`${lead.name}: ${result.error}`)
          // Scheda non inviabile: si salta (resta nella pagina Clienti per un invio a mano).
          if (result.status !== 502 && result.status !== 429) r.skipped = [...(r.skipped || []), lead.id]
        })
        if (result.status === 429) break
        // Gmail non risponde o non e' collegato: dopo 3 errori di fila ci si ferma.
        if (result.status === 502 && ++failures >= 3) break
        continue
      }
      failures = 0
      await patch(runId, (r) => void r.sent.push({ id: lead.id, name: lead.name, email: String(lead.email) }))
      await sleep(SEND_GAP_MS[0] + Math.random() * (SEND_GAP_MS[1] - SEND_GAP_MS[0]))
    }

    await finish(runId, 'done')
  } catch (error) {
    await finish(runId, 'error', error instanceof Error ? error.message : String(error))
  }
}

/** Attivita' nuove con un sito ancora da leggere, dalle piu' recenti. */
async function toAnalyze(limit: number): Promise<Lead[]> {
  const { data } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .is('analyzed_at', null)
    .not('website', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data || []) as Lead[]
}

/** Schede pronte da inviare: lette, con email di una persona e bozza, mai contattate. */
async function sendable(limit: number, skip: string[] = []): Promise<Lead[]> {
  if (limit <= 0) return []
  const { data } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .is('contacted_at', null)
    .not('email', 'is', null)
    .not('email_subject', 'is', null)
    .not('email_body', 'is', null)
    .not('analyzed_at', 'is', null)
    .order('score', { ascending: false, nullsFirst: false })
    .limit(limit + skip.length + 20)
  return ((data || []) as Lead[]).filter((l) => l.email && !SYSTEM_EMAIL.test(l.email) && !skip.includes(l.id)).slice(0, limit)
}

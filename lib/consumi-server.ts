import { BridgeError, callBeta } from '@/lib/beta-bridge'
import { normalizeBetaUsers, usageFromOthersSpaces } from '@/lib/beta-users'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { loadRun, loadSettings, pausedSearches } from '@/lib/autopilot'
import { looksLikeDescription } from '@/lib/autopilot-searches'
import { scrub, zonedStart } from '@/lib/google-usage'
import {
  DELAY,
  siteFeatureLabel,
  type AiTotals,
  type AutopilotInfo,
  type ConsumiUser,
  type SiteAiData,
  type Source,
} from '@/lib/consumi'

// Fonti interne della pagina Consumi (solo server): utenti della beta con i loro
// consumi reali (collegamento con la beta), chiamate AI del sito principale
// (tabella ai_usage, token letti dalla risposta dell'API) e ricerche
// dell'automazione del Motore clienti. Nessun importo stimato.

const USERS_TTL = 60_000
const SITE_TTL = 60_000

let usersMemory: { until: number; value: Source<ConsumiUser[]> } | null = null
let siteMemory: { until: number; value: Source<SiteAiData> } | null = null

/** Solo per le prove. */
export function resetConsumiServerMemory() {
  usersMemory = null
  siteMemory = null
}

/** Iscritti alla beta con il campo "usage" (cache 60 secondi). */
export async function getBetaUsersUsage(): Promise<Source<ConsumiUser[]>> {
  if (!process.env.FACEVOICE_BRIDGE_SECRET?.trim()) {
    return { status: 'da_collegare', missing: ['FACEVOICE_BRIDGE_SECRET'], delay: DELAY.users }
  }
  if (usersMemory && Date.now() < usersMemory.until) return usersMemory.value
  let value: Source<ConsumiUser[]>
  try {
    const { users } = normalizeBetaUsers(await callBeta('/api/bridge/users'))
    value = {
      status: 'ok',
      fetchedAt: new Date().toISOString(),
      delay: DELAY.users,
      data: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        avatarUrl: u.avatarUrl,
        shown: u.shown,
        blocked: u.blocked,
        usage: u.usage ?? null,
        sharedUsage: usageFromOthersSpaces(u.workspaces),
      })),
    }
  } catch (error) {
    const message = error instanceof BridgeError ? scrub(error.message) : 'Errore nel collegamento con la beta.'
    value = { status: 'errore', message, fetchedAt: new Date().toISOString(), delay: DELAY.users }
  }
  usersMemory = { until: Date.now() + (value.status === 'ok' ? USERS_TTL : 30_000), value }
  return value
}

const emptyTotals = (): AiTotals => ({
  gemini: { calls: 0, input: 0, output: 0 },
  claude: { calls: 0, input: 0, output: 0 },
  limits: 0,
  errors: 0,
})

type SiteRow = { feature: string | null; provider: string; outcome: string; input_tokens: number | null; output_tokens: number | null; created_at: string }

function addRow(t: AiTotals, row: SiteRow) {
  if (row.outcome === 'limit') t.limits++
  else if (row.outcome === 'error') t.errors++
  if (row.outcome !== 'ok') return
  const p = row.provider === 'claude' ? t.claude : t.gemini
  p.calls++
  p.input += Math.max(0, Number(row.input_tokens) || 0)
  p.output += Math.max(0, Number(row.output_tokens) || 0)
}

/** Chiamate AI del sito nel mese e oggi (ora italiana), per funzione (cache 60 secondi). */
export async function getSiteAiUsage(now = Date.now()): Promise<Source<SiteAiData>> {
  if (siteMemory && Date.now() < siteMemory.until) return siteMemory.value
  let value: Source<SiteAiData>
  try {
    const monthStart = zonedStart(now, 'Europe/Rome', 'month')
    const todayStart = zonedStart(now, 'Europe/Rome', 'day')
    const month = emptyTotals()
    const today = emptyTotals()
    const byFeature = new Map<string, { calls: number; input: number; output: number }>()
    for (let from = 0; from < 50_000; from += 1000) {
      const { data, error } = await supabaseAdmin
        .from('ai_usage')
        .select('feature, provider, outcome, input_tokens, output_tokens, created_at')
        .gte('created_at', new Date(monthStart).toISOString())
        // Dal piu' vecchio, con l'id per gli istanti uguali: le righe scritte durante la
        // lettura finiscono dopo le pagine gia' lette (nessuna contata due volte o saltata).
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + 999)
      if (error) throw new Error(error.message)
      for (const row of (data || []) as SiteRow[]) {
        addRow(month, row)
        if (Date.parse(row.created_at) >= todayStart) addRow(today, row)
        if (row.outcome === 'ok') {
          const key = row.feature || 'altro'
          const f = byFeature.get(key) || { calls: 0, input: 0, output: 0 }
          f.calls++
          f.input += Math.max(0, Number(row.input_tokens) || 0)
          f.output += Math.max(0, Number(row.output_tokens) || 0)
          byFeature.set(key, f)
        }
      }
      if (!data || data.length < 1000) break
    }
    value = {
      status: 'ok',
      fetchedAt: new Date().toISOString(),
      delay: DELAY.site,
      data: {
        monthStart: new Date(monthStart).toISOString(),
        month,
        today,
        byFeature: [...byFeature.entries()]
          .map(([feature, f]) => ({ feature, label: siteFeatureLabel(feature), ...f }))
          .sort((a, b) => b.input + b.output - (a.input + a.output))
          .slice(0, 12),
      },
    }
  } catch (error) {
    console.error('consumi (sito):', scrub(error instanceof Error ? error.message : String(error)))
    value = { status: 'errore', message: 'Non riesco a leggere le chiamate AI del sito (tabella ai_usage).', fetchedAt: new Date().toISOString(), delay: DELAY.site }
  }
  siteMemory = { until: Date.now() + (value.status === 'ok' ? SITE_TTL : 30_000), value }
  return value
}

/** Ricerche del Motore clienti in pausa o a vuoto nell'ultimo giro. null se non leggibili. */
export async function getAutopilotInfo(): Promise<AutopilotInfo | null> {
  try {
    const [settings, run] = await Promise.all([loadSettings(), loadRun()])
    const paused = pausedSearches(settings)
    const zeroLastRun = (run?.searched || [])
      .filter((s) => !s.auto && !s.skipped && !s.error && s.added === 0 && settings.searches.includes(s.query) && !paused.includes(s.query))
      .map((s) => ({ query: s.query, found: s.found }))
    return { paused, zeroLastRun, descriptions: settings.searches.filter((q) => looksLikeDescription(q) && !paused.includes(q)) }
  } catch (error) {
    console.error('consumi (automazione):', scrub(error instanceof Error ? error.message : String(error)))
    return null
  }
}

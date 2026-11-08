import {
  aiCallsOf,
  aiTokensOf,
  formatCount,
  placesCalls,
  type BetaUsage,
  type ShownLight,
} from '@/lib/beta-users'

// Pagina "Consumi" (solo admin): tipi condivisi tra server e pagina e funzioni
// pure (ripartizione del costo Places, consigli). Solo numeri reali: richieste
// contate da Google (Cloud Monitoring), costi fatturati da Google (export della
// fatturazione in BigQuery) e da Anthropic (Admin API), richieste e token che la
// beta ha registrato quando il fornitore ha risposto. Nessuna stima, nessuna previsione.

export type Counts = { ok: number; error: number }

/** Un intervallo (minuto, ora o giorno) con le richieste riuscite e in errore. */
export type TrafficPoint = { t: string; label: string; ok: number; error: number }

/** Richieste a un'API di Google con una credenziale, in un progetto. */
export type TrafficSeries = {
  project: string
  /** Nome dell'API per Google, es. places.googleapis.com */
  service: string
  serviceLabel: string
  /** Id della credenziale (mai la chiave). Vuoto: chiamate senza credenziale. */
  credentialId: string
  credentialLabel: string
  /** Ultimi 60 minuti, un punto al minuto (dal piu' vecchio). */
  minutes: TrafficPoint[]
  /** Oggi (ora italiana), un punto all'ora; l'ultima ora e' in corso. */
  hours: TrafficPoint[]
  /** Questo mese (ora italiana), un punto al giorno; l'ultimo e' oggi. */
  days: TrafficPoint[]
  lastHour: Counts
  today: Counts
  month: Counts
  /**
   * Solo Places: richieste Text Search (metodo SearchText) del mese, le sole che la beta
   * registra per utente. Serve a ripartire il costo sulle stesse richieste.
   */
  textSearchMonth?: Counts
}

export type MonitoringData = {
  projects: string[]
  series: TrafficSeries[]
  /** Nomi delle chiavi letti da Google (serve il permesso API Keys Viewer). */
  keyNames: boolean
  warnings: string[]
  /** Fine dell'ultimo minuto contato. */
  windowEnd: string
  /** Inizio del mese contato (mezzanotte del 1°, ora italiana). */
  monthStart: string
}

export type Money = { gross: number; credits: number; net: number }
export type MoneyUsage = Money & { usage: number }

/** Una riga dell'export della fatturazione: progetto, servizio, SKU. */
export type BillingLine = {
  project: string
  service: string
  sku: string
  currency: string
  unit: string
  month: MoneyUsage
  today: MoneyUsage
  /** Uso dal 1° del mese a mezzanotte, ora italiana (stesso periodo delle richieste contate). */
  romeMonth: MoneyUsage
}

export type BillingGroup = { project: string; service: string; currency: string; month: Money; today: Money }

export type BillingData = {
  table: string
  /** Mese di fatturazione di Google, AAAAMM (ora del Pacifico, come la console). */
  invoiceMonth: string
  /** Inizio del mese italiano usato per romeMonth (mezzanotte del 1°, ora italiana). */
  romeMonthStart: string
  /** Ultimo aggiornamento dell'export (export_time piu' recente). */
  lastExport: string | null
  lines: BillingLine[]
  groups: BillingGroup[]
  totals: { currency: string; month: Money; today: Money }[]
}

export type AnthropicData = {
  currency: 'USD'
  monthStart: string
  month: number
  today: number
  byLine: { description: string; amount: number }[]
}

export type Source<T> =
  | { status: 'ok'; data: T; fetchedAt: string; delay: string }
  | { status: 'da_collegare'; missing: string[]; delay: string }
  | { status: 'errore'; message: string; fetchedAt: string; delay: string }

export const DELAY = {
  monitoring: 'Richieste contate da Google al minuto, con qualche minuto di ritardo.',
  billing: 'Costi dell’export della fatturazione: Google lo aggiorna più volte al giorno, non al minuto.',
  anthropic: 'Costi di Anthropic: di solito arrivano entro 5 minuti.',
  users: 'Richieste e token registrati dalla beta quando il fornitore ha risposto.',
  site: 'Chiamate AI del sito registrate quando il fornitore ha risposto.',
} as const

/** Iscritto alla beta con i suoi consumi reali (dal collegamento con la beta). */
export type ConsumiUser = {
  id: string
  name: string
  email: string
  avatarUrl: string | null
  shown: ShownLight
  blocked: boolean
  usage: BetaUsage | null
  /**
   * Non e' titolare di nessuno spazio: "usage" sono gli spazi in cui lavora, gia' contati al
   * titolare. Fuori dai totali e senza euro.
   */
  sharedUsage: boolean
}

export type AiTotals = {
  gemini: { calls: number; input: number; output: number }
  claude: { calls: number; input: number; output: number }
  /** Volte in cui Gemini ha risposto "limite raggiunto". */
  limits: number
  errors: number
}

/** Chiamate AI del sito principale (tabella ai_usage). */
export type SiteAiData = {
  monthStart: string
  month: AiTotals
  today: AiTotals
  byFeature: { feature: string; label: string; calls: number; input: number; output: number }[]
}

/** Ricerche dell'automazione del Motore clienti (per i consigli). */
export type AutopilotInfo = {
  paused: string[]
  /** Ricerche della lista che nell'ultimo giro non hanno trovato attivita' nuove. */
  zeroLastRun: { query: string; found: number }[]
  /** Ricerche scritte come descrizione (Maps trova pochissimo). */
  descriptions: string[]
}

export type PlacesAttribution = {
  project: string
  /** Richieste Places Text Search riuscite del progetto della beta dal 1° del mese (ora italiana), contate da Google. */
  projectOk: number
  /** Costo netto delle voci Text Search del progetto della beta per l'uso dallo stesso momento (export della fatturazione). */
  netCost: number
  currency: string
  /** Inizio del periodo, uguale per richieste e costo: mezzanotte del 1° del mese, ora italiana. */
  periodStart: string
}

export type PlacesAttributionResult = { ok: true; value: PlacesAttribution } | { ok: false; reason: string }

/**
 * Come il sito entra in Google: "wif" senza chiave (token OIDC di Vercel scambiato con
 * Workload Identity Federation), "json" con la chiave JSON del service account. null: da collegare.
 */
export type GoogleAccessMode = 'wif' | 'json'

/** Testo per la pagina (niente di segreto). */
export const googleAccessLabel = (mode: GoogleAccessMode | null | undefined) =>
  mode === 'wif' ? 'Accesso: senza chiave (Vercel)' : mode === 'json' ? 'Accesso: chiave JSON' : 'Accesso a Google: da collegare'

export type ConsumiResponse = {
  updatedAt: string
  monitoring: Source<MonitoringData>
  billing: Source<BillingData>
  anthropic: Source<AnthropicData>
  users: Source<ConsumiUser[]>
  site: Source<SiteAiData>
  autopilot: AutopilotInfo | null
  places: PlacesAttributionResult
  tips: string[]
  betaProject: string | null
  /** Modo di accesso a Google attivo (solo il nome del modo). */
  googleAccess: GoogleAccessMode | null
}

export const PLACES_SERVICE = 'places.googleapis.com'
export const GEMINI_SERVICE = 'generativelanguage.googleapis.com'

const SERVICE_LABELS: Record<string, string> = {
  [PLACES_SERVICE]: 'Places (Google Maps)',
  [GEMINI_SERVICE]: 'Gemini',
  'maps-backend.googleapis.com': 'Maps JavaScript',
  'geocoding-backend.googleapis.com': 'Geocoding',
  'places-backend.googleapis.com': 'Places (vecchia)',
  'aiplatform.googleapis.com': 'Vertex AI',
  'youtube.googleapis.com': 'YouTube',
  'gmail.googleapis.com': 'Gmail',
  'monitoring.googleapis.com': 'Cloud Monitoring',
  'bigquery.googleapis.com': 'BigQuery',
  'apikeys.googleapis.com': 'API Keys',
}

/** Nome breve di un'API di Google. */
export const serviceLabel = (service: string) =>
  SERVICE_LABELS[service] || service.replace(/\.googleapis\.com$/, '') || 'API sconosciuta'

/** Riga dell'export delle ricerche Places Text Search (le sole che la beta registra per utente). */
export const isTextSearchLine = (line: Pick<BillingLine, 'service' | 'sku'>) => /places/i.test(line.service) && /text search/i.test(line.sku)

/** Riga dell'export che riguarda Places. */
export const isPlacesLine = (line: Pick<BillingLine, 'service' | 'sku'>) =>
  /places/i.test(line.service) || /\b(text search|nearby search|place details|place photo|autocomplete)\b/i.test(line.sku)

/** Riga dell'export che riguarda Gemini. */
export const isGeminiLine = (line: Pick<BillingLine, 'service' | 'sku'>) => /generative language|gemini/i.test(`${line.service} ${line.sku}`)

const sumCounts = (list: Counts[]): Counts => list.reduce((a, c) => ({ ok: a.ok + c.ok, error: a.error + c.error }), { ok: 0, error: 0 })

/** Richieste del mese per API (tutte le chiavi e i progetti insieme). */
export function monthByService(series: TrafficSeries[]): { service: string; label: string; month: Counts; today: Counts }[] {
  const map = new Map<string, TrafficSeries[]>()
  for (const s of series) map.set(s.service, [...(map.get(s.service) || []), s])
  return [...map.entries()]
    .map(([service, list]) => ({
      service,
      label: serviceLabel(service),
      month: sumCounts(list.map((s) => s.month)),
      today: sumCounts(list.map((s) => s.today)),
    }))
    .sort((a, b) => b.month.ok + b.month.error - (a.month.ok + a.month.error))
}

/**
 * Dati per ripartire il costo Places della beta sugli utenti, tutti sullo stesso periodo
 * (dal 1° del mese a mezzanotte, ora italiana, come le richieste della beta) e sulle stesse
 * richieste (Text Search): richieste riuscite del progetto della beta contate da Google
 * (Monitoring, metodo SearchText) e costo netto delle voci Text Search dello stesso progetto
 * per l'uso dallo stesso momento (export della fatturazione).
 */
export function placesAttributionFrom(
  monitoring: MonitoringData | null | undefined,
  billing: BillingData | null | undefined,
  betaProject: string | null | undefined
): PlacesAttributionResult {
  if (!betaProject) return { ok: false, reason: 'Per ripartire il costo Places scrivi in GOOGLE_BETA_PROJECT il progetto Google della beta.' }
  if (!billing) return { ok: false, reason: 'Per ripartire il costo Places serve l’export della fatturazione (costi reali).' }
  if (!monitoring) return { ok: false, reason: 'Per ripartire il costo Places servono le richieste contate da Google (Cloud Monitoring).' }
  if (!monitoring.projects.includes(betaProject)) {
    return { ok: false, reason: `Aggiungi ${betaProject} a GOOGLE_USAGE_PROJECTS per contare le sue richieste Places.` }
  }
  if (!billing.romeMonthStart || Date.parse(billing.romeMonthStart) !== Date.parse(monitoring.monthStart)) {
    return { ok: false, reason: 'Il mese è appena cambiato: la ripartizione del costo Places torna tra qualche minuto.' }
  }
  const projectOk = monitoring.series
    .filter((s) => s.project === betaProject && s.service === PLACES_SERVICE)
    .reduce((n, s) => n + (s.textSearchMonth?.ok ?? 0), 0)
  const lines = billing.lines.filter(
    (l) => l.project === betaProject && isTextSearchLine(l) && (l.romeMonth.gross !== 0 || l.romeMonth.credits !== 0 || l.romeMonth.usage !== 0)
  )
  if (!lines.length) return { ok: false, reason: `Nell’export non ci sono ancora costi Places (Text Search) del progetto ${betaProject} da inizio mese.` }
  if (projectOk <= 0) return { ok: false, reason: `Google non ha ancora contato richieste Places riuscite del progetto ${betaProject} questo mese.` }
  const currency = lines[0].currency
  const netCost = lines.filter((l) => l.currency === currency).reduce((n, l) => n + l.romeMonth.net, 0)
  return { ok: true, value: { project: betaProject, projectOk, netCost, currency, periodStart: billing.romeMonthStart } }
}

/**
 * Costo Google ripartito sulle richieste reali:
 * richieste Places riuscite dell'utente / richieste Places riuscite del progetto della beta
 * x costo netto Places del progetto (stesso periodo). Si divide per il numero piu' alto tra
 * le richieste contate da Google e quelle registrate da tutti gli utenti (usersOk): Google le
 * conta con qualche minuto di ritardo, e cosi' la somma delle quote non supera mai il costo.
 */
export function attributedPlacesCost(userMonthOk: number, a: Pick<PlacesAttribution, 'projectOk' | 'netCost'>, usersOk = 0): number | null {
  const base = Math.max(a.projectOk, Number.isFinite(usersOk) ? usersOk : 0)
  if (!(a.projectOk > 0) || !Number.isFinite(a.netCost) || !Number.isFinite(userMonthOk) || userMonthOk < 0) return null
  return Math.min(1, userMonthOk / base) * a.netCost
}

/**
 * Quota di un utente, o null quando non si puo' dare: dati Google mancanti, utente che non e'
 * titolare (consumi gia' contati al titolare) o periodo della beta diverso da quello di Google.
 */
export function userPlacesShare(
  usage: BetaUsage | null | undefined,
  sharedUsage: boolean,
  a: PlacesAttribution | null | undefined,
  usersOk: number
): number | null {
  if (!usage || sharedUsage || !a) return null
  if (usage.periodStart && Date.parse(usage.periodStart) !== Date.parse(a.periodStart)) return null
  return attributedPlacesCost(usage.month.places.ok, a, usersOk)
}

/** Richieste Places riuscite del mese degli utenti titolari (quelli contati nei totali). */
export const ownersPlacesOk = (users: { usage?: BetaUsage | null; sharedUsage: boolean }[]) =>
  users.reduce((n, u) => n + (u.usage && !u.sharedUsage ? u.usage.month.places.ok : 0), 0)

export const ATTRIBUTION_LABEL = 'Costo Google Places ripartito sulle richieste reali'

export const ATTRIBUTION_RULE =
  'richieste Places riuscite dell’utente ÷ richieste Places riuscite del progetto della beta contate da Google × costo netto delle voci “Text Search” del progetto (export della fatturazione). Solo ricerche Text Search, tutte dal 1° del mese (ora italiana); la somma delle quote non supera il costo reale.'

export const ATTRIBUTION_FORMULA = `${ATTRIBUTION_LABEL} = ${ATTRIBUTION_RULE}`

const MONEY_FORMATS = new Map<string, Intl.NumberFormat>()
/** 3,10 € oppure 3,10 USD, secondo la valuta della fatturazione. */
export function formatMoney(value: number, currency: string) {
  const code = /^[A-Z]{3}$/.test(currency) ? currency : 'EUR'
  let f = MONEY_FORMATS.get(code)
  if (!f) {
    f = new Intl.NumberFormat('it-IT', { style: 'currency', currency: code, minimumFractionDigits: 2, maximumFractionDigits: 2 })
    MONEY_FORMATS.set(code, f)
  }
  return f.format(Number.isFinite(value) ? value : 0)
}

const pct = (part: number, total: number) => Math.round((part / total) * 100)
const n = (v: number) => v.toLocaleString('it-IT')

export type TipsInput = {
  monitoring?: MonitoringData | null
  billing?: BillingData | null
  users?: ConsumiUser[] | null
  site?: SiteAiData | null
  autopilot?: AutopilotInfo | null
}

const MAX_TIPS = 7

/**
 * Consigli "Come ridurre i consumi", scritti solo a partire dai numeri reali.
 * Sono testi, non previsioni: dicono cosa e' successo e dove intervenire.
 */
export function buildTips({ monitoring, billing, users, site, autopilot }: TipsInput): string[] {
  const tips: string[] = []

  // 1) Richieste in errore (contate da Google).
  if (monitoring) {
    for (const s of monthByService(monitoring.series)) {
      const total = s.month.ok + s.month.error
      if (total >= 20 && s.month.error / total >= 0.05) {
        tips.push(
          `${s.label}: ${pct(s.month.error, total)}% delle richieste di questo mese è andato in errore (${n(s.month.error)} su ${n(total)}). Non danno risultati ma usano la quota: controlla chiave e limiti su Google Cloud.`
        )
      }
    }
  }

  // 2) Costi reali: la voce piu' cara e le ricerche Places con la tariffa piu' alta.
  if (billing) {
    const lines = billing.lines.filter((l) => l.month.net > 0).sort((a, b) => b.month.net - a.month.net)
    const top = lines[0]
    if (top) {
      const total = billing.totals.find((t) => t.currency === top.currency)?.month.net ?? top.month.net
      tips.push(
        `La voce che costa di più questo mese è “${top.sku}” (${top.service}${top.project ? `, progetto ${top.project}` : ''}): ${formatMoney(top.month.net, top.currency)} netti su ${formatMoney(total, top.currency)}.`
      )
    }
    const enterprise = lines.find((l) => isPlacesLine(l) && /enterprise|atmosphere/i.test(l.sku))
    if (enterprise) {
      tips.push(
        `Le ricerche Places sono fatturate come “${enterprise.sku}” (${formatMoney(enterprise.month.net, enterprise.currency)} questo mese): Google applica questa tariffa quando si chiedono telefono, sito o valutazioni. Chiedere solo i campi che servono abbassa la tariffa.`
      )
    }
  }

  // 3) Automazione del Motore clienti: ricerche che non trovano niente di nuovo.
  if (autopilot) {
    const p = autopilot.paused.length
    if (p) {
      tips.push(
        `${p === 1 ? `La ricerca “${autopilot.paused[0]}” è in pausa` : `${p} ricerche sono in pausa`} nell’automazione del Motore clienti: nessuna attività nuova nelle ultime 3 volte, quindi non ${p === 1 ? 'usa' : 'usano'} più Places. Riattivale dal Motore clienti se cambi città o categoria.`
      )
    }
    for (const z of autopilot.zeroLastRun.slice(0, 2)) {
      tips.push(`Nell’ultimo giro dell’automazione “${z.query}” ha trovato ${n(z.found)} attività e nessuna nuova: dopo 3 volte così va in pausa da sola.`)
    }
    const d = autopilot.descriptions[0]
    if (d) {
      tips.push(`La ricerca “${d}” è scritta come descrizione: su Google Maps trova pochissimo e spreca richieste. Meglio categoria + città, ad esempio “ristoranti Palermo”.`)
    }
  }

  // 4) Utenti della beta: Claude contro Gemini, chi usa di piu' Places, la funzione che usa piu' token.
  // Solo i titolari: chi lavora negli spazi di un altro ha gli stessi numeri del titolare.
  const withUsage = (users || []).filter((u): u is ConsumiUser & { usage: BetaUsage } => Boolean(u.usage) && !u.sharedUsage)
  if (withUsage.length) {
    const gemini = withUsage.reduce((s, u) => s + u.usage.month.ai.gemini.calls, 0)
    const claude = withUsage.reduce((s, u) => s + u.usage.month.ai.claude.calls, 0)
    const ai = gemini + claude
    if (ai >= 20 && claude / ai >= 0.1) {
      tips.push(
        `Claude ha fatto il ${pct(claude, ai)}% delle chiamate AI degli utenti questo mese (${n(claude)} su ${n(ai)}). Claude si paga a token (costo Anthropic qui sopra): è la parte AI da tenere d’occhio.`
      )
    }
    const places = withUsage.map((u) => ({ u, ok: u.usage.month.places.ok })).sort((a, b) => b.ok - a.ok)
    const placesTotal = places.reduce((s, x) => s + x.ok, 0)
    const first = places[0]
    if (withUsage.length >= 2 && placesTotal >= 50 && first && first.ok / placesTotal >= 0.5) {
      const feature = first.u.usage.byFeature.filter((f) => f.places > 0).sort((a, b) => b.places - a.places)[0]
      tips.push(
        `${first.u.name} fa il ${pct(first.ok, placesTotal)}% delle richieste Places degli utenti (${n(first.ok)} su ${n(placesTotal)} questo mese)${feature ? `, soprattutto da “${feature.label}”` : ''}.`
      )
    }
    if (!monitoring) {
      const err = withUsage.reduce((s, u) => s + u.usage.month.places.error, 0)
      const tot = withUsage.reduce((s, u) => s + placesCalls(u.usage.month), 0)
      if (tot >= 20 && err / tot >= 0.05) {
        tips.push(`Richieste Places degli utenti in errore questo mese: ${n(err)} su ${n(tot)} (${pct(err, tot)}%). Non danno risultati: controlla la chiave Places della beta.`)
      }
    }
    const features = new Map<string, { label: string; tokens: number }>()
    for (const u of withUsage) {
      for (const f of u.usage.byFeature) {
        const cur = features.get(f.feature) || { label: f.label, tokens: 0 }
        cur.tokens += f.input + f.output
        features.set(f.feature, cur)
      }
    }
    const topFeature = [...features.values()].sort((a, b) => b.tokens - a.tokens)[0]
    const allTokens = withUsage.reduce((s, u) => s + aiTokensOf(u.usage.month), 0)
    if (topFeature && topFeature.tokens > 0 && allTokens > 0 && topFeature.tokens / allTokens >= 0.4) {
      tips.push(
        `“${topFeature.label}” usa il ${pct(topFeature.tokens, allTokens)}% dei token AI degli utenti (${formatCount(topFeature.tokens)} questo mese): è il primo posto dove accorciare testi e risposte.`
      )
    }
  }

  // 5) Il sito principale.
  if (site) {
    const ai = site.month.gemini.calls + site.month.claude.calls
    if (ai >= 20 && site.month.claude.calls / ai >= 0.1) {
      tips.push(
        `Sul tuo sito Claude ha fatto il ${pct(site.month.claude.calls, ai)}% delle chiamate AI questo mese (${n(site.month.claude.calls)} su ${n(ai)})${
          site.month.limits ? `; Gemini ha risposto “limite raggiunto” ${n(site.month.limits)} volte` : ''
        }.`
      )
    }
  }

  if (!tips.length) {
    const anyData = Boolean(monitoring || billing || withUsage.length || site)
    return [
      anyData
        ? 'Per ora nessuno spreco evidente nei numeri reali: errori bassi, nessuna ricerca a vuoto.'
        : 'Collega le fonti (vedi “Come collegare”) per avere consigli sui numeri reali.',
    ]
  }
  return tips.slice(0, MAX_TIPS)
}

/** Totali dei consumi reali di una lista di utenti nel mese (solo titolari: niente doppi conteggi). */
export function usersMonthTotals(users: ConsumiUser[]) {
  let placesOk = 0
  let placesError = 0
  let gemini = 0
  let claude = 0
  let tokens = 0
  for (const u of users) {
    if (!u.usage || u.sharedUsage) continue
    placesOk += u.usage.month.places.ok
    placesError += u.usage.month.places.error
    gemini += u.usage.month.ai.gemini.calls
    claude += u.usage.month.ai.claude.calls
    tokens += aiTokensOf(u.usage.month)
  }
  return { placesOk, placesError, gemini, claude, ai: gemini + claude, tokens }
}

/** Ordine della lista utenti: chi consuma di piu' nel mese prima. */
export const usageWeight = (u: ConsumiUser) => (u.usage ? placesCalls(u.usage.month) + aiCallsOf(u.usage.month) : -1)

/** Funzioni del sito principale (stessi nomi del pulsante Consumi della Super chat). */
export const SITE_FEATURES: Record<string, string> = {
  chat_sito: 'Chat del sito',
  risposte_email: 'Risposte email',
  risposte_social: 'Risposte Instagram, Facebook, WhatsApp',
  controrisposte_clienti: 'Controrisposte ai clienti cercati',
  correzioni_risposte: 'Correzioni delle risposte (regole imparate)',
  assistente_clienti: 'Super chat e assistente clienti',
  email_clienti: 'Email e follow-up ai clienti',
  analisi_clienti: 'Analisi dei siti dei clienti',
  traduzioni_sito: 'Traduzioni del sito',
  super_chat_carosello: 'Caroselli della super chat',
  super_chat_slide: 'Modifiche alle slide dei caroselli',
  super_chat_documenti: 'Documenti della super chat (contratti, preventivi)',
  ricerca_tools: 'Ricerca AI Tools',
  altro: 'Altro',
}

export const siteFeatureLabel = (feature: string) => SITE_FEATURES[feature] || feature.replace(/_/g, ' ')

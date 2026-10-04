import { supabaseAdmin } from '@/lib/supabase-admin'
import { GEMINI_DEFAULT_MODEL, callGeminiWithFallback, getGeminiApiKey } from '@/lib/gemini'

// Ricerca clienti: Google Places (API ufficiale, niente scraping di Google),
// poi lettura del sito di ogni attivita' per email e social, poi analisi AI
// con bozza di primo contatto. L'invio resta manuale, uno alla volta.

export type Lead = {
  id: string
  place_id: string | null
  search_query: string | null
  name: string
  address: string | null
  phone: string | null
  website: string | null
  email: string | null
  instagram: string | null
  facebook: string | null
  rating: number | null
  reviews_count: number | null
  maps_url: string | null
  score: number | null
  analysis: string | null
  email_subject: string | null
  email_body: string | null
  dm_text: string | null
  status: string
  notes: string | null
  analyzed_at: string | null
  contacted_at: string | null
  created_at: string
}

export const LEAD_STATUSES = ['new', 'contacted', 'replied', 'client', 'discarded', 'do_not_contact'] as const
export const MAX_RESULTS = 60
// Tetto giornaliero di primi contatti via email: protegge la reputazione di facevoice.ai.
export const DAILY_EMAIL_LIMIT = 30

export function placesKey() {
  return process.env.GOOGLE_PLACES_API_KEY?.trim() || ''
}

type PlacesResponse = {
  places?: Array<{
    id: string
    displayName?: { text?: string }
    formattedAddress?: string
    nationalPhoneNumber?: string
    internationalPhoneNumber?: string
    websiteUri?: string
    rating?: number
    userRatingCount?: number
    googleMapsUri?: string
  }>
  nextPageToken?: string
  error?: { message?: string }
}

/** Cerca su Google Maps e salva le attivita' nuove. Restituisce quante ne ha trovate e aggiunte. */
export async function searchPlaces(query: string, max: number): Promise<{ found: number; added: number }> {
  const key = placesKey()
  if (!key) throw new Error('Manca GOOGLE_PLACES_API_KEY nelle variabili di Vercel')

  const rows: Partial<Lead>[] = []
  let pageToken: string | undefined
  // Google restituisce al massimo 20 risultati per pagina e 3 pagine per ricerca.
  for (let page = 0; page < 3 && rows.length < max; page++) {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.googleMapsUri,nextPageToken',
      },
      body: JSON.stringify({
        textQuery: query,
        languageCode: 'it',
        regionCode: 'IT',
        pageSize: 20,
        ...(pageToken ? { pageToken } : {}),
      }),
    })
    const data = (await response.json().catch(() => ({}))) as PlacesResponse
    if (!response.ok) throw new Error(data.error?.message || `Google Places ${response.status}`)

    for (const place of data.places || []) {
      rows.push({
        place_id: place.id,
        search_query: query,
        name: place.displayName?.text || 'Senza nome',
        address: place.formattedAddress || null,
        phone: place.internationalPhoneNumber || place.nationalPhoneNumber || null,
        website: place.websiteUri || null,
        rating: place.rating ?? null,
        reviews_count: place.userRatingCount ?? null,
        maps_url: place.googleMapsUri || null,
      })
    }
    pageToken = data.nextPageToken
    if (!pageToken) break
  }

  const limited = rows.slice(0, max)
  if (!limited.length) return { found: 0, added: 0 }

  // Le attivita' gia' in lista (stesso place_id) non vengono toccate: stato e note restano.
  const { data: inserted, error } = await supabaseAdmin
    .from('leads')
    .upsert(limited, { onConflict: 'place_id', ignoreDuplicates: true })
    .select('id')
  if (error) throw new Error(error.message)
  return { found: limited.length, added: inserted?.length ?? 0 }
}

// ---------------------------------------------------------------------
// Lettura del sito
// ---------------------------------------------------------------------

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const IGNORED_EMAIL = /\.(png|jpe?g|gif|webp|svg)$|sentry|wixpress|example\.|domain\.|@2x|u00/i

async function fetchPage(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FacevoiceAI/1.0; +https://www.facevoice.ai)' },
    })
    if (!response.ok || !(response.headers.get('content-type') || '').includes('text/html')) return ''
    return (await response.text()).slice(0, 400_000)
  } catch {
    return ''
  }
}

function visibleText(html: string) {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function pickEmail(html: string, domain: string): string | null {
  const fromMailto = [...html.matchAll(/mailto:([^"'?\s>]+)/gi)].map((m) => decodeURIComponent(m[1]))
  const found = [...fromMailto, ...(html.match(EMAIL_RE) || [])]
    .map((e) => e.trim().toLowerCase())
    .filter((e) => !IGNORED_EMAIL.test(e))
  if (!found.length) return null
  // Preferisce un indirizzo dello stesso dominio del sito, poi info@/contatti@.
  const sameDomain = found.find((e) => domain && e.endsWith(`@${domain}`))
  return sameDomain || found.find((e) => /^(info|contatti|contact|hello|ciao)@/.test(e)) || found[0]
}

function pickSocial(html: string, host: 'instagram.com' | 'facebook.com'): string | null {
  const re = new RegExp(`https?://(?:www\\.)?${host.replace('.', '\\.')}/[A-Za-z0-9_.\\-/]+`, 'gi')
  const links = (html.match(re) || []).filter(
    (link) => !/\/(sharer|share|plugins|tr|dialog|p|reel|explore|hashtag)\b/i.test(link)
  )
  return links[0]?.replace(/\/+$/, '') || null
}

export type SiteInfo = { email: string | null; instagram: string | null; facebook: string | null; text: string; reachable: boolean }

export async function readWebsite(website: string): Promise<SiteInfo> {
  let base: URL
  try {
    base = new URL(website)
  } catch {
    return { email: null, instagram: null, facebook: null, text: '', reachable: false }
  }
  // Solo siti pubblici: niente indirizzi interni o IP privati.
  if (!/^https?:$/.test(base.protocol) || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[)/i.test(base.hostname)) {
    return { email: null, instagram: null, facebook: null, text: '', reachable: false }
  }
  const domain = base.hostname.replace(/^www\./, '')
  const home = await fetchPage(base.href)
  if (!home) return { email: null, instagram: null, facebook: null, text: '', reachable: false }

  let html = home
  let email = pickEmail(home, domain)
  if (!email) {
    // Pagina contatti: dal link nella home, altrimenti i percorsi piu' comuni.
    const linked = home.match(/href=["']([^"']*(contatt|contact|chi-siamo|about)[^"']*)["']/i)?.[1]
    const candidates = [linked, '/contatti', '/contatti/', '/contact', '/contacts'].filter(Boolean) as string[]
    for (const path of candidates.slice(0, 3)) {
      const page = await fetchPage(new URL(path, base).href)
      if (!page) continue
      html += page
      email = pickEmail(page, domain)
      if (email) break
    }
  }

  return {
    email,
    instagram: pickSocial(html, 'instagram.com'),
    facebook: pickSocial(html, 'facebook.com'),
    text: visibleText(home).slice(0, 6000),
    reachable: true,
  }
}

// ---------------------------------------------------------------------
// Analisi AI e bozze
// ---------------------------------------------------------------------

const ANALYSIS_PROMPT = `Sei l'assistente commerciale di Luca Corrao, fondatore di Facevoice AI: azienda siciliana di sviluppo software su misura, siti web, integrazione AI e automazioni, digitalizzazione e social media management per imprese.

Ricevi i dati di un'attività locale trovata su Google Maps e il testo del suo sito (se esiste). Devi:
1. Valutare quanto è promettente come cliente per Facevoice AI: punteggio da 1 a 10. Alto se ci sono problemi concreti che Facevoice risolve (niente sito, sito datato o lento, niente prenotazione/ordine online, niente social o social trascurati, processi manuali evidenti) e l'attività sembra sana (recensioni, presenza). Basso per catene, franchising, enti pubblici, attività chiuse.
2. Scrivere l'analisi: 2-4 punti deboli concreti e verificabili dai dati, in italiano, una riga ciascuno.
3. Scrivere la PRIMA email di contatto a freddo, come la scriverebbe Luca a mano: colloquiale, naturale, umana, mai finta o "da AI". Del lei, 90-150 parole, paragrafi brevi separati da una riga vuota, niente elenchi, niente prezzi, niente parole gonfiate ("straordinario", "eccezionale", "rivoluzionario"). Struttura obbligatoria, in quest'ordine:
   a) "Buongiorno," (con il nome del titolare solo se compare nei dati).
   b) IL COMPLIMENTO: una cosa SPECIFICA e vera che hai notato nei dati (un dettaglio del sito, delle recensioni, del menù, della storia dell'attività), detta in modo spontaneo, es. "ho visto le foto delle vostre pastaie al lavoro sul sito: si percepisce tutta la cura che c'è dietro, complimenti davvero." Mai complimenti generici.
   c) LA PRESENTAZIONE, 1-2 frasi: "Mi chiamo Luca e con Facevoice AI, una piccola software house siciliana, aiutiamo [tipo di attività simili] a [beneficio concreto legato al loro settore, es. gestire prenotazioni e messaggi in automatico anche fuori orario]."
   d) LA RICHIESTA: una domanda facile e concreta sulla loro situazione (es. "Come gestite oggi le prenotazioni nei momenti di picco o fuori orario?") seguita da una proposta leggera, es. "Se le va, le preparo una proposta su misura, oppure ne parliamo in una chiamata di 10 minuti."
   e) Saluto e firma: "Un saluto,\nLuca Corrao\nFacevoice AI · www.facevoice.ai"
   f) Ultima riga, separata: "P.S. Se non è di suo interesse mi basta un «no grazie» e non la disturberò più."
   Oggetto: breve e naturale, max 7 parole, legato alla loro attività (es. "Prenotazioni per Osteria da Fortunata"), niente maiuscole urlate o emoji.
4. Scrivere un messaggio Direct per Instagram/Facebook: 2-4 frasi, del lei, stesso schema in breve (complimento specifico, chi siamo in mezza frase, una domanda), niente link.

Rispondi SOLO con JSON valido, senza testo prima o dopo, in questo formato:
{"score": 7, "analysis": "- punto 1\\n- punto 2", "email_subject": "...", "email_body": "...", "dm_text": "..."}`

type Analysis = { score: number; analysis: string; email_subject: string; email_body: string; dm_text: string }

function parseAnalysis(raw: string): Analysis | null {
  const json = raw.match(/\{[\s\S]*\}/)?.[0]
  if (!json) return null
  try {
    const data = JSON.parse(json)
    const score = Math.max(1, Math.min(10, Math.round(Number(data.score) || 0)))
    if (!data.email_body) return null
    return {
      score,
      analysis: String(data.analysis || ''),
      email_subject: String(data.email_subject || '').slice(0, 150),
      email_body: String(data.email_body || '').slice(0, 4000),
      dm_text: String(data.dm_text || '').slice(0, 1000),
    }
  } catch {
    return null
  }
}

/** Legge il sito, trova email e social, chiede all'AI analisi e bozze. Aggiorna il lead. */
export async function analyzeLead(lead: Lead): Promise<Lead> {
  if (!getGeminiApiKey()) throw new Error('GEMINI_API_KEY mancante')

  const site = lead.website ? await readWebsite(lead.website) : null
  const facts = [
    `Nome: ${lead.name}`,
    lead.address ? `Indirizzo: ${lead.address}` : '',
    lead.search_query ? `Trovata cercando: ${lead.search_query}` : '',
    lead.rating ? `Google: ${lead.rating}★ su ${lead.reviews_count ?? 0} recensioni` : 'Google: nessuna valutazione',
    lead.website ? `Sito: ${lead.website}${site?.reachable ? '' : ' (non raggiungibile)'}` : 'Sito: nessuno',
    site?.instagram || lead.instagram ? `Instagram: ${site?.instagram || lead.instagram}` : 'Instagram: non trovato',
    site?.facebook || lead.facebook ? `Facebook: ${site?.facebook || lead.facebook}` : 'Facebook: non trovato',
    site?.text ? `\nTesto del sito (estratto):\n${site.text}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const result = await callGeminiWithFallback([{ role: 'user', content: facts }], GEMINI_DEFAULT_MODEL, ANALYSIS_PROMPT, {
    temperature: 0.6,
    maxOutputTokens: 2048,
  })
  const analysis = parseAnalysis(result.message || '')
  if (!analysis) throw new Error('Risposta AI non valida, riprova')

  const { data, error } = await supabaseAdmin
    .from('leads')
    .update({
      email: lead.email || site?.email || null,
      instagram: lead.instagram || site?.instagram || null,
      facebook: lead.facebook || site?.facebook || null,
      ...analysis,
      analyzed_at: new Date().toISOString(),
    })
    .eq('id', lead.id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as Lead
}

import { supabaseAdmin } from '@/lib/supabase-admin'
import { callAIPaced, hasAIProvider } from '@/lib/ai'

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
export async function searchPlaces(query: string, max: number): Promise<{ found: number; added: number; ids: string[] }> {
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
  if (!limited.length) return { found: 0, added: 0, ids: [] }

  // Le attivita' gia' in lista (stesso place_id) non vengono toccate: stato e note restano.
  const { data: inserted, error } = await supabaseAdmin
    .from('leads')
    .upsert(limited, { onConflict: 'place_id', ignoreDuplicates: true })
    .select('id')
  if (error) throw new Error(error.message)
  // Tutte le schede di questa ricerca (nuove e gia' presenti), per mostrarle nella lista.
  const placeIds = limited.map((r) => r.place_id).filter((id): id is string => Boolean(id))
  const { data: all } = await supabaseAdmin.from('leads').select('id').in('place_id', placeIds)
  return { found: limited.length, added: inserted?.length ?? 0, ids: (all || []).map((r) => r.id) }
}

// ---------------------------------------------------------------------
// Lettura del sito
// ---------------------------------------------------------------------

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const IGNORED_EMAIL = /\.(png|jpe?g|gif|webp|svg)$|sentry|wixpress|example\.|domain\.|@2x|u00/i
// Indirizzi del servizio che ospita il sito o di sistema: non sono dell'attivita'.
const SYSTEM_EMAIL = /^(abuse|postmaster|hostmaster|webmaster|noreply|no-reply|donotreply|mailer-daemon|dmca|legal|privacy|gdpr|dpo)[@._-]|@(altervista\.(org|it)|aruba\.it|register\.it|wix\.com|godaddy\.com|siteground\.\w+|ovh\.\w+|netsons\.\w+|tophost\.it|serverplan\.com)$/i

export async function fetchPage(url: string): Promise<string> {
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

export function visibleText(html: string) {
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
    .filter((e) => !IGNORED_EMAIL.test(e) && !SYSTEM_EMAIL.test(e))
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

/** Solo siti pubblici http(s): niente indirizzi interni o IP privati. */
export function isPublicUrl(url: URL): boolean {
  return /^https?:$/.test(url.protocol) && !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[)/i.test(url.hostname)
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
  if (!isPublicUrl(base)) {
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

// Regole della prima email: condivise con l'assistente della Ricerca clienti.
export const FIRST_EMAIL_RULES = `come se Luca la scrivesse al volo dal telefono a una persona del posto: italiano parlato di tutti i giorni, parole semplici e comuni, frasi corte, del TU. Deve sembrare scritta da una persona, non da un'agenzia.
LUNGHEZZA: 50-80 parole in tutto (firma esclusa). Se superi le 80 parole, taglia. Paragrafi di 1-2 frasi separati da una riga vuota, niente elenchi, niente prezzi.
PAROLE VIETATE (sanno di marketing): soluzioni, valorizzare, ottimizzare, potenziare, incrementare, presenza online, presenza digitale, strategia, esperienza utente, fidelizzare, eccellenza, straordinario, eccezionale, innovativo, rivoluzionario, a 360 gradi, realtà (per dire azienda), "mi permetto di".
Struttura, in quest'ordine:
   a) "Ciao!" (o "Ciao [nome]!" solo se il nome del titolare è nei dati).
   b) Complimento in UNA frase, specifico e vero, preso dai dati (recensioni, foto, storia, un dettaglio del sito), detto in modo spontaneo. Mai generico.
   c) Chi siamo in UNA frase corta: "Sono Luca di Facevoice AI, ci occupiamo del digitale per [il loro settore] qui in Sicilia."
   d) L'idea, in 1-2 frasi, proposta in modo velato (una curiosità o una domanda, non una vendita), scelta in base al settore:
      - B&B, case vacanza, affittacamere, hotel e strutture ricettive SENZA un sito proprio (o con un sito su piattaforme gratuite o vecchio): l'idea principale è un sito tutto loro da cui ricevere prenotazioni dirette, così non pagano le commissioni a Booking o Airbnb, si fanno trovare e raccontano la struttura come vogliono. Esempio: "Mi è venuta una curiosità: le prenotazioni vi arrivano tutte da Booking o Airbnb? Con un sito vostro potreste riceverne anche di dirette, senza commissioni." I social al massimo con mezza frase, o per niente.
      - Strutture ricettive CON un sito ma senza prenotazione diretta: prenotazioni dirette dal loro sito, senza commissioni.
      - Ristoranti, pizzerie, bar e locali: un sito con il menù online, per farsi trovare meglio su Google, e i social curati. Esempio: "Ho notato che il menù online non si trova: con un sito semplice col menù vi trovano molto più facilmente su Google."
      - Altre attività: un sito per farsi trovare su Google e i social, scegliendo quello che manca davvero.
      Usa SOLO quello che risulta dai dati: se non sai se hanno un sito, non dire che non ce l'hanno.
   e) Chiusura verso la chiamata: "Se ti va ne parliamo dieci minuti su WhatsApp: scrivimi al +39 351 420 6353 e ti chiamo io." Niente preventivi, proposte su misura, documenti o incontri.
   f) Firma: "A presto,\nLuca Corrao\nFacevoice AI · www.facevoice.ai\nWhatsApp +39 351 420 6353"
   g) NIENTE dopo la firma: nessun P.S., nessun "se non ti interessa…".
Esempio di tono (B&B senza sito), da non copiare parola per parola:
"Ciao!

Ho visto le vostre recensioni su Google, 4,9 con più di 40 commenti: complimenti davvero.

Sono Luca di Facevoice AI, ci occupiamo del digitale per B&B e strutture qui in Sicilia.

Mi è venuta una curiosità: le prenotazioni vi arrivano tutte da Booking o Airbnb? Con un sito vostro potreste riceverne anche di dirette, senza pagare commissioni.

Se ti va ne parliamo dieci minuti su WhatsApp: scrivimi al +39 351 420 6353 e ti chiamo io.

A presto,
Luca Corrao"
Oggetto: corto e parlato, max 6 parole, legato a loro (es. "Una curiosità sul vostro B&B", "Il menù di Osteria da Fortunata"), niente maiuscole urlate o emoji.
Se Luca dà indicazioni sullo stile o sul contenuto, seguile alla lettera: valgono più di queste regole (tranne non inventare fatti).`

export const WHATSAPP_DISPLAY = '+39 351 420 6353'

const ANALYSIS_PROMPT = `Sei l'assistente commerciale di Luca Corrao, fondatore di Facevoice AI: azienda siciliana di sviluppo software su misura, siti web, integrazione AI e automazioni, digitalizzazione e social media management per imprese.

Ricevi i dati di un'attività locale trovata su Google Maps e il testo del suo sito (se esiste). Devi:
1. Valutare quanto è promettente come cliente per Facevoice AI: punteggio da 1 a 10. Alto se ci sono problemi concreti che Facevoice risolve (niente sito, sito datato o lento, niente prenotazione/ordine online, niente social o social trascurati, processi manuali evidenti) e l'attività sembra sana (recensioni, presenza). Basso per catene, franchising, enti pubblici, attività chiuse.
2. Scrivere l'analisi: 2-4 punti deboli concreti e verificabili dai dati, in italiano, una riga ciascuno.
3. Scrivere la PRIMA email di contatto a freddo, ${FIRST_EMAIL_RULES}
4. Scrivere un messaggio Direct per Instagram/Facebook: 2-3 frasi brevissime, dai del tu, stesso tono parlato e stessa idea per settore (complimento specifico, chi siamo in mezza frase, l'idea, invito a sentirsi su WhatsApp), niente link.

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
  if (!hasAIProvider()) throw new Error('Nessuna chiave AI configurata (Gemini o Claude)')

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

  const result = await callAIPaced([{ role: 'user', content: facts }], ANALYSIS_PROMPT, {
    feature: 'analisi_clienti',
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

import { workspaceDb } from '@/lib/workspace-db'
import { afterAIUsage } from '@/lib/usage-limits'

// Ricerca di aziende su Google Maps per Trova clienti (Places API ufficiale, "Text Search"
// della versione nuova, come il Motore clienti del sito principale), una pagina piccola per
// richiesta. Ogni richiesta riuscita costa e si registra nei consumi del cliente (ai_usage,
// funzione "saas_trova_clienti_maps"), cosi' conta nel limite in euro del suo piano.

/**
 * Prezzo di listino Google per una richiesta Text Search (Places API New) con i campi che
 * chiediamo (sito e telefono = SKU "Text Search Enterprise"): 35 USD ogni 1000 richieste,
 * cioe' 0,035 USD l'una (senza contare le richieste gratuite del mese).
 */
export const PLACES_TEXT_SEARCH_FEE_USD = 0.035
export const PLACES_FEATURE = 'saas_trova_clienti_maps'
/** Nella tabella ai_usage il fornitore puo' essere solo gemini o claude: le righe di Google Maps usano "gemini" (Google) con questo modello. */
export const PLACES_MODEL = 'google-places-text-search'
const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText'
const FIELDS = ['places.id', 'places.displayName', 'places.formattedAddress', 'places.nationalPhoneNumber', 'places.internationalPhoneNumber', 'places.websiteUri', 'places.googleMapsUri', 'places.businessStatus'].join(',')

export const placesKey = () => process.env.GOOGLE_PLACES_API_KEY?.trim() || ''

let warned = false
/** Ricerca disponibile (chiave presente). Senza chiave lo si scrive una volta nei log del server. */
export function placesAvailable(): boolean {
  if (placesKey()) return true
  if (!warned) {
    warned = true
    console.warn('trova clienti: GOOGLE_PLACES_API_KEY mancante, la ricerca delle aziende è spenta')
  }
  return false
}

export type Place = { id: string; name: string; address: string | null; phone: string | null; website: string | null; mapsUrl: string | null }

export class PlacesError extends Error {
  constructor(message: string, readonly fatal = false) {
    super(message)
    this.name = 'PlacesError'
  }
}

type PlacesResponse = {
  places?: Array<{
    id?: string
    displayName?: { text?: string }
    formattedAddress?: string
    nationalPhoneNumber?: string
    internationalPhoneNumber?: string
    websiteUri?: string
    googleMapsUri?: string
    businessStatus?: string
  }>
  error?: { message?: string; status?: string }
}

/** Costo di una richiesta a Google Maps nei consumi del cliente (non blocca e non fa fallire la ricerca). */
export function recordPlacesFee(workspaceId: string): Promise<boolean> {
  const logged = Promise.resolve(
    workspaceDb(workspaceId).from('ai_usage').insert({
      feature: PLACES_FEATURE,
      provider: 'gemini',
      model: PLACES_MODEL,
      outcome: 'ok',
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: PLACES_TEXT_SEARCH_FEE_USD,
    })
  )
    .then(({ error }) => {
      if (error) console.warn('ai_usage (google maps):', error.message)
      return !error
    })
    .catch(() => false)
  afterAIUsage(workspaceId, PLACES_TEXT_SEARCH_FEE_USD, logged)
  return logged
}

/**
 * Una pagina di risultati per una ricerca ("ristoranti Palermo"). Le attivita' chiuse non
 * si restituiscono. Lancia PlacesError (fatal: chiave rifiutata o servizio spento, inutile riprovare).
 */
export async function searchPlacesPage(workspaceId: string, query: string, options: { pageSize?: number; timeoutMs?: number } = {}): Promise<Place[]> {
  const key = placesKey()
  if (!key) throw new PlacesError('ricerca non disponibile', true)
  const pageSize = Math.min(20, Math.max(1, Math.round(options.pageSize ?? 10)))
  let response: Response
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS },
      body: JSON.stringify({ textQuery: query, languageCode: 'it', regionCode: 'IT', pageSize }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 12_000),
    })
  } catch (error) {
    throw new PlacesError(`Google Maps non risponde (${error instanceof Error ? error.name : 'rete'})`)
  }
  const data = (await response.json().catch(() => ({}))) as PlacesResponse
  if (!response.ok) {
    // Mai la chiave nei messaggi (se Google la ripetesse).
    const reason = String(data.error?.message || `errore ${response.status}`).split(key).join('***').slice(0, 200)
    throw new PlacesError(`Google Maps: ${reason}`, response.status === 401 || response.status === 403)
  }
  // Richiesta riuscita: costa anche se non trova niente.
  await recordPlacesFee(workspaceId)
  return (data.places || [])
    .filter((p) => p.id && p.businessStatus !== 'CLOSED_PERMANENTLY')
    .map((p) => ({
      id: String(p.id),
      name: String(p.displayName?.text || 'Senza nome').slice(0, 120),
      address: p.formattedAddress?.slice(0, 200) || null,
      phone: (p.internationalPhoneNumber || p.nationalPhoneNumber || '').slice(0, 40) || null,
      website: p.websiteUri?.slice(0, 300) || null,
      mapsUrl: p.googleMapsUri?.slice(0, 300) || null,
    }))
}

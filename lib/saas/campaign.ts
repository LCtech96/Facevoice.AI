import { readSetting, updateSetting } from '@/lib/settings-store'

// Campagna: memoria di contesto per una campagna marketing (Omnichat → "Campagna").
// Quando e' accesa, nei canali scelti l'AI risponde SOLO con queste informazioni,
// al posto delle Istruzioni dell'attivita'; spenta, l'AI torna alle Istruzioni e
// non la legge piu'. Una per spazio di lavoro:
//
//   app_settings campaign:<spazio> = Campaign (JSON)
//
// Le risposte scritte con la campagna si segnano (per il chip "Campagna" nell'Omnichat
// e nei Commenti) senza toccare le tabelle:
//
//   app_settings campaign_replies:<spazio> = [{ id, name, at }] (le ultime 300)
//
// Canali e superfici: email (risposte email), instagram_dm e instagram_comments,
// facebook_messenger e facebook_comments. WhatsApp e chat del sito: sempre Istruzioni.

export const CAMPAIGN_SCOPES = ['email', 'instagram_dm', 'instagram_comments', 'facebook_messenger', 'facebook_comments'] as const
export type CampaignScope = (typeof CAMPAIGN_SCOPES)[number]
export type CampaignScopes = Record<CampaignScope, boolean>
export type CampaignPlatform = 'email' | 'instagram' | 'facebook'

export type Campaign = {
  active: boolean
  /** Nome breve (facoltativo): si vede sulle schede dei canali e nel chip delle risposte. */
  name: string
  /** Informazioni della campagna: per l'AI sono l'unica fonte quando e' accesa. */
  text: string
  scopes: CampaignScopes
  /**
   * Da quando vale questa campagna (accesa, oppure testo cambiato mentre era accesa):
   * le correzioni della chat fatte dopo quest'ora valgono piu' della campagna.
   */
  activeSince: string | null
  updatedAt: string | null
  /** Id utente di chi l'ha salvata l'ultima volta. */
  updatedBy: string | null
}

export const MAX_CAMPAIGN_TEXT = 6000
export const MAX_CAMPAIGN_NAME = 80

/**
 * Canali gia' spuntati in una campagna nuova: messaggi privati ed email (dove si
 * chiude la vendita). I commenti no: sono pubblici e spesso parlano del post, non
 * della campagna; si accendono a mano.
 */
export const DEFAULT_SCOPES: CampaignScopes = {
  email: true,
  instagram_dm: true,
  instagram_comments: false,
  facebook_messenger: true,
  facebook_comments: false,
}

export const EMPTY_CAMPAIGN: Campaign = { active: false, name: '', text: '', scopes: DEFAULT_SCOPES, activeSince: null, updatedAt: null, updatedBy: null }

export const SCOPE_PLATFORM: Record<CampaignScope, CampaignPlatform> = {
  email: 'email',
  instagram_dm: 'instagram',
  instagram_comments: 'instagram',
  facebook_messenger: 'facebook',
  facebook_comments: 'facebook',
}

export const campaignKey = (workspaceId: string) => `campaign:${workspaceId}`
export const campaignRepliesKey = (workspaceId: string) => `campaign_replies:${workspaceId}`

/** Cosa sta rispondendo l'AI: un messaggio (email, Direct, Messenger) o un commento pubblico. */
export type ReplySurface = 'message' | 'comment'

/** Superficie della campagna per un canale; null = la campagna non vale li' (es. WhatsApp). */
export function campaignScopeFor(platform: string, surface: ReplySurface): CampaignScope | null {
  if (platform === 'email') return surface === 'message' ? 'email' : null
  if (platform === 'instagram') return surface === 'comment' ? 'instagram_comments' : 'instagram_dm'
  if (platform === 'facebook') return surface === 'comment' ? 'facebook_comments' : 'facebook_messenger'
  return null
}

const str = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '')
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

function asScopes(value: unknown, fallback: CampaignScopes): CampaignScopes {
  if (!value || typeof value !== 'object') return { ...fallback }
  const v = value as Record<string, unknown>
  return Object.fromEntries(CAMPAIGN_SCOPES.map((s) => [s, v[s] === true])) as CampaignScopes
}

/** Valore salvato → campagna (valori rotti o mancanti: campagna vuota e spenta). */
export function parseCampaign(raw: string | null): Campaign {
  if (!raw) return { ...EMPTY_CAMPAIGN, scopes: { ...DEFAULT_SCOPES } }
  try {
    const v = JSON.parse(raw) as Partial<Campaign> | null
    if (!v || typeof v !== 'object') return { ...EMPTY_CAMPAIGN, scopes: { ...DEFAULT_SCOPES } }
    return {
      active: v.active === true,
      name: oneLine(str(v.name, MAX_CAMPAIGN_NAME)),
      text: str(v.text, MAX_CAMPAIGN_TEXT),
      scopes: asScopes(v.scopes, DEFAULT_SCOPES),
      activeSince: typeof v.activeSince === 'string' ? v.activeSince : null,
      updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : null,
      updatedBy: typeof v.updatedBy === 'string' ? v.updatedBy : null,
    }
  } catch {
    return { ...EMPTY_CAMPAIGN, scopes: { ...DEFAULT_SCOPES } }
  }
}

/** Campagna dello spazio. Errore del database = errore (la risposta non parte con la fonte sbagliata). */
export async function readCampaign(workspaceId: string): Promise<Campaign> {
  const { value } = await readSetting(campaignKey(workspaceId))
  return parseCampaign(value)
}

/**
 * La campagna da usare per questa risposta, oppure null (spenta, senza testo o
 * canale non scelto): con null la risposta usa le Istruzioni come sempre.
 */
export function campaignFor(campaign: Campaign | null | undefined, platform: string, surface: ReplySurface): Campaign | null {
  if (!campaign?.active || !campaign.text.trim()) return null
  const scope = campaignScopeFor(platform, surface)
  return scope && campaign.scopes[scope] ? campaign : null
}

// --- Salvataggio (route /api/app/campaign) ----------------------------------------------

export type CampaignPatch = Partial<Pick<Campaign, 'active' | 'name' | 'text'>> & { scopes?: Partial<CampaignScopes> }

/** Corpo della richiesta → modifiche, oppure il messaggio di errore da mostrare. */
export function parseCampaignPatch(body: unknown): { patch: CampaignPatch } | { error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const patch: CampaignPatch = {}
  if (b.active !== undefined) {
    if (typeof b.active !== 'boolean') return { error: 'Valore non valido per «Attiva».' }
    patch.active = b.active
  }
  if (b.name !== undefined && b.name !== null) {
    if (typeof b.name !== 'string') return { error: 'Nome non valido.' }
    const name = oneLine(b.name)
    if (name.length > MAX_CAMPAIGN_NAME) return { error: `Nome troppo lungo (massimo ${MAX_CAMPAIGN_NAME} caratteri).` }
    patch.name = name
  }
  if (b.text !== undefined && b.text !== null) {
    if (typeof b.text !== 'string') return { error: 'Testo non valido.' }
    if (b.text.length > MAX_CAMPAIGN_TEXT) return { error: 'Testo troppo lungo (massimo 6.000 caratteri).' }
    patch.text = b.text
  }
  if (b.scopes !== undefined && b.scopes !== null) {
    if (typeof b.scopes !== 'object' || Array.isArray(b.scopes)) return { error: 'Canali non validi.' }
    const scopes: Partial<CampaignScopes> = {}
    for (const [key, value] of Object.entries(b.scopes as Record<string, unknown>)) {
      if (!(CAMPAIGN_SCOPES as readonly string[]).includes(key)) continue
      if (typeof value !== 'boolean') return { error: 'Canali non validi.' }
      scopes[key as CampaignScope] = value
    }
    patch.scopes = scopes
  }
  if (!Object.keys(patch).length) return { error: 'Niente da salvare.' }
  return { patch }
}

/** Perche' la campagna non si puo' accendere cosi' (null = va bene). */
export function activationError(campaign: Pick<Campaign, 'active' | 'text' | 'scopes'>): string | null {
  if (!campaign.active) return null
  if (!campaign.text.trim()) return 'Scrivi le informazioni della campagna prima di attivarla.'
  if (!CAMPAIGN_SCOPES.some((s) => campaign.scopes[s])) return 'Scegli almeno un canale in cui usare la campagna.'
  return null
}

export type SaveCampaignResult =
  | { ok: true; campaign: Campaign }
  | { ok: false; status: 400 | 409; error: string; campaign: Campaign }

/**
 * Salva le modifiche sulla campagna attuale (confronto sul timbro: due salvataggi
 * insieme non si perdono). Solo i canali collegati restano scelti. baseUpdatedAt:
 * updatedAt letto dalla pagina; se nel frattempo l'ha cambiata qualcun altro non si
 * sovrascrive (409), tranne per spegnerla e basta, che non fa perdere niente.
 */
export async function saveCampaign(
  workspaceId: string,
  patch: CampaignPatch,
  options: { userId: string; connected: ReadonlySet<string>; baseUpdatedAt?: string | null; now?: Date }
): Promise<SaveCampaignResult> {
  let refused: { status: 400 | 409; error: string } | null = null
  const onlySwitchOff = patch.active === false && Object.keys(patch).length === 1
  const saved = await updateSetting(campaignKey(workspaceId), parseCampaign, (current) => {
    refused = null
    if (!onlySwitchOff && options.baseUpdatedAt !== undefined && (current.updatedAt ?? null) !== (options.baseUpdatedAt ?? null)) {
      refused = { status: 409, error: 'Un’altra persona ha appena cambiato la campagna: ecco la versione nuova. Controllala e riprova.' }
      return false
    }
    const merged = { ...current.scopes, ...(patch.scopes || {}) }
    const scopes = Object.fromEntries(CAMPAIGN_SCOPES.map((s) => [s, merged[s] === true && options.connected.has(SCOPE_PLATFORM[s])])) as CampaignScopes
    const next = {
      active: patch.active ?? current.active,
      name: patch.name ?? current.name,
      text: patch.text ?? current.text,
      scopes,
    }
    const error = activationError(next)
    if (error) {
      refused = { status: 400, error }
      return false
    }
    // Timbro sempre nuovo (anche due salvataggi nello stesso millisecondo): serve al controllo dei conflitti.
    const now = new Date(Math.max((options.now || new Date()).getTime(), current.updatedAt ? new Date(current.updatedAt).getTime() + 1 : 0)).toISOString()
    // Nuova campagna (accesa ora, o testo cambiato mentre era accesa): le correzioni di prima valgono meno.
    const restarted = next.active && (!current.active || current.text !== next.text || !current.activeSince)
    return { ...next, activeSince: next.active ? (restarted ? now : current.activeSince) : null, updatedAt: now, updatedBy: options.userId }
  })
  const result = refused as { status: 400 | 409; error: string } | null
  if (result) return { ok: false, status: result.status, error: result.error, campaign: saved }
  return { ok: true, campaign: saved }
}

// --- Nel prompt delle risposte --------------------------------------------------------

const SCOPE_LABELS: Record<CampaignScope, string> = {
  email: 'le risposte email',
  instagram_dm: 'i messaggi Direct di Instagram',
  instagram_comments: 'i commenti pubblici su Instagram',
  facebook_messenger: 'i messaggi Messenger della Pagina Facebook',
  facebook_comments: 'i commenti pubblici su Facebook',
}

/**
 * Sezione del prompt che prende il posto delle Istruzioni (generali e del canale)
 * quando la campagna vale per questa risposta.
 */
export function campaignSection(campaign: Campaign, platform: string, surface: ReplySurface): string {
  const scope = campaignScopeFor(platform, surface)
  const name = campaign.name.trim()
  return [
    `## Campagna in corso${name ? `: «${name}»` : ''} (unica fonte di informazioni per questa risposta)`,
    `Il titolare ha attivato una campagna per ${scope ? SCOPE_LABELS[scope] : 'questo canale'}. In questa conversazione le informazioni della campagna prendono il posto delle Istruzioni dell'attività: sono l'unica fonte vera su offerte, prodotti, servizi, prezzi, date, orari, condizioni e link, e l'obiettivo della conversazione è quello della campagna.`,
    '- Usa solo le informazioni della campagna e la conversazione. Per offerte, prodotti, prezzi, date e condizioni non usare niente che venga da altre fonti (vecchie risposte, esempi delle correzioni, quello che sai in generale).',
    "- Se la campagna non risponde a una domanda, non cercare la risposta altrove e non inventarla: di' con naturalezza che glielo confermi a breve e aggiungi in fondo, su una riga a parte, [[DA CONFERMARE: cosa manca, in poche parole]].",
    '- Se un nostro messaggio precedente in questa conversazione dice altro su offerte, prezzi o date, vale la campagna (senza smentire un accordo già preso con questa persona).',
    '- Dove le regole qui sotto parlano di «Istruzioni» o «istruzioni», si intendono le informazioni della campagna.',
    '',
    '### Informazioni della campagna',
    campaign.text.trim(),
  ].join('\n')
}

// --- Risposte scritte con la campagna (chip "Campagna") --------------------------------

export type CampaignMark = { id: string; name: string; at: string }
const MAX_MARKS = 300

function parseMarks(raw: string | null): CampaignMark[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value)
      ? value.filter((m): m is CampaignMark => Boolean(m) && typeof m.id === 'string' && typeof m.at === 'string').map((m) => ({ id: m.id, name: str(m.name, MAX_CAMPAIGN_NAME), at: m.at }))
      : []
  } catch {
    return []
  }
}

/** Segna una risposta (bozza o inviata) scritta con la campagna. Mai bloccante. */
export async function markCampaignReply(workspaceId: string, messageId: string, campaign: Pick<Campaign, 'name'>): Promise<void> {
  try {
    await updateSetting(campaignRepliesKey(workspaceId), parseMarks, (list) => [
      { id: messageId, name: campaign.name.trim(), at: new Date().toISOString() },
      ...list.filter((m) => m.id !== messageId),
    ].slice(0, MAX_MARKS))
  } catch (error) {
    console.warn('saas campagna (segno risposta):', error instanceof Error ? error.message : error)
  }
}

/** Risposte scritte con la campagna, tra quelle indicate: id → nome della campagna ('' se senza nome). */
export async function campaignMarks(workspaceId: string, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  try {
    const wanted = new Set(ids)
    const { value } = await readSetting(campaignRepliesKey(workspaceId))
    return new Map(parseMarks(value).filter((m) => wanted.has(m.id)).map((m) => [m.id, m.name]))
  } catch {
    return new Map()
  }
}
